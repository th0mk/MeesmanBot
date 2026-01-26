import { Database } from 'bun:sqlite';
import type { FundData, FundType } from './scraper.js';

const DATA_DIR = `${import.meta.dir}/../data`;
const DB_PATH = `${DATA_DIR}/meesman.db`;

// Ensure data directory exists
import { mkdirSync, existsSync } from 'fs';
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

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

/**
 * Initialize the database
 */
export async function initDatabase(): Promise<Database> {
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

  db.run(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      ping_role_id TEXT
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

  return db;
}

// === Subscriptions ===

/**
 * Gets all subscribed channels for a specific fund
 */
export function getSubscriptions(fundType?: FundType): Subscription[] {
  const query = fundType
    ? db.query<{ guild_id: string; channel_id: string; fund_type: string; subscribed_at: string }, [string]>(
        'SELECT guild_id, channel_id, fund_type, subscribed_at FROM subscriptions WHERE fund_type = ?'
      )
    : db.query<{ guild_id: string; channel_id: string; fund_type: string; subscribed_at: string }, []>(
        'SELECT guild_id, channel_id, fund_type, subscribed_at FROM subscriptions'
      );

  const rows = fundType ? query.all(fundType) : (query as ReturnType<typeof db.query<{ guild_id: string; channel_id: string; fund_type: string; subscribed_at: string }, []>>).all();

  return rows.map(row => ({
    guildId: row.guild_id,
    channelId: row.channel_id,
    fundType: row.fund_type as FundType,
    subscribedAt: row.subscribed_at
  }));
}

/**
 * Adds a channel subscription for a specific fund
 * @returns True if newly subscribed, false if already subscribed
 */
export function addSubscription(guildId: string, channelId: string, fundType: FundType): boolean {
  try {
    db.run(
      'INSERT INTO subscriptions (guild_id, channel_id, fund_type, subscribed_at) VALUES (?, ?, ?, datetime("now"))',
      [guildId, channelId, fundType]
    );
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
  const result = db.run(
    'DELETE FROM subscriptions WHERE guild_id = ? AND channel_id = ? AND fund_type = ?',
    [guildId, channelId, fundType]
  );
  return result.changes > 0;
}

/**
 * Checks if a channel is subscribed to a specific fund
 */
export function isSubscribed(guildId: string, channelId: string, fundType: FundType): boolean {
  const result = db.query<{ exists: number }, [string, string, string]>(
    'SELECT 1 as exists FROM subscriptions WHERE guild_id = ? AND channel_id = ? AND fund_type = ?'
  ).get(guildId, channelId, fundType);
  return result !== null;
}

/**
 * Gets subscription count
 */
export function getSubscriptionCount(fundType?: FundType): number {
  if (fundType) {
    const result = db.query<{ count: number }, [string]>(
      'SELECT COUNT(*) as count FROM subscriptions WHERE fund_type = ?'
    ).get(fundType);
    return result?.count ?? 0;
  }
  const result = db.query<{ count: number }, []>(
    'SELECT COUNT(*) as count FROM subscriptions'
  ).get();
  return result?.count ?? 0;
}

// === Guild Settings ===

/**
 * Gets the ping role for a guild
 */
export function getPingRole(guildId: string): string | null {
  const result = db.query<{ ping_role_id: string | null }, [string]>(
    'SELECT ping_role_id FROM guild_settings WHERE guild_id = ?'
  ).get(guildId);
  return result?.ping_role_id ?? null;
}

/**
 * Sets or removes the ping role for a guild
 */
export function setPingRole(guildId: string, roleId: string | null): void {
  if (roleId === null) {
    db.run('DELETE FROM guild_settings WHERE guild_id = ?', [guildId]);
  } else {
    db.run(
      'INSERT OR REPLACE INTO guild_settings (guild_id, ping_role_id) VALUES (?, ?)',
      [guildId, roleId]
    );
  }
}

// === Price History ===

/**
 * Gets the price history for a specific fund (most recent first)
 */
export function getPriceHistory(fundType: FundType, limit: number = 50): PriceEntry[] {
  const rows = db.query<{ fund_type: string; price: number; price_date: string | null; fetched_at: string; performances: string | null }, [string, number]>(`
    SELECT fund_type, price, price_date, fetched_at, performances
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(fundType, limit);

  return rows.map(row => ({
    fundType: row.fund_type as FundType,
    price: row.price,
    priceDate: row.price_date,
    fetchedAt: row.fetched_at,
    performances: row.performances ? JSON.parse(row.performances) : null
  }));
}

/**
 * Gets the latest recorded price entry for a specific fund
 */
export function getLatestPrice(fundType: FundType): PriceEntry | null {
  const row = db.query<{ fund_type: string; price: number; price_date: string | null; fetched_at: string; performances: string | null }, [string]>(`
    SELECT fund_type, price, price_date, fetched_at, performances
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(fundType);

  if (!row) return null;

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
}

/**
 * Gets price statistics for a specific fund
 */
export function getPriceStats(fundType: FundType): PriceStats {
  const countResult = db.query<{ count: number }, [string]>(
    'SELECT COUNT(*) as count FROM price_history WHERE fund_type = ?'
  ).get(fundType);
  const count = countResult?.count ?? 0;

  if (count === 0) {
    return { count: 0 };
  }

  const stats = db.query<{ lowest: number; highest: number; average: number }, [string]>(`
    SELECT
      MIN(price) as lowest,
      MAX(price) as highest,
      AVG(price) as average
    FROM price_history
    WHERE fund_type = ?
  `).get(fundType);

  const latest = getLatestPrice(fundType);

  const oldest = db.query<{ price: number; price_date: string | null; fetched_at: string }, [string]>(`
    SELECT price, price_date, fetched_at
    FROM price_history
    WHERE fund_type = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(fundType);

  return {
    count,
    latest,
    oldest: oldest ? {
      price: oldest.price,
      priceDate: oldest.price_date,
      fetchedAt: oldest.fetched_at
    } : null,
    highest: stats?.highest,
    lowest: stats?.lowest,
    average: stats?.average
  };
}

/**
 * Close the database connection (for cleanup)
 */
export function closeDatabase(): void {
  db.close();
}
