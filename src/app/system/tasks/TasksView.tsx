'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Play, RefreshCw, Trash2 } from 'lucide-react';

interface TaskResult {
  success: boolean;
  message: string;
}

export default function TasksView() {
  const [results, setResults] = useState<Record<string, TaskResult>>({});
  const [running, setRunning] = useState<string | null>(null);

  const runTask = async (name: string, endpoint: string, method = 'POST') => {
    setRunning(name);
    try {
      const res = await fetch(endpoint, { method });
      const json = await res.json();
      setResults((prev) => ({
        ...prev,
        [name]: { success: res.ok, message: json.message || (res.ok ? 'Completed' : 'Failed') },
      }));
    } catch {
      setResults((prev) => ({ ...prev, [name]: { success: false, message: 'Request failed' } }));
    }
    setRunning(null);
  };

  const tasks = [
    {
      name: 'Fetch Agile Rates',
      description: 'Pull latest Octopus Agile half-hourly rates from the API',
      schedule: 'Daily at 4:05 PM',
      endpoint: '/api/rates',
      icon: RefreshCw,
    },
    {
      name: 'Run Scheduler',
      description: 'Calculate and plan optimal charge windows based on current rates',
      schedule: 'Daily at 4:10 PM',
      endpoint: '/api/schedule',
      icon: Play,
    },
    {
      name: 'DB Retention Prune',
      description: 'Delete rows older than 30 days from the events and mqtt_logs tables',
      schedule: 'Daily at 3:30 AM',
      endpoint: '/api/system/retention-prune',
      icon: Trash2,
    },
  ];

  return (
    <div className="space-y-6">
      {tasks.map((task) => (
        <Card key={task.name}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold tracking-[-0.02em] text-sb-text">{task.name}</h3>
              <p className="mt-1 text-sm leading-6 text-sb-text-muted">{task.description}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Schedule: {task.schedule}</p>
              {results[task.name] && (
                <div className="mt-2">
                  <Badge kind={results[task.name].success ? 'success' : 'danger'}>
                    {results[task.name].message}
                  </Badge>
                </div>
              )}
            </div>
            <Button
              onClick={() => runTask(task.name, task.endpoint)}
              disabled={running === task.name}
              size="sm"
            >
              <task.icon size={14} className={running === task.name ? 'animate-spin' : ''} />
              {running === task.name ? 'Running…' : 'Run now'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
