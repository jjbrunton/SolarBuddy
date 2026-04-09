import { getSettings } from '../config';
import { getTariffDefinition } from '../tariffs/definitions';
import { generateSyntheticRates } from '../tariffs/rate-generator';
import {
  storeImportRates,
  getStoredImportRates,
  type RateSource,
} from '../db/rate-repository';

export interface AgileRate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
  price_exc_vat: number;
  source?: RateSource;
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
  storeImportRates(rates);
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
  return getStoredImportRates(from, to);
}
