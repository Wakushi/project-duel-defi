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
import { Chains } from '../models/chains';
import { GnsPositionService } from '../services/GnsPositionService';

interface Subscription {
  chain: Chains;
  user: string;
  interval: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
}

@WebSocketGateway({ path: '/ws/positions' })
export class PositionsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PositionsGateway.name);
  private readonly subscriptionTtl = 10 * 60 * 1_000; // 10 minutes
  private subscriptions = new Map<WebSocket, Subscription>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly positionService: GnsPositionService) {}

  handleConnection(client: WebSocket) {
    this.logger.log('Client connected');
  }

  handleDisconnect(client: WebSocket) {
    this.logger.log('Client disconnected');
    this.clearSubscription(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: { chain: Chains; user: string },
  ) {
    this.clearSubscription(client);

    const { chain, user } = data;
    this.logger.log(`Client subscribed: ${user} on ${chain}`);

    this.sendPositions(client, chain, user);

    const interval = setInterval(() => {
      if (client.readyState !== WebSocket.OPEN) {
        this.clearSubscription(client);
        return;
      }
      this.sendPositions(client, chain, user);
    }, 1_000);

    // Auto-disconnect after TTL
    const timeout = setTimeout(() => {
      this.logger.log(`Subscription expired for ${user} on ${chain}`);
      client.send(
        JSON.stringify({ event: 'expired', data: 'Subscription TTL reached' }),
      );
      this.clearSubscription(client);
      client.close();
    }, this.subscriptionTtl);

    this.subscriptions.set(client, { chain, user, interval, timeout });
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(@ConnectedSocket() client: WebSocket) {
    this.clearSubscription(client);
  }

  private sendPositions(client: WebSocket, chain: Chains, user: string) {
    try {
      const positions = this.positionService.getPositions({ chain, user });
      client.send(JSON.stringify({ event: 'positions', data: positions }));
    } catch (err) {
      client.send(
        JSON.stringify({
          event: 'error',
          data: (err as Error).message,
        }),
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
