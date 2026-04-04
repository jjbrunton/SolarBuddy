import { getSettings } from '../config';
import { generateSyntheticExportRates } from '../tariffs/rate-generator';
import {
  storeExportRates as storeExportRatesDb,
  getStoredExportRates as getStoredExportRatesDb,
} from '../db/rate-repository';
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
  storeExportRatesDb(rates);
}

export function getStoredExportRates(from?: string, to?: string): AgileRate[] {
  return getStoredExportRatesDb(from, to);
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
