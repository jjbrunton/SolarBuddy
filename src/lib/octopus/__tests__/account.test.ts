import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseTariffCode,
  findActiveAgreement,
  verifyAccount,
  type OctopusAgreement,
} from '../account';

// ── parseTariffCode ──────────────────────────────────────────────────

describe('parseTariffCode', () => {
  it('parses an Agile tariff code', () => {
    expect(parseTariffCode('E-1R-AGILE-24-10-01-H')).toEqual({
      productCode: 'AGILE-24-10-01',
      region: 'H',
    });
  });

  it('parses a variable tariff code', () => {
    expect(parseTariffCode('E-1R-VAR-22-11-01-N')).toEqual({
      productCode: 'VAR-22-11-01',
      region: 'N',
    });
  });

  it('parses a Go tariff code', () => {
    expect(parseTariffCode('E-1R-GO-VAR-22-10-14-A')).toEqual({
      productCode: 'GO-VAR-22-10-14',
      region: 'A',
    });
  });

  it('returns null for empty string', () => {
    expect(parseTariffCode('')).toBeNull();
  });

  it('returns null for string with no dashes', () => {
    expect(parseTariffCode('NOTARIFF')).toBeNull();
  });

  it('returns null for wrong prefix', () => {
    expect(parseTariffCode('G-1R-VAR-22-11-01-N')).toBeNull();
  });

  it('returns null when region is more than one character', () => {
    expect(parseTariffCode('E-1R-AGILE-24-10-01-HH')).toBeNull();
  });

  it('returns null when product code is missing', () => {
    expect(parseTariffCode('E-1R--A')).toBeNull();
  });
});

// ── findActiveAgreement ──────────────────────────────────────────────

describe('findActiveAgreement', () => {
  it('returns the open-ended agreement (valid_to null)', () => {
    const agreements: OctopusAgreement[] = [
      { tariff_code: 'E-1R-OLD-A', valid_from: '2022-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' },
      { tariff_code: 'E-1R-CURRENT-A', valid_from: '2023-01-01T00:00:00Z', valid_to: null },
    ];
    expect(findActiveAgreement(agreements)).toBe(agreements[1]);
  });

  it('prefers open-ended over future-dated', () => {
    const agreements: OctopusAgreement[] = [
      { tariff_code: 'E-1R-FUTURE-A', valid_from: '2023-01-01T00:00:00Z', valid_to: '2099-12-31T00:00:00Z' },
      { tariff_code: 'E-1R-CURRENT-A', valid_from: '2023-06-01T00:00:00Z', valid_to: null },
    ];
    expect(findActiveAgreement(agreements)!.tariff_code).toBe('E-1R-CURRENT-A');
  });

  it('falls back to future-dated agreement when no open-ended exists', () => {
    const agreements: OctopusAgreement[] = [
      { tariff_code: 'E-1R-EXPIRED-A', valid_from: '2020-01-01T00:00:00Z', valid_to: '2021-01-01T00:00:00Z' },
      { tariff_code: 'E-1R-FUTURE-A', valid_from: '2025-01-01T00:00:00Z', valid_to: '2099-12-31T00:00:00Z' },
    ];
    expect(findActiveAgreement(agreements)!.tariff_code).toBe('E-1R-FUTURE-A');
  });

  it('picks the most recent future-dated agreement', () => {
    const agreements: OctopusAgreement[] = [
      { tariff_code: 'E-1R-OLDER-A', valid_from: '2025-01-01T00:00:00Z', valid_to: '2099-01-01T00:00:00Z' },
      { tariff_code: 'E-1R-NEWER-A', valid_from: '2025-06-01T00:00:00Z', valid_to: '2099-06-01T00:00:00Z' },
    ];
    expect(findActiveAgreement(agreements)!.tariff_code).toBe('E-1R-NEWER-A');
  });

  it('returns null when all agreements are expired', () => {
    const agreements: OctopusAgreement[] = [
      { tariff_code: 'E-1R-OLD-A', valid_from: '2020-01-01T00:00:00Z', valid_to: '2021-01-01T00:00:00Z' },
      { tariff_code: 'E-1R-OLDER-A', valid_from: '2019-01-01T00:00:00Z', valid_to: '2020-01-01T00:00:00Z' },
    ];
    expect(findActiveAgreement(agreements)).toBeNull();
  });

  it('returns null for empty agreements array', () => {
    expect(findActiveAgreement([])).toBeNull();
  });
});

// ── verifyAccount ────────────────────────────────────────────────────

describe('verifyAccount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const validAccountResponse = {
    number: 'A-1234ABCD',
    properties: [
      {
        electricity_meter_points: [
          {
            mpan: '2000024512368',
            meters: [{ serial_number: '21L3456789' }],
            agreements: [
              {
                tariff_code: 'E-1R-AGILE-24-10-01-H',
                valid_from: '2024-10-01T00:00:00Z',
                valid_to: null,
              },
            ],
          },
        ],
      },
    ],
  };

  it('returns account info on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(validAccountResponse), { status: 200 })
    );

    const result = await verifyAccount('sk_live_test', 'A-1234ABCD');

    expect(result).toEqual({
      ok: true,
      account: {
        accountNumber: 'A-1234ABCD',
        mpan: '2000024512368',
        meterSerial: '21L3456789',
        tariffCode: 'E-1R-AGILE-24-10-01-H',
        productCode: 'AGILE-24-10-01',
        region: 'H',
        regionName: 'Southern England',
      },
    });
  });

  it('sends Basic auth header with API key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(validAccountResponse), { status: 200 })
    );

    await verifyAccount('sk_live_test', 'A-1234ABCD');

    const expectedAuth = Buffer.from('sk_live_test:').toString('base64');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.octopus.energy/v1/accounts/A-1234ABCD/',
      { headers: { Authorization: `Basic ${expectedAuth}` } }
    );
  });

  it('returns error on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    );

    const result = await verifyAccount('bad_key', 'A-1234ABCD');
    expect(result).toEqual({
      ok: false,
      error: 'Invalid API key — check your Octopus developer dashboard',
    });
  });

  it('returns error on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', { status: 404 })
    );

    const result = await verifyAccount('sk_live_test', 'A-00000000');
    expect(result).toEqual({
      ok: false,
      error: 'Account not found — check your account number',
    });
  });

  it('rejects account numbers that do not match expected format', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );

    const result = await verifyAccount('sk_live_test', '../../admin');
    expect(result).toEqual({ ok: false, error: 'Invalid account number format' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await verifyAccount('sk_live_test', 'A-1234ABCD');
    expect(result).toEqual({
      ok: false,
      error: 'Failed to connect to Octopus Energy API',
    });
  });

  it('returns error when no electricity meter points', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ number: 'A-1234ABCD', properties: [{ electricity_meter_points: [] }] }),
        { status: 200 }
      )
    );

    const result = await verifyAccount('sk_live_test', 'A-1234ABCD');
    expect(result).toEqual({
      ok: false,
      error: 'No electricity meter points found on this account',
    });
  });

  it('returns error when no active agreement', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 'A-1234ABCD',
          properties: [
            {
              electricity_meter_points: [
                {
                  mpan: '2000024512368',
                  meters: [{ serial_number: '21L3456789' }],
                  agreements: [
                    {
                      tariff_code: 'E-1R-OLD-22-01-01-H',
                      valid_from: '2022-01-01T00:00:00Z',
                      valid_to: '2023-01-01T00:00:00Z',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await verifyAccount('sk_live_test', 'A-1234ABCD');
    expect(result).toEqual({
      ok: false,
      error: 'No active tariff agreement found',
    });
  });

  it('handles missing meter serial gracefully', async () => {
    const noMeterSerial = {
      ...validAccountResponse,
      properties: [
        {
          electricity_meter_points: [
            {
              mpan: '2000024512368',
              meters: [],
              agreements: validAccountResponse.properties[0].electricity_meter_points[0].agreements,
            },
          ],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(noMeterSerial), { status: 200 })
    );

    const result = await verifyAccount('sk_live_test', 'A-1234ABCD');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.account.meterSerial).toBe('');
    }
  });
});
