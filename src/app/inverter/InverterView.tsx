'use client';

import { useSSE } from '@/hooks/useSSE';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FieldSet } from '@/components/ui/FieldSet';
import { DescriptionList } from '@/components/ui/DescriptionList';
import { TemperatureIndicator } from '@/components/inverter/TemperatureIndicator';
import { ConfigReadback } from '@/components/config/ConfigReadback';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { AnimatedGauge } from '@/components/ui/AnimatedGauge';
import { useEffect, useState } from 'react';

interface Settings {
  mqtt_host: string;
  mqtt_port: string;
}

export default function InverterView() {
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

      {/* Status overview — row 1 */}
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

      {/* Status overview — row 2 (new Tier 1 data) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-sb-text-muted">Device Mode</p>
              <div className="mt-2">
                <StatusIndicator label="" value={state.device_mode} size="md" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Battery Voltage</p>
          <p className="mt-1 text-2xl font-bold text-sb-text">
            {state.battery_voltage != null ? `${state.battery_voltage}V` : '\u2014'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Grid Voltage</p>
          <p className="mt-1 text-2xl font-bold text-sb-text">
            {state.grid_voltage != null ? `${state.grid_voltage}V` : '\u2014'}
          </p>
          {state.grid_frequency != null && (
            <p className="mt-1 text-xs text-sb-text-muted">{state.grid_frequency}Hz</p>
          )}
        </Card>
      </div>

      {/* Animated gauges row */}
      <Card>
        <CardHeader title="System Gauges" />
        <div className="flex flex-wrap items-center justify-around gap-4">
          <AnimatedGauge
            value={state.battery_soc}
            min={0}
            max={100}
            unit="%"
            label="Battery SOC"
            thresholds={[
              { value: 0, color: '#f05050' },
              { value: 20, color: '#ff902b' },
              { value: 40, color: '#5d9cec' },
              { value: 80, color: '#27c24c' },
            ]}
          />
          <AnimatedGauge
            value={state.battery_voltage}
            min={44}
            max={58}
            unit="V"
            label="Battery Voltage"
            thresholds={[
              { value: 0, color: '#f05050' },
              { value: 47, color: '#ff902b' },
              { value: 50, color: '#5d9cec' },
              { value: 54, color: '#27c24c' },
            ]}
          />
          <AnimatedGauge
            value={state.grid_voltage}
            min={200}
            max={260}
            unit="V"
            label="Grid Voltage"
            thresholds={[
              { value: 0, color: '#f05050' },
              { value: 215, color: '#ff902b' },
              { value: 225, color: '#27c24c' },
              { value: 250, color: '#ff902b' },
            ]}
          />
          <AnimatedGauge
            value={state.grid_frequency}
            min={49}
            max={51}
            unit="Hz"
            label="Grid Frequency"
            thresholds={[
              { value: 0, color: '#f05050' },
              { value: 49.5, color: '#ff902b' },
              { value: 49.8, color: '#27c24c' },
              { value: 50.3, color: '#ff902b' },
            ]}
          />
        </div>
      </Card>

      {/* Temperature section */}
      <div className="grid gap-3 sm:grid-cols-2">
        <TemperatureIndicator
          label="Inverter Temperature"
          value={state.inverter_temperature}
          warnAt={45}
          dangerAt={55}
        />
        <TemperatureIndicator
          label="Battery Temperature"
          value={state.battery_temperature}
          warnAt={35}
          dangerAt={45}
          max={60}
        />
      </div>

      {/* Live Readings */}
      <Card>
        <CardHeader title="Live Readings" />
        <DescriptionList
          items={[
            { label: 'PV (Solar) Power', value: state.pv_power != null ? `${state.pv_power} W` : '\u2014' },
            { label: 'Grid Power', value: state.grid_power != null ? `${state.grid_power} W` : '\u2014' },
            { label: 'Grid Voltage', value: state.grid_voltage != null ? `${state.grid_voltage} V` : '\u2014' },
            { label: 'Grid Frequency', value: state.grid_frequency != null ? `${state.grid_frequency} Hz` : '\u2014' },
            { label: 'Load Power', value: state.load_power != null ? `${state.load_power} W` : '\u2014' },
            {
              label: 'Battery Power',
              value:
                state.battery_power != null
                  ? `${state.battery_power > 0 ? '+' : ''}${state.battery_power} W ${state.battery_power > 0 ? '(charging)' : state.battery_power < 0 ? '(discharging)' : '(idle)'}`
                  : '\u2014',
            },
            { label: 'Battery SOC', value: soc != null ? `${soc}%` : '\u2014' },
            { label: 'Battery Voltage', value: state.battery_voltage != null ? `${state.battery_voltage} V` : '\u2014' },
            { label: 'Battery Temperature', value: state.battery_temperature != null ? `${state.battery_temperature} °C` : '\u2014' },
            { label: 'Inverter Temperature', value: state.inverter_temperature != null ? `${state.inverter_temperature} °C` : '\u2014' },
            { label: 'Bus Voltage', value: state.bus_voltage != null ? `${state.bus_voltage} V` : '\u2014' },
            { label: 'Device Mode', value: state.device_mode || '\u2014' },
            { label: 'Work Mode', value: state.work_mode || '\u2014' },
            {
              label: 'Last Updated',
              value: state.last_updated ? new Date(state.last_updated).toLocaleTimeString('en-GB') : '\u2014',
            },
          ]}
        />
      </Card>

      {/* Configuration Read-back (Tier 3) */}
      <Card>
        <CardHeader title="Inverter Configuration">
          <span className="text-xs text-sb-text-muted">Live from MQTT</span>
        </CardHeader>
        <ConfigReadback state={state} />
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
