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
  interval: ReturnType<typeof setInterval>;
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

  handleConnection(client: WebSocket) {
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
    this.logger.log(`WS subscribe: duel=${duelId}`);

    // Validate duel exists upfront
    const duel = await this.databaseService.getDuelById(duelId);
    if (!duel) {
      client.send(
        JSON.stringify({ event: 'error', data: `Duel ${duelId} not found` }),
      );
      return;
    }

    const startedAt = Date.now();
    const durationSeconds = duel.duration_seconds;

    // Send initial data immediately
    await this.sendDuelData(client, duelId, durationSeconds, startedAt);

    const interval = setInterval(async () => {
      if (client.readyState !== WebSocket.OPEN) {
        this.clearSubscription(client);
        return;
      }

      const remainingMs = durationSeconds * 1000 - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        this.logger.log(`WS duel timer ended: duel=${duelId}`);
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

    const timeout = setTimeout(() => {
      this.logger.log(`WS subscription expired: duel=${duelId}`);
      client.send(
        JSON.stringify({ event: 'expired', data: 'Subscription TTL reached' }),
      );
      this.clearSubscription(client);
      client.close();
    }, this.subscriptionTtl);

    this.subscriptions.set(client, {
      duelId,
      durationSeconds,
      startedAt,
      interval,
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

  private clearSubscription(client: WebSocket) {
    const sub = this.subscriptions.get(client);
    if (sub) {
      clearInterval(sub.interval);
      clearTimeout(sub.timeout);
      this.subscriptions.delete(client);
    }
  }
}
