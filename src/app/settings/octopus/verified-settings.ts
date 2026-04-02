export interface VerifiedOctopusAccountInfo {
  accountNumber: string;
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
  region: string;
  regionName: string;
}

export interface OctopusSettingsShape {
  octopus_api_key: string;
  octopus_account: string;
  octopus_region: string;
  octopus_product_code: string;
  octopus_mpan: string;
  octopus_meter_serial: string;
}

export function mergeVerifiedOctopusSettings<T extends OctopusSettingsShape>(
  settings: T,
  account: VerifiedOctopusAccountInfo,
): T {
  return {
    ...settings,
    octopus_account: account.accountNumber,
    octopus_region: account.region,
    octopus_product_code: account.productCode,
    octopus_mpan: account.mpan,
    octopus_meter_serial: account.meterSerial ?? '',
  };
}
