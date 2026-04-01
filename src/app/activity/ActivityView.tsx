'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
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

export default function ActivityView({ initialEvents }: { initialEvents: { id: number; timestamp: string; level: 'info' | 'success' | 'warning' | 'error'; category: string; message: string }[] }) {
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/events-log');
        const json = await res.json();
        setEvents(json.events || []);
      } catch { /* silent */ }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Activity log"
        description="Monitor the latest operator-facing events and system decisions in a single chronological feed."
      />

      <Card>
        <CardHeader
          title="Recent events"
          subtitle="This stream captures notable scheduler, telemetry, and integration events as SolarBuddy runs."
        />
        {loading ? (
          <p className="text-sb-text-muted">Loading events...</p>
        ) : events.length === 0 ? (
          <EmptyState
            title="No events recorded yet"
            description="Events will appear here once SolarBuddy starts recording scheduler runs, telemetry transitions, and integration activity."
          />
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const { Icon, kind } = levelConfig[event.level] || levelConfig.info;
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-3 rounded-2xl border border-sb-border/70 bg-sb-surface-muted/80 px-4 py-3"
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
