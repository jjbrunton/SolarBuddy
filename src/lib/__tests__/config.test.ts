import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSetting, getSettings, saveSettings } from '../config';

const { prepareMock, allMock, getMock, runMock, transactionMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  getMock: vi.fn(),
  runMock: vi.fn(),
  transactionMock: vi.fn((callback: (entries: [string, string][]) => void) => (entries: [string, string][]) => callback(entries)),
}));

vi.mock('../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

describe('config helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockImplementation((query: string) => ({
      all: allMock,
      get: getMock,
      run: runMock,
    }));
  });

  it('merges stored settings with defaults', () => {
    allMock.mockReturnValue([
      { key: 'mqtt_host', value: 'broker' },
      { key: 'charge_rate', value: '90' },
    ]);

    expect(getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      mqtt_host: 'broker',
      charge_rate: '90',
    });
  });

  it('returns stored settings or falls back to defaults for a single key', () => {
    getMock.mockReturnValueOnce({ value: '1884' }).mockReturnValueOnce(undefined);

    expect(getSetting('mqtt_port')).toBe('1884');
    expect(getSetting('watchdog_enabled')).toBe(DEFAULT_SETTINGS.watchdog_enabled);
  });

  it('persists settings entries inside a transaction', () => {
    saveSettings({ mqtt_host: 'broker', mqtt_port: '1884' });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(runMock).toHaveBeenNthCalledWith(1, 'mqtt_host', 'broker');
    expect(runMock).toHaveBeenNthCalledWith(2, 'mqtt_port', '1884');
  });
});
