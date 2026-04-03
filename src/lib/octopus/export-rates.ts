import { getDb } from '../db';
import { getSettings, type AppSettings } from '../config';
import { getTariffDefinition } from '../tariffs/definitions';
import { generateSyntheticExportRates } from '../tariffs/rate-generator';
import type { AgileRate } from './rates';

export async function fetchExportRates(
  periodFrom?: string,
  periodTo?: string,
): Promise<AgileRate[]> {
  const settings = getSettings();
  if (!settings.octopus_export_mpan || !settings.octopus_export_product_code || !settings.octopus_region) {
    return [];
  }

  const tariffCode = `E-1R-${settings.octopus_export_product_code}-${settings.octopus_region}`;
  const baseUrl = `https://api.octopus.energy/v1/products/${settings.octopus_export_product_code}/electricity-tariffs/${tariffCode}/standard-unit-rates/`;

  const params = new URLSearchParams();
  if (periodFrom) params.set('period_from', periodFrom);
  if (periodTo) params.set('period_to', periodTo);
  params.set('page_size', '200');
  params.set('order_by', 'period');

  const url = `${baseUrl}?${params.toString()}`;
  console.log(`[Octopus] Fetching export rates from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Octopus API error (export): ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.results || []).map((r: Record<string, unknown>) => ({
    valid_from: r.valid_from as string,
    valid_to: r.valid_to as string,
    price_inc_vat: r.value_inc_vat as number,
    price_exc_vat: r.value_exc_vat as number,
  }));
}

export function storeExportRates(rates: AgileRate[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO export_rates (valid_from, valid_to, price_inc_vat, price_exc_vat, fetched_at)
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
  console.log(`[Octopus] Stored ${rates.length} export rates`);
}

export function getStoredExportRates(from?: string, to?: string): AgileRate[] {
  const db = getDb();
  let query = 'SELECT valid_from, valid_to, price_inc_vat, price_exc_vat FROM export_rates';
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

/**
 * Resolve export rates for a period. Uses the Octopus API if an export
 * MPAN and product code are configured, otherwise generates flat-rate
 * synthetic slots from the fixed `export_rate` setting (which defaults
 * to 0 — no payment for export).
 */
export async function resolveExportRates(
  periodFrom: string,
  periodTo: string,
): Promise<AgileRate[]> {
  const settings = getSettings();

  // If the user has an Octopus export tariff configured, fetch from API
  if (settings.octopus_export_mpan && settings.octopus_export_product_code) {
    const rates = await fetchExportRates(periodFrom, periodTo);
    if (rates.length > 0) {
      storeExportRates(rates);
      return rates;
    }
  }

  // Fall back to synthetic flat-rate export slots
  const fixedRate = parseFloat(settings.export_rate) || 0;
  const rates = generateSyntheticExportRates(fixedRate, periodFrom, periodTo);
  if (rates.length > 0) {
    storeExportRates(rates);
  }
  return rates;
}
