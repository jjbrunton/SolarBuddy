import type { Metadata } from 'next';
import { getEventsLog } from '@/lib/analytics-data';
import { getRecentMqttLogs } from '@/lib/mqtt/logs';
import LogsView from './LogsView';

export const metadata: Metadata = { title: 'System Logs' };

export default function LogsPage() {
  const events = getEventsLog();
  const mqttEntries = getRecentMqttLogs();
  return <LogsView initialEvents={events} initialMqttEntries={mqttEntries} />;
}
