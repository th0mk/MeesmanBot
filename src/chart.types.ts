export interface PriceChart {
  png: Buffer;
  fileName: string;
}

export interface ChartPeriod {
  id: string;
  label: string;
  buttonLabel: string;
  days: number | null;
}
