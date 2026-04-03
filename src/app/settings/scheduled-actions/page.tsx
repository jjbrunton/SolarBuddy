import type { Metadata } from 'next';
import ScheduledActionsView from './ScheduledActionsView';

export const metadata: Metadata = { title: 'Scheduled Actions' };

export default function ScheduledActionsPage() {
  return <ScheduledActionsView />;
}
