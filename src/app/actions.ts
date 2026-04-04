'use server';

import { revalidatePath } from 'next/cache';
import { saveSettings, getSettings, SETTING_KEY_SET, type AppSettings } from '@/lib/config';
import { getDb } from '@/lib/db';
import { syncVirtualInverterSetting } from '@/lib/virtual-inverter/runtime';

export async function saveSettingsAction(
  settings: Record<string, string>,
): Promise<{ ok: boolean; error?: string; settings?: AppSettings }> {
  // Validate: only allow known keys with string values
  const validated: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTING_KEY_SET.has(key)) continue;
    if (typeof value !== 'string') {
      return { ok: false, error: `Invalid value for ${key}: must be a string` };
    }
    (validated as Record<string, string>)[key] = value;
  }

  if (Object.keys(validated).length === 0) {
    return { ok: false, error: 'No valid settings provided' };
  }

  saveSettings(validated);

  // If MQTT settings changed, reconnect
  if (validated.mqtt_host !== undefined || validated.mqtt_port !== undefined) {
    const { connectMqtt } = await import('@/lib/mqtt/client');
    connectMqtt();
  }

  if (validated.watchdog_enabled !== undefined) {
    const { syncInverterWatchdogSetting } = await import('@/lib/scheduler/watchdog');
    syncInverterWatchdogSetting();
  }

  if (
    validated.virtual_mode_enabled !== undefined ||
    validated.virtual_scenario_id !== undefined ||
    validated.virtual_speed !== undefined
  ) {
    await syncVirtualInverterSetting();
  }

  // Trigger schedule replan if any schedule-relevant setting changed
  const { SCHEDULE_RELEVANT_KEYS, requestReplan } = await import('@/lib/scheduler/reevaluate');
  if (Object.keys(validated).some((key) => SCHEDULE_RELEVANT_KEYS.has(key))) {
    requestReplan('settings changed');
  }

  revalidatePath('/settings');
  return { ok: true, settings: getSettings() };
}

export async function fetchRatesAction(): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const { fetchAndStoreRates } = await import('@/lib/octopus/rates');
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);

    const rates = await fetchAndStoreRates(now.toISOString(), tomorrow.toISOString());
    revalidatePath('/rates');

    if (rates.length > 0) {
      const { requestReplan } = await import('@/lib/scheduler/reevaluate');
      requestReplan('manual rate fetch');
    }

    return { ok: true, count: rates.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function runScheduleAction(): Promise<{ ok: boolean; error?: string; message?: string; status?: string }> {
  const { runScheduleCycle } = await import('@/lib/scheduler/cron');
  const result = await runScheduleCycle();
  revalidatePath('/schedule');

  if (!result.ok) {
    return { ok: false, error: result.message, status: result.status };
  }

  return { ok: true, message: result.message, status: result.status };
}

export async function saveOverridesAction(
  slots: { slot_start: string; slot_end: string }[],
): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!Array.isArray(slots)) {
    return { ok: false, error: 'slots must be an array' };
  }

  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);
    const insert = db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const slot of slots) {
      insert.run(today, slot.slot_start, slot.slot_end, now);
    }
  });
  transaction();

  revalidatePath('/rates');
  return { ok: true, count: slots.length };
}

export async function clearOverridesAction(): Promise<{ ok: boolean }> {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);
  revalidatePath('/rates');
  return { ok: true };
}
