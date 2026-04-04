import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GainsController } from './controllers/gains.controller';
import { DuelsController } from './controllers/duels.controller';
import { GnsPriceFeedListenerService } from './services/GnsPriceFeedListenerService';
import { GnsPositionService } from './services/GnsPositionService';
import { GnsTradingVariablesService } from './services/GnsTradingVariablesService';
import { MobulaService } from './services/MobulaService';
import { DatabaseService } from './services/DatabaseService';
import { GnsWsListenerService } from './services/GnsWsListenerService';
import { PositionsGateway } from './gateways/positions.gateway';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, GainsController, DuelsController],
  providers: [
    AppService,
    GnsPriceFeedListenerService,
    GnsPositionService,
    GnsTradingVariablesService,
    MobulaService,
    DatabaseService,
    GnsWsListenerService,
    PositionsGateway,
  ],
})
export class AppModule {}
