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
  octopus_mpan: string;
  octopus_meter_serial: string;
  charging_strategy: string;
  charge_hours: string;
  price_threshold: string;
  min_soc_target: string;
  charge_window_start: string;
  charge_window_end: string;
  default_work_mode: string;
  charge_rate: string;
  auto_schedule: string;
  battery_capacity_kwh: string;
  max_charge_power_kw: string;
  estimated_consumption_w: string;
  // Tariff
  tariff_type: string;
  tariff_offpeak_rate: string;
  tariff_peak_rate: string;
  tariff_standard_rate: string;
  // Negative pricing
  negative_price_charging: string;
  negative_price_pre_discharge: string;
  // Peak protection
  peak_protection: string;
  peak_period_start: string;
  peak_period_end: string;
  peak_soc_target: string;
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
  octopus_mpan: '',
  octopus_meter_serial: '',
  charging_strategy: 'night_fill',
  charge_hours: '4',
  price_threshold: '0',
  min_soc_target: '80',
  charge_window_start: '23:00',
  charge_window_end: '07:00',
  default_work_mode: 'Battery first',
  charge_rate: '100',
  auto_schedule: 'true',
  battery_capacity_kwh: '5.12',
  max_charge_power_kw: '3.6',
  estimated_consumption_w: '500',
  tariff_type: 'agile',
  tariff_offpeak_rate: '7.5',
  tariff_peak_rate: '35',
  tariff_standard_rate: '24.5',
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
  peak_protection: 'false',
  peak_period_start: '16:00',
  peak_period_end: '19:00',
  peak_soc_target: '90',
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
