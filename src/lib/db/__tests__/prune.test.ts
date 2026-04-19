import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE TABLE mqtt_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      direction TEXT NOT NULL,
      topic TEXT,
      payload TEXT NOT NULL
    );
  `);
  return { testDb: db };
});

vi.mock('../connection', () => ({
  getDb: () => testDb,
}));

import { pruneTableByAge, runRetentionPrune, RETENTION_TARGETS } from '../prune';

function insertEvent(timestamp: string, message = 'msg') {
  testDb
    .prepare(
      `INSERT INTO events (timestamp, level, category, message) VALUES (?, 'info', 'test', ?)`
    )
    .run(timestamp, message);
}

function insertMqttLog(timestamp: string) {
  testDb
    .prepare(
      `INSERT INTO mqtt_logs (timestamp, level, direction, topic, payload) VALUES (?, 'info', 'inbound', 'topic/x', 'payload')`
    )
    .run(timestamp);
}

describe('pruneTableByAge', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM events').run();
    testDb.prepare('DELETE FROM mqtt_logs').run();
  });

  it('deletes rows older than retentionDays and keeps recent rows', () => {
    const recent = new Date().toISOString();
    const oldIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    insertEvent(oldIso, 'old');
    insertEvent(recent, 'recent');

    const result = pruneTableByAge({
      table: 'events',
      timestampColumn: 'timestamp',
      retentionDays: 30,
    });

    expect(result).toEqual({ table: 'events', deleted: 1 });
    const remaining = testDb.prepare('SELECT message FROM events').all() as { message: string }[];
    expect(remaining.map((r) => r.message)).toEqual(['recent']);
  });

  it('handles SQLite-default timestamps (no T or Z)', () => {
    insertEvent('2026-01-01 00:00:00', 'old-default-format');

    const result = pruneTableByAge({
      table: 'events',
      timestampColumn: 'timestamp',
      retentionDays: 30,
    });

    expect(result.deleted).toBe(1);
  });

  it('does not delete rows exactly at the cutoff boundary', () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    insertEvent(recent, 'fresh');

    const result = pruneTableByAge({
      table: 'events',
      timestampColumn: 'timestamp',
      retentionDays: 30,
    });

    expect(result.deleted).toBe(0);
  });
});

describe('runRetentionPrune', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM events').run();
    testDb.prepare('DELETE FROM mqtt_logs').run();
  });

  it('prunes every configured target and reports counts', () => {
    const oldIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    insertEvent(oldIso, 'old-event');
    insertEvent(oldIso, 'another-old-event');
    insertMqttLog(oldIso);

    const results = runRetentionPrune();

    expect(results.map((r) => r.table)).toEqual(RETENTION_TARGETS.map((t) => t.table));
    const eventsResult = results.find((r) => r.table === 'events');
    const mqttResult = results.find((r) => r.table === 'mqtt_logs');
    expect(eventsResult?.deleted).toBe(2);
    expect(mqttResult?.deleted).toBe(1);
  });

  it('targets only display/diagnostic tables (no calculation inputs)', () => {
    const tables = RETENTION_TARGETS.map((t) => t.table);
    expect(tables).toEqual(['events', 'mqtt_logs']);
    // Guard: never prune anything calculations depend on.
    for (const protectedTable of [
      'rates',
      'export_rates',
      'readings',
      'schedules',
      'plan_slots',
      'usage_profile',
      'usage_profile_meta',
      'manual_overrides',
      'auto_overrides',
      'carbon_intensity',
      'settings',
    ]) {
      expect(tables).not.toContain(protectedTable);
    }
  });
});
