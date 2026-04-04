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
      return;
    }

    const STARTING_DUEL_COUNT = 3;

    const startedAt =
      new Date(duel.ready_both_at).getTime() + STARTING_DUEL_COUNT;

    const timeout = setTimeout(() => {
      this.logger.log(`[subscribe] Subscription TTL reached: duel=${duelId}`);
      client.send(
        JSON.stringify({ event: 'expired', data: 'Subscription TTL reached' }),
      );
      this.clearSubscription(client);
      client.close();
    }, this.subscriptionTtl);

    this.logger.log(
      `[subscribe] Client registered for duel=${duelId}, waiting for start signal`,
    );

    this.subscriptions.set(client, {
      duelId,
      durationSeconds,
      startedAt,
      started: false,
      interval: null,
      timeout,
    });
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

      client.send(JSON.stringify({ event: 'duel', data: payload }));
      this.logger.debug(
        `WS duel data sent: duel=${duelId} users=${payload.users.length} (${Date.now() - t0}ms)`,
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
    this.logger.log(
      `[notifyDuelStart] Firing start for duel=${duelId}`,
    );

    let notified = 0;

    for (const [client, sub] of this.subscriptions.entries()) {
      if (sub.duelId !== duelId || client.readyState !== WebSocket.OPEN) {
        continue;
      }

      sub.started = true;

      client.send(
        JSON.stringify({ event: 'start', data: { message: 'start', duelId } }),
      );

      // Kick off the periodic duel data interval now
      this.startDuelDataInterval(client, sub);
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
      clearTimeout(sub.timeout);
      this.subscriptions.delete(client);
    }
  }
}
