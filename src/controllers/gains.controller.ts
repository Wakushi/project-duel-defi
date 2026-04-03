import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { GnsPriceFeedListenerService } from '../services/GnsPriceFeedListenerService';

@Controller('gains')
export class GainsController {
  constructor(private readonly priceFeedService: GnsPriceFeedListenerService) {}

  @Get('price/:pairIndex')
  getPairPrice(@Param('pairIndex', ParseIntPipe) pairIndex: number) {
    return this.priceFeedService.getPairPrice(pairIndex);
  }
}
