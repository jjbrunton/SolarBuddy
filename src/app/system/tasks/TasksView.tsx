'use client';

import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Play, RefreshCw } from 'lucide-react';

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
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Scheduled Tasks</h1>

      {tasks.map((task) => (
        <Card key={task.name}>
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-medium text-sb-text">{task.name}</h3>
              <p className="mt-1 text-sm text-sb-text-muted">{task.description}</p>
              <p className="mt-2 text-xs text-sb-text-muted">Schedule: {task.schedule}</p>
              {results[task.name] && (
                <div className="mt-2">
                  <Badge kind={results[task.name].success ? 'success' : 'danger'}>
                    {results[task.name].message}
                  </Badge>
                </div>
              )}
            </div>
            <button
              onClick={() => runTask(task.name, task.endpoint)}
              disabled={running === task.name}
              className="flex items-center gap-2 rounded-md bg-sb-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-sb-accent-hover disabled:opacity-50"
            >
              <task.icon size={14} className={running === task.name ? 'animate-spin' : ''} />
              {running === task.name ? 'Running...' : 'Run Now'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}
