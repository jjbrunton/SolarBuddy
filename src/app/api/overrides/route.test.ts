import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, allMock, runMock, transactionMock, reconcileInverterStateMock } = vi.hoisted(() => {
  const runMock = vi.fn();
  const allMock = vi.fn();
  return {
    prepareMock: vi.fn((query: string) => ({ all: allMock, run: runMock })),
    allMock,
    runMock,
    transactionMock: vi.fn((callback: () => void) => () => callback()),
    reconcileInverterStateMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: prepareMock,
    transaction: transactionMock,
  }),
}));

vi.mock('@/lib/scheduler/watchdog', () => ({
  reconcileInverterState: reconcileInverterStateMock,
}));

import { DELETE, GET, PATCH, POST } from './route';

describe('/api/overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:15:00Z'));
  });

  it('returns today overrides', async () => {
    allMock.mockReturnValue([{ slot_start: 'a' }]);

    const response = await GET();

    expect(await response.json()).toEqual({ overrides: [{ slot_start: 'a' }] });
    expect(allMock).toHaveBeenCalledWith('2026-04-03');
  });

  it('validates the replacement payload', async () => {
    const response = await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({ slots: 'bad' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'slots must be an array' });
  });

  it('replaces overrides and defaults invalid actions to charge', async () => {
    const response = await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({
          slots: [
            { slot_start: 's1', slot_end: 'e1', action: 'hold' },
            { slot_start: 's2', slot_end: 'e2', action: 'invalid' },
          ],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(runMock).toHaveBeenNthCalledWith(1, '2026-04-03');
    expect(runMock).toHaveBeenNthCalledWith(2, '2026-04-03', 's1', 'e1', 'hold', '2026-04-03T10:15:00.000Z');
    expect(runMock).toHaveBeenNthCalledWith(3, '2026-04-03', 's2', 'e2', 'charge', '2026-04-03T10:15:00.000Z');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual overrides replaced');
    expect(await response.json()).toEqual({ ok: true, count: 2 });
  });

  it('validates PATCH payloads and upserts a single override', async () => {
    const missing = await PATCH(
      new Request('http://localhost/api/overrides', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'slot_start, slot_end, and valid action required' });

    const success = await PATCH(
      new Request('http://localhost/api/overrides', {
        method: 'PATCH',
        body: JSON.stringify({ slot_start: 's1', slot_end: 'e1', action: 'discharge' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(runMock).toHaveBeenNthCalledWith(1, '2026-04-03', 's1');
    expect(runMock).toHaveBeenNthCalledWith(2, '2026-04-03', 's1', 'e1', 'discharge', '2026-04-03T10:15:00.000Z');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual override updated');
    expect(await success.json()).toEqual({ ok: true });
  });

  it('deletes a single slot or clears all overrides', async () => {
    const single = await DELETE(new Request('http://localhost/api/overrides?slot_start=s1'));
    expect(runMock).toHaveBeenCalledWith('2026-04-03', 's1');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual override removed');
    expect(await single.json()).toEqual({ ok: true });

    vi.clearAllMocks();
    const all = await DELETE(new Request('http://localhost/api/overrides'));
    expect(runMock).toHaveBeenCalledWith('2026-04-03');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual overrides cleared');
    expect(await all.json()).toEqual({ ok: true });
  });
});
