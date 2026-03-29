import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import ScheduleView from './ScheduleView';

export const metadata: Metadata = { title: 'Charge Schedule' };

export default function SchedulePage() {
  const db = getDb();
  const schedules = db
    .prepare("SELECT * FROM schedules WHERE date >= date('now', '-1 day') ORDER BY slot_start ASC")
    .all();

  return <ScheduleView initialSchedules={schedules as { id: number; date: string; slot_start: string; slot_end: string; avg_price: number; status: string; notes: string | null }[]} />;
}
