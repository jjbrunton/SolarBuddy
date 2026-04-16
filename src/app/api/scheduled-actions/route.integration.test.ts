/**
 * Full route + real SQLite integration for /api/scheduled-actions.
 *
 * Exercises GET / POST / PATCH / DELETE against the real scheduled_actions
 * table. Verifies that: (a) inserts return the new row with an autoincrement
 * id and timestamp, (b) PATCH updates the existing row in place, and (c)
 * DELETE removes it. The route.test.ts mocks the repository and does not
 * catch the UPDATE-vs-INSERT branch or the enabled bit coercion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scheduled_actions (
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
  `);
  return { testDb: db };
});

vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/db/connection', () => ({ getDb: () => testDb }));

import { DELETE, GET, PATCH, POST } from './route';

function countRows(): number {
  return (testDb.prepare('SELECT COUNT(*) AS c FROM scheduled_actions').get() as { c: number }).c;
}

describe('/api/scheduled-actions (route + real SQLite)', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM scheduled_actions').run();
  });

  it('POST inserts a new action and assigns an id', async () => {
    const res = await POST(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Evening hold',
          action: 'hold',
          time: '18:00',
          days: 'weekdays',
          soc_condition: 'above',
          soc_threshold: 50,
          duration_minutes: 90,
          enabled: true,
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.action.id).toBe('number');
    expect(body.action.id).toBeGreaterThan(0);

    expect(countRows()).toBe(1);
    const row = testDb
      .prepare('SELECT name, action, time, days, enabled FROM scheduled_actions WHERE id = ?')
      .get(body.action.id) as {
      name: string;
      action: string;
      time: string;
      days: string;
      enabled: number;
    };
    expect(row).toEqual({
      name: 'Evening hold',
      action: 'hold',
      time: '18:00',
      days: 'weekdays',
      enabled: 1,
    });
  });

  it('GET returns every action ordered by time ascending', async () => {
    testDb
      .prepare(
        `INSERT INTO scheduled_actions (name, action, time, days, soc_condition, soc_threshold, duration_minutes, enabled, created_at)
         VALUES (?, ?, ?, 'daily', 'any', 0, 30, 1, datetime('now'))`,
      )
      .run('Afternoon', 'charge', '14:00');
    testDb
      .prepare(
        `INSERT INTO scheduled_actions (name, action, time, days, soc_condition, soc_threshold, duration_minutes, enabled, created_at)
         VALUES (?, ?, ?, 'daily', 'any', 0, 30, 1, datetime('now'))`,
      )
      .run('Morning', 'discharge', '06:30');

    const body = await (await GET()).json();
    expect(body.actions.map((a: { name: string }) => a.name)).toEqual(['Morning', 'Afternoon']);
  });

  it('PATCH updates an existing action in place rather than inserting a new one', async () => {
    const created = await (
      await POST(
        new Request('http://localhost/api/scheduled-actions', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Noon discharge',
            action: 'discharge',
            time: '12:00',
            days: 'daily',
            soc_condition: 'any',
            soc_threshold: 0,
            duration_minutes: 30,
            enabled: true,
          }),
          headers: { 'content-type': 'application/json' },
        }),
      )
    ).json();
    const id = created.action.id;

    await PATCH(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'PATCH',
        body: JSON.stringify({
          id,
          name: 'Noon discharge',
          action: 'discharge',
          time: '12:30',
          days: 'weekends',
          soc_condition: 'below',
          soc_threshold: 40,
          duration_minutes: 60,
          enabled: false,
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(countRows()).toBe(1);
    const row = testDb
      .prepare('SELECT time, days, enabled, duration_minutes FROM scheduled_actions WHERE id = ?')
      .get(id);
    expect(row).toEqual({ time: '12:30', days: 'weekends', enabled: 0, duration_minutes: 60 });
  });

  it('PATCH without id returns 400', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'No id' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('DELETE removes the action; DELETE without id returns 400', async () => {
    const created = await (
      await POST(
        new Request('http://localhost/api/scheduled-actions', {
          method: 'POST',
          body: JSON.stringify({
            name: 'disposable',
            action: 'hold',
            time: '01:00',
            days: 'daily',
            soc_condition: 'any',
            soc_threshold: 0,
            duration_minutes: 30,
            enabled: true,
          }),
          headers: { 'content-type': 'application/json' },
        }),
      )
    ).json();

    const missing = await DELETE(new Request('http://localhost/api/scheduled-actions'));
    expect(missing.status).toBe(400);

    const ok = await DELETE(new Request(`http://localhost/api/scheduled-actions?id=${created.action.id}`));
    expect(ok.status).toBe(200);
    expect(countRows()).toBe(0);
  });
});
