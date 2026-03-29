import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import ActivityView from './ActivityView';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  const db = getDb();
  const events = db
    .prepare(
      `SELECT id, timestamp, level, category, message
       FROM events
       ORDER BY timestamp DESC
       LIMIT 100`
    )
    .all() as { id: number; timestamp: string; level: 'info' | 'success' | 'warning' | 'error'; category: string; message: string }[];

  return <ActivityView initialEvents={events} />;
}
