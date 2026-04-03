import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Chains } from '../models/chains';
import { GnsPriceFeedListenerService } from '../services/GnsPriceFeedListenerService';
import { GnsPositionService } from '../services/GnsPositionService';
import { GnsTradingVariablesService } from '../services/GnsTradingVariablesService';

@Controller('gains')
export class GainsController {
  constructor(
    private readonly priceFeedService: GnsPriceFeedListenerService,
    private readonly positionService: GnsPositionService,
    private readonly tradingVariablesService: GnsTradingVariablesService,
  ) {}

  @Get('price/:pairIndex')
  getPairPrice(@Param('pairIndex', ParseIntPipe) pairIndex: number) {
    return this.priceFeedService.getPairPrice(pairIndex);
  }

  @Get('trades/:address')
  getTradesByAddress(
    @Param('address') address: string,
    @Query('chain') chain: Chains,
  ) {
    const positions = this.positionService.getPositions({
      chain,
      user: address,
    });

    return positions;
  }

  @Get('pairs')
  getAllPairs(@Query('chain') chain: Chains) {
    const pairs = this.tradingVariablesService.getAllPairs(chain);
    const onlyCryptoPairs = pairs.filter((p) => p.groupIndex === 10);

    const topPairs = onlyCryptoPairs.slice(0, 24);

    const enrichedPairs = topPairs.map((pair) => {
      const priceData = this.priceFeedService.priceMap.get(pair.pairIndex);
      const price24hAgo = this.priceFeedService.priceMap24hAgo.get(
        pair.pairIndex,
      );
      const percentChange =
        priceData && price24hAgo ? (priceData - price24hAgo) / price24hAgo : 0;

      return {
        pairIndex: pair.pairIndex,
        name: pair.name,
        from: pair.from,
        to: pair.to,
        groupIndex: pair.groupIndex,
        feeIndex: pair.feeIndex,
        spreadP: pair.spreadP,
        price: priceData ?? null,
        price24hAgo: price24hAgo ?? null,
        percentChange,
      };
    });

    return enrichedPairs;
  }
}
