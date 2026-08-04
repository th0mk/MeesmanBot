export type FundType = 'wereldwijd' | 'verantwoord';

export interface Fund {
  name: string;
  url: string;
  isin: string;
}

export interface FundData {
  fundType: FundType;
  price: number | null;
  priceDate: string | null;
  isin: string | null;
  annualCosts: number | null;
  fetchedAt: string;
  performances: Record<string, number>;
}
