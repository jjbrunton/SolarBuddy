import { expect, test } from '@playwright/test';

test.describe('/api/overrides round-trip', () => {
  test.beforeEach(async ({ request }) => {
    // Each test starts from a clean slate in case prior tests left rows behind
    // in the shared Playwright DB.
    await request.delete('/api/overrides');
  });

  test('POST creates overrides that subsequent GETs return', async ({ request }) => {
    // Use dynamic "today" to stay inside the route's day-scoped filter.
    const today = new Date().toISOString().slice(0, 10);
    const slotStart = `${today}T23:00:00Z`;
    const slotEnd = `${today}T23:30:00Z`;

    const createRes = await request.post('/api/overrides', {
      data: {
        slots: [{ slot_start: slotStart, slot_end: slotEnd, action: 'charge' }],
      },
    });
    expect(createRes.ok()).toBe(true);
    expect(await createRes.json()).toMatchObject({ ok: true, count: 1 });

    const getRes = await request.get('/api/overrides');
    const getBody = await getRes.json();
    const match = getBody.overrides.find(
      (o: { slot_start: string }) => o.slot_start === slotStart,
    );
    expect(match).toBeDefined();
    expect(match.action).toBe('charge');
  });

  test('PATCH updates the action for an existing slot', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10);
    const slotStart = `${today}T23:00:00Z`;
    const slotEnd = `${today}T23:30:00Z`;

    await request.post('/api/overrides', {
      data: { slots: [{ slot_start: slotStart, slot_end: slotEnd, action: 'charge' }] },
    });

    const patchRes = await request.patch('/api/overrides', {
      data: { slot_start: slotStart, slot_end: slotEnd, action: 'discharge' },
    });
    expect(patchRes.ok()).toBe(true);

    const getBody = await (await request.get('/api/overrides')).json();
    const match = getBody.overrides.find(
      (o: { slot_start: string }) => o.slot_start === slotStart,
    );
    expect(match.action).toBe('discharge');
  });

  test('DELETE with slot_start only removes that one; bare DELETE clears the day', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10);
    const slotA = `${today}T22:00:00Z`;
    const slotB = `${today}T22:30:00Z`;

    await request.post('/api/overrides', {
      data: {
        slots: [
          { slot_start: slotA, slot_end: `${today}T22:30:00Z`, action: 'charge' },
          { slot_start: slotB, slot_end: `${today}T23:00:00Z`, action: 'charge' },
        ],
      },
    });

    await request.delete(`/api/overrides?slot_start=${encodeURIComponent(slotA)}`);
    let body = await (await request.get('/api/overrides')).json();
    expect(body.overrides.map((o: { slot_start: string }) => o.slot_start)).not.toContain(slotA);
    expect(body.overrides.map((o: { slot_start: string }) => o.slot_start)).toContain(slotB);

    await request.delete('/api/overrides');
    body = await (await request.get('/api/overrides')).json();
    expect(body.overrides.filter((o: { slot_start: string }) => o.slot_start === slotB)).toHaveLength(0);
  });

  test('POST rejects a non-array payload with 400', async ({ request }) => {
    const res = await request.post('/api/overrides', { data: { slots: 'nope' } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  test('PATCH with missing fields returns 400', async ({ request }) => {
    const res = await request.patch('/api/overrides', { data: {} });
    expect(res.status()).toBe(400);
  });
});
