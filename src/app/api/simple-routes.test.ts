import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getStateMock,
  getEventsLogMock,
  syncInverterTimeMock,
  checkForTariffChangeMock,
  verifyAccountMock,
} = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  getEventsLogMock: vi.fn(),
  syncInverterTimeMock: vi.fn(),
  checkForTariffChangeMock: vi.fn(),
  verifyAccountMock: vi.fn(),
}));

vi.mock('@/lib/state', () => ({
  getState: getStateMock,
}));

vi.mock('@/lib/events', () => ({
  getEventsLog: getEventsLogMock,
}));

vi.mock('@/lib/inverter/time-sync', () => ({
  syncInverterTime: syncInverterTimeMock,
}));

vi.mock('@/lib/octopus/tariff-monitor', () => ({
  checkForTariffChange: checkForTariffChangeMock,
}));

vi.mock('@/lib/octopus/account', () => ({
  verifyAccount: verifyAccountMock,
}));

import { GET as getStatus } from './status/route';
import { GET as getEventsLog } from './events-log/route';
import { POST as postTimeSync } from './system/time-sync/route';
import { POST as postTariffCheck } from './system/tariff-check/route';
import { POST as postVerify } from './octopus/verify/route';

describe('simple api routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the current inverter state', async () => {
    getStateMock.mockReturnValue({ mqtt_connected: true });

    const response = await getStatus();

    expect(await response.json()).toEqual({ mqtt_connected: true });
  });

  it('returns the event log payload', async () => {
    getEventsLogMock.mockReturnValue([{ id: 1 }]);

    const response = await getEventsLog();

    expect(await response.json()).toEqual({ events: [{ id: 1 }] });
  });

  it('returns the inverter time-sync result', async () => {
    syncInverterTimeMock.mockResolvedValue({ synced: true, message: 'ok' });

    const response = await postTimeSync();

    expect(await response.json()).toEqual({ synced: true, message: 'ok' });
  });

  it('returns tariff-check data on success and a 500 on failure', async () => {
    checkForTariffChangeMock.mockResolvedValueOnce({ changed: false, tariffCode: 'AGILE' });

    const okResponse = await postTariffCheck();
    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({ ok: true, changed: false, tariffCode: 'AGILE' });

    checkForTariffChangeMock.mockRejectedValueOnce(new Error('offline'));

    const errorResponse = await postTariffCheck();
    expect(errorResponse.status).toBe(500);
    expect(await errorResponse.json()).toEqual({ ok: false, error: 'offline' });
  });

  it('validates Octopus verify input and surfaces service errors', async () => {
    const missing = await postVerify(
      new Request('http://localhost/api/octopus/verify', {
        method: 'POST',
        body: JSON.stringify({ apiKey: '', accountNumber: '' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      ok: false,
      error: 'API key and account number are required',
    });

    verifyAccountMock.mockResolvedValueOnce({ ok: false, error: 'bad creds' });
    const invalid = await postVerify(
      new Request('http://localhost/api/octopus/verify', {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'key', accountNumber: 'A-1234' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: 'bad creds' });

    verifyAccountMock.mockResolvedValueOnce({ ok: true, account: { region: 'H' } });
    const success = await postVerify(
      new Request('http://localhost/api/octopus/verify', {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'key', accountNumber: 'A-1234' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ ok: true, account: { region: 'H' } });
  });
});
