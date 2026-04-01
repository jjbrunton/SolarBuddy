import { getDb } from '../db';
import { getSettings } from '../config';
import { getTariffDefinition } from '../tariffs/definitions';
import { generateSyntheticRates } from '../tariffs/rate-generator';

export interface AgileRate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
  price_exc_vat: number;
}

export async function fetchRates(periodFrom?: string, periodTo?: string): Promise<AgileRate[]> {
  const settings = getSettings();
  if (!settings.octopus_region) {
    throw new Error('Octopus region not configured');
  }

  const tariffCode = `E-1R-${settings.octopus_product_code}-${settings.octopus_region}`;
  const baseUrl = `https://api.octopus.energy/v1/products/${settings.octopus_product_code}/electricity-tariffs/${tariffCode}/standard-unit-rates/`;

  const params = new URLSearchParams();
  if (periodFrom) params.set('period_from', periodFrom);
  if (periodTo) params.set('period_to', periodTo);
  params.set('page_size', '200');
  params.set('order_by', 'period');

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[Octopus] Fetching rates from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Octopus API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rates: AgileRate[] = (data.results || []).map((r: Record<string, unknown>) => ({
    valid_from: r.valid_from as string,
    valid_to: r.valid_to as string,
    price_inc_vat: r.value_inc_vat as number,
    price_exc_vat: r.value_exc_vat as number,
  }));

  return rates;
}

export function storeRates(rates: AgileRate[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO rates (valid_from, valid_to, price_inc_vat, price_exc_vat, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(valid_from) DO UPDATE SET
      price_inc_vat = excluded.price_inc_vat,
      price_exc_vat = excluded.price_exc_vat,
      fetched_at = excluded.fetched_at
  `);
  const now = new Date().toISOString();
  const transaction = db.transaction((rates: AgileRate[]) => {
    for (const rate of rates) {
      upsert.run(rate.valid_from, rate.valid_to, rate.price_inc_vat, rate.price_exc_vat, now);
    }
  });
  transaction(rates);
  console.log(`[Octopus] Stored ${rates.length} rates`);
}

export async function fetchAndStoreRates(periodFrom?: string, periodTo?: string): Promise<AgileRate[]> {
  const rates = await fetchRates(periodFrom, periodTo);
  if (rates.length > 0) {
    storeRates(rates);
  }
  return rates;
}

export async function resolveRates(periodFrom: string, periodTo: string): Promise<AgileRate[]> {
  const settings = getSettings();
  const tariff = getTariffDefinition(settings.tariff_type);

  if (tariff.usesApiRates) {
    return fetchAndStoreRates(periodFrom, periodTo);
  }

  // Generate synthetic rates for non-Agile tariffs
  const rates = generateSyntheticRates(tariff, settings, periodFrom, periodTo);
  if (rates.length > 0) {
    storeRates(rates);
  }
  return rates;
}

export function getStoredRates(from?: string, to?: string): AgileRate[] {
  const db = getDb();
  let query = 'SELECT valid_from, valid_to, price_inc_vat, price_exc_vat FROM rates';
  const conditions: string[] = [];
  const params: string[] = [];

  if (from) {
    conditions.push('valid_from >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('valid_to <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY valid_from ASC';

  return db.prepare(query).all(...params) as AgileRate[];
}
