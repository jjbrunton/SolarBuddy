'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { FieldSet } from '@/components/ui/FieldSet';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ConfigReadback } from '@/components/config/ConfigReadback';
import { useSSE } from '@/hooks/useSSE';
import { CheckCircle, XCircle, ExternalLink, Settings, Download } from 'lucide-react';

interface SystemInfo {
  health: {
    mqtt_connected: boolean;
    runtime_mode: 'real' | 'virtual';
    virtual_mode_active: boolean;
    virtual_scenario_name: string | null;
    rates_fresh: boolean;
    last_rate_fetch: string | null;
    last_schedule: string | null;
    scheduler_configured: boolean;
    auto_schedule_enabled: boolean;
    watchdog_enabled: boolean;
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

export default function SystemView({ initialInfo }: { initialInfo: SystemInfo | null }) {
  const [info] = useState<SystemInfo | null>(initialInfo);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { state } = useSSE();

  async function downloadExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/system/export');
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || `solarbuddy-export-${new Date().toISOString()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (!info) {
    return <Card><p className="text-sb-text-muted">Loading system information...</p></Card>;
  }

  return (
    <div className="space-y-6">
      {/* Health checks */}
      <Card>
        <CardHeader title="Health" subtitle="Core infrastructure checks for the broker, rates, and scheduler services." />
        <div className="space-y-2">
          <HealthCheck
            label={info.health.virtual_mode_active ? 'Virtual Runtime' : 'MQTT Connection'}
            ok={info.health.virtual_mode_active || info.health.mqtt_connected}
          />
          <HealthCheck label="Rate Data Fresh (< 24h)" ok={info.health.rates_fresh} />
          <HealthCheck
            label="Rates Available"
            ok={info.health.last_rate_fetch !== null}
          />
          <HealthCheck
            label="Scheduler Configured"
            ok={info.health.scheduler_configured}
          />
        </div>
      </Card>

      {/* Live Inverter Configuration (Tier 3 read-back) */}
      <Card>
        <CardHeader title="Live Inverter Configuration">
          <div className="flex items-center gap-1.5">
            <Settings size={14} className="text-sb-text-muted" />
            <span className="text-xs text-sb-text-muted">
              {info.health.virtual_mode_active ? 'Virtual runtime state' : 'Live from MQTT'}
            </span>
          </div>
        </CardHeader>
        <ConfigReadback state={state} />
      </Card>

      {/* Database stats */}
      <Card>
        <CardHeader title="Database" subtitle="Operational persistence footprint and record counts stored in SQLite." />
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

      {/* Data export */}
      <Card>
        <CardHeader
          title="Data Export"
          subtitle="Download a single JSON dump of scheduler settings, schedules, readings, and other telemetry tables for offline analysis. Connector credentials are redacted."
        />
        <div className="flex items-center gap-3">
          <Button onClick={downloadExport} disabled={exporting} size="sm">
            <Download size={14} />
            {exporting ? 'Preparing…' : 'Download export'}
          </Button>
          {exportError && (
            <span className="text-xs text-sb-danger">{exportError}</span>
          )}
        </div>
      </Card>

      {/* About */}
      <FieldSet legend="About">
        <DescriptionList
          items={[
            { label: 'Version', value: <Badge kind="info">v{info.about.version}</Badge> },
            {
              label: 'Runtime Mode',
              value: (
                <Badge kind={info.health.virtual_mode_active ? 'warning' : 'success'}>
                  {info.health.virtual_mode_active ? 'Virtual' : 'Real'}
                </Badge>
              ),
            },
            info.health.virtual_mode_active
              ? { label: 'Virtual Scenario', value: info.health.virtual_scenario_name || 'Unknown' }
              : null,
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
            {
              label: 'Auto Schedule',
              value: (
                <Badge kind={info.health.auto_schedule_enabled ? 'success' : 'default'}>
                  {info.health.auto_schedule_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              ),
            },
            {
              label: 'Inverter Watchdog',
              value: (
                <Badge kind={info.health.watchdog_enabled ? 'success' : 'default'}>
                  {info.health.watchdog_enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              ),
            },
          ].filter(Boolean) as { label: string; value: ReactNode }[]}
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
