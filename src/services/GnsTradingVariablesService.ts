import axios from 'axios';
import { Chains } from 'src/models/chains';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  buildComprehensivePnlContext,
  buildLiquidationPriceContext,
  GetComprehensivePnlContext,
  GetLiquidationPriceContext,
  GlobalTradingVariablesBackend,
  TradeContainer,
  TradeContainerBackend,
  TradeType,
  TransformedGlobalTrades,
  TransformedGlobalTradingVariables,
  transformGlobalTrades,
  transformGlobalTradingVariables,
  UserPriceImpact,
} from '@gainsnetwork/sdk';

const urlMap = new Map([
  [Chains.Base, 'https://backend-base.gains.trade/'],
  [Chains.Arbitrum, 'https://backend-arbitrum.gains.trade/'],
  [Chains.Testnet, 'https://backend-sepolia.gains.trade/'],
]);

@Injectable()
export class GnsTradingVariablesService implements OnModuleInit {
  private readonly logger = new Logger(GnsTradingVariablesService.name);
  private readonly tradingVariablesUrl: string = 'trading-variables/all';
  private readonly openTradesUrl: string = 'open-trades';

  private tradingVariablesBackendByChain: Map<
    Chains,
    GlobalTradingVariablesBackend
  > = new Map();
  private tradingVariablesByChain: Map<
    Chains,
    TransformedGlobalTradingVariables
  > = new Map();
  private tradesByChain: Map<Chains, TradeContainerBackend[]> = new Map();

  async onModuleInit() {
    const chains = Object.values(Chains);

    await Promise.all(
      chains.flatMap((chain) => [
        this.refreshTradingVariables(chain),
        this.refreshTrades(chain),
      ]),
    );

    this.logger.log('Initialized trading variables and trades for all chains');
  }

  public getAllTraderPositions(
    chain: Chains,
    trader: string,
  ): TradeContainer[] {
    const t0 = Date.now();
    const tv = this.tradingVariablesByChain.get(chain);
    if (!tv) {
      this.logger.warn(
        `getAllTraderPositions: no trading variables for chain=${chain}`,
      );
      return [];
    }

    const { pairs, collaterals } = tv.globalTradingVariables;

    if (!pairs) {
      this.logger.warn(
        `getAllTraderPositions: no pairs for chain=${chain}`,
      );
      return [];
    }

    const tradesByChain = this.tradesByChain.get(chain);

    if (!tradesByChain) {
      this.logger.warn(
        `getAllTraderPositions: no trades loaded for chain=${chain}`,
      );
      return [];
    }

    const transformedTradesForTrader = transformGlobalTrades(
      tradesByChain,
      pairs,
      trader,
      collaterals,
    );

    if (!transformedTradesForTrader) {
      this.logger.debug(
        `getAllTraderPositions: no trades found for trader=${trader} chain=${chain}`,
      );
      return [];
    }

    const trades: TradeContainer[] = [];

    for (const [_, tradeMap] of transformedTradesForTrader.trades) {
      for (const [_, trade] of tradeMap) {
        trades.push(trade);
      }
    }

    this.logger.log(
      `getAllTraderPositions: trader=${trader} chain=${chain} -> ${trades.length} trades (${Date.now() - t0}ms)`,
    );
    return trades;
  }

  public getLiquidationPriceContext(
    chain: Chains,
    {
      tradeContainer,
      currentPairPrice,
      beforeOpened = false,
      additionalFeeCollateral = 0,
      userPriceImpact,
    }: {
      tradeContainer: TradeContainer;
      currentPairPrice: number;
      beforeOpened?: boolean;
      additionalFeeCollateral?: number;
      userPriceImpact?: UserPriceImpact;
    },
  ): GetLiquidationPriceContext | undefined {
    const tv = this.tradingVariablesByChain.get(chain);
    if (!tv) return undefined;

    const { globalTradingVariables, blockNumber } = tv;
    const pair = this.getPair(chain, tradeContainer.trade.pairIndex);
    if (!pair) return undefined;

    const liquidationContext = buildLiquidationPriceContext(
      globalTradingVariables,
      tradeContainer,
      {
        currentBlock: blockNumber!,
        currentTimestamp: Math.floor(Date.now() / 1000),
        currentPairPrice,
        spreadP: pair.spreadP,
        beforeOpened,
        additionalFeeCollateral,
        userPriceImpact,
      },
    );

    return liquidationContext;
  }

  public getPnlContext(
    chain: Chains,
    tradeContainer: TradeContainer,
  ): GetComprehensivePnlContext | undefined {
    const tradingVariables = this.tradingVariablesByChain.get(chain);

    if (!tradingVariables) {
      this.logger.log(`Trading variables not found in getPnlContext`);
      return;
    }

    const { globalTradingVariables, blockNumber } = tradingVariables;

    if (!blockNumber) {
      this.logger.log(`blockNumber not found in getPnlContext`);
      return;
    }

    const pnlContext = buildComprehensivePnlContext(
      globalTradingVariables,
      tradeContainer,
      {
        currentBlock: blockNumber,
        currentTimestamp: Math.floor(Date.now() / 1000),
        traderFeeMultiplier: 1,
      },
    );

    return pnlContext;
  }

  public getAllPairs(chain: Chains) {
    const t0 = Date.now();
    const tv = this.tradingVariablesByChain.get(chain);

    if (!tv) {
      this.logger.warn(`getAllPairs: no trading variables for chain=${chain}`);
      return [];
    }

    const pairs = tv.globalTradingVariables.pairs ?? [];

    const filtered = pairs.filter((p) => {
      const leverage =
        tv.globalTradingVariables?.pairMaxLeverages![p.pairIndex];
      return leverage !== 0.001;
    });

    this.logger.log(
      `getAllPairs: chain=${chain} -> ${filtered.length}/${pairs.length} active pairs (${Date.now() - t0}ms)`,
    );
    return filtered;
  }

  public getPair(chain: Chains, index: number) {
    const tv = this.tradingVariablesByChain.get(chain);
    if (!tv) return undefined;
    return tv.globalTradingVariables.pairs?.[index];
  }

  private async refreshTradingVariables(
    chain: Chains,
    newTradingVariables?: GlobalTradingVariablesBackend,
  ): Promise<void> {
    this.logger.log(
      `Refreshing trading variables on ${chain} (${newTradingVariables ? 'with input' : 'no input'})`,
    );

    try {
      let backend =
        this.tradingVariablesBackendByChain.get(chain) ??
        ({} as GlobalTradingVariablesBackend);

      if (newTradingVariables) {
        Object.entries(newTradingVariables).forEach(([key, value]) => {
          if (key in backend) {
            backend[key] = value;
          }
        });
      } else {
        const fetched = await this.fetchTradingVariables(chain);

        if (!fetched) {
          this.logger.error(
            `[REFRESH_TRADING_VARIABLES | ${chain}] No trading variables returned from GNS API`,
          );
          return;
        }

        backend = fetched;
      }

      this.tradingVariablesBackendByChain.set(chain, backend);
      this.tradingVariablesByChain.set(
        chain,
        transformGlobalTradingVariables(backend),
      );
    } catch (error) {
      this.logger.error(
        `Error fetching trading variables for ${chain}: ${error}`,
      );
    }
  }

  private async refreshTrades(chain: Chains): Promise<void> {
    this.fetchOpenTrades(chain)
      .then((trades) => {
        this.tradesByChain.set(chain, trades);
        this.logger.log(
          `[REFRESH_TRADES | ${chain}] Refreshed ${trades.length} trades`,
        );
      })
      .catch((error) => {
        this.handleAxiosError('Error fetching open trades', error);
      });
  }

  private async fetchTradingVariables(
    chain: Chains,
  ): Promise<GlobalTradingVariablesBackend | undefined> {
    try {
      const url = urlMap.get(chain);

      const response = await this.makeAxiosRequest(
        url + this.tradingVariablesUrl,
      );

      return response.data;
    } catch (error) {
      this.handleAxiosError('Error fetching trading variables', error);
    }
  }

  private async fetchOpenTrades(
    chain: Chains,
  ): Promise<TradeContainerBackend[]> {
    try {
      const url = urlMap.get(chain);

      const response = await this.makeAxiosRequest(url + this.openTradesUrl);

      return response.data;
    } catch (error) {
      this.handleAxiosError('Error fetching open trades', error);

      return [];
    }
  }

  private async makeAxiosRequest(url: string, options?: any): Promise<any> {
    const method = options?.method || 'GET';

    const t0 = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);

    const request =
      method.toUpperCase() === 'POST'
        ? axios.post(url, options?.data, options)
        : axios.get(url, options);

    this.logger.log(
      `Sending ${method.toUpperCase()} request to ${url} (REQ ID:${randomId})`,
    );

    return request.then((response) => {
      this.logger.log(
        `Received response in ${Date.now() - t0}ms (REQ ID:${randomId})`,
      );

      return response;
    });
  }

  private handleAxiosError(message: string, error: unknown) {
    if (axios.isAxiosError(error)) {
      this.logger.error(`🔴 ${message}: ${error.message}`);

      if (error.response) {
        const { status, data } = error.response;

        this.logger.error(`Response status: ${status}`);
        this.logger.error(`Response data: ${JSON.stringify(data)}`);
      } else if (error.request) {
        this.logger.error('No response received from server');
      } else {
        this.logger.error(`Request setup failed: ${error.message}`);
      }
    } else {
      this.logger.error(`An unexpected error occurred: ${String(error)}`);
    }
  }
}
