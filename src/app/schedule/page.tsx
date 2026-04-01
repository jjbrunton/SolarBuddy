import type { Metadata } from 'next';
import ScheduleView from './ScheduleView';

export const metadata: Metadata = { title: 'Charge Plan' };

export default function SchedulePage() {
  return <ScheduleView />;
}
