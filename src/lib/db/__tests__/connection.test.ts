import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../connection';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function tableNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function indexNames(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

describe('initSchema — fresh database', () => {
  it('creates every required table', () => {
    const db = freshDb();
    initSchema(db);

    const tables = tableNames(db);
    for (const expected of [
      'settings',
      'rates',
      'schedules',
      'plan_slots',
      'readings',
      'events',
      'mqtt_logs',
      'carbon_intensity',
      'manual_overrides',
      'export_rates',
      'pv_forecasts',
      'scheduled_actions',
      'plan_slot_executions',
      'usage_profile',
      'usage_profile_meta',
      'auto_overrides',
    ]) {
      expect(tables.has(expected), `expected table ${expected}`).toBe(true);
    }
  });

  it('creates the indices declared in the schema', () => {
    const db = freshDb();
    initSchema(db);

    const indices = indexNames(db);
    for (const expected of [
      'idx_readings_ts',
      'idx_rates_valid_from',
      'idx_schedules_date',
      'idx_plan_slots_start',
      'idx_events_ts',
      'idx_auto_overrides_slot_start',
      'idx_auto_overrides_expires_at',
      'idx_plan_slot_executions_slot_start',
    ]) {
      expect(indices.has(expected), `expected index ${expected}`).toBe(true);
    }
  });

  it('adds every new reading telemetry column on a fresh DB', () => {
    const db = freshDb();
    initSchema(db);
    const cols = columnNames(db, 'readings');
    for (const expected of [
      'battery_voltage',
      'battery_temperature',
      'inverter_temperature',
      'grid_voltage',
      'grid_frequency',
      'pv_power_1',
      'pv_power_2',
    ]) {
      expect(cols.has(expected), `readings.${expected}`).toBe(true);
    }
  });

  it('is idempotent: a second call does not throw or duplicate schema', () => {
    const db = freshDb();
    initSchema(db);
    const before = tableNames(db);

    expect(() => initSchema(db)).not.toThrow();
    const after = tableNames(db);
    expect([...after].sort()).toEqual([...before].sort());
  });
});

describe('initSchema — column migrations on upgraded databases', () => {
  it('adds telemetry columns to a pre-existing readings table that lacks them', () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE readings (
        timestamp TEXT NOT NULL,
        battery_soc REAL,
        pv_power REAL,
        grid_power REAL,
        load_power REAL
      );
    `);

    initSchema(db);

    const cols = columnNames(db, 'readings');
    expect(cols.has('battery_voltage')).toBe(true);
    expect(cols.has('pv_power_1')).toBe(true);
    expect(cols.has('pv_power_2')).toBe(true);
  });

  it("adds the 'action' column to manual_overrides with a default of 'charge'", () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE manual_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO manual_overrides (date, slot_start, slot_end, created_at) VALUES ('2026-04-05', '2026-04-05T10:00:00Z', '2026-04-05T10:30:00Z', '2026-04-05T00:00:00Z')",
    ).run();

    initSchema(db);

    expect(columnNames(db, 'manual_overrides').has('action')).toBe(true);
    const row = db
      .prepare('SELECT action FROM manual_overrides LIMIT 1')
      .get() as { action: string };
    expect(row.action).toBe('charge');
  });

  it("adds the 'source' column to rates with a default of 'api'", () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE rates (
        valid_from TEXT NOT NULL,
        valid_to TEXT NOT NULL,
        price_inc_vat REAL NOT NULL,
        price_exc_vat REAL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (valid_from)
      );
    `);
    db.prepare(
      "INSERT INTO rates (valid_from, valid_to, price_inc_vat, fetched_at) VALUES ('2026-04-05T00:00:00Z', '2026-04-05T00:30:00Z', 10, '2026-04-05T00:00:00Z')",
    ).run();

    initSchema(db);

    expect(columnNames(db, 'rates').has('source')).toBe(true);
    const row = db.prepare('SELECT source FROM rates LIMIT 1').get() as { source: string };
    expect(row.source).toBe('api');
  });

  it("adds the 'type' column to schedules with a default of 'charge'", () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE schedules (
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
    `);

    initSchema(db);

    expect(columnNames(db, 'schedules').has('type')).toBe(true);
  });

  it('backfills missing plan_slots columns when the table predates them', () => {
    const db = freshDb();
    // Start from a plan_slots shape that matches an early release (already had
    // status + created_at, index on `status` succeeds) but lacked the later
    // analytics columns — this is the realistic upgrade path in production.
    db.exec(`
      CREATE TABLE plan_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        slot_start TEXT NOT NULL UNIQUE,
        slot_end TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT DEFAULT 'planned',
        created_at TEXT NOT NULL DEFAULT ''
      );
    `);

    initSchema(db);

    const cols = columnNames(db, 'plan_slots');
    for (const expected of [
      'reason',
      'expected_soc_after',
      'expected_value',
      'executed_at',
      'notes',
      'actual_value',
    ]) {
      expect(cols.has(expected), `plan_slots.${expected}`).toBe(true);
    }
  });
});

describe("initSchema — data migrations", () => {
  it("collapses legacy 'do_nothing' action values to 'hold' across action-bearing tables", () => {
    const db = freshDb();
    initSchema(db);

    db.prepare(
      "INSERT INTO plan_slots (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-05', '2026-04-05T10:00:00Z', '2026-04-05T10:30:00Z', 'do_nothing', '2026-04-05T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-05', '2026-04-05T10:00:00Z', '2026-04-05T10:30:00Z', 'do_nothing', '2026-04-05T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO scheduled_actions (name, action, time, days) VALUES ('test', 'do_nothing', '10:00', 'daily')",
    ).run();

    // Run schema init again — the data migrations rerun unconditionally.
    initSchema(db);

    const plan = db.prepare('SELECT action FROM plan_slots').get() as { action: string };
    const override = db.prepare('SELECT action FROM manual_overrides').get() as {
      action: string;
    };
    const action = db.prepare('SELECT action FROM scheduled_actions').get() as {
      action: string;
    };
    expect(plan.action).toBe('hold');
    expect(override.action).toBe('hold');
    expect(action.action).toBe('hold');
  });

  it("bumps usage_learning_window_days from 14 to 90, leaving explicit overrides untouched", () => {
    const db = freshDb();
    initSchema(db);
    db.prepare("INSERT INTO settings (key, value) VALUES ('usage_learning_window_days', '14')").run();

    initSchema(db);
    let row = db
      .prepare("SELECT value FROM settings WHERE key = 'usage_learning_window_days'")
      .get() as { value: string };
    expect(row.value).toBe('90');

    db.prepare("UPDATE settings SET value = '30' WHERE key = 'usage_learning_window_days'").run();
    initSchema(db);
    row = db
      .prepare("SELECT value FROM settings WHERE key = 'usage_learning_window_days'")
      .get() as { value: string };
    expect(row.value).toBe('30');
  });

  it('normalises rate timestamps that were stored with millisecond precision', () => {
    const db = freshDb();
    initSchema(db);

    // Simulate Nordpool having written the millisecond form, and Octopus the
    // canonical second-precision form, for the same slot.
    db.prepare(
      "INSERT INTO rates (valid_from, valid_to, price_inc_vat, fetched_at, source) VALUES ('2026-04-05T00:00:00.000Z', '2026-04-05T00:30:00.000Z', 10, '2026-04-05T00:00:00Z', 'nordpool')",
    ).run();
    db.prepare(
      "INSERT INTO rates (valid_from, valid_to, price_inc_vat, fetched_at, source) VALUES ('2026-04-05T00:00:00Z', '2026-04-05T00:30:00Z', 8, '2026-04-05T00:00:00Z', 'octopus')",
    ).run();

    initSchema(db);

    const rows = db
      .prepare('SELECT valid_from, source FROM rates ORDER BY valid_from')
      .all() as Array<{ valid_from: string; source: string }>;
    // The duplicate nordpool row is gone; the canonical octopus row survives.
    expect(rows).toHaveLength(1);
    expect(rows[0].valid_from).toBe('2026-04-05T00:00:00Z');
    expect(rows[0].source).toBe('octopus');
  });
});
