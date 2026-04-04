import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const MULTI_DATA_BASE = 'https://api.mobula.io/api/1/market/multi-data';

interface MobulaContract {
  address: string;
  blockchainId: string;
  blockchain: string;
  decimals: number;
}

export interface MobulaAssetData {
  key?: string;
  id?: number;
  name?: string;
  symbol?: string;
  decimals?: number;
  logo?: string;
  rank?: number;
  price?: number;
  market_cap?: number;
  market_cap_diluted?: number;
  volume?: number;
  volume_change_24h?: number;
  volume_7d?: number;
  liquidity?: number;
  ath?: number;
  atl?: number;
  off_chain_volume?: number;
  is_listed?: boolean;
  price_change_1h?: number;
  price_change_24h?: number;
  price_change_7d?: number;
  price_change_1m?: number;
  price_change_1y?: number;
  total_supply?: number;
  circulating_supply?: number;
  contracts?: MobulaContract[];
}

@Injectable()
export class MobulaService {
  private readonly logger = new Logger(MobulaService.name);
  private readonly apiKey: string;
  private readonly cache = new Map<
    string,
    { data: MobulaAssetData; expiry: number }
  >();
  private readonly cacheTtlMs = 60_000_000_000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>('MOBULA_API_KEY');

    if (!this.apiKey) {
      throw new Error(`Mobula API key not found in MobulaService`);
    }
  }

  async getMultiData(
    symbols: string[],
  ): Promise<Record<string, MobulaAssetData>> {
    const now = Date.now();
    const result: Record<string, MobulaAssetData> = {};
    const missingSymbols: string[] = [];

    for (const symbol of symbols) {
      const cached = this.cache.get(symbol);
      if (cached && cached.expiry > now) {
        result[symbol] = cached.data;
      } else {
        missingSymbols.push(symbol);
      }
    }

    if (missingSymbols.length > 0) {
      const fetched = await this.fetchWithRetry(missingSymbols);
      if (fetched) {
        for (const [key, value] of Object.entries(fetched)) {
          this.cache.set(key, { data: value, expiry: now + this.cacheTtlMs });
          result[key] = value;
        }
      }
    }

    return result;
  }

  private async fetchWithRetry(
    symbols: string[],
    retries = 3,
    delayMs = 2_000,
  ): Promise<Record<string, MobulaAssetData> | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get<{
          data: Record<string, MobulaAssetData>;
        }>(MULTI_DATA_BASE, {
          params: { symbols: symbols.join(',') },
          headers: { Authorization: this.apiKey },
          timeout: 15_000,
        });

        return response.data?.data ?? null;
      } catch (error) {
        const msg = axios.isAxiosError(error) ? error.message : String(error);
        this.logger.warn(
          `Mobula fetch failed (attempt ${attempt}/${retries}): ${msg}`,
        );
        if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    this.logger.error(`Mobula fetch failed after ${retries} attempts`);
    return null;
  }
}
