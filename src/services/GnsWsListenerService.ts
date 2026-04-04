import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import WebSocket from 'ws';
import { Chains } from '../models/chains.js';
import { GnsTradingVariablesService } from './GnsTradingVariablesService.js';
import { TradeContainerBackend } from '@gainsnetwork/sdk';

const wsUrlMap = new Map<Chains, string>([
  [Chains.Base, 'wss://backend-base.gains.trade'],
  [Chains.Arbitrum, 'wss://backend-arbitrum.gains.trade'],
  [Chains.Testnet, 'wss://backend-sepolia.gains.trade'],
]);

@Injectable()
export class GnsWsListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GnsWsListenerService.name);
  private readonly connections = new Map<Chains, WebSocket>();
  private readonly heartbeatTimers = new Map<
    Chains,
    ReturnType<typeof setInterval>
  >();
  private isShuttingDown = false;

  constructor(
    private readonly tradingVariablesService: GnsTradingVariablesService,
  ) {}

  onModuleInit() {
    for (const chain of Object.values(Chains)) {
      this.connect(chain);
    }
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    for (const chain of this.connections.keys()) {
      this.close(chain);
    }
  }

  private connect(chain: Chains): void {
    const url = wsUrlMap.get(chain);
    if (!url) return;

    this.logger.log(`[${chain}] Connecting to ${url}`);
    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.logger.log(`[${chain}] Connected`);
      this.startHeartbeat(chain, ws);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(chain, msg);
      } catch (err) {
        this.logger.error(`[${chain}] Failed to parse message: ${err}`);
      }
    });

    ws.on('error', (err) => {
      this.logger.error(`[${chain}] WS error: ${err.message}`);
    });

    ws.on('close', () => {
      this.logger.warn(`[${chain}] WS closed`);
      this.stopHeartbeat(chain);
      this.connections.delete(chain);

      if (!this.isShuttingDown) {
        setTimeout(() => this.connect(chain), 5000);
      }
    });

    this.connections.set(chain, ws);
  }

  private handleMessage(
    chain: Chains,
    msg: { name: string; value: any },
  ): void {
    switch (msg.name) {
      case 'registerTrade': {
        const tc = msg.value as TradeContainerBackend;
        this.tradingVariablesService.createOrUpdateTrade(chain, tc);
        break;
      }

      case 'unregisterTrade': {
        const { index, user } = msg.value;
        this.tradingVariablesService.unregisterTrade(
          chain,
          String(index),
          user,
        );
        break;
      }

      case 'updateTrade': {
        if (!msg.value?.trade) return;
        const tc = msg.value as TradeContainerBackend;
        this.tradingVariablesService.createOrUpdateTrade(chain, tc);
        break;
      }

      default:
        break;
    }
  }

  private startHeartbeat(chain: Chains, ws: WebSocket): void {
    const timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('heartbeat');
      }
    }, 30_000);
    this.heartbeatTimers.set(chain, timer);
  }

  private stopHeartbeat(chain: Chains): void {
    const timer = this.heartbeatTimers.get(chain);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(chain);
    }
  }

  private close(chain: Chains): void {
    this.stopHeartbeat(chain);
    const ws = this.connections.get(chain);
    if (ws) {
      ws.close();
      this.connections.delete(chain);
    }
  }
}
