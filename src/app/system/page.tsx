'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { FieldSet } from '@/components/ui/FieldSet';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';

interface SystemInfo {
  health: {
    mqtt_connected: boolean;
    rates_fresh: boolean;
    last_rate_fetch: string | null;
    last_schedule: string | null;
  };
  stats: {
    readings_count: number;
    schedules_count: number;
    db_size_bytes: number;
  };
  about: {
    version: string;
    node_version: string;
    platform: string;
    arch: string;
    uptime: string;
    db_path: string;
  };
}

function HealthCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-sb-bg px-3 py-2.5">
      <span className="text-sm text-sb-text">{label}</span>
      {ok ? (
        <span className="flex items-center gap-1.5 text-sm text-sb-success">
          <CheckCircle size={14} /> OK
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-sb-danger">
          <XCircle size={14} /> Issue
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    fetch('/api/system')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  if (!info) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-sb-text">System</h1>
        <Card><p className="text-sb-text-muted">Loading system information...</p></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">System Status</h1>

      {/* Health checks */}
      <Card>
        <CardHeader title="Health" />
        <div className="space-y-2">
          <HealthCheck label="MQTT Connection" ok={info.health.mqtt_connected} />
          <HealthCheck label="Rate Data Fresh (< 24h)" ok={info.health.rates_fresh} />
          <HealthCheck
            label="Rates Available"
            ok={info.health.last_rate_fetch !== null}
          />
          <HealthCheck
            label="Scheduler Active"
            ok={info.health.last_schedule !== null}
          />
        </div>
      </Card>

      {/* Database stats */}
      <Card>
        <CardHeader title="Database" />
        <DescriptionList
          items={[
            { label: 'Database Size', value: formatBytes(info.stats.db_size_bytes) },
            { label: 'Total Readings', value: info.stats.readings_count.toLocaleString() },
            { label: 'Total Schedules', value: info.stats.schedules_count.toLocaleString() },
            { label: 'DB Path', value: info.about.db_path },
          ]}
        />
        <div className="mt-3">
          <p className="mb-1 text-xs text-sb-text-muted">Storage Used</p>
          <ProgressBar value={info.stats.db_size_bytes} max={100 * 1024 * 1024} size="sm" />
        </div>
      </Card>

      {/* About */}
      <FieldSet legend="About">
        <DescriptionList
          items={[
            { label: 'Version', value: <Badge kind="info">v{info.about.version}</Badge> },
            { label: 'Node.js', value: info.about.node_version },
            { label: 'Platform', value: `${info.about.platform} (${info.about.arch})` },
            { label: 'Uptime', value: info.about.uptime },
            {
              label: 'Last Rate Fetch',
              value: info.health.last_rate_fetch
                ? new Date(info.health.last_rate_fetch).toLocaleString('en-GB')
                : 'Never',
            },
            {
              label: 'Last Schedule',
              value: info.health.last_schedule
                ? new Date(info.health.last_schedule).toLocaleString('en-GB')
                : 'Never',
            },
          ]}
        />
      </FieldSet>

      {/* More info */}
      <FieldSet legend="More Information">
        <div className="space-y-2 text-sm">
          <a
            href="https://solar-assistant.io/help"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sb-accent hover:underline"
          >
            <ExternalLink size={14} /> Solar Assistant Documentation
          </a>
          <a
            href="https://developer.octopus.energy/docs/api/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sb-accent hover:underline"
          >
            <ExternalLink size={14} /> Octopus Energy API
          </a>
        </div>
      </FieldSet>
    </div>
  );
}
