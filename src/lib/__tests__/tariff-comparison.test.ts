import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runTariffComparison } from '../tariff-comparison';

const {
  prepareMock,
  allMock,
  periodToISOMock,
  wattSamplesToKwhMock,
  getTariffDefinitionMock,
  generateSyntheticRatesMock,
  getSettingsMock,
} = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  periodToISOMock: vi.fn(),
  wattSamplesToKwhMock: vi.fn(),
  getTariffDefinitionMock: vi.fn(),
  generateSyntheticRatesMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

vi.mock('../analytics', async () => {
  const actual = await vi.importActual<typeof import('../analytics')>('../analytics');
  return {
    ...actual,
    periodToISO: periodToISOMock,
    wattSamplesToKwh: wattSamplesToKwhMock,
  };
});

vi.mock('../tariffs/definitions', async () => {
  const actual = await vi.importActual<typeof import('../tariffs/definitions')>('../tariffs/definitions');
  return {
    ...actual,
    getTariffDefinition: getTariffDefinitionMock,
  };
});

vi.mock('../tariffs/rate-generator', () => ({
  generateSyntheticRates: generateSyntheticRatesMock,
}));

vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof import('../config')>('../config');
  return {
    ...actual,
    getSettings: getSettingsMock,
  };
});

describe('runTariffComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareMock.mockReturnValue({ all: allMock });
    periodToISOMock.mockReturnValue('2026-03-01T00:00:00Z');
    getSettingsMock.mockReturnValue({
      export_rate: '4.5',
      tariff_type: 'agile',
      tariff_offpeak_rate: '7.5',
      tariff_peak_rate: '35',
      tariff_standard_rate: '24.5',
    });
  });

  it('replays historical usage against a synthetic tariff', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-01',
        import_w_sum: 1000,
        export_w_sum: 500,
        sample_count: 4,
        avg_import_price: 22,
        avg_export_price: 6,
      },
    ]);
    wattSamplesToKwhMock.mockReturnValueOnce(1.5).mockReturnValueOnce(0.25);
    getTariffDefinitionMock.mockReturnValue({ usesApiRates: false, type: 'go' });
    generateSyntheticRatesMock.mockReturnValue([
      { price_inc_vat: 10 },
      { price_inc_vat: 20 },
      { price_inc_vat: 30 },
    ]);

    expect(runTariffComparison('30d', 'go', { offpeak: '8', export: '5.5' })).toEqual({
      summary: {
        total_actual_net: 31.5,
        total_hypothetical_net: 28.63,
        total_difference: -2.87,
        percentage_difference: -9.13,
      },
      daily: [
        {
          date: '2026-04-01',
          actual_import_cost: 33,
          hypothetical_import_cost: 30,
          actual_export_revenue: 1.5,
          hypothetical_export_revenue: 1.38,
          actual_net: 31.5,
          hypothetical_net: 28.63,
          difference: -2.87,
        },
      ],
    });

    expect(periodToISOMock).toHaveBeenCalledWith('30d');
    expect(generateSyntheticRatesMock).toHaveBeenCalledWith(
      { usesApiRates: false, type: 'go' },
      expect.objectContaining({ tariff_type: 'go', tariff_offpeak_rate: '8' }),
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T23:59:59.000Z',
    );
  });

  it('uses stored Agile prices directly for Agile comparisons', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-01',
        import_w_sum: 1000,
        export_w_sum: 0,
        sample_count: 4,
        avg_import_price: 18,
        avg_export_price: null,
      },
    ]);
    wattSamplesToKwhMock.mockReturnValueOnce(2).mockReturnValueOnce(0);
    getTariffDefinitionMock.mockReturnValue({ usesApiRates: true, type: 'agile' });

    expect(runTariffComparison('7d', 'agile')).toEqual({
      summary: {
        total_actual_net: 36,
        total_hypothetical_net: 36,
        total_difference: 0,
        percentage_difference: 0,
      },
      daily: [
        {
          date: '2026-04-01',
          actual_import_cost: 36,
          hypothetical_import_cost: 36,
          actual_export_revenue: 0,
          hypothetical_export_revenue: 0,
          actual_net: 36,
          hypothetical_net: 36,
          difference: 0,
        },
      ],
    });

    expect(generateSyntheticRatesMock).not.toHaveBeenCalled();
  });
});
