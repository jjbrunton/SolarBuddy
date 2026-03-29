import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { getState } from '@/lib/state';
import fs from 'fs';
import path from 'path';
import SystemView from './SystemView';

export const metadata: Metadata = { title: 'System Status' };

const startTime = Date.now();

export default function SystemPage() {
  const db = getDb();
  const state = getState();

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'solarbuddy.db');
  let dbSize = 0;
  try {
    const stats = fs.statSync(dbPath);
    dbSize = stats.size;
  } catch { /* file may not exist */ }

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

  return <SystemView initialInfo={info} />;
}
