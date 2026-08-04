import type { FundType } from './scraper.types.js';

export interface Subscription {
  guildId: string;
  channelId: string;
  fundType: FundType;
  subscribedAt: string;
}

export interface GuildSettings {
  guildId: string;
  pingRoleId: string | null;
}

export interface PriceEntry {
  fundType: FundType;
  price: number;
  priceDate: string | null;
  fetchedAt: string;
  performances: Record<string, number> | null;
}

export interface PriceStats {
  count: number;
  latest?: PriceEntry | null;
  oldest?: {
    price: number;
    priceDate: string | null;
    fetchedAt: string;
  } | null;
  highest?: number;
  lowest?: number;
  average?: number;
}
