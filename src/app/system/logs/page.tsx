'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface Event {
  id: number;
  timestamp: string;
  level: string;
  category: string;
  message: string;
}

function levelKind(level: string) {
  switch (level) {
    case 'error': return 'danger' as const;
    case 'warning': return 'warning' as const;
    case 'success': return 'success' as const;
    default: return 'info' as const;
  }
}

export default function LogsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/events-log')
      .then((r) => r.json())
      .then((json) => setEvents(json.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">System Logs</h1>

      <Card>
        <CardHeader title="Event Log" />
        {loading ? (
          <p className="text-sb-text-muted">Loading logs...</p>
        ) : events.length === 0 ? (
          <p className="text-sb-text-muted">No log entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sb-border text-left text-sb-text-muted">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">Level</th>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-sb-border/50">
                    <td className="whitespace-nowrap py-2.5 text-sb-text-muted">
                      {new Date(e.timestamp).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5">
                      <Badge kind={levelKind(e.level)}>{e.level}</Badge>
                    </td>
                    <td className="py-2.5 text-sb-text-muted">{e.category}</td>
                    <td className="py-2.5 text-sb-text">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
