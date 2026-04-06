import { getSettings, type AppSettings } from '../config';

export interface OctopusConsumptionRecord {
  interval_start: string;
  interval_end: string;
  consumption_kwh: number;
  average_w: number;
}

interface OctopusConsumptionApiResult {
  interval_start: string;
  interval_end: string;
  consumption: number | null;
}

interface OctopusConsumptionApiPage {
  next: string | null;
  results: OctopusConsumptionApiResult[];
}

const DEFAULT_PAGE_SIZE = 25_000;
const MAX_PAGES = 12;

export function hasOctopusConsumptionConfig(
  settings: Pick<AppSettings, 'octopus_api_key' | 'octopus_mpan' | 'octopus_meter_serial'> = getSettings(),
): boolean {
  return Boolean(settings.octopus_api_key && settings.octopus_mpan && settings.octopus_meter_serial);
}

export async function fetchConsumption(
  periodFrom?: string,
  periodTo?: string,
): Promise<OctopusConsumptionRecord[]> {
  const settings = getSettings();
  if (!settings.octopus_api_key) {
    throw new Error('Octopus API key not configured');
  }
  if (!settings.octopus_mpan) {
    throw new Error('Octopus MPAN not configured');
  }
  if (!settings.octopus_meter_serial) {
    throw new Error('Octopus meter serial not configured');
  }

  const auth = Buffer.from(`${settings.octopus_api_key}:`).toString('base64');
  const params = new URLSearchParams();
  if (periodFrom) params.set('period_from', periodFrom);
  if (periodTo) params.set('period_to', periodTo);
  params.set('page_size', String(DEFAULT_PAGE_SIZE));
  params.set('order_by', 'period');

  const baseUrl =
    `https://api.octopus.energy/v1/electricity-meter-points/${settings.octopus_mpan}` +
    `/meters/${settings.octopus_meter_serial}/consumption/`;

  let nextUrl: string | null = `${baseUrl}?${params.toString()}`;
  const rows: OctopusConsumptionRecord[] = [];

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!response.ok) {
      throw new Error(`Octopus consumption API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OctopusConsumptionApiPage;
    for (const result of data.results ?? []) {
      if (!result.interval_start || !result.interval_end) continue;
      if (typeof result.consumption !== 'number' || !Number.isFinite(result.consumption)) continue;

      // Octopus returns kWh per 30-minute interval.
      const averageWatts = Math.max(0, result.consumption * 2000);
      rows.push({
        interval_start: result.interval_start,
        interval_end: result.interval_end,
        consumption_kwh: result.consumption,
        average_w: averageWatts,
      });
    }

    nextUrl = data.next;
  }

  // If the upstream API ever loops or repeats rows across pages, de-duplicate
  // by interval start to keep profile math stable.
  const byStart = new Map<string, OctopusConsumptionRecord>();
  for (const row of rows) {
    byStart.set(row.interval_start, row);
  }

  return Array.from(byStart.values()).sort((a, b) => {
    return new Date(a.interval_start).getTime() - new Date(b.interval_start).getTime();
  });
}
