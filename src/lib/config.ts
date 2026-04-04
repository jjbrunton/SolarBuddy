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
  watchdog_enabled: string;
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
  smart_discharge: string;
  discharge_price_threshold: string;
  discharge_soc_floor: string;
  // Peak protection
  peak_protection: string;
  peak_period_start: string;
  peak_period_end: string;
  peak_soc_target: string;
  // Export
  octopus_export_mpan: string;
  octopus_export_meter_serial: string;
  octopus_export_product_code: string;
  export_rate: string;
  // Advanced scheduling heuristics
  always_charge_below_price: string;
  peak_detection: string;
  peak_duration_slots: string;
  solar_skip_enabled: string;
  solar_skip_threshold_kwh: string;
  pre_cheapest_suppression: string;
  negative_run_discharge: string;
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
  // Virtual inverter
  virtual_mode_enabled: string;
  virtual_scenario_id: string;
  virtual_speed: string;
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

export const DEFAULT_SETTINGS: AppSettings = {
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
  watchdog_enabled: 'true',
  battery_capacity_kwh: '5.12',
  max_charge_power_kw: '3.6',
  estimated_consumption_w: '500',
  tariff_type: 'agile',
  tariff_offpeak_rate: '7.5',
  tariff_peak_rate: '35',
  tariff_standard_rate: '24.5',
  negative_price_charging: 'true',
  negative_price_pre_discharge: 'false',
  smart_discharge: 'false',
  discharge_price_threshold: '0',
  discharge_soc_floor: '20',
  peak_protection: 'false',
  peak_period_start: '16:00',
  peak_period_end: '19:00',
  peak_soc_target: '90',
  // Advanced scheduling heuristics
  always_charge_below_price: '0',
  peak_detection: 'manual',
  peak_duration_slots: '7',
  solar_skip_enabled: 'false',
  solar_skip_threshold_kwh: '15',
  pre_cheapest_suppression: 'false',
  negative_run_discharge: 'false',
  // Export
  octopus_export_mpan: '',
  octopus_export_meter_serial: '',
  octopus_export_product_code: '',
  export_rate: '0',
  // PV Forecast (forecast.solar)
  pv_forecast_enabled: 'false',
  pv_forecast_confidence: 'estimate',
  pv_latitude: '',
  pv_longitude: '',
  pv_declination: '35',
  pv_azimuth: '0',
  pv_kwp: '',
  // Time sync
  time_sync_enabled: 'false',
  // Tariff monitor
  tariff_monitor_enabled: 'true',
  // Virtual inverter
  virtual_mode_enabled: 'false',
  virtual_scenario_id: 'overnight-recovery',
  virtual_speed: '6x',
  // Notifications
  notifications_state_change: 'false',
  notifications_battery_exhausted: 'false',
  notifications_battery_charged: 'false',
  notifications_schedule_updated: 'false',
  notifications_discord_enabled: 'false',
  notifications_discord_webhook_url: '',
  notifications_telegram_enabled: 'false',
  notifications_telegram_bot_token: '',
  notifications_telegram_chat_id: '',
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];
export const SETTING_KEY_SET = new Set<string>(SETTING_KEYS);

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, string> = {};
  for (const row of rows) {
    stored[row.key] = row.value;
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function getSetting(key: keyof AppSettings): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key];
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
