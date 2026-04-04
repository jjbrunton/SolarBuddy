import { REGION_NAMES } from './regions';

export interface OctopusExportInfo {
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
}

export interface OctopusAccountInfo {
  accountNumber: string;
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
  region: string;
  regionName: string;
  export?: OctopusExportInfo;
}

export type OctopusVerifyResult =
  | { ok: true; account: OctopusAccountInfo }
  | { ok: false; error: string };

export interface OctopusAgreement {
  tariff_code: string;
  valid_from: string;
  valid_to: string | null;
}

interface OctopusMeter {
  serial_number: string;
}

interface OctopusMeterPoint {
  mpan: string;
  meters: OctopusMeter[];
  agreements: OctopusAgreement[];
}

interface OctopusProperty {
  electricity_meter_points: OctopusMeterPoint[];
}

interface OctopusAccountResponse {
  number: string;
  properties: OctopusProperty[];
}

export function parseTariffCode(tariffCode: string): { productCode: string; region: string } | null {
  // Format: E-1R-{PRODUCT_CODE}-{REGION} where region is a single letter
  // Example: E-1R-AGILE-24-10-01-H -> product=AGILE-24-10-01, region=H
  const lastDash = tariffCode.lastIndexOf('-');
  if (lastDash === -1) return null;

  const region = tariffCode.slice(lastDash + 1);
  if (region.length !== 1) return null;

  const prefix = 'E-1R-';
  if (!tariffCode.startsWith(prefix)) return null;

  const productCode = tariffCode.slice(prefix.length, lastDash);
  if (!productCode) return null;

  return { productCode, region };
}

export function findActiveAgreement(agreements: OctopusAgreement[]): OctopusAgreement | null {
  const now = new Date();

  // Prefer agreement with no end date (currently active)
  const openEnded = agreements.find((a) => a.valid_to === null);
  if (openEnded) return openEnded;

  // Fall back to agreement with future end date
  const future = agreements
    .filter((a) => a.valid_to && new Date(a.valid_to) > now)
    .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime());
  return future[0] ?? null;
}

const ACCOUNT_NUMBER_RE = /^A-[0-9A-Fa-f]{8}$/;

export async function verifyAccount(apiKey: string, accountNumber: string): Promise<OctopusVerifyResult> {
  if (!ACCOUNT_NUMBER_RE.test(accountNumber)) {
    return { ok: false, error: 'Invalid account number format' };
  }

  const auth = Buffer.from(apiKey + ':').toString('base64');

  let res: Response;
  try {
    res = await fetch(`https://api.octopus.energy/v1/accounts/${accountNumber}/`, {
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch {
    return { ok: false, error: 'Failed to connect to Octopus Energy API' };
  }

  if (res.status === 401) {
    return { ok: false, error: 'Invalid API key — check your Octopus developer dashboard' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'Account not found — check your account number' };
  }
  if (!res.ok) {
    return { ok: false, error: `Octopus API error: ${res.status} ${res.statusText}` };
  }

  const data = (await res.json()) as OctopusAccountResponse;

  const meterPoints = data.properties?.flatMap((p) => p.electricity_meter_points) ?? [];
  if (meterPoints.length === 0) {
    return { ok: false, error: 'No electricity meter points found on this account' };
  }

  // Import meter: first meter point whose active tariff does NOT contain OUTGOING
  const importMeter = meterPoints.find((mp) => {
    const ag = findActiveAgreement(mp.agreements);
    return ag && !ag.tariff_code.includes('OUTGOING');
  }) ?? meterPoints[0];

  const agreement = findActiveAgreement(importMeter.agreements);
  if (!agreement) {
    return { ok: false, error: 'No active tariff agreement found' };
  }

  const parsed = parseTariffCode(agreement.tariff_code);
  if (!parsed) {
    return { ok: false, error: `Could not parse tariff code: ${agreement.tariff_code}` };
  }

  // Export meter: meter point whose active tariff contains OUTGOING
  let exportInfo: OctopusExportInfo | undefined;
  const exportMeter = meterPoints.find((mp) => {
    const ag = findActiveAgreement(mp.agreements);
    return ag && ag.tariff_code.includes('OUTGOING');
  });
  if (exportMeter) {
    const exportAgreement = findActiveAgreement(exportMeter.agreements);
    if (exportAgreement) {
      const exportParsed = parseTariffCode(exportAgreement.tariff_code);
      if (exportParsed) {
        exportInfo = {
          mpan: exportMeter.mpan,
          meterSerial: exportMeter.meters[0]?.serial_number ?? '',
          tariffCode: exportAgreement.tariff_code,
          productCode: exportParsed.productCode,
        };
      }
    }
  }

  return {
    ok: true,
    account: {
      accountNumber: data.number,
      mpan: importMeter.mpan,
      meterSerial: importMeter.meters[0]?.serial_number ?? '',
      tariffCode: agreement.tariff_code,
      productCode: parsed.productCode,
      region: parsed.region,
      regionName: REGION_NAMES[parsed.region] ?? 'Unknown',
      export: exportInfo,
    },
  };
}
