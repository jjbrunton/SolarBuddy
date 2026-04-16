/**
 * Full route + real SQLite integration for /api/settings.
 *
 * Verifies the critical path that the heavily-mocked unit test can't:
 *   - POST actually writes to SQLite (upsert branch of ON CONFLICT)
 *   - GET returns the merged defaults + persisted overrides
 *   - Unknown keys are dropped silently
 *   - The replan trigger only fires when a schedule-relevant key changes
 *
 * All side-effect modules (MQTT reconnect, watchdog, HA sync, virtual inverter,
 * usage profile refresh) are mocked because the route imports them dynamically
 * based on which keys changed. What we validate is the DB-facing behaviour.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  testDb,
  syncVirtualInverterSettingMock,
  connectMqttMock,
  syncInverterWatchdogSettingMock,
  requestReplanMock,
  syncHomeAssistantSettingMock,
  computeUsageProfileMock,
} = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return {
    testDb: db,
    syncVirtualInverterSettingMock: vi.fn(),
    connectMqttMock: vi.fn(),
    syncInverterWatchdogSettingMock: vi.fn(),
    requestReplanMock: vi.fn(),
    syncHomeAssistantSettingMock: vi.fn(),
    computeUsageProfileMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ getDb: () => testDb }));
vi.mock('@/lib/db/connection', () => ({ getDb: () => testDb }));
vi.mock('@/lib/virtual-inverter/runtime', () => ({
  syncVirtualInverterSetting: syncVirtualInverterSettingMock,
}));
vi.mock('@/lib/mqtt/client', () => ({ connectMqtt: connectMqttMock }));
vi.mock('@/lib/scheduler/watchdog', () => ({
  syncInverterWatchdogSetting: syncInverterWatchdogSettingMock,
}));
vi.mock('@/lib/scheduler/reevaluate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scheduler/reevaluate')>(
    '@/lib/scheduler/reevaluate',
  );
  return { ...actual, requestReplan: requestReplanMock };
});
vi.mock('@/lib/home-assistant/runtime', () => ({
  syncHomeAssistantSetting: syncHomeAssistantSettingMock,
}));
vi.mock('@/lib/usage', () => ({ computeUsageProfile: computeUsageProfileMock }));

import { GET, POST } from './route';

function storedRow(key: string) {
  return testDb.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
}

describe('/api/settings (route + real SQLite)', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM settings').run();
    syncVirtualInverterSettingMock.mockReset().mockResolvedValue(undefined);
    connectMqttMock.mockReset();
    syncInverterWatchdogSettingMock.mockReset();
    requestReplanMock.mockReset();
    syncHomeAssistantSettingMock.mockReset().mockResolvedValue(undefined);
    computeUsageProfileMock.mockReset().mockResolvedValue(undefined);
  });

  it('POST persists valid keys and GET returns them merged with defaults', async () => {
    const res = await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          charge_rate: '85',
          min_soc_target: '80',
          charge_window_start: '00:30',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.charge_rate).toBe('85');

    // Hit SQLite directly to prove the write wasn't a memory illusion.
    expect(storedRow('charge_rate')).toEqual({ value: '85' });
    expect(storedRow('min_soc_target')).toEqual({ value: '80' });

    const getBody = await (await GET()).json();
    expect(getBody.charge_rate).toBe('85');
    expect(getBody.min_soc_target).toBe('80');
    // Keys not touched should fall back to defaults, not be undefined.
    expect(typeof getBody.auto_schedule).toBe('string');
  });

  it('POST ignores unknown keys and rejects non-string values with 400', async () => {
    // Unknown key silently dropped.
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ some_unknown_key: 'nope', charge_rate: '70' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(storedRow('some_unknown_key')).toBeUndefined();
    expect(storedRow('charge_rate')).toEqual({ value: '70' });

    // Non-string value for a real key → 400.
    const bad = await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ charge_rate: 70 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('upserts on repeat saves rather than inserting duplicates', async () => {
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ charge_rate: '70' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ charge_rate: '95' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const rows = testDb
      .prepare("SELECT value FROM settings WHERE key = 'charge_rate'")
      .all() as Array<{ value: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('95');
  });

  it('triggers a replan when a schedule-relevant setting changes, and skips it otherwise', async () => {
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ min_soc_target: '90' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(requestReplanMock).toHaveBeenCalledWith('settings changed');

    requestReplanMock.mockClear();

    // mqtt_host is handled separately — not in SCHEDULE_RELEVANT_KEYS.
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ mqtt_host: 'localhost' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(requestReplanMock).not.toHaveBeenCalled();
    expect(connectMqttMock).toHaveBeenCalled();
  });

  it('HA sync fires only when a homeassistant_* key is in the payload', async () => {
    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ charge_rate: '70' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(syncHomeAssistantSettingMock).not.toHaveBeenCalled();

    await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ homeassistant_enabled: 'true', homeassistant_host: 'broker' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(syncHomeAssistantSettingMock).toHaveBeenCalledTimes(1);
  });
});
