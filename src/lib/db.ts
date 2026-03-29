import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'solarbuddy.db');

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rates (
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (valid_from)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      avg_price REAL,
      status TEXT DEFAULT 'planned',
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS readings (
      timestamp TEXT NOT NULL,
      battery_soc REAL,
      pv_power REAL,
      grid_power REAL,
      load_power REAL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_rates_valid_from ON rates(valid_from);
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
  `);
}
