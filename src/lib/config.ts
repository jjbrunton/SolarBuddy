import { getDb } from './db';

export interface AppSettings {
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

const DEFAULTS: AppSettings = {
  mqtt_host: '',
  mqtt_port: '1883',
  mqtt_username: '',
  mqtt_password: '',
  octopus_region: '',
  octopus_product_code: 'AGILE-24-10-01',
  octopus_api_key: '',
  octopus_account: '',
  charge_hours: '4',
  price_threshold: '0',
  min_soc_target: '80',
  charge_window_start: '23:00',
  charge_window_end: '07:00',
  default_work_mode: 'Battery first',
  charge_rate: '100',
  auto_schedule: 'true',
};

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }
  return { ...DEFAULTS, ...stored };
}

export function getSetting(key: keyof AppSettings): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key];
}

export function saveSettings(settings: Partial<AppSettings>) {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const transaction = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, value);
    }
  });
  transaction(Object.entries(settings) as [string, string][]);
}
