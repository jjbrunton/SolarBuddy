import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listTodayOverridesMock,
  replaceTodayOverridesMock,
  upsertTodayOverrideMock,
  deleteTodayOverrideSlotMock,
  clearTodayOverridesMock,
  reconcileInverterStateMock,
} = vi.hoisted(() => ({
  listTodayOverridesMock: vi.fn(),
  replaceTodayOverridesMock: vi.fn(),
  upsertTodayOverrideMock: vi.fn(),
  deleteTodayOverrideSlotMock: vi.fn(),
  clearTodayOverridesMock: vi.fn(),
  reconcileInverterStateMock: vi.fn(),
}));

vi.mock('@/lib/db/override-repository', () => ({
  listTodayOverrides: listTodayOverridesMock,
  replaceTodayOverrides: replaceTodayOverridesMock,
  upsertTodayOverride: upsertTodayOverrideMock,
  deleteTodayOverrideSlot: deleteTodayOverrideSlotMock,
  clearTodayOverrides: clearTodayOverridesMock,
}));

vi.mock('@/lib/scheduler/watchdog', () => ({
  reconcileInverterState: reconcileInverterStateMock,
}));

import { DELETE, GET, PATCH, POST } from './route';

describe('/api/overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns today overrides from the repository', async () => {
    listTodayOverridesMock.mockReturnValue([{ slot_start: 'a' }]);

    const response = await GET();

    expect(await response.json()).toEqual({ overrides: [{ slot_start: 'a' }] });
    expect(listTodayOverridesMock).toHaveBeenCalledTimes(1);
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
    expect(await response.json()).toEqual({ ok: false, error: 'slots must be an array' });
  });

  it('replaces overrides via the repository helper', async () => {
    replaceTodayOverridesMock.mockReturnValue(2);
    const slots = [
      { slot_start: 's1', slot_end: 'e1', action: 'hold' },
      { slot_start: 's2', slot_end: 'e2', action: 'invalid' },
    ];
    const response = await POST(
      new Request('http://localhost/api/overrides', {
        method: 'POST',
        body: JSON.stringify({ slots }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(replaceTodayOverridesMock).toHaveBeenCalledWith(slots);
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
    expect(await missing.json()).toEqual({ ok: false, error: 'slot_start, slot_end, and valid action required' });

    const success = await PATCH(
      new Request('http://localhost/api/overrides', {
        method: 'PATCH',
        body: JSON.stringify({ slot_start: 's1', slot_end: 'e1', action: 'discharge' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(upsertTodayOverrideMock).toHaveBeenCalledWith('s1', 'e1', 'discharge');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual override updated');
    expect(await success.json()).toEqual({ ok: true });
  });

  it('deletes a single slot or clears all overrides', async () => {
    const single = await DELETE(new Request('http://localhost/api/overrides?slot_start=s1'));
    expect(deleteTodayOverrideSlotMock).toHaveBeenCalledWith('s1');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual override removed');
    expect(await single.json()).toEqual({ ok: true });

    vi.clearAllMocks();
    const all = await DELETE(new Request('http://localhost/api/overrides'));
    expect(clearTodayOverridesMock).toHaveBeenCalledTimes(1);
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('manual overrides cleared');
    expect(await all.json()).toEqual({ ok: true });
  });
});
