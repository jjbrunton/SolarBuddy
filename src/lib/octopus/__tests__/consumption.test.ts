import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';
import { fetchConsumption, hasOctopusConsumptionConfig } from '../consumption';

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
}));

vi.mock('../../config', async () => {
  const actual = await vi.importActual<typeof import('../../config')>('../../config');
  return {
    ...actual,
    getSettings: getSettingsMock,
  };
});

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    octopus_api_key: 'sk_test_usage',
    octopus_mpan: '200000000001',
    octopus_meter_serial: 'MTR123',
    ...overrides,
  };
}

describe('octopus consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue(makeSettings());
  });

  it('detects whether Octopus consumption config is complete', () => {
    expect(hasOctopusConsumptionConfig()).toBe(true);

    getSettingsMock.mockReturnValue(makeSettings({ octopus_meter_serial: '' }));
    expect(hasOctopusConsumptionConfig()).toBe(false);
  });

  it('fetches and maps half-hour consumption intervals', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          next: null,
          results: [
            {
              interval_start: '2026-04-05T00:00:00Z',
              interval_end: '2026-04-05T00:30:00Z',
              consumption: 0.42,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const rows = await fetchConsumption('2026-04-05T00:00:00Z', '2026-04-05T01:00:00Z');

    expect(rows).toEqual([
      {
        interval_start: '2026-04-05T00:00:00Z',
        interval_end: '2026-04-05T00:30:00Z',
        consumption_kwh: 0.42,
        average_w: 840,
      },
    ]);

    const expectedAuth = Buffer.from('sk_test_usage:').toString('base64');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.octopus.energy/v1/electricity-meter-points/200000000001/meters/MTR123/consumption/?period_from=2026-04-05T00%3A00%3A00Z&period_to=2026-04-05T01%3A00%3A00Z&page_size=25000&order_by=period',
      { headers: { Authorization: `Basic ${expectedAuth}` } },
    );
  });

  it('follows paginated responses and de-duplicates overlapping intervals', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            next: 'https://api.octopus.energy/v1/next-page',
            results: [
              {
                interval_start: '2026-04-05T00:30:00Z',
                interval_end: '2026-04-05T01:00:00Z',
                consumption: 0.4,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            next: null,
            results: [
              {
                interval_start: '2026-04-05T00:30:00Z',
                interval_end: '2026-04-05T01:00:00Z',
                consumption: 0.41,
              },
              {
                interval_start: '2026-04-05T01:00:00Z',
                interval_end: '2026-04-05T01:30:00Z',
                consumption: 0.2,
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const rows = await fetchConsumption();

    expect(rows).toEqual([
      {
        interval_start: '2026-04-05T00:30:00Z',
        interval_end: '2026-04-05T01:00:00Z',
        consumption_kwh: 0.41,
        average_w: 820,
      },
      {
        interval_start: '2026-04-05T01:00:00Z',
        interval_end: '2026-04-05T01:30:00Z',
        consumption_kwh: 0.2,
        average_w: 400,
      },
    ]);
  });

  it('throws a descriptive error when the API returns a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500, statusText: 'Server Error' }),
    );

    await expect(fetchConsumption()).rejects.toThrow('Octopus consumption API error: 500 Server Error');
  });

  it('throws a descriptive error when required config is missing', async () => {
    getSettingsMock.mockReturnValue(makeSettings({ octopus_api_key: '' }));

    await expect(fetchConsumption()).rejects.toThrow('Octopus API key not configured');
  });
});
