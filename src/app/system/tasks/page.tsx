import type { Metadata } from 'next';
import TasksView from './TasksView';

export const metadata: Metadata = { title: 'Scheduled Tasks' };

export default function TasksPage() {
  return <TasksView />;
}
