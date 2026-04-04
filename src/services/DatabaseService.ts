import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../models/database.js';
import { GnsPositionService } from './GnsPositionService.js';
import { Chains } from '../models/chains.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<Database>;

  constructor(
    private readonly config: ConfigService,
    private readonly positionService: GnsPositionService,
  ) {
    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({
          connectionString: this.config.getOrThrow<string>('DB_URL'),
        }),
      }),
    });
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }

  async getUserById(id: string) {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getDuelById(id: string) {
    return this.db
      .selectFrom('duels')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async buildDuelPayload(duelId: string, remainingSeconds: number) {
    const duel = await this.getDuelById(duelId);
    if (!duel) return null;

    const [creator, opponent] = await Promise.all([
      this.getUserById(duel.creator_id),
      duel.opponent_id
        ? this.getUserById(duel.opponent_id)
        : Promise.resolve(null),
    ]);

    const chain = Chains.Testnet;

    const users = [creator, opponent]
      .filter((u) => u?.wallet_address)
      .map((u) => ({
        wallet: u!.wallet_address,
        positions: this.positionService.getPositions({
          chain,
          user: u!.wallet_address!,
        }),
      }));

    return { duelId: duel.id, remainingSeconds, users };
  }
}
