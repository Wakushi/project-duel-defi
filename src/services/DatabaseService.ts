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

  async getActiveDuelByWallet(wallet: string) {
    return this.db
      .selectFrom('duels')
      .innerJoin('users as creator', 'creator.id', 'duels.creator_id')
      .leftJoin('users as opponent', 'opponent.id', 'duels.opponent_id')
      .selectAll('duels')
      .where('duels.ready_both_at', 'is not', null)
      .where((eb) =>
        eb.or([
          eb('creator.wallet_address', '=', wallet),
          eb('opponent.wallet_address', '=', wallet),
        ]),
      )
      .orderBy('duels.ready_both_at', 'desc')
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

    const users = [
      { user: creator, chain: duel.creator_chain as Chains },
      { user: opponent, chain: duel.opponent_chain as Chains },
    ]
      .filter((entry) => entry.user?.wallet_address && entry.chain)
      .map((entry) => ({
        wallet: entry.user!.wallet_address,
        positions: this.positionService.getPositions({
          chain: entry.chain,
          user: entry.user!.wallet_address!,
        }),
      }));

    return { duelId: duel.id, remainingSeconds, users };
  }
}
