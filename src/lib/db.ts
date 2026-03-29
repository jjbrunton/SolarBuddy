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

    CREATE TABLE IF NOT EXISTS carbon_intensity (
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      intensity_forecast INTEGER,
      intensity_actual INTEGER,
      intensity_index TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (period_from)
    );

    CREATE TABLE IF NOT EXISTS manual_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_readings_date ON readings(date(timestamp));
    CREATE INDEX IF NOT EXISTS idx_rates_valid_from ON rates(valid_from);
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
    CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status, date);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_carbon_period ON carbon_intensity(period_from);
    CREATE INDEX IF NOT EXISTS idx_overrides_date ON manual_overrides(date);
  `);

  // Migrate: add new columns for expanded Solar Assistant data
  const cols = db.prepare('PRAGMA table_info(readings)').all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  const newCols = [
    'battery_voltage',
    'battery_temperature',
    'inverter_temperature',
    'grid_voltage',
    'grid_frequency',
    'pv_power_1',
    'pv_power_2',
  ];
  for (const col of newCols) {
    if (!colNames.has(col)) {
      db.exec(`ALTER TABLE readings ADD COLUMN ${col} REAL`);
    }
  }
}
