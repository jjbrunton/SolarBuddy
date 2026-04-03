'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function SolarSettingsView() {
  const pathname = usePathname();
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const forecastEnabled = settings.pv_forecast_enabled === 'true';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Solar forecast"
        description="Connect to forecast.solar to feed PV generation forecasts into the charge planner. The scheduler uses predicted solar output to reduce unnecessary grid charging. No API key required."
      />
      <SettingsTabs pathname={pathname} />

      <Card>
        <SettingsSection
          title="PV Forecast"
          description="forecast.solar provides free rooftop PV forecasts based on your system location and capacity. Enter your panel details below."
        >
          <div className="space-y-4">
            <Field label="Enable PV Forecast" description="When enabled, the scheduler will factor predicted solar generation into charge planning.">
              <select
                className={inputClass}
                value={settings.pv_forecast_enabled}
                onChange={(e) => update('pv_forecast_enabled', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>

            {forecastEnabled ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Latitude" description="Decimal degrees, e.g. 51.5074">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_latitude}
                    onChange={(e) => update('pv_latitude', e.target.value)}
                    placeholder="51.5074"
                  />
                </Field>
                <Field label="Longitude" description="Decimal degrees, e.g. -0.1278">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_longitude}
                    onChange={(e) => update('pv_longitude', e.target.value)}
                    placeholder="-0.1278"
                  />
                </Field>
                <Field label="Panel capacity (kWp)" description="Total installed PV capacity in kilowatts peak">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_kwp}
                    onChange={(e) => update('pv_kwp', e.target.value)}
                    placeholder="4.0"
                  />
                </Field>
                <Field label="Declination (tilt)" description="Panel angle from horizontal in degrees (0–90). Default 35.">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_declination}
                    onChange={(e) => update('pv_declination', e.target.value)}
                    placeholder="35"
                  />
                </Field>
                <Field label="Azimuth" description="Panel direction: -180 to 180 (0 = south, -90 = east, 90 = west).">
                  <input
                    className={inputClass}
                    type="text"
                    inputMode="decimal"
                    value={settings.pv_azimuth}
                    onChange={(e) => update('pv_azimuth', e.target.value)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Forecast confidence" description="Estimate is the median. Conservative assumes 80% of estimate. Optimistic assumes 120%.">
                  <select
                    className={inputClass}
                    value={settings.pv_forecast_confidence}
                    onChange={(e) => update('pv_forecast_confidence', e.target.value)}
                  >
                    <option value="estimate">Estimate (median)</option>
                    <option value="estimate10">Conservative (80%)</option>
                    <option value="estimate90">Optimistic (120%)</option>
                  </select>
                </Field>
              </div>
            ) : null}
          </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
