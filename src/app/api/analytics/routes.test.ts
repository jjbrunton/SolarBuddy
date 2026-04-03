import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEnergyDataMock,
  getBatteryDataMock,
  getCarbonDataMock,
  getRatesCompareDataMock,
  getSavingsDataMock,
  getDailyPnLMock,
  runTariffComparisonMock,
} = vi.hoisted(() => ({
  getEnergyDataMock: vi.fn(),
  getBatteryDataMock: vi.fn(),
  getCarbonDataMock: vi.fn(),
  getRatesCompareDataMock: vi.fn(),
  getSavingsDataMock: vi.fn(),
  getDailyPnLMock: vi.fn(),
  runTariffComparisonMock: vi.fn(),
}));

vi.mock('@/lib/analytics-data', () => ({
  getEnergyData: getEnergyDataMock,
  getBatteryData: getBatteryDataMock,
  getCarbonData: getCarbonDataMock,
  getRatesCompareData: getRatesCompareDataMock,
  getSavingsData: getSavingsDataMock,
}));

vi.mock('@/lib/accounting', () => ({
  getDailyPnL: getDailyPnLMock,
}));

vi.mock('@/lib/tariff-comparison', () => ({
  runTariffComparison: runTariffComparisonMock,
}));

import { GET as getEnergy } from './energy/route';
import { GET as getAccounting } from './accounting/route';
import { GET as getBattery } from './battery/route';
import { GET as getCarbon } from './carbon/route';
import { GET as getRatesCompare } from './rates-compare/route';
import { GET as getSavings } from './savings/route';
import { GET as getTariffComparison } from './tariff-comparison/route';

describe('analytics api routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns energy analytics for the requested period', async () => {
    getEnergyDataMock.mockReturnValue({ points: [1, 2, 3] });

    const response = await getEnergy(new Request('http://localhost/api/analytics/energy?period=30d'));

    expect(await response.json()).toEqual({ period: '30d', points: [1, 2, 3] });
    expect(getEnergyDataMock).toHaveBeenCalledWith('30d');
  });

  it('uses the accounting default period when none is provided', async () => {
    getDailyPnLMock.mockReturnValue({ summary: { total_net_cost: 10 }, daily: [] });

    const response = await getAccounting(new Request('http://localhost/api/analytics/accounting'));

    expect(await response.json()).toEqual({ period: '7d', summary: { total_net_cost: 10 }, daily: [] });
    expect(getDailyPnLMock).toHaveBeenCalledWith('7d');
  });

  it('uses the battery default period when none is provided', async () => {
    getBatteryDataMock.mockReturnValue({ cycles: [] });

    const response = await getBattery(new Request('http://localhost/api/analytics/battery'));

    expect(await response.json()).toEqual({ period: '30d', cycles: [] });
    expect(getBatteryDataMock).toHaveBeenCalledWith('30d');
  });

  it('awaits carbon analytics and defaults to today', async () => {
    getCarbonDataMock.mockResolvedValue({ forecast: [] });

    const response = await getCarbon(new Request('http://localhost/api/analytics/carbon'));

    expect(await response.json()).toEqual({ period: 'today', forecast: [] });
    expect(getCarbonDataMock).toHaveBeenCalledWith('today');
  });

  it('uses the compare query parameter for tariff comparison charts', async () => {
    getRatesCompareDataMock.mockReturnValue({ rows: [] });

    const response = await getRatesCompare(new Request('http://localhost/api/analytics/rates-compare?compare=90d'));

    expect(await response.json()).toEqual({ compare_period: '90d', rows: [] });
    expect(getRatesCompareDataMock).toHaveBeenCalledWith('90d');
  });

  it('uses the savings default period when omitted', async () => {
    getSavingsDataMock.mockReturnValue({ savings: 42 });

    const response = await getSavings(new Request('http://localhost/api/analytics/savings'));

    expect(await response.json()).toEqual({ period: '7d', savings: 42 });
    expect(getSavingsDataMock).toHaveBeenCalledWith('7d');
  });

  it('passes custom tariff inputs through to the tariff comparison engine', async () => {
    runTariffComparisonMock.mockReturnValue({ summary: { total_difference: 5 }, daily: [] });

    const response = await getTariffComparison(
      new Request('http://localhost/api/analytics/tariff-comparison?period=90d&target_tariff=flux&offpeak=8&peak=30&standard=20&export=5'),
    );

    expect(await response.json()).toEqual({
      period: '90d',
      targetTariff: 'flux',
      summary: { total_difference: 5 },
      daily: [],
    });
    expect(runTariffComparisonMock).toHaveBeenCalledWith('90d', 'flux', {
      offpeak: '8',
      peak: '30',
      standard: '20',
      export: '5',
    });
  });
});
