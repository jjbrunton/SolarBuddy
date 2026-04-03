export interface VerifiedOctopusExportInfo {
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
}

export interface VerifiedOctopusAccountInfo {
  accountNumber: string;
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
  region: string;
  regionName: string;
  export?: VerifiedOctopusExportInfo;
}

export interface OctopusSettingsShape {
  octopus_api_key: string;
  octopus_account: string;
  octopus_region: string;
  octopus_product_code: string;
  octopus_mpan: string;
  octopus_meter_serial: string;
  octopus_export_mpan: string;
  octopus_export_meter_serial: string;
  octopus_export_product_code: string;
}

export function mergeVerifiedOctopusSettings<T extends OctopusSettingsShape>(
  settings: T,
  account: VerifiedOctopusAccountInfo,
): T {
  const merged = {
    ...settings,
    octopus_account: account.accountNumber,
    octopus_region: account.region,
    octopus_product_code: account.productCode,
    octopus_mpan: account.mpan,
    octopus_meter_serial: account.meterSerial ?? '',
  };

  if (account.export) {
    merged.octopus_export_mpan = account.export.mpan;
    merged.octopus_export_meter_serial = account.export.meterSerial ?? '';
    merged.octopus_export_product_code = account.export.productCode;
  }

  return merged;
}
