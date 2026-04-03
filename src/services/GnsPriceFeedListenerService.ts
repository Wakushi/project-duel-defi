import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

@Injectable()
export class GnsPriceFeedListenerService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GnsPriceFeedListenerService.name);
  private readonly wssUrl = 'wss://backend-pricing.eu.gains.trade';

  private ws: WebSocket | null = null;
  private isShuttingDown = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly reconnectInterval = 5_000;
  private readonly maxReconnectAttempts = 20;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatInterval = 30_000;

  public priceMap: Map<number, number> = new Map();
  public priceMap24hAgo: Map<number, number> = new Map();

  async onModuleInit() {
    await this.init();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  private async init() {
    this.connect();
  }

  private async shutdown() {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;

    this.stopHeartbeat();

    this.ws?.close();

    this.logger.log('Shut down');
  }

  private connect() {
    if (this.isShuttingDown) return;

    this.isReconnecting = false;
    this.ws = new WebSocket(this.wssUrl);

    this.ws.on('open', () => {
      this.logger.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      const d = raw.toString();
      const data = d
        .slice(1, d.length - 1)
        .split(',')
        .map(Number);

      if (data.length % 2 !== 0) return;

      for (let i = 0; i < data.length; i += 2) {
        const pairIndex = data[i];
        const price = data[i + 1];
        this.priceMap.set(pairIndex, price);
        this.emit('priceUpdate', { pairIndex, price });
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`WebSocket error: ${err.message}`);
      this.stopHeartbeat();
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
      this.stopHeartbeat();
      if (!this.isShuttingDown) this.reconnect();
    });
  }

  private reconnect() {
    if (this.isShuttingDown || this.isReconnecting) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`,
      );
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.logger.log(
      `Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts})`,
    );

    setTimeout(() => this.connect(), this.reconnectInterval);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('heartbeat');
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public getPairPrice(pairIndex: number): {
    price: number;
    price24hAgo: number;
    percentChange: number;
  } {
    const price = this.priceMap.get(pairIndex);
    if (price === undefined)
      throw new Error(`No price for pairIndex ${pairIndex}`);
    const price24hAgo = this.priceMap24hAgo.get(pairIndex) ?? price;
    const percentChange = (price - price24hAgo) / price24hAgo;
    return { price, price24hAgo, percentChange };
  }
}
