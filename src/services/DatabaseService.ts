import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from '../models/database.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<Database>;

  constructor(private readonly config: ConfigService) {
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
}
