import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/config';
import { getState } from '@/lib/state';
import { getEventsLog } from '@/lib/events';
import { getRecentMqttLogs } from '@/lib/mqtt/logs';
import SystemPageView from './SystemPageView';

export const metadata: Metadata = { title: 'System' };

const startTime = Date.now();

export default function SystemPage() {
  const db = getDb();
  const settings = getSettings();
  const state = getState();

  const dbPath = process.env.DB_PATH || 'data/solarbuddy.db';
  const pageCount = db.prepare('PRAGMA page_count').pluck().get() as number;
  const pageSize = db.prepare('PRAGMA page_size').pluck().get() as number;
  const dbSize = pageCount * pageSize;

  const latestRate = db
    .prepare('SELECT MAX(valid_from) as latest FROM rates')
    .get() as { latest: string | null } | undefined;

  const latestSchedule = db
    .prepare('SELECT MAX(created_at) as latest FROM schedules')
    .get() as { latest: string | null } | undefined;

  const readingsCount = db
    .prepare('SELECT COUNT(*) as count FROM readings')
    .get() as { count: number };

  const schedulesCount = db
    .prepare('SELECT COUNT(*) as count FROM schedules')
    .get() as { count: number };

  const uptimeMs = Date.now() - startTime;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  const info = {
    health: {
      mqtt_connected: state.mqtt_connected,
      rates_fresh: latestRate?.latest
        ? Date.now() - new Date(latestRate.latest).getTime() < 24 * 60 * 60 * 1000
        : false,
      last_rate_fetch: latestRate?.latest || null,
      last_schedule: latestSchedule?.latest || null,
      scheduler_configured: Boolean(settings.octopus_region),
      auto_schedule_enabled: settings.auto_schedule === 'true',
      watchdog_enabled: settings.watchdog_enabled !== 'false',
    },
    stats: {
      readings_count: readingsCount.count,
      schedules_count: schedulesCount.count,
      db_size_bytes: dbSize,
    },
    about: {
      version: '1.0.0',
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: `${uptimeHours}h ${uptimeMins}m`,
      db_path: dbPath,
    },
  };

  const events = getEventsLog();
  const mqttEntries = getRecentMqttLogs();

  return (
    <SystemPageView
      initialInfo={info}
      initialEvents={events}
      initialMqttEntries={mqttEntries}
    />
  );
}
