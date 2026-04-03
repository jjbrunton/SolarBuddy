import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSavingsDataMock,
  getDailyPnLMock,
} = vi.hoisted(() => ({
  getSavingsDataMock: vi.fn(),
  getDailyPnLMock: vi.fn(),
}));

vi.mock('@/lib/analytics-data', () => ({
  getSavingsData: getSavingsDataMock,
}));

vi.mock('@/lib/accounting', () => ({
  getDailyPnL: getDailyPnLMock,
}));

import { GET as getAccounting } from './accounting/route';
import { GET as getSavings } from './savings/route';

describe('analytics api routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the accounting default period when none is provided', async () => {
    getDailyPnLMock.mockReturnValue({ summary: { total_net_cost: 10 }, daily: [] });

    const response = await getAccounting(new Request('http://localhost/api/analytics/accounting'));

    expect(await response.json()).toEqual({ period: '7d', summary: { total_net_cost: 10 }, daily: [] });
    expect(getDailyPnLMock).toHaveBeenCalledWith('7d');
  });

  it('uses the savings default period when omitted', async () => {
    getSavingsDataMock.mockReturnValue({ savings: 42 });

    const response = await getSavings(new Request('http://localhost/api/analytics/savings'));

    expect(await response.json()).toEqual({ period: '7d', savings: 42 });
    expect(getSavingsDataMock).toHaveBeenCalledWith('7d');
  });
});
