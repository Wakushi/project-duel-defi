import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GainsController } from './controllers/gains.controller';
import { GnsPriceFeedListenerService } from './services/GnsPriceFeedListenerService';
import { GnsPositionService } from './services/GnsPositionService';
import { GnsTradingVariablesService } from './services/GnsTradingVariablesService';
import { MobulaService } from './services/MobulaService';
import { DatabaseService } from './services/DatabaseService';
import { PositionsGateway } from './gateways/positions.gateway';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, GainsController],
  providers: [
    AppService,
    GnsPriceFeedListenerService,
    GnsPositionService,
    GnsTradingVariablesService,
    MobulaService,
    DatabaseService,
    PositionsGateway,
  ],
})
export class AppModule {}
