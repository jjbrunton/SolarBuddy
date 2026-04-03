import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForTariffChange } from '../tariff-monitor';

const { getSettingsMock, saveSettingsMock, appendEventMock, verifyAccountMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  saveSettingsMock: vi.fn(),
  appendEventMock: vi.fn(),
  verifyAccountMock: vi.fn(),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
  saveSettings: saveSettingsMock,
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

vi.mock('../account', () => ({
  verifyAccount: verifyAccountMock,
}));

describe('checkForTariffChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unchanged when Octopus credentials are missing', async () => {
    getSettingsMock.mockReturnValue({ octopus_api_key: '', octopus_account: '' });

    await expect(checkForTariffChange()).resolves.toEqual({ changed: false });
  });

  it('returns unchanged when account verification fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getSettingsMock.mockReturnValue({
      octopus_api_key: 'key',
      octopus_account: 'A-123',
    });
    verifyAccountMock.mockResolvedValue({ ok: false, error: 'bad creds' });

    await expect(checkForTariffChange()).resolves.toEqual({ changed: false });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('returns unchanged when the tariff details match current settings', async () => {
    getSettingsMock.mockReturnValue({
      octopus_api_key: 'key',
      octopus_account: 'A-123',
      octopus_product_code: 'AGILE',
      octopus_region: 'H',
    });
    verifyAccountMock.mockResolvedValue({
      ok: true,
      account: { productCode: 'AGILE', region: 'H' },
    });

    await expect(checkForTariffChange()).resolves.toEqual({ changed: false });
  });

  it('persists a detected tariff change and logs an event', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getSettingsMock.mockReturnValue({
      octopus_api_key: 'key',
      octopus_account: 'A-123',
      octopus_product_code: 'AGILE',
      octopus_region: 'H',
    });
    verifyAccountMock.mockResolvedValue({
      ok: true,
      account: {
        productCode: 'GO',
        region: 'A',
        mpan: '123',
        meterSerial: 'M1',
        export: {
          mpan: '456',
          meterSerial: 'M2',
          productCode: 'OUTGOING',
        },
      },
    });

    await expect(checkForTariffChange()).resolves.toEqual({
      changed: true,
      oldProductCode: 'AGILE',
      newProductCode: 'GO',
      oldRegion: 'H',
      newRegion: 'A',
    });
    expect(saveSettingsMock).toHaveBeenNthCalledWith(1, {
      octopus_product_code: 'GO',
      octopus_region: 'A',
      octopus_mpan: '123',
      octopus_meter_serial: 'M1',
    });
    expect(saveSettingsMock).toHaveBeenNthCalledWith(2, {
      octopus_export_mpan: '456',
      octopus_export_meter_serial: 'M2',
      octopus_export_product_code: 'OUTGOING',
    });
    expect(appendEventMock).toHaveBeenCalledWith({
      level: 'warning',
      category: 'tariff-monitor',
      message: 'Tariff change detected: AGILE (H) → GO (A)',
    });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
