import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import WebSocket from 'ws';
import { Chains } from '../models/chains.js';
import { GnsTradingVariablesService } from './GnsTradingVariablesService.js';
import { DatabaseService } from './DatabaseService.js';
import { PositionsGateway } from '../gateways/positions.gateway.js';
import {
  GlobalTradingVariablesBackend,
  TradeContainerBackend,
} from '@gainsnetwork/sdk';

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

  // Tracks which wallets have had their MarketExecuted event received per duel
  // Key: duelId, Value: Set of wallet addresses that have been executed
  private readonly duelExecutedWallets = new Map<string, Set<string>>();

  constructor(
    private readonly tradingVariablesService: GnsTradingVariablesService,
    private readonly databaseService: DatabaseService,
    private readonly positionsGateway: PositionsGateway,
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

      case 'tradingVariables': {
        const tradingVariables = msg.value as GlobalTradingVariablesBackend;
        this.logger.log(`[${chain}] Received tradingVariables event`);
        this.tradingVariablesService.refreshTradingVariablesFromWs(
          chain,
          tradingVariables,
        );
        break;
      }

      case 'currentBlock':
        this.tradingVariablesService.updateCurrentBlock(chain, msg.value);
        break;

      case 'currentL1Block':
        this.tradingVariablesService.updateCurrentL1Block(chain, msg.value);
        break;

      case 'accBorrowingFeesPairUpdated': {
        const { collateralIndex, pairIndex, pairBorrowingFees } = msg.value;
        this.tradingVariablesService.updatePairAccBorrowingFee(chain, {
          collateralIndex: Number.parseInt(collateralIndex, 10),
          pairIndex: Number.parseInt(pairIndex, 10),
          pairBorrowingFees,
        });
        break;
      }

      case 'accBorrowingFeesGroupUpdated': {
        const { collateralIndex, groupIndex, groupBorrowingFees } = msg.value;
        this.tradingVariablesService.updateGroupAccBorrowingFee(chain, {
          collateralIndex: Number.parseInt(collateralIndex, 10),
          groupIndex: Number.parseInt(groupIndex, 10),
          groupBorrowingFees,
        });
        break;
      }

      case 'borrowingPairFeePerBlockCapUpdated':
        this.tradingVariablesService.updateBorrowingPairFeePerBlockCap(chain, {
          collateralIndex: Number.parseInt(msg.value.collateralIndex, 10),
          pairIndex: Number.parseInt(msg.value.pairIndex, 10),
          borrowingPairFeePerBlockCap: {
            minP: msg.value.borrowingFeePerBlockCap.minP,
            maxP: msg.value.borrowingFeePerBlockCap.maxP,
          },
        });
        break;

      case 'openInterestGroupUpdated':
        this.tradingVariablesService.updateOpenInterestGroup(chain, {
          collateralIndex: Number.parseInt(msg.value.collateralIndex, 10),
          groupIndex: Number.parseInt(msg.value.groupIndex, 10),
          groupBorrowingFees: {
            oiLong: msg.value.groupBorrowingFees.oiLong,
            oiShort: msg.value.groupBorrowingFees.oiShort,
          },
        });
        break;

      case 'openInterestPairUpdated':
        this.tradingVariablesService.updateOpenInterestPair(chain, {
          collateralIndex: Number.parseInt(msg.value.collateralIndex, 10),
          pairIndex: Number.parseInt(msg.value.pairIndex, 10),
          pairOi: msg.value.pairBorrowingFees,
        });
        break;

      case 'pendingAccFundingFeesStored':
        this.tradingVariablesService.updatePendingAccFundingFees(chain, {
          collateralIndex: Number.parseInt(msg.value.collateralIndex, 10),
          pairIndex: Number.parseInt(msg.value.pairIndex, 10),
          pairData: msg.value.pairData,
        });
        break;

      case 'pendingAccBorrowingFeesStored':
        this.tradingVariablesService.updatePendingAccBorrowingFees(chain, {
          collateralIndex: Number.parseInt(msg.value.collateralIndex, 10),
          pairIndex: Number.parseInt(msg.value.pairIndex, 10),
          pairData: msg.value.pairData,
        });
        break;

      case 'oiWindowUpdated': {
        const { windowId, newOi } = msg.value;
        this.tradingVariablesService.updateWindowOi(chain, {
          windowId: Number.parseInt(windowId, 10),
          newOi: {
            oiLongUsd: newOi.oiLongUsd || 0,
            oiShortUsd: newOi.oiShortUsd || 0,
          },
        });
        break;
      }

      case 'liveEvent': {
        this.handleLiveEvent(chain, msg.value);
        break;
      }

      default:
        break;
    }
  }

  private handleLiveEvent(chain: Chains, event: any): void {
    if (event?.event === 'MarketOpenCanceled') {
      console.log(`MarketOpenCanceled on ${chain}`);
      console.log(event);
    }

    if (event?.event !== 'MarketExecuted') return;

    const trader: string | undefined =
      event.returnValues?.user || event.returnValues?.trader;

    if (!trader) return;

    const open = event.returnValues?.open;

    this.logger.log(
      `[${chain}] MarketExecuted for trader ${trader} (open=${open})`,
    );

    if (!open) return;

    this.handleMarketExecutedForDuel(trader);
  }

  private async handleMarketExecutedForDuel(trader: string): Promise<void> {
    try {
      const duel = await this.databaseService.getActiveDuelByWallet(trader);

      if (!duel) {
        this.logger.debug(
          `[MarketExecuted] No active duel found for trader ${trader}`,
        );
        return;
      }

      const duelId = duel.id;

      let executed = this.duelExecutedWallets.get(duelId);
      if (!executed) {
        executed = new Set<string>();
        this.duelExecutedWallets.set(duelId, executed);
      }

      executed.add(trader.toLowerCase());

      this.logger.log(
        `[Duel ${duelId}] MarketExecuted received for ${trader} (${executed.size}/2)`,
      );

      if (executed.size >= 2) {
        this.logger.log(
          `[Duel ${duelId}] Both MarketExecuted received — notifying clients`,
        );
        this.positionsGateway.notifyDuelStart(duelId);
        this.duelExecutedWallets.delete(duelId);
      }
    } catch (err) {
      this.logger.error(`handleMarketExecutedForDuel failed: ${err}`);
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
