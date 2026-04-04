import {
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Chains } from '../models/chains';
import { GnsPriceFeedListenerService } from '../services/GnsPriceFeedListenerService';
import { GnsPositionService } from '../services/GnsPositionService';
import { GnsTradingVariablesService } from '../services/GnsTradingVariablesService';
import { MobulaService } from 'src/services/MobulaService';

@Controller('gains')
export class GainsController {
  private readonly logger = new Logger(GainsController.name);

  constructor(
    private readonly priceFeedService: GnsPriceFeedListenerService,
    private readonly positionService: GnsPositionService,
    private readonly mobulaService: MobulaService,
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
  async getAllPairs(@Query('chain') chain: Chains) {
    const t0 = Date.now();

    const pairs = this.tradingVariablesService.getAllPairs(chain);
    const onlyCryptoPairs = pairs.filter((p) => p.groupIndex === 10);
    const tPairs = Date.now();

    this.logger.log(
      `getAllPairs: fetched & filtered pairs in ${tPairs - t0}ms`,
    );

    const topPairs = onlyCryptoPairs;
    const tokenSymbols = topPairs.map((t) => t.from);
    const tokensMetadata = await this.mobulaService.getMultiData(tokenSymbols);

    const tMobula = Date.now();
    this.logger.log(
      `getAllPairs: mobula getMultiData in ${tMobula - tPairs}ms`,
    );

    const enrichedPairs = topPairs.map((pair) => {
      const priceData = this.priceFeedService.priceMap.get(pair.pairIndex);
      const price24hAgo = this.priceFeedService.priceMap24hAgo.get(
        pair.pairIndex,
      );
      const percentChange =
        priceData && price24hAgo ? (priceData - price24hAgo) / price24hAgo : 0;

      const metadata = tokensMetadata[pair.from];

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
        logo: metadata?.logo ?? null,
      };
    });

    this.logger.log(`getAllPairs: total ${Date.now() - t0}ms`);
    return enrichedPairs;
  }
}
