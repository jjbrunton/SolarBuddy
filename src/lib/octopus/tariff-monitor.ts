import { getSettings, saveSettings } from '../config';
import { appendEvent } from '../events';
import { verifyAccount } from './account';

export interface TariffChangeResult {
  changed: boolean;
  oldProductCode?: string;
  newProductCode?: string;
  oldRegion?: string;
  newRegion?: string;
}

/**
 * Check whether the user's Octopus tariff has changed since settings
 * were last saved. If a change is detected, update settings and log it.
 */
export async function checkForTariffChange(): Promise<TariffChangeResult> {
  const settings = getSettings();

  if (!settings.octopus_api_key || !settings.octopus_account) {
    return { changed: false };
  }

  const result = await verifyAccount(settings.octopus_api_key, settings.octopus_account);
  if (!result.ok) {
    console.log(`[TariffMonitor] Account verification failed: ${result.error}`);
    return { changed: false };
  }

  const { account } = result;
  const oldProduct = settings.octopus_product_code;
  const oldRegion = settings.octopus_region;

  if (account.productCode === oldProduct && account.region === oldRegion) {
    return { changed: false };
  }

  // Tariff has changed
  const message = `Tariff change detected: ${oldProduct} (${oldRegion}) → ${account.productCode} (${account.region})`;
  console.log(`[TariffMonitor] ${message}`);

  saveSettings({
    octopus_product_code: account.productCode,
    octopus_region: account.region,
    octopus_mpan: account.mpan,
    octopus_meter_serial: account.meterSerial,
  });

  // Also update export meter if discovered
  if (account.export) {
    saveSettings({
      octopus_export_mpan: account.export.mpan,
      octopus_export_meter_serial: account.export.meterSerial,
      octopus_export_product_code: account.export.productCode,
    });
  }

  appendEvent({
    level: 'warning',
    category: 'tariff-monitor',
    message,
  });

  return {
    changed: true,
    oldProductCode: oldProduct,
    newProductCode: account.productCode,
    oldRegion,
    newRegion: account.region,
  };
}
