import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getScheduledActionsMock,
  upsertScheduledActionMock,
  deleteScheduledActionMock,
} = vi.hoisted(() => ({
  getScheduledActionsMock: vi.fn(),
  upsertScheduledActionMock: vi.fn(),
  deleteScheduledActionMock: vi.fn(),
}));

vi.mock('@/lib/scheduled-actions', () => ({
  getScheduledActions: getScheduledActionsMock,
  upsertScheduledAction: upsertScheduledActionMock,
  deleteScheduledAction: deleteScheduledActionMock,
}));

import { DELETE, GET, PATCH, POST } from './route';

describe('/api/scheduled-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns saved actions', async () => {
    getScheduledActionsMock.mockReturnValue([{ id: 1 }]);

    const response = await GET();

    expect(await response.json()).toEqual({ actions: [{ id: 1 }] });
  });

  it('creates and updates actions', async () => {
    upsertScheduledActionMock
      .mockReturnValueOnce({ id: 1, name: 'new' })
      .mockReturnValueOnce({ id: 2, name: 'updated' });

    const created = await POST(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'POST',
        body: JSON.stringify({ name: 'new' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await created.json()).toEqual({ ok: true, action: { id: 1, name: 'new' } });

    const missing = await PATCH(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, error: 'Missing id' });

    const updated = await PATCH(
      new Request('http://localhost/api/scheduled-actions', {
        method: 'PATCH',
        body: JSON.stringify({ id: 2, name: 'updated' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await updated.json()).toEqual({ ok: true, action: { id: 2, name: 'updated' } });
  });

  it('requires an id for deletion', async () => {
    const missing = await DELETE(new Request('http://localhost/api/scheduled-actions'));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, error: 'Missing id' });

    const response = await DELETE(new Request('http://localhost/api/scheduled-actions?id=7'));
    expect(deleteScheduledActionMock).toHaveBeenCalledWith(7);
    expect(await response.json()).toEqual({ ok: true });
  });
});
