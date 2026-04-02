import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      avg_price REAL,
      status TEXT DEFAULT 'planned',
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT,
      type TEXT DEFAULT 'charge'
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

vi.mock('../db', () => ({
  getDb: () => testDb,
}));

import { getDb } from '../db';
import { appendEvent, getEventsLog, resetEventsForTests } from '../events';
import { resetMqttLogsForTests } from '../mqtt/logs';

describe('events log', () => {
  beforeEach(() => {
    const db = getDb();
    resetEventsForTests();
    resetMqttLogsForTests();
    db.prepare('DELETE FROM schedules').run();
  });

  it('returns persisted event entries before fallback data', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, executed_at, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      '2026-04-01',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:30:00.000Z',
      7.5,
      'completed',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:30:00.000Z',
      'charge'
    );
    db.prepare(
      `INSERT INTO mqtt_logs (timestamp, level, direction, topic, payload)
       VALUES (?, ?, ?, ?, ?)`
    ).run('2026-04-01T01:00:00.000Z', 'success', 'system', null, 'Connected to broker');

    appendEvent({
      timestamp: '2026-04-01T02:00:00.000Z',
      level: 'success',
      category: 'scheduler',
      message: 'Night Fill: scheduled 2 charge windows.',
    });

    expect(getEventsLog()).toEqual([
      expect.objectContaining({
        timestamp: '2026-04-01T02:00:00.000Z',
        level: 'success',
        category: 'scheduler',
        message: 'Night Fill: scheduled 2 charge windows.',
      }),
    ]);
  });

  it('falls back to recent scheduler and MQTT activity when no events are persisted', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, executed_at, type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      '2026-04-01',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:30:00.000Z',
      6.25,
      'completed',
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:30:00.000Z',
      'charge',
      'SOC target reached early'
    );
    db.prepare(
      `INSERT INTO mqtt_logs (timestamp, level, direction, topic, payload)
       VALUES (?, ?, ?, ?, ?)`
    ).run('2026-04-01T01:00:00.000Z', 'warning', 'system', null, 'Connection closed');

    const events = getEventsLog();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      timestamp: '2026-04-01T01:00:00.000Z',
      level: 'warning',
      category: 'mqtt',
      message: 'Connection closed',
    });
    expect(events[1]).toMatchObject({
      timestamp: '2026-04-01T00:30:00.000Z',
      level: 'success',
      category: 'scheduler',
    });
    expect(events[1].message).toContain('completed');
    expect(events[1].message).toContain('SOC target reached early');
  });
});
