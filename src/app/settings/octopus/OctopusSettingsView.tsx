'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton } from '@/components/settings/shared';
import { REGION_NAMES } from '@/lib/octopus/regions';

interface AccountInfo {
  accountNumber: string;
  mpan: string;
  meterSerial: string;
  tariffCode: string;
  productCode: string;
  region: string;
  regionName: string;
}

export default function OctopusSettingsView() {
  const { settings, update, save, saving, message } = useSettings();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);

  // Reconstruct display from saved settings on load (no API call needed)
  useEffect(() => {
    if (
      settings &&
      settings.octopus_region &&
      settings.octopus_product_code &&
      settings.octopus_mpan &&
      !accountInfo
    ) {
      setAccountInfo({
        accountNumber: settings.octopus_account,
        mpan: settings.octopus_mpan,
        meterSerial: settings.octopus_meter_serial,
        tariffCode: `E-1R-${settings.octopus_product_code}-${settings.octopus_region}`,
        productCode: settings.octopus_product_code,
        region: settings.octopus_region,
        regionName: REGION_NAMES[settings.octopus_region] ?? 'Unknown',
      });
    }
  }, [settings, accountInfo]);

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const canVerify = settings.octopus_api_key && settings.octopus_account;

  const verify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch('/api/octopus/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: settings.octopus_api_key,
          accountNumber: settings.octopus_account,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const info = json.account as AccountInfo;
        setAccountInfo(info);
        update('octopus_region', info.region);
        update('octopus_product_code', info.productCode);
        update('octopus_mpan', info.mpan);
        update('octopus_meter_serial', info.meterSerial);
      } else {
        setVerifyError(json.error ?? 'Verification failed');
        setAccountInfo(null);
      }
    } catch {
      setVerifyError('Failed to connect to verification endpoint');
      setAccountInfo(null);
    }
    setVerifying(false);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Settings</h1>
      <SettingsTabs />

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Octopus Energy Account</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="API Key" description="Find this in your Octopus account under Developer Settings">
            <input
              className={inputClass}
              type="password"
              value={settings.octopus_api_key}
              onChange={(e) => update('octopus_api_key', e.target.value)}
            />
          </Field>
          <Field label="Account Number">
            <input
              className={inputClass}
              value={settings.octopus_account}
              onChange={(e) => update('octopus_account', e.target.value)}
              placeholder="A-1234ABCD"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={verify}
            disabled={!canVerify || verifying}
            className="rounded-md bg-sb-card-alt px-4 py-2 text-sm font-medium text-sb-text border border-sb-border hover:bg-sb-active disabled:opacity-50"
          >
            {verifying ? 'Verifying...' : 'Verify Account'}
          </button>
          {verifyError && (
            <span className="text-sm text-sb-danger">{verifyError}</span>
          )}
        </div>
      </Card>

      {accountInfo && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <h3 className="font-medium text-sb-text">Account Details</h3>
            <span className="rounded-full bg-sb-success/20 px-2.5 py-0.5 text-xs font-medium text-sb-success">
              Verified
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-sb-text-muted">Region</dt>
              <dd className="font-medium text-sb-text">{accountInfo.region} — {accountInfo.regionName}</dd>
            </div>
            <div>
              <dt className="text-sb-text-muted">Product Code</dt>
              <dd className="font-medium text-sb-text">{accountInfo.productCode}</dd>
            </div>
            <div>
              <dt className="text-sb-text-muted">Tariff Code</dt>
              <dd className="font-medium text-sb-text">{accountInfo.tariffCode}</dd>
            </div>
            <div>
              <dt className="text-sb-text-muted">MPAN</dt>
              <dd className="font-medium text-sb-text">{accountInfo.mpan}</dd>
            </div>
            {accountInfo.meterSerial && (
              <div>
                <dt className="text-sb-text-muted">Meter Serial</dt>
                <dd className="font-medium text-sb-text">{accountInfo.meterSerial}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
