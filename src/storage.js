import initSqlJs from 'sql.js';
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

let db = null;

/**
 * Initialize the database
 */
export async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize tables
  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(guild_id, channel_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price REAL NOT NULL,
      price_date TEXT UNIQUE,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      performances TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_subscriptions_guild ON subscriptions(guild_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(fetched_at)`);

  saveDatabase();
  return db;
}

/**
 * Save the database to disk
 */
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// === Subscriptions ===

/**
 * Gets all subscribed channels
 * @returns {Array<{guildId: string, channelId: string, subscribedAt: string}>}
 */
export function getSubscriptions() {
  const stmt = db.prepare('SELECT guild_id, channel_id, subscribed_at FROM subscriptions');
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({
      guildId: row.guild_id,
      channelId: row.channel_id,
      subscribedAt: row.subscribed_at
    });
  }
  stmt.free();
  return results;
}

/**
 * Adds a channel subscription
 * @param {string} guildId
 * @param {string} channelId
 * @returns {boolean} True if newly subscribed, false if already subscribed
 */
export function addSubscription(guildId, channelId) {
  try {
    db.run('INSERT INTO subscriptions (guild_id, channel_id, subscribed_at) VALUES (?, ?, datetime("now"))', [guildId, channelId]);
    saveDatabase();
    return true;
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return false;
    }
    throw err;
  }
}

/**
 * Removes a channel subscription
 * @param {string} guildId
 * @param {string} channelId
 * @returns {boolean} True if removed, false if not found
 */
export function removeSubscription(guildId, channelId) {
  const before = db.getRowsModified();
  db.run('DELETE FROM subscriptions WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
  const after = db.getRowsModified();
  if (after > before) {
    saveDatabase();
    return true;
  }
  return false;
}

/**
 * Checks if a channel is subscribed
 * @param {string} guildId
 * @param {string} channelId
 * @returns {boolean}
 */
export function isSubscribed(guildId, channelId) {
  const stmt = db.prepare('SELECT 1 FROM subscriptions WHERE guild_id = ? AND channel_id = ?');
  stmt.bind([guildId, channelId]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

/**
 * Gets subscription count
 * @returns {number}
 */
export function getSubscriptionCount() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM subscriptions');
  stmt.step();
  const result = stmt.getAsObject();
  stmt.free();
  return result.count;
}

// === Price History ===

/**
 * Gets the price history (most recent first)
 * @param {number} limit
 * @returns {Array}
 */
export function getPriceHistory(limit = 50) {
  const stmt = db.prepare(`
    SELECT price, price_date, fetched_at, performances
    FROM price_history
    ORDER BY id DESC
    LIMIT ?
  `);
  stmt.bind([limit]);
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({
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
 * Gets the latest recorded price entry
 * @returns {Object|null}
 */
export function getLatestPrice() {
  const stmt = db.prepare(`
    SELECT price, price_date, fetched_at, performances
    FROM price_history
    ORDER BY id DESC
    LIMIT 1
  `);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    price: row.price,
    priceDate: row.price_date,
    fetchedAt: row.fetched_at,
    performances: row.performances ? JSON.parse(row.performances) : null
  };
}

/**
 * Gets the previous price entry (second most recent)
 * @returns {Object|null}
 */
export function getPreviousPrice() {
  const stmt = db.prepare(`
    SELECT price, price_date, fetched_at, performances
    FROM price_history
    ORDER BY id DESC
    LIMIT 1 OFFSET 1
  `);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    price: row.price,
    priceDate: row.price_date,
    fetchedAt: row.fetched_at,
    performances: row.performances ? JSON.parse(row.performances) : null
  };
}

/**
 * Adds a price entry to history (updates if same price_date exists)
 * @param {Object} priceData
 */
export function addPriceEntry(priceData) {
  db.run(
    'INSERT OR REPLACE INTO price_history (price, price_date, fetched_at, performances) VALUES (?, ?, ?, ?)',
    [
      priceData.price,
      priceData.priceDate,
      priceData.fetchedAt || new Date().toISOString(),
      priceData.performances ? JSON.stringify(priceData.performances) : null
    ]
  );
  saveDatabase();
}

/**
 * Gets price statistics
 * @returns {Object}
 */
export function getPriceStats() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM price_history');
  countStmt.step();
  const count = countStmt.getAsObject().count;
  countStmt.free();

  if (count === 0) {
    return { count: 0 };
  }

  const statsStmt = db.prepare(`
    SELECT
      MIN(price) as lowest,
      MAX(price) as highest,
      AVG(price) as average
    FROM price_history
  `);
  statsStmt.step();
  const stats = statsStmt.getAsObject();
  statsStmt.free();

  const latest = getLatestPrice();

  const oldestStmt = db.prepare(`
    SELECT price, price_date, fetched_at
    FROM price_history
    ORDER BY id ASC
    LIMIT 1
  `);
  oldestStmt.step();
  const oldest = oldestStmt.getAsObject();
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
export function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
