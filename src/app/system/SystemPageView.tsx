'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedTabs } from '@/components/ui/Tabs';
import SystemView from './SystemView';
import TasksView from './tasks/TasksView';
import LogsView from './logs/LogsView';

interface Event {
  id: number;
  timestamp: string;
  level: string;
  category: string;
  message: string;
}

interface MqttLogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  direction: 'inbound' | 'outbound' | 'system';
  topic: string | null;
  payload: string;
}

const TABS = [
  { label: 'Status', value: 'status' },
  { label: 'Tasks', value: 'tasks' },
  { label: 'Logs', value: 'logs' },
];

export default function SystemPageView({
  initialInfo,
  initialEvents,
  initialMqttEntries,
}: {
  initialInfo: Parameters<typeof SystemView>[0]['initialInfo'];
  initialEvents: Event[];
  initialMqttEntries: MqttLogEntry[];
}) {
  const [tab, setTab] = useState('status');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Diagnostics"
        title="System"
        description="Health checks, background tasks, and live logs."
      />

      <SegmentedTabs items={TABS} activeValue={tab} onChange={setTab} />

      {tab === 'status' && <SystemView initialInfo={initialInfo} />}
      {tab === 'tasks' && <TasksView />}
      {tab === 'logs' && <LogsView initialEvents={initialEvents} initialMqttEntries={initialMqttEntries} />}
    </div>
  );
}
