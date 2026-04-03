import { describe, expect, it } from 'vitest';
import { mergeVerifiedOctopusSettings, type VerifiedOctopusAccountInfo } from '../verified-settings';

const baseSettings = {
  octopus_api_key: 'sk_test_123',
  octopus_account: '',
  octopus_region: '',
  octopus_product_code: 'AGILE-24-10-01',
  octopus_mpan: '',
  octopus_meter_serial: '',
  octopus_export_mpan: '',
  octopus_export_meter_serial: '',
  octopus_export_product_code: '',
  tariff_type: 'agile',
  mqtt_host: 'solar-assistant.local',
};

const verifiedAccount: VerifiedOctopusAccountInfo = {
  accountNumber: 'A-1234ABCD',
  mpan: '2000012345678',
  meterSerial: '21L1234567',
  tariffCode: 'E-1R-AGILE-24-10-01-H',
  productCode: 'AGILE-24-10-01',
  region: 'H',
  regionName: 'Southern England',
};

describe('mergeVerifiedOctopusSettings', () => {
  it('copies verified Octopus metadata into persisted settings', () => {
    const merged = mergeVerifiedOctopusSettings(baseSettings, verifiedAccount);

    expect(merged.octopus_account).toBe('A-1234ABCD');
    expect(merged.octopus_region).toBe('H');
    expect(merged.octopus_product_code).toBe('AGILE-24-10-01');
    expect(merged.octopus_mpan).toBe('2000012345678');
    expect(merged.octopus_meter_serial).toBe('21L1234567');
    expect(merged.octopus_api_key).toBe('sk_test_123');
    expect(merged.tariff_type).toBe('agile');
  });

  it('normalizes a missing meter serial to an empty string', () => {
    const merged = mergeVerifiedOctopusSettings(baseSettings, {
      ...verifiedAccount,
      meterSerial: '',
    });

    expect(merged.octopus_meter_serial).toBe('');
  });

  it('merges export meter info when present', () => {
    const merged = mergeVerifiedOctopusSettings(baseSettings, {
      ...verifiedAccount,
      export: {
        mpan: '2000098765432',
        meterSerial: '21E9876543',
        tariffCode: 'E-1R-AGILE-OUTGOING-19-05-13-H',
        productCode: 'AGILE-OUTGOING-19-05-13',
      },
    });

    expect(merged.octopus_export_mpan).toBe('2000098765432');
    expect(merged.octopus_export_meter_serial).toBe('21E9876543');
    expect(merged.octopus_export_product_code).toBe('AGILE-OUTGOING-19-05-13');
  });

  it('leaves export fields unchanged when no export info in verification', () => {
    const merged = mergeVerifiedOctopusSettings(baseSettings, verifiedAccount);

    expect(merged.octopus_export_mpan).toBe('');
    expect(merged.octopus_export_meter_serial).toBe('');
    expect(merged.octopus_export_product_code).toBe('');
  });
});
