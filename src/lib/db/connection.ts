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

    CREATE TABLE IF NOT EXISTS plan_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      expected_soc_after REAL,
      expected_value REAL,
      status TEXT DEFAULT 'planned',
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT,
      UNIQUE(slot_start)
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

    CREATE TABLE IF NOT EXISTS mqtt_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      direction TEXT NOT NULL,
      topic TEXT,
      payload TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS export_rates (
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api',
      PRIMARY KEY (valid_from)
    );

    CREATE TABLE IF NOT EXISTS pv_forecasts (
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      pv_estimate_w REAL NOT NULL,
      pv_estimate10_w REAL,
      pv_estimate90_w REAL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (valid_from)
    );

    CREATE TABLE IF NOT EXISTS scheduled_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      action TEXT NOT NULL,
      time TEXT NOT NULL,
      days TEXT NOT NULL DEFAULT 'daily',
      soc_condition TEXT NOT NULL DEFAULT 'any',
      soc_threshold REAL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plan_slot_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      override_source TEXT NOT NULL,
      soc_at_start REAL,
      soc_at_end REAL,
      command_signature TEXT,
      command_issued_at TEXT NOT NULL,
      actual_import_wh REAL,
      actual_export_wh REAL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_profile (
      day_type    TEXT    NOT NULL CHECK(day_type IN ('weekday','weekend')),
      slot_index  INTEGER NOT NULL CHECK(slot_index >= 0 AND slot_index < 48),
      median_w    REAL    NOT NULL,
      p25_w       REAL    NOT NULL,
      p75_w       REAL    NOT NULL,
      mean_w      REAL    NOT NULL,
      sample_count INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL,
      PRIMARY KEY (day_type, slot_index)
    );

    CREATE TABLE IF NOT EXISTS usage_profile_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      baseload_w          REAL NOT NULL,
      baseload_percentile REAL NOT NULL,
      window_days         INTEGER NOT NULL,
      window_start        TEXT NOT NULL,
      window_end          TEXT NOT NULL,
      total_samples       INTEGER NOT NULL,
      computed_at         TEXT NOT NULL,
      high_periods_json   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_overrides_slot_start ON auto_overrides(slot_start);
    CREATE INDEX IF NOT EXISTS idx_auto_overrides_expires_at ON auto_overrides(expires_at);

    CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_readings_date ON readings(date(timestamp));
    CREATE INDEX IF NOT EXISTS idx_rates_valid_from ON rates(valid_from);
    CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
    CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status, date);
    CREATE INDEX IF NOT EXISTS idx_plan_slots_date ON plan_slots(date);
    CREATE INDEX IF NOT EXISTS idx_plan_slots_status ON plan_slots(status, date);
    CREATE INDEX IF NOT EXISTS idx_plan_slots_start ON plan_slots(slot_start);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_mqtt_logs_ts ON mqtt_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_carbon_period ON carbon_intensity(period_from);
    CREATE INDEX IF NOT EXISTS idx_overrides_date ON manual_overrides(date);
    CREATE INDEX IF NOT EXISTS idx_export_rates_valid_from ON export_rates(valid_from);
    CREATE INDEX IF NOT EXISTS idx_pv_forecasts_valid_from ON pv_forecasts(valid_from);
    CREATE INDEX IF NOT EXISTS idx_scheduled_actions_enabled ON scheduled_actions(enabled);
    CREATE INDEX IF NOT EXISTS idx_plan_slot_executions_slot_start ON plan_slot_executions(slot_start);
    CREATE INDEX IF NOT EXISTS idx_plan_slot_executions_issued_at ON plan_slot_executions(command_issued_at);
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

  // Migrate: add action column to manual_overrides
  const overrideCols = db.prepare('PRAGMA table_info(manual_overrides)').all() as { name: string }[];
  const overrideColNames = new Set(overrideCols.map((c) => c.name));
  if (!overrideColNames.has('action')) {
    db.exec("ALTER TABLE manual_overrides ADD COLUMN action TEXT DEFAULT 'charge'");
  }

  // Migrate: add source column to rates (api vs tariff-generated)
  const rateCols = db.prepare('PRAGMA table_info(rates)').all() as { name: string }[];
  const rateColNames = new Set(rateCols.map((c) => c.name));
  if (!rateColNames.has('source')) {
    db.exec("ALTER TABLE rates ADD COLUMN source TEXT DEFAULT 'api'");
  }

  // Migrate: add type column to schedules (charge vs discharge)
  const scheduleCols = db.prepare('PRAGMA table_info(schedules)').all() as { name: string }[];
  const scheduleColNames = new Set(scheduleCols.map((c) => c.name));
  if (!scheduleColNames.has('type')) {
    db.exec("ALTER TABLE schedules ADD COLUMN type TEXT DEFAULT 'charge'");
  }

  const planSlotCols = db.prepare('PRAGMA table_info(plan_slots)').all() as { name: string }[];
  const planSlotColNames = new Set(planSlotCols.map((c) => c.name));
  if (planSlotCols.length > 0) {
    if (!planSlotColNames.has('reason')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN reason TEXT');
    }
    if (!planSlotColNames.has('expected_soc_after')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN expected_soc_after REAL');
    }
    if (!planSlotColNames.has('expected_value')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN expected_value REAL');
    }
    if (!planSlotColNames.has('status')) {
      db.exec("ALTER TABLE plan_slots ADD COLUMN status TEXT DEFAULT 'planned'");
    }
    if (!planSlotColNames.has('created_at')) {
      db.exec("ALTER TABLE plan_slots ADD COLUMN created_at TEXT DEFAULT ''");
    }
    if (!planSlotColNames.has('executed_at')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN executed_at TEXT');
    }
    if (!planSlotColNames.has('notes')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN notes TEXT');
    }
    if (!planSlotColNames.has('actual_value')) {
      db.exec('ALTER TABLE plan_slots ADD COLUMN actual_value REAL');
    }
  }

  // Migrate: collapse legacy 'do_nothing' action to 'hold' across all action-bearing tables.
  // SolarBuddy now uses exactly three actions: charge, discharge, hold.
  db.exec("UPDATE plan_slots SET action = 'hold' WHERE action = 'do_nothing'");
  db.exec("UPDATE manual_overrides SET action = 'hold' WHERE action = 'do_nothing'");
  const scheduledActionsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_actions'")
    .get();
  if (scheduledActionsTable) {
    db.exec("UPDATE scheduled_actions SET action = 'hold' WHERE action = 'do_nothing'");
  }
}
