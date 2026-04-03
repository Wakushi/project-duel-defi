import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Chains } from '../models/chains';
import { GnsPriceFeedListenerService } from '../services/GnsPriceFeedListenerService';
import { GnsPositionService } from '../services/GnsPositionService';

@Controller('gains')
export class GainsController {
  constructor(
    private readonly priceFeedService: GnsPriceFeedListenerService,
    private readonly positionService: GnsPositionService,
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
}
