import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GainsController } from './controllers/gains.controller';
import { GnsPriceFeedListenerService } from './services/GnsPriceFeedListenerService';
import { GnsTradingVariablesService } from './services/GnsTradingVariablesService';

@Module({
  imports: [],
  controllers: [AppController, GainsController],
  providers: [AppService, GnsPriceFeedListenerService, GnsTradingVariablesService],
})
export class AppModule {}
