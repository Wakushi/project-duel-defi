import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Chains } from '../models/chains';
import { GnsPriceFeedListenerService } from '../services/GnsPriceFeedListenerService';
import { GnsTradingVariablesService } from '../services/GnsTradingVariablesService';

@Controller('gains')
export class GainsController {
  constructor(
    private readonly priceFeedService: GnsPriceFeedListenerService,
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
    return this.tradingVariablesService.getTradesByAddress(chain, address);
  }
}
