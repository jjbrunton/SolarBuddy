'use client';

import { useSSE } from '@/hooks/useSSE';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FieldSet } from '@/components/ui/FieldSet';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { useEffect, useState } from 'react';

interface Settings {
  mqtt_host: string;
  mqtt_port: string;
}

export default function InverterPage() {
  const { state, connected } = useSSE();
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);

  const soc = state.battery_soc;
  const socColor =
    soc === null
      ? 'text-sb-text-muted'
      : soc >= 80
        ? 'text-sb-success'
        : soc >= 40
          ? 'text-sb-accent'
          : soc >= 20
            ? 'text-sb-warning'
            : 'text-sb-danger';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Inverter</h1>

      {/* Status overview */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-sb-text-muted">Connection</p>
          <div className="mt-2">
            <Badge kind={state.mqtt_connected ? 'success' : 'danger'}>
              {state.mqtt_connected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Work Mode</p>
          <p className="mt-1 text-lg font-bold text-sb-text">{state.work_mode || '\u2014'}</p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Battery SOC</p>
          <p className={`mt-1 text-3xl font-bold ${socColor}`}>
            {soc !== null ? `${soc}%` : '\u2014'}
          </p>
          {soc !== null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sb-border">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  soc >= 80
                    ? 'bg-sb-success'
                    : soc >= 40
                      ? 'bg-sb-accent'
                      : soc >= 20
                        ? 'bg-sb-warning'
                        : 'bg-sb-danger'
                }`}
                style={{ width: `${soc}%` }}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Current readings */}
      <Card>
        <CardHeader title="Live Readings" />
        <DescriptionList
          items={[
            { label: 'PV (Solar) Power', value: state.pv_power !== null ? `${state.pv_power} W` : '\u2014' },
            { label: 'Grid Power', value: state.grid_power !== null ? `${state.grid_power} W` : '\u2014' },
            { label: 'Load Power', value: state.load_power !== null ? `${state.load_power} W` : '\u2014' },
            {
              label: 'Battery Power',
              value:
                state.battery_power !== null
                  ? `${state.battery_power > 0 ? '+' : ''}${state.battery_power} W ${state.battery_power > 0 ? '(charging)' : state.battery_power < 0 ? '(discharging)' : '(idle)'}`
                  : '\u2014',
            },
            { label: 'Battery SOC', value: soc !== null ? `${soc}%` : '\u2014' },
            { label: 'Work Mode', value: state.work_mode || '\u2014' },
            {
              label: 'Last Updated',
              value: state.last_updated ? new Date(state.last_updated).toLocaleTimeString('en-GB') : '\u2014',
            },
          ]}
        />
      </Card>

      {/* Connection info */}
      <Card>
        <CardHeader title="Connection Details" />
        <DescriptionList
          items={[
            { label: 'MQTT Broker', value: settings ? `${settings.mqtt_host}:${settings.mqtt_port}` : 'Loading...' },
            {
              label: 'MQTT Status',
              value: (
                <Badge kind={state.mqtt_connected ? 'success' : 'danger'}>
                  {state.mqtt_connected ? 'Connected' : 'Disconnected'}
                </Badge>
              ),
            },
            {
              label: 'SSE Stream',
              value: (
                <Badge kind={connected ? 'success' : 'warning'}>
                  {connected ? 'Live' : 'Reconnecting'}
                </Badge>
              ),
            },
          ]}
        />
      </Card>

      {/* Work mode explanation */}
      <FieldSet legend="Work Modes Explained">
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-sb-text">Battery First</p>
            <p className="text-sb-text-muted">
              Prioritizes battery usage. Discharges battery to power loads before drawing from grid.
              Best for maximizing self-consumption during peak rate hours.
            </p>
          </div>
          <div>
            <p className="font-medium text-sb-text">Load First</p>
            <p className="text-sb-text-muted">
              Solar powers loads directly, excess charges the battery. Battery only discharges when solar
              is insufficient. Best general-purpose mode for daily use.
            </p>
          </div>
          <div>
            <p className="font-medium text-sb-text">Grid First</p>
            <p className="text-sb-text-muted">
              Forces charging from grid. Used during cheap rate windows (e.g., Agile negative/low rates)
              to fill the battery for later use.
            </p>
          </div>
        </div>
      </FieldSet>
    </div>
  );
}
