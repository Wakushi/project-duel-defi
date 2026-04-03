import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GainsController } from './controllers/gains.controller';
import { GnsPriceFeedListenerService } from './services/GnsPriceFeedListenerService';
import { GnsPositionService } from './services/GnsPositionService';
import { GnsTradingVariablesService } from './services/GnsTradingVariablesService';
import { PositionsGateway } from './gateways/positions.gateway';

@Module({
  imports: [],
  controllers: [AppController, GainsController],
  providers: [AppService, GnsPriceFeedListenerService, GnsPositionService, GnsTradingVariablesService, PositionsGateway],
})
export class AppModule {}
