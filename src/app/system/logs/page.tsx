import type { Metadata } from 'next';
import { getEventsLog } from '@/lib/analytics-data';
import LogsView from './LogsView';

export const metadata: Metadata = { title: 'System Logs' };

export default function LogsPage() {
  const events = getEventsLog();
  return <LogsView initialEvents={events} />;
}
