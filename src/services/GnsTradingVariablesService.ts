import axios from 'axios';
import { Chains } from 'src/models/chains';
import { Injectable, Logger } from '@nestjs/common';
import {
  GlobalTradingVariablesBackend,
  TradeContainerBackend,
  TransformedGlobalTradingVariables,
  transformGlobalTradingVariables,
} from '@gainsnetwork/sdk';

const urlMap = new Map([
  [Chains.Base, 'https://backend-base.gains.trade/'],
  [Chains.Arbitrum, 'https://backend-arbitrum.gains.trade/'],
  [Chains.Testnet, 'https://backend-sepolia.gains.trade/'],
]);

@Injectable()
export class GnsTradingVariablesService {
  private readonly logger = new Logger(GnsTradingVariablesService.name);
  private readonly tradingVariablesUrl: string = 'trading-variables/all';
  private readonly openTradesUrl: string = 'open-trades';

  private tradingVariablesBackend: GlobalTradingVariablesBackend =
    {} as GlobalTradingVariablesBackend;

  private tradingVariables: TransformedGlobalTradingVariables =
    {} as TransformedGlobalTradingVariables;

  private allTrades: TradeContainerBackend[] = [];

  private isRefreshingTrades = false;

  public async refreshTradingVariables(
    chain: Chains,
    newTradingVariables?: GlobalTradingVariablesBackend,
  ): Promise<void> {
    this.logger.log(
      `Refreshing trading variables on ${chain} (${newTradingVariables ? 'with input' : 'no input'})`,
    );

    try {
      if (newTradingVariables) {
        Object.entries(newTradingVariables).forEach(([key, value]) => {
          if (key in this.tradingVariablesBackend) {
            this.tradingVariablesBackend[key] = value;
          }
        });
      } else {
        const tradingVariables = await this.fetchTradingVariables(chain);

        if (!tradingVariables) {
          this.logger.error(
            `[REFRESH_TRADING_VARIABLES | ${chain}] No trading variables returned from GNS API`,
          );
          return;
        }

        this.tradingVariablesBackend = tradingVariables;
      }

      this.tradingVariables = transformGlobalTradingVariables(
        this.tradingVariablesBackend,
      );
    } catch (error) {
      this.logger.error(
        `Error fetching trading variables for ${chain}: ${error}`,
      );
    }
  }

  public async refreshTrades(chain: Chains): Promise<void> {
    if (this.isRefreshingTrades) return;

    this.isRefreshingTrades = true;

    this.fetchOpenTrades(chain)
      .then((trades) => {
        this.allTrades = trades;
        this.logger.log(
          `[REFRESH_TRADES | ${chain}] 🟢 Refreshed ${this.allTrades.length} trades`,
        );
      })
      .catch((error) => {
        this.handleAxiosError('Error fetching open trades', error);
      })
      .finally(() => {
        this.isRefreshingTrades = false;
      });
  }

  private async fetchTradingVariables(
    chain: Chains,
  ): Promise<GlobalTradingVariablesBackend | undefined> {
    try {
      const url = urlMap[chain];

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
      const url = urlMap[chain];

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
