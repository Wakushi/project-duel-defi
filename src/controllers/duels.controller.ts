import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { DatabaseService } from '../services/DatabaseService.js';

@Controller('duels')
export class DuelsController {
  private readonly logger = new Logger(DuelsController.name);

  constructor(private readonly db: DatabaseService) {}

  @Get('user/:id')
  async getUserById(@Param('id') id: string) {
    this.logger.log(`GET /duels/user/${id}`);
    const user = await this.db.getUserById(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  @Get(':id')
  async getDuelLive(@Param('id') id: string) {
    this.logger.log(`GET /duels/${id}`);
    const duel = await this.db.getDuelById(id);
    if (!duel) throw new NotFoundException(`Duel ${id} not found`);

    const payload = await this.db.buildDuelPayload(id, duel.duration_seconds);
    if (!payload) throw new NotFoundException(`Duel ${id} not found`);
    return payload;
  }
}
