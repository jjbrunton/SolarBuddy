/** UK average flat tariff rate (p/kWh) used as a comparison baseline. */
export const FLAT_RATE_PENCE = 24.5;

/**
 * Convert a period string like "7d", "30d", "90d", "48h", or "today"
 * into an ISO timestamp representing the start of the window.
 */
export function periodToISO(period: string): string {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const match = period.match(/^(\d+)(d|h)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'h') {
      return new Date(now.getTime() - n * 3600_000).toISOString();
    }
    return new Date(now.getTime() - n * 86400_000).toISOString();
  }
  // fallback: 7 days
  return new Date(now.getTime() - 7 * 86400_000).toISOString();
}

/**
 * Convert a sum of instantaneous watt readings into kWh.
 *
 * Each reading represents roughly (totalSpanSeconds / sampleCount) seconds
 * of power. Energy = sum(P) * dt, converted to kWh.
 *
 * @param wattSum  Sum of all power readings (W) across the period
 * @param sampleCount  Number of readings in that period
 * @param totalSpanSeconds  Duration the readings span (default: 86400 = full day)
 */
export function wattSamplesToKwh(
  wattSum: number,
  sampleCount: number,
  totalSpanSeconds = 86400,
): number {
  if (sampleCount === 0) return 0;
  const dtSeconds = totalSpanSeconds / sampleCount;
  // energy = wattSum * dt (in Wh) → convert to kWh
  const kwh = (wattSum * dtSeconds) / 3600 / 1000;
  return Math.round(kwh * 100) / 100;
}
