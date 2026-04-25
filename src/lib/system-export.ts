import { getDb } from './db';
import { getSettings, SENSITIVE_SETTING_KEYS, type AppSettings } from './config';

// Credentials we never want in a shareable analytics dump. Includes the keys
// already protected by SENSITIVE_SETTING_KEYS plus connector secrets that the
// generic /api/settings GET still returns. Replaced with '[REDACTED]' (or '' if
// the original was already empty) so consumers can see which integrations are
// configured without exposing the credentials.
const EXPORT_REDACTED_SETTING_KEYS = new Set<keyof AppSettings>([
  ...SENSITIVE_SETTING_KEYS,
  'mqtt_password',
  'octopus_api_key',
  'homeassistant_password',
  'notifications_discord_webhook_url',
  'notifications_telegram_bot_token',
]);

// Tables included in the dump. Excludes `api_keys` (only stores hashes, but no
// reason to expose them) and the `settings` table (surfaced separately as a
// redacted object).
const EXPORTED_TABLES = [
  'rates',
  'export_rates',
  'schedules',
  'plan_slots',
  'plan_slot_executions',
  'readings',
  'events',
  'mqtt_logs',
  'carbon_intensity',
  'manual_overrides',
  'auto_overrides',
  'scheduled_actions',
  'pv_forecasts',
  'usage_profile',
  'usage_profile_meta',
] as const;

function redactSettings(settings: AppSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings) as [keyof AppSettings, string][]) {
    if (EXPORT_REDACTED_SETTING_KEYS.has(key)) {
      out[key] = value ? '[REDACTED]' : '';
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface SystemExport {
  meta: {
    exported_at: string;
    app_version: string;
    schema_version: string;
    db_path: string;
    db_size_bytes: number;
    redacted_setting_keys: string[];
  };
  settings: Record<string, string>;
  tables: Record<string, unknown[]>;
  row_counts: Record<string, number>;
}

export function buildSystemExport(): SystemExport {
  const db = getDb();
  const pageCount = db.prepare('PRAGMA page_count').pluck().get() as number;
  const pageSize = db.prepare('PRAGMA page_size').pluck().get() as number;

  const tables: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const table of EXPORTED_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as unknown[];
    tables[table] = rows;
    rowCounts[table] = rows.length;
  }

  return {
    meta: {
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      schema_version: '1',
      db_path: process.env.DB_PATH || 'data/solarbuddy.db',
      db_size_bytes: pageCount * pageSize,
      redacted_setting_keys: [...EXPORT_REDACTED_SETTING_KEYS],
    },
    settings: redactSettings(getSettings()),
    tables,
    row_counts: rowCounts,
  };
}
