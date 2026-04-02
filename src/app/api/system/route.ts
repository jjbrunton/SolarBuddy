import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSettings } from '@/lib/config';
import { getState } from '@/lib/state';
import fs from 'fs';
import path from 'path';

const startTime = Date.now();

export async function GET() {
  const db = getDb();
  const settings = getSettings();
  const state = getState();

  // DB file size
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'solarbuddy.db');
  let dbSize = 0;
  try {
    const stats = fs.statSync(dbPath);
    dbSize = stats.size;
  } catch { /* file may not exist */ }

  // Latest rate
  const latestRate = db
    .prepare('SELECT MAX(valid_from) as latest FROM rates')
    .get() as { latest: string | null } | undefined;

  // Latest schedule
  const latestSchedule = db
    .prepare('SELECT MAX(created_at) as latest FROM schedules')
    .get() as { latest: string | null } | undefined;

  // Readings count
  const readingsCount = db
    .prepare('SELECT COUNT(*) as count FROM readings')
    .get() as { count: number };

  // Schedules count
  const schedulesCount = db
    .prepare('SELECT COUNT(*) as count FROM schedules')
    .get() as { count: number };

  const uptimeMs = Date.now() - startTime;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMins = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  return NextResponse.json({
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
  });
}
