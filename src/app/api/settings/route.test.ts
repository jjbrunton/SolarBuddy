import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSettingsMock,
  saveSettingsMock,
  connectMqttMock,
  syncInverterWatchdogSettingMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  saveSettingsMock: vi.fn(),
  connectMqttMock: vi.fn(),
  syncInverterWatchdogSettingMock: vi.fn(),
}));

vi.mock('@/lib/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config')>('@/lib/config');
  return {
    ...actual,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
    SETTING_KEY_SET: new Set(['mqtt_host', 'mqtt_port', 'watchdog_enabled', 'charge_rate']),
  };
});

vi.mock('@/lib/mqtt/client', () => ({
  connectMqtt: connectMqttMock,
}));

vi.mock('@/lib/scheduler/watchdog', () => ({
  syncInverterWatchdogSetting: syncInverterWatchdogSettingMock,
}));

import { GET, POST } from './route';

describe('/api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ mqtt_host: 'broker', watchdog_enabled: 'true' });
  });

  it('returns the current settings', async () => {
    const response = await GET();

    expect(await response.json()).toEqual({ mqtt_host: 'broker', watchdog_enabled: 'true' });
  });

  it('rejects non-string setting values', async () => {
    const response = await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({ charge_rate: 100 }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Invalid value for charge_rate: must be a string',
    });
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it('persists known settings, ignores unknown keys, and triggers dependent services', async () => {
    getSettingsMock.mockReturnValueOnce({
      mqtt_host: 'new-broker',
      mqtt_port: '1884',
      watchdog_enabled: 'false',
      charge_rate: '90',
    });

    const response = await POST(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          mqtt_host: 'new-broker',
          mqtt_port: '1884',
          watchdog_enabled: 'false',
          charge_rate: '90',
          ignored: 'value',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(saveSettingsMock).toHaveBeenCalledWith({
      mqtt_host: 'new-broker',
      mqtt_port: '1884',
      watchdog_enabled: 'false',
      charge_rate: '90',
    });
    expect(connectMqttMock).toHaveBeenCalledTimes(1);
    expect(syncInverterWatchdogSettingMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      ok: true,
      settings: {
        mqtt_host: 'new-broker',
        mqtt_port: '1884',
        watchdog_enabled: 'false',
        charge_rate: '90',
      },
    });
  });
});
