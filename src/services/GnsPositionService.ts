import {
  ComprehensivePnlResult,
  getComprehensivePnl,
  GetComprehensivePnlContext,
  getLiquidationPrice,
  TradeContainer,
} from '@gainsnetwork/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Chains } from 'src/models/chains';
import { GnsTradingVariablesService } from './GnsTradingVariablesService';
import { GnsPriceFeedListenerService } from './GnsPriceFeedListenerService';

@Injectable()
export class GnsPositionService {
  private readonly logger = new Logger(GnsPositionService.name);

  constructor(
    private readonly gnsTradingVariablesService: GnsTradingVariablesService,
    private readonly gnsPriceFeedListenerService: GnsPriceFeedListenerService,
  ) {}

  public getPositions({
    chain,
    user,
  }: {
    chain: Chains;
    user: string;
  }): any | undefined {
    const allUserTrades = this.gnsTradingVariablesService.getAllTraderPositions(
      chain,
      user,
    );

    const enrichedTrades: any = [];

    allUserTrades.forEach((tradeC) => {
      const { price } = this.gnsPriceFeedListenerService.getPairPrice(
        tradeC.trade.pairIndex,
      );

      const liqPriceContext =
        this.gnsTradingVariablesService.getLiquidationPriceContext(chain, {
          tradeContainer: tradeC,
          currentPairPrice: price,
        });

      if (!liqPriceContext) {
        this.logger.error(`liqPriceContext is undefined`);
        return;
      }

      const liquidationPrice = getLiquidationPrice(
        tradeC.trade,
        liqPriceContext,
      );

      const pnlResult = this.getPnl(chain, tradeC);

      if (!pnlResult?.pnl) return;

      const { uPnlCollateral, uPnlPercent } = pnlResult.pnl;

      const pair = this.gnsTradingVariablesService.getPair(
        chain,
        tradeC.trade.pairIndex,
      );

      if (!pair) {
        this.logger.error(
          `Pair not found on pair index ${tradeC.trade.pairIndex} and chain ${chain}`,
        );
        return;
      }

      const enrichedTrade = {
        pair: pair.name,
        pairIndex: tradeC.trade.pairIndex,
        tradeType: tradeC.trade.tradeType,
        percentChange: uPnlPercent,
        pnl: uPnlCollateral,
        index: tradeC.trade.index,
        openPrice: tradeC.trade.openPrice,
        currentPriceUsdDecimaled: price,
        collateral: tradeC.trade.collateralAmount,
        isLong: tradeC.trade.long,
        leverage: tradeC.trade.leverage,
        liqUsdDecimaled: liquidationPrice,
        chain,
      };

      enrichedTrades.push(enrichedTrade);
    });

    return enrichedTrades;
  }

  private getPnl(
    chain: Chains,
    tradeContainer: TradeContainer,
  ):
    | { pnl: ComprehensivePnlResult; pnlContext: GetComprehensivePnlContext }
    | undefined {
    const pnlContext = this.gnsTradingVariablesService.getPnlContext(
      chain,
      tradeContainer,
    );

    if (!pnlContext) {
      this.logger.log(`pnlContext not found in getPnl`);
      return;
    }

    const { price } = this.gnsPriceFeedListenerService.getPairPrice(
      tradeContainer.trade.pairIndex,
    );

    const { trade, tradeInfo } = tradeContainer;

    const pnl = getComprehensivePnl(
      trade,
      price,
      trade.openPrice,
      tradeInfo,
      pnlContext,
    );

    return { pnl, pnlContext };
  }
}
