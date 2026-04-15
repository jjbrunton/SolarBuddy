'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';
import { REGION_NAMES } from '@/lib/octopus/regions';
import { mergeVerifiedOctopusSettings, type VerifiedOctopusAccountInfo, type VerifiedOctopusExportInfo } from './verified-settings';

export default function OctopusSettingsView() {
  const { settings, update, replaceSettings, save, persistSettings, saving, message } = useSettings();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<VerifiedOctopusAccountInfo | null>(null);
  const [refreshingNordpool, setRefreshingNordpool] = useState(false);
  const [nordpoolStatus, setNordpoolStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (
      settings &&
      settings.octopus_region &&
      settings.octopus_product_code &&
      settings.octopus_mpan &&
      !accountInfo
    ) {
      let exportInfo: VerifiedOctopusExportInfo | undefined;
      if (settings.octopus_export_mpan) {
        exportInfo = {
          mpan: settings.octopus_export_mpan,
          meterSerial: settings.octopus_export_meter_serial,
          tariffCode: settings.octopus_export_product_code
            ? `E-1R-${settings.octopus_export_product_code}-${settings.octopus_region}`
            : '',
          productCode: settings.octopus_export_product_code,
        };
      }
      setAccountInfo({
        accountNumber: settings.octopus_account,
        mpan: settings.octopus_mpan,
        meterSerial: settings.octopus_meter_serial,
        tariffCode: `E-1R-${settings.octopus_product_code}-${settings.octopus_region}`,
        productCode: settings.octopus_product_code,
        region: settings.octopus_region,
        regionName: REGION_NAMES[settings.octopus_region] ?? 'Unknown',
        export: exportInfo,
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
        const info = json.account as VerifiedOctopusAccountInfo;
        const nextSettings = mergeVerifiedOctopusSettings(settings, info);
        setAccountInfo(info);
        replaceSettings(nextSettings);

        const saveResult = await persistSettings(nextSettings, 'Octopus account verified and settings saved.');
        if (!saveResult.ok) {
          setVerifyError(saveResult.error ?? 'Verification succeeded, but saving the detected tariff details failed.');
        }
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

  const refreshNordpool = async () => {
    setRefreshingNordpool(true);
    setNordpoolStatus(null);
    try {
      const res = await fetch('/api/rates/nordpool/refresh', { method: 'POST' });
      const json = await res.json();
      if (json.status === 'ok') {
        setNordpoolStatus({
          ok: true,
          message: `Stored ${json.count} estimated rates for ${json.date}.`,
        });
      } else if (json.status === 'skipped') {
        const reasons: Record<string, string> = {
          disabled: 'Forecast is disabled — enable it and save first.',
          not_agile: 'Forecast only runs when the tariff shape is Agile.',
          no_prices: `No day-ahead prices published yet for ${json.date}. Try again later.`,
        };
        setNordpoolStatus({ ok: false, message: reasons[json.reason] ?? `Skipped: ${json.reason}` });
      } else {
        setNordpoolStatus({ ok: false, message: json.message ?? json.error ?? 'Refresh failed.' });
      }
    } catch (err) {
      setNordpoolStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Refresh failed.',
      });
    }
    setRefreshingNordpool(false);
  };

  const tariffType = settings.tariff_type || 'agile';
  const isAgile = tariffType === 'agile';
  const showPeakRate = tariffType === 'flux';

  return (
    <div className="space-y-6">
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
                  ...(accountInfo.export
                    ? [
                        { label: 'Export MPAN', value: accountInfo.export.mpan },
                        ...(accountInfo.export.meterSerial
                          ? [{ label: 'Export Meter Serial', value: accountInfo.export.meterSerial }]
                          : []),
                        { label: 'Export Product Code', value: accountInfo.export.productCode },
                      ]
                    : []),
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <SettingsSection
          title="Export Meter (Optional)"
          description="Configure if you have an export meter with a Smart Export Guarantee or Agile Outgoing tariff. Leave blank if you don't get paid for export."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Export MPAN">
              <input
                className={inputClass}
                value={settings.octopus_export_mpan}
                onChange={(e) => update('octopus_export_mpan', e.target.value)}
              />
            </Field>
            <Field label="Export Meter Serial">
              <input
                className={inputClass}
                value={settings.octopus_export_meter_serial}
                onChange={(e) => update('octopus_export_meter_serial', e.target.value)}
              />
            </Field>
            <Field label="Export Product Code">
              <input
                className={inputClass}
                value={settings.octopus_export_product_code}
                onChange={(e) => update('octopus_export_product_code', e.target.value)}
              />
            </Field>
            <Field
              label="Fixed Export Rate (p/kWh)"
              description="Used when no dynamic export tariff is configured. Set to 0 if you don't get paid for export."
            >
              <input
                className={inputClass}
                type="number"
                step="0.1"
                min="0"
                value={settings.export_rate}
                onChange={(e) => update('export_rate', e.target.value)}
              />
            </Field>
          </div>
        </SettingsSection>
      </Card>

      {isAgile ? (
        <Card>
          <SettingsSection
            title="Nordpool day-ahead forecast"
            description="Get estimated Agile rates ~5 hours before Octopus publishes by converting Nordpool N2EX wholesale prices. Estimates are automatically replaced with confirmed rates when available."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Enable forecast" description="Fetch Nordpool day-ahead prices at ~11:15am and estimate Agile rates">
                <select
                  className={inputClass}
                  value={settings.nordpool_forecast_enabled}
                  onChange={(e) => update('nordpool_forecast_enabled', e.target.value)}
                >
                  <option value="false">Disabled</option>
                  <option value="true">Enabled</option>
                </select>
              </Field>
            </div>

            {settings.nordpool_forecast_enabled === 'true' ? (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Distribution multiplier"
                  description="Wholesale-to-retail markup factor. Varies by DNO region (2.0–2.4). Default 2.2 works for most regions."
                >
                  <input
                    className={inputClass}
                    type="number"
                    step="0.1"
                    min="1"
                    max="4"
                    value={settings.nordpool_distribution_multiplier}
                    onChange={(e) => update('nordpool_distribution_multiplier', e.target.value)}
                  />
                </Field>
                <Field
                  label="Peak adder (p/kWh)"
                  description="Extra charge during peak hours for DUoS costs. Default 12.5p."
                >
                  <input
                    className={inputClass}
                    type="number"
                    step="0.5"
                    min="0"
                    value={settings.nordpool_peak_adder}
                    onChange={(e) => update('nordpool_peak_adder', e.target.value)}
                  />
                </Field>
                <Field label="Peak start" description="Start of peak DUoS period (default 16:00)">
                  <input
                    className={inputClass}
                    type="time"
                    value={settings.nordpool_peak_start}
                    onChange={(e) => update('nordpool_peak_start', e.target.value)}
                  />
                </Field>
                <Field label="Peak end" description="End of peak DUoS period (default 19:00)">
                  <input
                    className={inputClass}
                    type="time"
                    value={settings.nordpool_peak_end}
                    onChange={(e) => update('nordpool_peak_end', e.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {settings.nordpool_forecast_enabled === 'true' ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={refreshNordpool} disabled={refreshingNordpool} variant="secondary">
                  {refreshingNordpool ? 'Refreshing…' : 'Refresh forecast now'}
                </Button>
                {nordpoolStatus ? (
                  <span
                    className={`text-sm ${nordpoolStatus.ok ? 'text-sb-text-muted' : 'text-sb-danger'}`}
                  >
                    {nordpoolStatus.message}
                  </span>
                ) : (
                  <span className="text-sm text-sb-text-muted">
                    Fetches tomorrow’s day-ahead prices and replans immediately. Save any
                    setting changes first.
                  </span>
                )}
              </div>
            ) : null}
          </SettingsSection>
        </Card>
      ) : null}

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
