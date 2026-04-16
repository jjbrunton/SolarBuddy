/**
 * Full route + real SQLite integration for /api/overrides.
 *
 * Exercises every HTTP verb the route supports and asserts the manual_overrides
 * table state at each step. Catches SQL typos, transaction behaviour, and route
 * wiring that the heavily mocked route.test.ts can't see.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb, reconcileInverterStateMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE manual_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT DEFAULT 'charge',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_overrides_date ON manual_overrides(date);
  `);

  return {
    testDb: db,
    reconcileInverterStateMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
// override-repository imports './connection' directly, so mock both entry points.
vi.mock('@/lib/db/connection', () => ({ getDb: () => testDb }));
vi.mock('@/lib/scheduler/watchdog', () => ({
  reconcileInverterState: reconcileInverterStateMock,
}));
vi.mock('@/lib/virtual-inverter/runtime', () => ({
  getVirtualNow: () => new Date('2026-04-16T10:00:00Z'),
}));

import { DELETE, GET, PATCH, POST } from './route';

type OverrideRow = {
  date: string;
  slot_start: string;
  slot_end: string;
  action: string;
};

function listRows(): OverrideRow[] {
  return testDb
    .prepare('SELECT date, slot_start, slot_end, action FROM manual_overrides ORDER BY slot_start')
    .all() as OverrideRow[];
}

describe('/api/overrides (route + real SQLite)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00Z'));
    testDb.prepare('DELETE FROM manual_overrides').run();
    reconcileInverterStateMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a full POST → GET lifecycle and reconciles the inverter each step', async () => {
    const postRes = await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [
            { slot_start: '2026-04-16T12:00:00Z', slot_end: '2026-04-16T12:30:00Z', action: 'charge' },
            { slot_start: '2026-04-16T13:00:00Z', slot_end: '2026-04-16T13:30:00Z', action: 'discharge' },
          ],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await postRes.json()).toEqual({ ok: true, count: 2 });
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual overrides replaced');

    expect(listRows()).toEqual([
      { date: '2026-04-16', slot_start: '2026-04-16T12:00:00Z', slot_end: '2026-04-16T12:30:00Z', action: 'charge' },
      { date: '2026-04-16', slot_start: '2026-04-16T13:00:00Z', slot_end: '2026-04-16T13:30:00Z', action: 'discharge' },
    ]);

    const getRes = await GET();
    const getBody = await getRes.json();
    expect(getBody.overrides).toHaveLength(2);
    expect(getBody.overrides[0]).toMatchObject({ slot_start: '2026-04-16T12:00:00Z', action: 'charge' });
  });

  it('replaces previous overrides atomically — a second POST wipes the first set', async () => {
    await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [{ slot_start: '2026-04-16T12:00:00Z', slot_end: '2026-04-16T12:30:00Z', action: 'charge' }],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(listRows()).toHaveLength(1);

    await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [{ slot_start: '2026-04-16T14:00:00Z', slot_end: '2026-04-16T14:30:00Z', action: 'hold' }],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    const rows = listRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot_start: '2026-04-16T14:00:00Z', action: 'hold' });
  });

  it('coerces unknown actions to charge instead of rejecting the whole payload', async () => {
    await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [{ slot_start: '2026-04-16T12:00:00Z', slot_end: '2026-04-16T12:30:00Z', action: 'teleport' }],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(listRows()[0].action).toBe('charge');
  });

  it('PATCH upserts a single slot and replaces the action when called again', async () => {
    const firstPatch = await PATCH(
      new Request('http://localhost/api/overrides', {
        method: 'PATCH',
        body: JSON.stringify({
          slot_start: '2026-04-16T15:00:00Z',
          slot_end: '2026-04-16T15:30:00Z',
          action: 'charge',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(firstPatch.status).toBe(200);
    expect(listRows()).toHaveLength(1);
    expect(listRows()[0].action).toBe('charge');

    await PATCH(
      new Request('http://localhost/api/overrides', {
        method: 'PATCH',
        body: JSON.stringify({
          slot_start: '2026-04-16T15:00:00Z',
          slot_end: '2026-04-16T15:30:00Z',
          action: 'discharge',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    const rows = listRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('discharge');
    expect(reconcileInverterStateMock).toHaveBeenCalledTimes(2);
  });

  it('DELETE with slot_start removes only that slot; DELETE without params clears the day', async () => {
    await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [
            { slot_start: '2026-04-16T12:00:00Z', slot_end: '2026-04-16T12:30:00Z', action: 'charge' },
            { slot_start: '2026-04-16T13:00:00Z', slot_end: '2026-04-16T13:30:00Z', action: 'charge' },
          ],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    await DELETE(new Request('http://localhost/api/overrides?slot_start=2026-04-16T12:00:00Z'));
    expect(listRows()).toHaveLength(1);
    expect(listRows()[0].slot_start).toBe('2026-04-16T13:00:00Z');
    expect(reconcileInverterStateMock).toHaveBeenLastCalledWith('manual override removed');

    await DELETE(new Request('http://localhost/api/overrides'));
    expect(listRows()).toHaveLength(0);
    expect(reconcileInverterStateMock).toHaveBeenLastCalledWith('manual overrides cleared');
  });

  it('scoping: GET only returns overrides for today, not yesterday', async () => {
    testDb
      .prepare(
        `INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('2026-04-15', '2026-04-15T12:00:00Z', '2026-04-15T12:30:00Z', 'charge', '2026-04-15T11:59:00Z');
    testDb
      .prepare(
        `INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('2026-04-16', '2026-04-16T12:00:00Z', '2026-04-16T12:30:00Z', 'discharge', '2026-04-16T11:59:00Z');

    const body = await (await GET()).json();
    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0].slot_start).toBe('2026-04-16T12:00:00Z');
  });
});
