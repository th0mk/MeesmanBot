import * as cheerio from 'cheerio';

const FUND_URL = 'https://www.meesman.nl/onze-fondsen/aandelen-wereldwijd-totaal/';

/**
 * Fetches and parses the Meesman fund page to extract price data
 * @returns {Promise<Object>} Fund data including price, date, and performance
 */
export async function fetchFundData() {
  const response = await fetch(FUND_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const data = {
    price: null,
    priceDate: null,
    isin: null,
    annualCosts: null,
    fetchedAt: new Date().toISOString()
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

  // Extract ISIN code
  const isinMatch = pageText.match(/NL\d{10}/);
  if (isinMatch) {
    data.isin = isinMatch[0];
  }

  // Extract annual costs
  const costsMatch = pageText.match(/(\d+[,.]?\d*)\s*%\s*per\s*jaar/i);
  if (costsMatch) {
    data.annualCosts = parseFloat(costsMatch[1].replace(',', '.'));
  }

  // Extract performance data
  const performances = {};
  const perfPattern = /(\d{4})\s*[:.]?\s*(-?\d+[,.]?\d*)\s*%/g;
  let match;
  while ((match = perfPattern.exec(pageText)) !== null) {
    const year = match[1];
    const perf = parseFloat(match[2].replace(',', '.'));
    if (year >= 2020 && year <= 2030) {
      performances[year] = perf;
    }
  }
  data.performances = performances;

  return data;
}

/**
 * Calculates the percentage change between two prices
 * @param {number} oldPrice
 * @param {number} newPrice
 * @returns {number} Percentage change
 */
export function calculatePercentageChange(oldPrice, newPrice) {
  if (!oldPrice || oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}
