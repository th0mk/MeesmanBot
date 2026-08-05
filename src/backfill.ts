/**
 * Backfills price_history from the trading-price spreadsheet Meesman publishes
 * on its fund pages, so the chart has history from before the bot was running.
 *
 *   bun run backfill
 *   bun run backfill -- --dry-run
 *   bun run backfill -- --fonds=wereldwijd
 *
 * Safe to re-run: dates already in the database are left untouched.
 */
import { FUNDS } from './scraper.js';
import { initDatabase, addHistoricalPrices, getPriceStats, closeDatabase } from './storage.js';
import { fetchHistoricalPrices } from './backfill.utils.js';
import type { FundType } from './scraper.types.js';
import type { BackfillSummary, HistoricalPrice } from './backfill.types.js';

function summarise(prices: HistoricalPrice[], fundType: FundType, inserted: number): BackfillSummary {
  const dates = prices.filter(price => price.fundType === fundType).map(price => price.priceDate);
  return {
    fundType,
    parsed: dates.length,
    inserted,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null
  };
}

async function backfill(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find(arg => arg.startsWith('--fonds='))?.split('=')[1];

  if (only && !Object.hasOwn(FUNDS, only)) {
    console.error(`Unknown fund "${only}". Choose from: ${Object.keys(FUNDS).join(', ')}`);
    process.exit(1);
  }

  await initDatabase();

  const all = await fetchHistoricalPrices();
  const prices = only ? all.filter(price => price.fundType === only) : all;

  if (prices.length === 0) {
    console.error('No prices parsed from the spreadsheet — the layout may have changed.');
    process.exit(1);
  }

  const funds = (only ? [only] : Object.keys(FUNDS)) as FundType[];

  console.log(`Parsed ${prices.length} prices${dryRun ? ' (dry run, nothing written)' : ''}`);

  for (const fundType of funds) {
    const forFund = prices.filter(price => price.fundType === fundType);
    const inserted = dryRun ? 0 : addHistoricalPrices(forFund);
    const summary = summarise(prices, fundType, inserted);

    console.log(
      `  ${FUNDS[fundType].name}: ${summary.parsed} prices ` +
      `(${summary.firstDate} .. ${summary.lastDate}), ` +
      (dryRun ? 'not written' : `${summary.inserted} new, ${summary.parsed - summary.inserted} already known`)
    );
  }

  if (!dryRun) {
    for (const fundType of funds) {
      console.log(`  ${FUNDS[fundType].name}: ${getPriceStats(fundType).count} rows in total`);
    }
  }

  closeDatabase();
}

backfill().catch(err => {
  console.error('Backfill failed:', (err as Error).message);
  process.exit(1);
});
