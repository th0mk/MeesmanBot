import * as cheerio from 'cheerio';

export type FundType = 'wereldwijd' | 'verantwoord';

export const FUNDS: Record<FundType, { name: string; url: string; isin: string }> = {
  wereldwijd: {
    name: 'Aandelen Wereldwijd Totaal',
    url: 'https://www.meesman.nl/onze-fondsen/aandelen-wereldwijd-totaal/',
    isin: 'NL0013689110'
  },
  verantwoord: {
    name: 'Aandelen Verantwoorde Toekomst',
    url: 'https://www.meesman.nl/onze-fondsen/aandelen-verantwoorde-toekomst/',
    isin: 'NL0015000PW1'
  }
};

export interface FundData {
  fundType: FundType;
  price: number | null;
  priceDate: string | null;
  isin: string | null;
  annualCosts: number | null;
  fetchedAt: string;
  performances: Record<string, number>;
}

/**
 * Fetches and parses a Meesman fund page to extract price data
 */
export async function fetchFundData(fundType: FundType): Promise<FundData> {
  const fund = FUNDS[fundType];
  const response = await fetch(fund.url);

  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const data: FundData = {
    fundType,
    price: null,
    priceDate: null,
    isin: null,
    annualCosts: null,
    fetchedAt: new Date().toISOString(),
    performances: {}
  };

  // Find the price - typically in a prominent location on the page
  // The page structure may vary, so we try multiple selectors
  const pageText = $('body').text();

  // Extract price and date (format: € 96,6307 (09-01-2026))
  const priceWithDateMatch = pageText.match(/€\s*(\d+[,.]?\d+)\s*\((\d{2})-(\d{2})-(\d{4})\)/);
  if (priceWithDateMatch) {
    // Convert Dutch number format (comma as decimal) to standard format
    data.price = parseFloat(priceWithDateMatch[1].replace(',', '.'));
    // Date is in DD-MM-YYYY format, convert to YYYY-MM-DD
    const day = priceWithDateMatch[2];
    const month = priceWithDateMatch[3];
    const year = priceWithDateMatch[4];
    data.priceDate = `${year}-${month}-${day}`;
  } else {
    // Fallback: just extract price
    const priceMatch = pageText.match(/€\s*(\d+[,.]?\d+)/);
    if (priceMatch) {
      data.price = parseFloat(priceMatch[1].replace(',', '.'));
    }
  }

  // Extract ISIN code (format: 2 letter country + 9 alphanumeric + 1 check digit)
  const isinMatch = pageText.match(/NL[A-Z0-9]{10}/);
  if (isinMatch) {
    data.isin = isinMatch[0];
  }

  // Extract annual costs
  const costsMatch = pageText.match(/(\d+[,.]?\d*)\s*%\s*per\s*jaar/i);
  if (costsMatch) {
    data.annualCosts = parseFloat(costsMatch[1].replace(',', '.'));
  }

  // Extract performance data
  const performances: Record<string, number> = {};
  const perfPattern = /(\d{4})\s*[:.]?\s*(-?\d+[,.]?\d*)\s*%/g;
  let match;
  while ((match = perfPattern.exec(pageText)) !== null) {
    const year = match[1];
    const perf = parseFloat(match[2].replace(',', '.'));
    if (parseInt(year) >= 2020 && parseInt(year) <= 2030) {
      performances[year] = perf;
    }
  }
  data.performances = performances;

  return data;
}

/**
 * Calculates the percentage change between two prices
 */
export function calculatePercentageChange(oldPrice: number, newPrice: number): number {
  if (!oldPrice || oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}
