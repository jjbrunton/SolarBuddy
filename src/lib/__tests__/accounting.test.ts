import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDailyPnL } from '../accounting';

const { prepareMock, allMock, periodToISOMock, wattSamplesToKwhMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  allMock: vi.fn(),
  periodToISOMock: vi.fn(),
  wattSamplesToKwhMock: vi.fn(),
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

describe('getDailyPnL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    periodToISOMock.mockReturnValue('2026-03-01T00:00:00Z');
    prepareMock.mockReturnValue({ all: allMock });
  });

  it('builds daily and summary PnL data from readings and prices', () => {
    allMock.mockReturnValue([
      {
        date: '2026-04-01',
        import_w_sum: 1000,
        export_w_sum: 800,
        sample_count: 4,
        avg_import_price: 20,
        avg_export_price: 5,
      },
      {
        date: '2026-04-02',
        import_w_sum: 2000,
        export_w_sum: 0,
        sample_count: 4,
        avg_import_price: 30,
        avg_export_price: null,
      },
    ]);
    wattSamplesToKwhMock
      .mockReturnValueOnce(1.23)
      .mockReturnValueOnce(0.45)
      .mockReturnValueOnce(2.34)
      .mockReturnValueOnce(0);

    expect(getDailyPnL('30d')).toEqual({
      summary: {
        total_import_kwh: 3.57,
        total_import_cost: 94.8,
        total_export_kwh: 0.45,
        total_export_revenue: 2.25,
        total_net_cost: 92.55,
      },
      daily: [
        {
          date: '2026-04-01',
          import_kwh: 1.23,
          import_cost: 24.6,
          export_kwh: 0.45,
          export_revenue: 2.25,
          net_cost: 22.35,
        },
        {
          date: '2026-04-02',
          import_kwh: 2.34,
          import_cost: 70.2,
          export_kwh: 0,
          export_revenue: 0,
          net_cost: 70.2,
        },
      ],
    });

    expect(periodToISOMock).toHaveBeenCalledWith('30d');
    expect(allMock).toHaveBeenCalledWith('2026-03-01T00:00:00Z');
  });

  it('returns empty totals when there are no rows', () => {
    allMock.mockReturnValue([]);

    expect(getDailyPnL('today')).toEqual({
      summary: {
        total_import_kwh: 0,
        total_import_cost: 0,
        total_export_kwh: 0,
        total_export_revenue: 0,
        total_net_cost: 0,
      },
      daily: [],
    });
  });
});
