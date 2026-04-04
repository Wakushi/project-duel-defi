import type { ColumnType, Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  pseudo: string;
  password_hash: string;
  wallet_address: string | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface DuelsTable {
  id: Generated<string>;
  creator_id: string;
  opponent_id: string | null;
  stake_usdc: string;
  duration_seconds: number;
  ready_state: unknown;
  ready_both_at: Date | null;
  creator_trade_config: unknown | null;
  opponent_trade_config: unknown | null;
  duel_live_at: Date | null;
  duel_closed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, never, Date>;
}

export interface Database {
  users: UsersTable;
  duels: DuelsTable;
}
