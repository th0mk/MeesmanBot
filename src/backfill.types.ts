import type { FundType } from './scraper.types.js';

export interface HistoricalPrice {
  fundType: FundType;
  price: number;
  priceDate: string;
}

export interface BackfillSummary {
  fundType: FundType;
  parsed: number;
  inserted: number;
  firstDate: string | null;
  lastDate: string | null;
}
