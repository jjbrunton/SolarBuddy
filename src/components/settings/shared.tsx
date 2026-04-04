'use client';

import { useEffect, useState } from 'react';
import { saveSettingsAction } from '@/app/actions';
import { Button } from '@/components/ui/Button';
import { SegmentedLinkTabs } from '@/components/ui/Tabs';

export interface Settings {
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
  tariff_type: string;
  tariff_offpeak_rate: string;
  tariff_peak_rate: string;
  tariff_standard_rate: string;
  charging_strategy: string;
  charge_hours: string;
  price_threshold: string;
  min_soc_target: string;
  charge_window_start: string;
  charge_window_end: string;
  default_work_mode: string;
  charge_rate: string;
  auto_schedule: string;
  watchdog_enabled: string;
  battery_capacity_kwh: string;
  max_charge_power_kw: string;
  estimated_consumption_w: string;
  negative_price_charging: string;
  negative_price_pre_discharge: string;
  smart_discharge: string;
  discharge_price_threshold: string;
  discharge_soc_floor: string;
  peak_protection: string;
  peak_period_start: string;
  peak_period_end: string;
  peak_soc_target: string;
  // Export
  octopus_export_mpan: string;
  octopus_export_meter_serial: string;
  octopus_export_product_code: string;
  export_rate: string;
  // PV Forecast (forecast.solar)
  pv_forecast_enabled: string;
  pv_forecast_confidence: string;
  pv_latitude: string;
  pv_longitude: string;
  pv_declination: string;
  pv_azimuth: string;
  pv_kwp: string;
  // Time sync
  time_sync_enabled: string;
  // Tariff monitor
  tariff_monitor_enabled: string;
  // Notifications
  notifications_state_change: string;
  notifications_battery_exhausted: string;
  notifications_battery_charged: string;
  notifications_schedule_updated: string;
  notifications_discord_enabled: string;
  notifications_discord_webhook_url: string;
  notifications_telegram_enabled: string;
  notifications_telegram_bot_token: string;
  notifications_telegram_chat_id: string;
}

const tabs = [
  { label: 'General', href: '/settings' },
  { label: 'MQTT', href: '/settings/mqtt' },
  { label: 'Octopus Energy', href: '/settings/octopus' },
  { label: 'Charging', href: '/settings/charging' },
  { label: 'Solar', href: '/settings/solar' },
];

export const inputClass =
  'w-full rounded-2xl border border-sb-border bg-sb-input px-4 py-3 text-sm text-sb-text shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-[border-color,box-shadow,background-color] outline-none placeholder:text-sb-text-subtle focus:border-sb-border-strong focus:bg-sb-card focus:ring-2 focus:ring-sb-accent/20';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-sb-text">{title}</h2>
        {description ? <p className="text-sm leading-6 text-sb-text-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <label className="block text-sm font-medium text-sb-text">{label}</label>
      {description ? <p className="mt-1.5 text-xs leading-5 text-sb-text-muted">{description}</p> : null}
      <div className="mt-auto pt-2.5">{children}</div>
    </div>
  );
}

export function SettingsTabs({ pathname }: { pathname: string }) {
  return <SegmentedLinkTabs items={tabs} activeHref={pathname} className="w-full overflow-x-auto" />;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  const update = (key: keyof Settings, value: string) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const replaceSettings = (nextSettings: Settings) => {
    setSettings(nextSettings);
  };

  const persistSettings = async (
    nextSettings: Settings,
    successMessage = 'Settings saved successfully.',
  ): Promise<{ ok: boolean; error?: string }> => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveSettingsAction(nextSettings as unknown as Record<string, string>);
      if (result.ok) {
        setMessage(successMessage);
        if (result.settings) setSettings(result.settings as unknown as Settings);
        setSaving(false);
        return { ok: true };
      } else {
        setMessage(result.error || 'Failed to save settings');
        setSaving(false);
        return { ok: false, error: result.error || 'Failed to save settings' };
      }
    } catch {
      setMessage('Failed to save settings');
      setSaving(false);
      return { ok: false, error: 'Failed to save settings' };
    }
  };

  const save = async () => {
    if (!settings) return;
    await persistSettings(settings);
  };

  return { settings, update, replaceSettings, save, persistSettings, saving, message };
}

export function SaveButton({
  saving,
  message,
  onSave,
}: {
  saving: boolean;
  message: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
      {message ? (
        <span className={`text-sm ${message.includes('Failed') ? 'text-sb-danger' : 'text-sb-success'}`}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
