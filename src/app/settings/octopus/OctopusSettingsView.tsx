'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';
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
  const pathname = usePathname();
  const { settings, update, save, saving, message } = useSettings();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);

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

  const tariffType = settings.tariff_type || 'agile';
  const isAgile = tariffType === 'agile';
  const showPeakRate = tariffType === 'flux';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Octopus tariff setup"
        description="Select the tariff model SolarBuddy should optimize against, and verify Agile account details when dynamic pricing is in use."
      />
      <SettingsTabs pathname={pathname} />

      <Card>
        <SettingsSection
          title="Tariff shape"
          description="Static products use the rates you enter here. Agile keeps using live half-hourly prices fetched from Octopus."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tariff" description="Select your Octopus Energy tariff product">
              <select
                className={inputClass}
                value={tariffType}
                onChange={(e) => update('tariff_type', e.target.value)}
              >
                <option value="agile">Agile</option>
                <option value="go">Go / Intelligent Go</option>
                <option value="flux">Flux</option>
                <option value="cosy">Cosy</option>
              </select>
            </Field>
          </div>

          {!isAgile ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Off-Peak Rate (p/kWh)" description="Price during cheap periods">
                <input
                  className={inputClass}
                  type="number"
                  step="0.1"
                  min="0"
                  value={settings.tariff_offpeak_rate}
                  onChange={(e) => update('tariff_offpeak_rate', e.target.value)}
                />
              </Field>
              {showPeakRate ? (
                <Field label="Peak Rate (p/kWh)" description="Price during peak periods (Flux 16:00-19:00)">
                  <input
                    className={inputClass}
                    type="number"
                    step="0.1"
                    min="0"
                    value={settings.tariff_peak_rate}
                    onChange={(e) => update('tariff_peak_rate', e.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Standard Rate (p/kWh)" description="Price outside off-peak or peak windows">
                <input
                  className={inputClass}
                  type="number"
                  step="0.1"
                  min="0"
                  value={settings.tariff_standard_rate}
                  onChange={(e) => update('tariff_standard_rate', e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </SettingsSection>
      </Card>

      {isAgile ? (
        <>
          <Card>
            <SettingsSection
              title="Agile account verification"
              description="Verification populates the region and tariff metadata used for live rate imports and schedule planning."
            >
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

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={verify} disabled={!canVerify || verifying} variant="secondary">
                  {verifying ? 'Verifying…' : 'Verify account'}
                </Button>
                {verifyError ? <span className="text-sm text-sb-danger">{verifyError}</span> : null}
              </div>
            </SettingsSection>
          </Card>

          {accountInfo ? (
            <Card>
              <div className="mb-5 flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-sb-text">Detected account details</h3>
                <Badge kind="success">Verified</Badge>
              </div>
              <DescriptionList
                items={[
                  { label: 'Region', value: `${accountInfo.region} — ${accountInfo.regionName}` },
                  { label: 'Product Code', value: accountInfo.productCode },
                  { label: 'Tariff Code', value: accountInfo.tariffCode },
                  { label: 'MPAN', value: accountInfo.mpan },
                  ...(accountInfo.meterSerial
                    ? [{ label: 'Meter Serial', value: accountInfo.meterSerial }]
                    : []),
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
