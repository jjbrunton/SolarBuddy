export interface PVForecastSlot {
  valid_from: string;
  valid_to: string;
  pv_estimate_w: number;
  pv_estimate10_w: number;
  pv_estimate90_w: number;
}

interface ForecastSolarWattHours {
  [isoTimestamp: string]: number;
}

interface ForecastSolarResponse {
  result: {
    watts: ForecastSolarWattHours;
    watt_hours_period: ForecastSolarWattHours;
    watt_hours: ForecastSolarWattHours;
    watt_hours_day: Record<string, number>;
  };
  message: { code: number; type: string; text: string };
}

/**
 * Fetch PV forecast from api.forecast.solar (free, no auth required).
 * Returns hourly watt estimates converted to half-hour slots.
 *
 * API: GET https://api.forecast.solar/estimate/{lat}/{lon}/{dec}/{az}/{kwp}
 * - lat/lon: location
 * - dec: panel declination (tilt) in degrees
 * - az: panel azimuth (-180..180, 0=south)
 * - kwp: installed capacity in kWp
 */
export async function fetchPVForecast(
  latitude: string,
  longitude: string,
  declination: string,
  azimuth: string,
  kwp: string,
): Promise<PVForecastSlot[]> {
  const url = `https://api.forecast.solar/estimate/${latitude}/${longitude}/${declination}/${azimuth}/${kwp}`;

  console.log(`[PVForecast] Fetching from: ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Forecast.Solar API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ForecastSolarResponse;

  if (!data.result?.watts) {
    return [];
  }

  // The API returns instantaneous watt values at hourly timestamps.
  // We interpolate to 30-min slots to match the Octopus rate grid.
  const entries = Object.entries(data.result.watts)
    .map(([ts, watts]) => ({ time: new Date(ts), watts }))
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  if (entries.length === 0) return [];

  const slots: PVForecastSlot[] = [];
  const SLOT_MS = 30 * 60 * 1000;

  // Generate 30-min slots across the forecast range
  const start = entries[0].time.getTime();
  const end = entries[entries.length - 1].time.getTime();

  for (let cursor = start; cursor < end; cursor += SLOT_MS) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + SLOT_MS);
    const slotMid = cursor + SLOT_MS / 2;

    // Interpolate: find the two surrounding data points
    let watts = 0;
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
      if (slotMid >= a.time.getTime() && slotMid <= b.time.getTime()) {
        const t = (slotMid - a.time.getTime()) / (b.time.getTime() - a.time.getTime());
        watts = a.watts + t * (b.watts - a.watts);
        break;
      }
    }

    // forecast.solar doesn't provide P10/P90 — use 80% and 120% as estimates
    slots.push({
      valid_from: slotStart.toISOString(),
      valid_to: slotEnd.toISOString(),
      pv_estimate_w: Math.round(watts),
      pv_estimate10_w: Math.round(watts * 0.8),
      pv_estimate90_w: Math.round(watts * 1.2),
    });
  }

  return slots;
}
