import type { AgileRate } from '../octopus/rates';
import type { AppSettings } from '../config';
import type { TariffDefinition, TariffBand } from './definitions';
import { isInChargeWindow } from '../scheduler/engine';

const SLOT_DURATION_MS = 30 * 60 * 1000;

export function generateSyntheticRates(
  tariff: TariffDefinition,
  settings: AppSettings,
  from: string,
  to: string,
): AgileRate[] {
  const rates: AgileRate[] = [];
  const startTime = new Date(from);
  const endTime = new Date(to);

  // Round start down to nearest 30-min boundary
  startTime.setMinutes(startTime.getMinutes() < 30 ? 0 : 30, 0, 0);

  let current = startTime.getTime();
  const end = endTime.getTime();

  while (current < end) {
    const slotStart = new Date(current);
    const slotEnd = new Date(current + SLOT_DURATION_MS);
    const price = resolveSlotPrice(slotStart.toISOString(), tariff, settings);

    rates.push({
      valid_from: slotStart.toISOString(),
      valid_to: slotEnd.toISOString(),
      price_inc_vat: price,
      price_exc_vat: price / 1.05, // 5% VAT on electricity
    });

    current += SLOT_DURATION_MS;
  }

  return rates;
}

function resolveSlotPrice(
  validFrom: string,
  tariff: TariffDefinition,
  settings: AppSettings,
): number {
  // Check named bands (non-catch-all) first
  for (const band of tariff.bands) {
    if (isCatchAllBand(band)) continue;
    if (isInChargeWindow(validFrom, band.start, band.end)) {
      return parseFloat(settings[band.rateKey]) || 0;
    }
  }

  // Fall back to catch-all (standard) band
  const catchAll = tariff.bands.find(isCatchAllBand);
  if (catchAll) {
    return parseFloat(settings[catchAll.rateKey]) || 0;
  }

  return parseFloat(settings.tariff_standard_rate) || 24.5;
}

function isCatchAllBand(band: TariffBand): boolean {
  return band.start === '00:00' && band.end === '00:00';
}
