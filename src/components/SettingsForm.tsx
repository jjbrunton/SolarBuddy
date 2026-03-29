'use client';

import { useEffect, useState } from 'react';

interface Settings {
  mqtt_host: string;
  mqtt_port: string;
  mqtt_username: string;
  mqtt_password: string;
  octopus_region: string;
  octopus_product_code: string;
  octopus_api_key: string;
  octopus_account: string;
  octopus_mpan: string;
  octopus_meter_serial: string;
  charge_hours: string;
  price_threshold: string;
  min_soc_target: string;
  charge_window_start: string;
  charge_window_end: string;
  default_work_mode: string;
  charge_rate: string;
  auto_schedule: string;
}

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

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-300">{label}</label>
      {description && <p className="mb-1 text-xs text-zinc-500">{description}</p>}
      {children}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none';

export default function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  if (!settings) return <p className="text-zinc-400">Loading settings...</p>;

  const update = (key: keyof Settings, value: string) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage('Settings saved!');
        setSettings(json.settings);
      } else {
        setMessage('Failed to save settings');
      }
    } catch {
      setMessage('Failed to save settings');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      {/* MQTT / Solar Assistant */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Solar Assistant (MQTT)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="MQTT Host" description="IP address of your Solar Assistant device">
            <input
              className={inputClass}
              value={settings.mqtt_host}
              onChange={(e) => update('mqtt_host', e.target.value)}
              placeholder="192.168.1.100"
            />
          </Field>
          <Field label="MQTT Port">
            <input
              className={inputClass}
              value={settings.mqtt_port}
              onChange={(e) => update('mqtt_port', e.target.value)}
            />
          </Field>
          <Field label="Username (optional)">
            <input
              className={inputClass}
              value={settings.mqtt_username}
              onChange={(e) => update('mqtt_username', e.target.value)}
            />
          </Field>
          <Field label="Password (optional)">
            <input
              className={inputClass}
              type="password"
              value={settings.mqtt_password}
              onChange={(e) => update('mqtt_password', e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* Octopus Energy */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Octopus Energy</h2>
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
          <Field label="API Key (optional)" description="For consumption data. Find it in your Octopus account.">
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
      </section>

      {/* Charging Preferences */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-4 text-lg font-semibold">Charging Preferences</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Charge Slots" description="Number of cheapest half-hour slots to use">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="48"
              value={settings.charge_hours}
              onChange={(e) => update('charge_hours', e.target.value)}
            />
          </Field>
          <Field label="Price Threshold (p/kWh)" description="If > 0, charge below this price instead of cheapest N">
            <input
              className={inputClass}
              type="number"
              step="0.5"
              value={settings.price_threshold}
              onChange={(e) => update('price_threshold', e.target.value)}
            />
          </Field>
          <Field label="Target SOC (%)" description="Stop charging when battery reaches this level">
            <input
              className={inputClass}
              type="number"
              min="10"
              max="100"
              value={settings.min_soc_target}
              onChange={(e) => update('min_soc_target', e.target.value)}
            />
          </Field>
          <Field label="Window Start" description="Earliest time to consider for charging">
            <input
              className={inputClass}
              type="time"
              value={settings.charge_window_start}
              onChange={(e) => update('charge_window_start', e.target.value)}
            />
          </Field>
          <Field label="Window End" description="Latest time to consider for charging">
            <input
              className={inputClass}
              type="time"
              value={settings.charge_window_end}
              onChange={(e) => update('charge_window_end', e.target.value)}
            />
          </Field>
          <Field label="Charge Rate (%)">
            <input
              className={inputClass}
              type="number"
              min="1"
              max="100"
              value={settings.charge_rate}
              onChange={(e) => update('charge_rate', e.target.value)}
            />
          </Field>
          <Field label="Default Work Mode" description="Mode to revert to after charging">
            <select
              className={inputClass}
              value={settings.default_work_mode}
              onChange={(e) => update('default_work_mode', e.target.value)}
            >
              <option value="Battery first">Battery first</option>
              <option value="Load first">Load first</option>
            </select>
          </Field>
          <Field label="Auto Schedule">
            <select
              className={inputClass}
              value={settings.auto_schedule}
              onChange={(e) => update('auto_schedule', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {message && <span className="text-sm text-green-400">{message}</span>}
      </div>
    </div>
  );
}
