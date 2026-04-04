import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import WebSocket, { Server } from 'ws';
import { DatabaseService } from '../services/DatabaseService';

interface DuelSubscription {
  duelId: string;
  durationSeconds: number;
  startedAt: number;
  started: boolean;
  interval: ReturnType<typeof setInterval> | null;
  startDelay: ReturnType<typeof setTimeout> | null;
  timeout: ReturnType<typeof setTimeout>;
}

@WebSocketGateway({ path: '/ws/positions' })
export class PositionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PositionsGateway.name);
  private readonly subscriptionTtl = 10 * 60 * 1_000; // 10 minutes
  private subscriptions = new Map<WebSocket, DuelSubscription>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly databaseService: DatabaseService) {}

  handleConnection(_client: WebSocket) {
    this.logger.log(
      `WS client connected (active: ${this.subscriptions.size + 1})`,
    );
  }

  handleDisconnect(client: WebSocket) {
    const sub = this.subscriptions.get(client);
    this.logger.log(
      `WS client disconnected${sub ? ` (duel=${sub.duelId})` : ''}`,
    );
    this.clearSubscription(client);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { duelId: string },
  ) {
    this.clearSubscription(client);

    const { duelId } = data;
    this.logger.log(`[subscribe] Client subscribed to duel=${duelId}`);

    // Validate duel exists upfront
    const duel = await this.databaseService.getDuelById(duelId);
    if (!duel) {
      this.logger.warn(`[subscribe] Duel ${duelId} not found`);
      client.send(
        JSON.stringify({ event: 'error', data: `Duel ${duelId} not found` }),
      );
      this.logger.log(`[ws:send] event=error duel=${duelId} reason=not_found`);
      return;
    }

    const durationSeconds = duel.duration_seconds;

    if (!duel.ready_both_at) {
      this.logger.warn(`[subscribe] Duel ${duelId} has not started yet`);
      client.send(
        JSON.stringify({
          event: 'error',
          data: `Duel ${duelId} has not started yet`,
        }),
      );
      this.logger.log(`[ws:send] event=error duel=${duelId} reason=not_started`);
      return;
    }

    const timeout = setTimeout(() => {
      this.logger.log(`[subscribe] Subscription TTL reached: duel=${duelId}`);
      client.send(
        JSON.stringify({ event: 'expired', data: 'Subscription TTL reached' }),
      );
      this.logger.log(`[ws:send] event=expired duel=${duelId} reason=ttl_reached`);
      this.clearSubscription(client);
      client.close();
    }, this.subscriptionTtl);

    const alreadyLive = !!duel.duel_live_at;
    // For reconnects use duel_live_at; for first start, startedAt will be set in notifyDuelStart
    const startedAt = alreadyLive
      ? new Date(duel.duel_live_at!).getTime()
      : 0;

    const sub: DuelSubscription = {
      duelId,
      durationSeconds,
      startedAt,
      started: alreadyLive,
      interval: null,
      startDelay: null,
      timeout,
    };

    this.subscriptions.set(client, sub);

    if (alreadyLive) {
      this.logger.log(
        `[subscribe] Duel ${duelId} already live (duel_live_at=${duel.duel_live_at}) — sending positions immediately`,
      );
      this.startDuelDataInterval(client, sub);
    } else {
      this.logger.log(
        `[subscribe] Client registered for duel=${duelId}, waiting for start signal`,
      );
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: WebSocket) {
    const sub = this.subscriptions.get(client);
    this.logger.log(`WS unsubscribe${sub ? `: duel=${sub.duelId}` : ''}`);
    this.clearSubscription(client);
  }

  private async sendDuelData(
    client: WebSocket,
    duelId: string,
    durationSeconds: number,
    startedAt: number,
  ) {
    const t0 = Date.now();
    try {
      const elapsedMs = Date.now() - startedAt;
      const remainingSeconds = Math.max(
        0,
        Math.round(durationSeconds - elapsedMs / 1000),
      );

      const payload = await this.databaseService.buildDuelPayload(
        duelId,
        remainingSeconds,
      );

      if (!payload) {
        client.send(
          JSON.stringify({ event: 'error', data: `Duel ${duelId} not found` }),
        );
        return;
      }

      const msg = JSON.stringify({ event: 'duel', data: payload });
      client.send(msg);
      this.logger.log(
        `[ws:send] event=duel duel=${duelId} remainingSeconds=${payload.remainingSeconds} users=${payload.users.length} positions=${payload.users.map((u: any) => u.positions?.length ?? 0).join(',')} (${Date.now() - t0}ms)`,
      );
    } catch (err) {
      this.logger.error(
        `WS sendDuelData failed: duel=${duelId} (${Date.now() - t0}ms): ${err}`,
      );
      client.send(
        JSON.stringify({ event: 'error', data: (err as Error).message }),
      );
    }
  }

  notifyDuelStart(duelId: string) {
    this.logger.log(`[notifyDuelStart] Firing start for duel=${duelId}`);

    let notified = 0;

    for (const [client, sub] of this.subscriptions.entries()) {
      if (sub.duelId !== duelId || client.readyState !== WebSocket.OPEN) {
        continue;
      }

      sub.started = true;

      const startMsg = { event: 'start', data: { message: 'start', duelId } };
      client.send(JSON.stringify(startMsg));
      this.logger.log(
        `[ws:send] event=start duel=${duelId}`,
      );

      this.logger.log(
        `[notifyDuelStart] duel=${duelId} — delaying position data by 3s`,
      );
      sub.startDelay = setTimeout(() => {
        sub.startDelay = null;
        if (client.readyState !== WebSocket.OPEN) return;
        // Timer starts now — when positions actually begin flowing
        sub.startedAt = Date.now();
        this.logger.log(
          `[notifyDuelStart] duel=${duelId} — 3s elapsed, starting position data (startedAt=${sub.startedAt})`,
        );
        this.startDuelDataInterval(client, sub);
      }, 3_000);

      notified++;
    }

    this.logger.log(
      `[notifyDuelStart] duel=${duelId} — notified ${notified} client(s)`,
    );
  }

  private startDuelDataInterval(client: WebSocket, sub: DuelSubscription) {
    const { duelId, durationSeconds, startedAt } = sub;

    // Send initial data immediately
    this.sendDuelData(client, duelId, durationSeconds, startedAt);

    sub.interval = setInterval(async () => {
      if (client.readyState !== WebSocket.OPEN) {
        this.clearSubscription(client);
        return;
      }

      const remainingMs = durationSeconds * 1000 - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        this.logger.log(`[interval] Duel timer ended: duel=${duelId}`);
        await this.sendDuelData(client, duelId, durationSeconds, startedAt);
        client.send(
          JSON.stringify({ event: 'expired', data: 'Duel duration ended' }),
        );
        this.logger.log(`[ws:send] event=expired duel=${duelId} reason=duration_ended`);
        this.clearSubscription(client);
        client.close();
        return;
      }

      await this.sendDuelData(client, duelId, durationSeconds, startedAt);
    }, 1_000);
  }

  private clearSubscription(client: WebSocket) {
    const sub = this.subscriptions.get(client);
    if (sub) {
      if (sub.interval) clearInterval(sub.interval);
      if (sub.startDelay) clearTimeout(sub.startDelay);
      clearTimeout(sub.timeout);
      this.subscriptions.delete(client);
    }
  }
}
