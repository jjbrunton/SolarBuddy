import { expect, test } from '@playwright/test';

test.describe('/api/scheduled-actions CRUD', () => {
  // Clean up anything left over from previous runs so ordering assertions are deterministic.
  test.beforeEach(async ({ request }) => {
    const { actions } = await (await request.get('/api/scheduled-actions')).json();
    for (const action of actions) {
      if (action.name?.startsWith('e2e-')) {
        await request.delete(`/api/scheduled-actions?id=${action.id}`);
      }
    }
  });

  test('full CRUD lifecycle: create → list → update → delete', async ({ request }) => {
    // Create.
    const createRes = await request.post('/api/scheduled-actions', {
      data: {
        name: 'e2e-test-action',
        action: 'hold',
        time: '23:45',
        days: 'weekdays',
        soc_condition: 'above',
        soc_threshold: 70,
        duration_minutes: 15,
        enabled: true,
      },
    });
    expect(createRes.ok()).toBe(true);
    const created = await createRes.json();
    expect(created.action.id).toBeGreaterThan(0);
    const id = created.action.id;

    // List + find.
    const { actions } = await (await request.get('/api/scheduled-actions')).json();
    const match = actions.find((a: { id: number }) => a.id === id);
    expect(match).toBeDefined();
    expect(match.name).toBe('e2e-test-action');
    expect(match.enabled).toBe(true);

    // Update.
    const patchRes = await request.patch('/api/scheduled-actions', {
      data: {
        id,
        name: 'e2e-test-action',
        action: 'discharge',
        time: '23:45',
        days: 'weekends',
        soc_condition: 'any',
        soc_threshold: 0,
        duration_minutes: 30,
        enabled: false,
      },
    });
    expect(patchRes.ok()).toBe(true);

    const { actions: updated } = await (await request.get('/api/scheduled-actions')).json();
    const updatedMatch = updated.find((a: { id: number }) => a.id === id);
    expect(updatedMatch.action).toBe('discharge');
    expect(updatedMatch.days).toBe('weekends');
    expect(updatedMatch.enabled).toBe(false);

    // Delete.
    const delRes = await request.delete(`/api/scheduled-actions?id=${id}`);
    expect(delRes.ok()).toBe(true);

    const { actions: after } = await (await request.get('/api/scheduled-actions')).json();
    expect(after.find((a: { id: number }) => a.id === id)).toBeUndefined();
  });

  test('DELETE without id returns 400', async ({ request }) => {
    const res = await request.delete('/api/scheduled-actions');
    expect(res.status()).toBe(400);
  });

  test('PATCH without id returns 400', async ({ request }) => {
    const res = await request.patch('/api/scheduled-actions', { data: { name: 'no-id' } });
    expect(res.status()).toBe(400);
  });
});
