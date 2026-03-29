'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface Event {
  id: number;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  category: string;
  message: string;
}

const levelConfig = {
  info: { Icon: Info, kind: 'info' as const },
  success: { Icon: CheckCircle, kind: 'success' as const },
  warning: { Icon: AlertTriangle, kind: 'warning' as const },
  error: { Icon: AlertCircle, kind: 'danger' as const },
};

export default function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/events-log');
        const json = await res.json();
        setEvents(json.events || []);
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Activity</h1>

      <Card>
        <CardHeader title="Recent Events" />
        {loading ? (
          <p className="text-sb-text-muted">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-sb-text-muted">No events recorded yet. Events will appear as the system operates.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const { Icon, kind } = levelConfig[event.level] || levelConfig.info;
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 rounded-md bg-sb-bg px-3 py-2.5"
                >
                  <Icon size={16} className={`mt-0.5 shrink-0 text-sb-${kind === 'danger' ? 'danger' : kind}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge kind={kind}>{event.category}</Badge>
                      <span className="text-xs text-sb-text-muted">
                        {new Date(event.timestamp).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-sb-text">{event.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
