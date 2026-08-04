import type { FundType } from './scraper.types.js';
import type { PriceEntry } from './storage.types.js';
import type { ChartPeriod, PriceChart } from './chart.types.js';

export type TrendVariant = 'update' | 'status';

export interface TrendView {
  fundType: FundType;
  entries: PriceEntry[];
  chart: PriceChart | null;
  period: ChartPeriod;
  variant: TrendVariant;
}

export interface TrendButton {
  fundType: FundType;
  periodId: string;
  variant: TrendVariant;
}
