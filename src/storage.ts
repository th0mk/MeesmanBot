import initSqlJs, { Database, Statement } from 'sql.js';
import type { FundData, FundType } from './scraper.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'meesman.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db: Database | null = null;

export interface Subscription {
  guildId: string;
  channelId: string;
  fundType: FundType;
  subscribedAt: string;
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

/**
 * Initialize the database
 */
export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize tables with fund_type support
  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      fund_type TEXT NOT NULL DEFAULT 'wereldwijd',
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, channel_id, fund_type)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_type TEXT NOT NULL DEFAULT 'wereldwijd',
      price REAL NOT NULL,
      price_date TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      performances TEXT,
      UNIQUE(fund_type, price_date)
    )
  `);

  // Migration: Add fund_type column to existing tables if missing
  try {
    db.run(`ALTER TABLE subscriptions ADD COLUMN fund_type TEXT NOT NULL DEFAULT 'wereldwijd'`);
  } catch {
    // Column already exists, ignore
  }
  try {
    db.run(`ALTER TABLE price_history ADD COLUMN fund_type TEXT NOT NULL DEFAULT 'wereldwijd'`);
  } catch {
    // Column already exists, ignore
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_guild ON subscriptions(guild_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_fund ON subscriptions(fund_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(fetched_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_fund ON price_history(fund_type)`);

  saveDatabase();
  return db;
}

/**
 * Save the database to disk
 */
function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// === Subscriptions ===

/**
 * Gets all subscribed channels for a specific fund
 */
export function getSubscriptions(fundType?: FundType): Subscription[] {
  if (!db) throw new Error('Database not initialized');

  const query = fundType
    ? 'SELECT guild_id, channel_id, fund_type, subscribed_at FROM subscriptions WHERE fund_type = ?'
    : 'SELECT guild_id, channel_id, fund_type, subscribed_at FROM subscriptions';

  const stmt: Statement = db.prepare(query);
  if (fundType) stmt.bind([fundType]);

  const results: Subscription[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { guild_id: string; channel_id: string; fund_type: string; subscribed_at: string };
    results.push({
      guildId: row.guild_id,
      channelId: row.channel_id,
      fundType: row.fund_type as FundType,
      subscribedAt: row.subscribed_at
    });
  }
  stmt.free();
  return results;
}

/**
 * Adds a channel subscription for a specific fund
 * @returns True if newly subscribed, false if already subscribed
 */
export function addSubscription(guildId: string, channelId: string, fundType: FundType): boolean {
  if (!db) throw new Error('Database not initialized');

  try {
    db.run('INSERT INTO subscriptions (guild_id, channel_id, fund_type, subscribed_at) VALUES (?, ?, ?, datetime("now"))', [guildId, channelId, fundType]);
    saveDatabase();
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return false;
    }
    throw err;
  }
}

/**
 * Removes a channel subscription for a specific fund
 * @returns True if removed, false if not found
 */
export function removeSubscription(guildId: string, channelId: string, fundType: FundType): boolean {
  if (!db) throw new Error('Database not initialized');

  db.run('DELETE FROM subscriptions WHERE guild_id = ? AND channel_id = ? AND fund_type = ?', [guildId, channelId, fundType]);
  const deleted = db.getRowsModified();
  if (deleted > 0) {
    saveDatabase();
    return true;
  }
  return false;
}

/**
 * Checks if a channel is subscribed to a specific fund
 */
export function isSubscribed(guildId: string, channelId: string, fundType: FundType): boolean {
  if (!db) throw new Error('Database not initialized');

  const stmt: Statement = db.prepare('SELECT 1 FROM subscriptions WHERE guild_id = ? AND channel_id = ? AND fund_type = ?');
  stmt.bind([guildId, channelId, fundType]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

/**
 * Gets subscription count
 */
export function getSubscriptionCount(fundType?: FundType): number {
  if (!db) throw new Error('Database not initialized');

  const query = fundType
    ? 'SELECT COUNT(*) as count FROM subscriptions WHERE fund_type = ?'
    : 'SELECT COUNT(*) as count FROM subscriptions';

  const stmt: Statement = db.prepare(query);
  if (fundType) stmt.bind([fundType]);
  stmt.step();
  const result = stmt.getAsObject() as { count: number };
  stmt.free();
  return result.count;
}

// === Price History ===

/**
 * Gets the price history for a specific fund (most recent first)
 */
export function getPriceHistory(fundType: FundType, limit: number = 50): PriceEntry[] {
  if (!db) throw new Error('Database not initialized');

  const stmt: Statement = db.prepare(`
    SELECT fund_type, price, price_date, fetched_at, performances
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  stmt.bind([fundType, limit]);
  const results: PriceEntry[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { fund_type: string; price: number; price_date: string | null; fetched_at: string; performances: string | null };
    results.push({
      fundType: row.fund_type as FundType,
      price: row.price,
      priceDate: row.price_date,
      fetchedAt: row.fetched_at,
      performances: row.performances ? JSON.parse(row.performances) : null
    });
  }
  stmt.free();
  return results;
}

/**
 * Gets the latest recorded price entry for a specific fund
 */
export function getLatestPrice(fundType: FundType): PriceEntry | null {
  if (!db) throw new Error('Database not initialized');

  const stmt: Statement = db.prepare(`
    SELECT fund_type, price, price_date, fetched_at, performances
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id DESC
    LIMIT 1
  `);
  stmt.bind([fundType]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as { fund_type: string; price: number; price_date: string | null; fetched_at: string; performances: string | null };
  stmt.free();
  return {
    fundType: row.fund_type as FundType,
    price: row.price,
    priceDate: row.price_date,
    fetchedAt: row.fetched_at,
    performances: row.performances ? JSON.parse(row.performances) : null
  };
}

/**
 * Adds a price entry to history (updates if same fund_type and price_date exists)
 */
export function addPriceEntry(priceData: FundData): void {
  if (!db) throw new Error('Database not initialized');

  db.run(
    'INSERT OR REPLACE INTO price_history (fund_type, price, price_date, fetched_at, performances) VALUES (?, ?, ?, ?, ?)',
    [
      priceData.fundType,
      priceData.price,
      priceData.priceDate ?? null,
      priceData.fetchedAt || new Date().toISOString(),
      priceData.performances ? JSON.stringify(priceData.performances) : null
    ]
  );
  saveDatabase();
}

/**
 * Gets price statistics for a specific fund
 */
export function getPriceStats(fundType: FundType): PriceStats {
  if (!db) throw new Error('Database not initialized');

  const countStmt: Statement = db.prepare('SELECT COUNT(*) as count FROM price_history WHERE fund_type = ?');
  countStmt.bind([fundType]);
  countStmt.step();
  const count = (countStmt.getAsObject() as { count: number }).count;
  countStmt.free();

  if (count === 0) {
    return { count: 0 };
  }

  const statsStmt: Statement = db.prepare(`
    SELECT
      MIN(price) as lowest,
      MAX(price) as highest,
      AVG(price) as average
    FROM price_history
    WHERE fund_type = ?
  `);
  statsStmt.bind([fundType]);
  statsStmt.step();
  const stats = statsStmt.getAsObject() as { lowest: number; highest: number; average: number };
  statsStmt.free();

  const latest = getLatestPrice(fundType);

  const oldestStmt: Statement = db.prepare(`
    SELECT price, price_date, fetched_at
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id ASC
    LIMIT 1
  `);
  oldestStmt.bind([fundType]);
  oldestStmt.step();
  const oldest = oldestStmt.getAsObject() as { price: number; price_date: string | null; fetched_at: string };
  oldestStmt.free();

  return {
    count,
    latest,
    oldest: oldest ? {
      price: oldest.price,
      priceDate: oldest.price_date,
      fetchedAt: oldest.fetched_at
    } : null,
    highest: stats.highest,
    lowest: stats.lowest,
    average: stats.average
  };
}

/**
 * Close the database connection (for cleanup)
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
