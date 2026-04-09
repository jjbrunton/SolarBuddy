/**
 * Nordpool N2EX Day-Ahead price client.
 *
 * Fetches GB day-ahead wholesale electricity prices from Nordpool's public API.
 * Results are hourly; this module converts them to half-hourly slots to match
 * the UK settlement period used by Octopus Agile.
 */

export interface NordpoolSlot {
  valid_from: string;
  valid_to: string;
  /** Wholesale price in p/kWh (pence per kilowatt-hour). */
  wholesale_price_pkwh: number;
}

interface NordpoolApiRow {
  deliveryStart: string;
  deliveryEnd: string;
  entryPerArea: Record<string, number>;
}

interface NordpoolApiResponse {
  deliveryDateCET: string;
  market: string;
  deliveryAreas: string[];
  multiAreaEntries: NordpoolApiRow[];
}

const NORDPOOL_API = 'https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices';

/**
 * Fetch day-ahead wholesale prices for GB from Nordpool N2EX.
 *
 * @param date ISO date string (YYYY-MM-DD) for the delivery day.
 * @returns Half-hourly slots with wholesale prices in p/kWh.
 */
export async function fetchNordpoolDayAhead(date: string): Promise<NordpoolSlot[]> {
  const url = `${NORDPOOL_API}?date=${date}&market=N2EX_DayAhead&deliveryArea=UK&currency=GBP`;
  console.log(`[Nordpool] Fetching day-ahead prices: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nordpool API error: ${response.status} ${response.statusText}`);
  }

  const data: NordpoolApiResponse = await response.json();
  const entries = data.multiAreaEntries ?? [];

  if (entries.length === 0) {
    console.log(`[Nordpool] No price entries returned for ${date}`);
    return [];
  }

  // Convert hourly entries to half-hourly slots.
  // Nordpool returns prices in £/MWh — convert to p/kWh (divide by 10).
  const slots: NordpoolSlot[] = [];
  for (const entry of entries) {
    const priceRaw = entry.entryPerArea?.['UK'];
    if (priceRaw == null) continue;

    const pricePkwh = priceRaw / 10; // £/MWh → p/kWh
    const start = new Date(entry.deliveryStart);
    const mid = new Date(start.getTime() + 30 * 60 * 1000);
    const end = new Date(entry.deliveryEnd);

    // First half-hour
    slots.push({
      valid_from: start.toISOString(),
      valid_to: mid.toISOString(),
      wholesale_price_pkwh: pricePkwh,
    });
    // Second half-hour
    slots.push({
      valid_from: mid.toISOString(),
      valid_to: end.toISOString(),
      wholesale_price_pkwh: pricePkwh,
    });
  }

  console.log(`[Nordpool] Parsed ${slots.length} half-hourly slots from ${entries.length} hourly entries`);
  return slots;
}
