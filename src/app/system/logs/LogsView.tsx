'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedTabs } from '@/components/ui/Tabs';

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

type MqttLogStreamMessage =
  | { type: 'snapshot'; entries: MqttLogEntry[] }
  | { type: 'entry'; entry: MqttLogEntry };

const tabs = [
  { id: 'events', label: 'Event Log' },
  { id: 'mqtt', label: 'MQTT Live' },
] as const;

function levelKind(level: string) {
  switch (level) {
    case 'error': return 'danger' as const;
    case 'warning': return 'warning' as const;
    case 'success': return 'success' as const;
    default: return 'info' as const;
  }
}

function directionKind(direction: MqttLogEntry['direction']) {
  switch (direction) {
    case 'inbound': return 'info' as const;
    case 'outbound': return 'primary' as const;
    default: return 'default' as const;
  }
}

function formatTimestamp(timestamp: string, includeMilliseconds = false) {
  const date = new Date(timestamp);
  const base = date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (!includeMilliseconds) {
    return base;
  }

  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export default function LogsView({
  initialEvents,
  initialMqttEntries,
}: {
  initialEvents: Event[];
  initialMqttEntries: MqttLogEntry[];
}) {
  const [events] = useState<Event[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('events');
  const [mqttEntries, setMqttEntries] = useState<MqttLogEntry[]>(initialMqttEntries);
  const [mqttStreamConnected, setMqttStreamConnected] = useState(false);
  const mqttTableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/system/mqtt-log');

    source.onopen = () => {
      setMqttStreamConnected(true);
    };

    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as MqttLogStreamMessage;
        if (message.type === 'snapshot') {
          setMqttEntries(message.entries);
          return;
        }

        setMqttEntries((current) => {
          const next = [...current, message.entry];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
      } catch {
        // Ignore malformed events.
      }
    };

    source.onerror = () => {
      setMqttStreamConnected(false);
    };

    return () => {
      source.close();
      setMqttStreamConnected(false);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'mqtt' || !mqttTableRef.current) return;
    mqttTableRef.current.scrollTop = mqttTableRef.current.scrollHeight;
  }, [activeTab, mqttEntries]);

  return (
    <div className="space-y-6">
      <SegmentedTabs
        items={tabs.map((tab) => ({ label: tab.label, value: tab.id }))}
        activeValue={activeTab}
        onChange={(value) => setActiveTab(value as (typeof tabs)[number]['id'])}
      />

      <Card>
        <CardHeader title={activeTab === 'events' ? 'Event Log' : 'MQTT Live Log'}>
          {activeTab === 'mqtt' ? (
            <Badge kind={mqttStreamConnected ? 'success' : 'warning'}>
              {mqttStreamConnected ? 'Live stream connected' : 'Reconnecting stream'}
            </Badge>
          ) : null}
        </CardHeader>

        {activeTab === 'events' ? (
          events.length === 0 ? (
            <EmptyState
              title="No log entries yet"
              description="SolarBuddy will start recording events here as soon as background services and integrations emit operator-facing activity."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                    <th className="px-3 py-3 font-medium">Time</th>
                    <th className="px-3 py-3 font-medium">Level</th>
                    <th className="px-3 py-3 font-medium">Category</th>
                    <th className="px-3 py-3 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-sb-border/50">
                      <td className="whitespace-nowrap px-3 py-3 text-sb-text-muted">
                        {formatTimestamp(event.timestamp)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge kind={levelKind(event.level)}>{event.level}</Badge>
                      </td>
                      <td className="px-3 py-3 text-sb-text-muted">{event.category}</td>
                      <td className="px-3 py-3 text-sb-text">{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : mqttEntries.length === 0 ? (
          <EmptyState
            title="No MQTT activity yet"
            description="Connection changes and topic traffic will appear here once the broker is connected and Solar Assistant begins publishing payloads."
          />
        ) : (
          <div ref={mqttTableRef} className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-sb-card">
                <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3 font-medium">Time</th>
                  <th className="px-3 py-3 font-medium">Direction</th>
                  <th className="px-3 py-3 font-medium">Level</th>
                  <th className="px-3 py-3 font-medium">Topic</th>
                  <th className="px-3 py-3 font-medium">Payload</th>
                </tr>
              </thead>
              <tbody>
                {mqttEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-sb-border/50 align-top">
                    <td className="whitespace-nowrap px-3 py-3 text-sb-text-muted">
                      {formatTimestamp(entry.timestamp, true)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge kind={directionKind(entry.direction)}>{entry.direction}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge kind={levelKind(entry.level)}>{entry.level}</Badge>
                    </td>
                    <td className="px-3 py-3 font-[family-name:var(--font-sb-mono)] text-xs text-sb-text-muted">
                      {entry.topic || 'system'}
                    </td>
                    <td className="px-3 py-3 font-[family-name:var(--font-sb-mono)] text-xs text-sb-text">
                      {entry.payload}
                    </td>
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
