'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton } from '@/components/settings/shared';

const REGIONS = [
  { code: 'A', name: 'Eastern England' },
  { code: 'B', name: 'East Midlands' },
  { code: 'C', name: 'London' },
  { code: 'D', name: 'Merseyside and Northern Wales' },
  { code: 'E', name: 'West Midlands' },
  { code: 'F', name: 'North Eastern England' },
  { code: 'G', name: 'North Western England' },
  { code: 'H', name: 'Southern England' },
  { code: 'J', name: 'South Eastern England' },
  { code: 'K', name: 'Southern Wales' },
  { code: 'L', name: 'South Western England' },
  { code: 'M', name: 'Yorkshire' },
  { code: 'N', name: 'Southern Scotland' },
  { code: 'P', name: 'Northern Scotland' },
];

export default function OctopusSettingsPage() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Settings</h1>
      <SettingsTabs />

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Octopus Energy</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Region" description="Your electricity distribution region">
            <select
              className={inputClass}
              value={settings.octopus_region}
              onChange={(e) => update('octopus_region', e.target.value)}
            >
              <option value="">Select region...</option>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product Code">
            <input
              className={inputClass}
              value={settings.octopus_product_code}
              onChange={(e) => update('octopus_product_code', e.target.value)}
            />
          </Field>
          <Field label="API Key (optional)" description="Find this in your Octopus account dashboard">
            <input
              className={inputClass}
              type="password"
              value={settings.octopus_api_key}
              onChange={(e) => update('octopus_api_key', e.target.value)}
            />
          </Field>
          <Field label="Account Number (optional)">
            <input
              className={inputClass}
              value={settings.octopus_account}
              onChange={(e) => update('octopus_account', e.target.value)}
              placeholder="A-1234ABCD"
            />
          </Field>
        </div>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
