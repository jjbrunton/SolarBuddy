import type { Metadata } from 'next';
import { getEventsLog } from '@/lib/events';
import ActivityView from './ActivityView';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  const events = getEventsLog();
  return <ActivityView initialEvents={events} />;
}
