'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface Settings {
  mqtt_host: string;
  mqtt_port: string;
  mqtt_username: string;
  mqtt_password: string;
  octopus_region: string;
  octopus_product_code: string;
  octopus_api_key: string;
  octopus_account: string;
  charge_hours: string;
  price_threshold: string;
  min_soc_target: string;
  charge_window_start: string;
  charge_window_end: string;
  default_work_mode: string;
  charge_rate: string;
  auto_schedule: string;
}

const tabs = [
  { label: 'General', href: '/settings' },
  { label: 'MQTT', href: '/settings/mqtt' },
  { label: 'Octopus Energy', href: '/settings/octopus' },
  { label: 'Charging', href: '/settings/charging' },
];

export const inputClass =
  'w-full rounded-md border border-sb-border bg-sb-input px-3 py-2 text-sm text-sb-text focus:border-sb-accent focus:outline-none';

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
    <div>
      <label className="mb-1 block text-sm font-medium text-sb-text">{label}</label>
      {description && <p className="mb-1.5 text-xs text-sb-text-muted">{description}</p>}
      {children}
    </div>
  );
}

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex gap-1 rounded-lg bg-sb-card p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            pathname === tab.href
              ? 'bg-sb-active text-sb-text'
              : 'text-sb-text-muted hover:bg-sb-active/50 hover:text-sb-text'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
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

  return { settings, update, save, saving, message };
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
    <div className="flex items-center gap-4">
      <button
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-sb-accent px-6 py-2 text-sm font-medium text-white hover:bg-sb-accent-hover disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
      {message && (
        <span className={`text-sm ${message.includes('Failed') ? 'text-sb-danger' : 'text-sb-success'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
