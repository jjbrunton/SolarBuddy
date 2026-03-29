'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton } from '@/components/settings/shared';

export default function ChargingSettingsPage() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Settings</h1>
      <SettingsTabs />

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Charging Preferences</h3>
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
        </div>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
