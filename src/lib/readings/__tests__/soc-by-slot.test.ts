import { beforeEach, describe, expect, it, vi } from 'vitest';

const { allMock, prepareMock } = vi.hoisted(() => ({
  allMock: vi.fn(),
  prepareMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

import { getActualSOCBySlot } from '../soc-by-slot';

beforeEach(() => {
  vi.clearAllMocks();
  prepareMock.mockReturnValue({ all: allMock });
});

describe('getActualSOCBySlot', () => {
  it('queries the day boundaries for the given date', () => {
    allMock.mockReturnValue([]);

    getActualSOCBySlot('2026-04-16');

    expect(prepareMock).toHaveBeenCalledTimes(1);
    const sql = prepareMock.mock.calls[0][0];
    expect(sql).toContain('FROM readings');
    expect(sql).toContain('battery_soc IS NOT NULL');
    expect(allMock).toHaveBeenCalledWith(
      '2026-04-16T00:00:00.000Z',
      '2026-04-16T23:59:59.999Z',
    );
  });

  it('returns the rows returned by the query', () => {
    const rows = [
      { slot_start: '2026-04-16T00:00:00.000Z', battery_soc: 42.3 },
      { slot_start: '2026-04-16T00:30:00.000Z', battery_soc: 45.1 },
    ];
    allMock.mockReturnValue(rows);

    expect(getActualSOCBySlot('2026-04-16')).toEqual(rows);
  });
});
