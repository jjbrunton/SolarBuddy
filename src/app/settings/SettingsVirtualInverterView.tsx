'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass, SaveButton, SettingsSection, useSettings } from '@/components/settings/shared';

interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  purpose: string;
  defaultStartSoc: number;
}

interface RuntimeStatus {
  enabled: boolean;
  scenarioId: string;
  scenarioName: string | null;
  playbackState: 'stopped' | 'running' | 'paused';
  speed: string;
  virtualTime: string | null;
  startSoc: number;
  loadMultiplier: number;
}

export default function SettingsVirtualInverterView() {
  const { settings, update, persistSettings, saving, message } = useSettings();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [startSoc, setStartSoc] = useState(50);
  const [loadMultiplier, setLoadMultiplier] = useState(1);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshRuntime() {
    const [runtimeRes, scenariosRes] = await Promise.all([
      fetch('/api/virtual-inverter'),
      fetch('/api/virtual-inverter/scenarios'),
    ]);
    const runtimeJson = await runtimeRes.json();
    const scenariosJson = await scenariosRes.json();
    setRuntime(runtimeJson);
    setScenarios(scenariosJson.scenarios || []);
    if (runtimeJson.startSoc != null) {
      setStartSoc(runtimeJson.startSoc);
    }
    if (runtimeJson.loadMultiplier != null) {
      setLoadMultiplier(runtimeJson.loadMultiplier);
    }
  }

  useEffect(() => {
    void refreshRuntime();
  }, []);

  useEffect(() => {
    if (!settings) return;
    const selected = scenarios.find((scenario) => scenario.id === settings.virtual_scenario_id);
    if (selected && startSoc === 50) {
      setStartSoc(selected.defaultStartSoc);
    }
  }, [scenarios, settings, startSoc]);

  if (!settings) {
    return <Card><p className="text-sb-text-muted">Loading virtual inverter settings...</p></Card>;
  }

  const saveSettingsAndRefresh = async (successMessage?: string) => {
    const result = await persistSettings(settings, successMessage);
    if (result.ok) {
      await refreshRuntime();
    }
    return result;
  };

  const sendControl = async (action: 'start' | 'pause' | 'reset' | 'disable') => {
    setBusy(true);
    setControlMessage(null);
    try {
      if (action !== 'disable') {
        const persisted = await saveSettingsAndRefresh('Virtual inverter settings saved.');
        if (!persisted.ok) {
          setBusy(false);
          return;
        }
      }

      const response = await fetch('/api/virtual-inverter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          scenarioId: settings.virtual_scenario_id,
          speed: settings.virtual_speed,
          startSoc,
          loadMultiplier,
        }),
      });
      const json = await response.json();
      setRuntime(json);
      setControlMessage(
        action === 'start'
          ? 'Virtual inverter running.'
          : action === 'pause'
            ? 'Virtual inverter paused.'
            : action === 'reset'
              ? 'Virtual inverter reset to the scenario start.'
              : 'Virtual inverter disabled.',
      );
    } catch {
      setControlMessage('Failed to update the virtual inverter runtime.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="Virtual Inverter Mode"
          description="Switch SolarBuddy into a safe synthetic runtime. While enabled, live MQTT commands are blocked and the app reads from the selected preset scenario instead."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field
              label="Virtual Mode"
              description="Enable the sandbox runtime for the whole SolarBuddy instance."
            >
              <select
                className={inputClass}
                value={settings.virtual_mode_enabled}
                onChange={(e) => update('virtual_mode_enabled', e.target.value)}
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </Field>

            <Field
              label="Playback Speed"
              description="Controls how quickly the virtual clock advances while a scenario is running."
            >
              <select
                className={inputClass}
                value={settings.virtual_speed}
                onChange={(e) => update('virtual_speed', e.target.value)}
              >
                <option value="1x">1 minute / second</option>
                <option value="6x">6 minutes / second</option>
                <option value="30x">30 minutes / second</option>
              </select>
            </Field>

            <Field
              label="Scenario"
              description="Choose the scripted inverter behavior and tariff profile to test."
            >
              <select
                className={inputClass}
                value={settings.virtual_scenario_id}
                onChange={(e) => update('virtual_scenario_id', e.target.value)}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>{scenario.name}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Starting SOC (%)"
              description="Override the scenario’s default starting battery level for the next start or reset."
            >
              <input
                className={inputClass}
                type="number"
                min="0"
                max="100"
                value={startSoc}
                onChange={(e) => setStartSoc(Number(e.target.value))}
              />
            </Field>

            <Field
              label="Load Multiplier"
              description="Scale the scripted household load to make the scenario lighter or heavier."
            >
              <input
                className={inputClass}
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                value={loadMultiplier}
                onChange={(e) => setLoadMultiplier(Number(e.target.value))}
              />
            </Field>
          </div>

          {runtime ? (
            <div className="rounded-2xl border border-sb-border bg-sb-bg px-4 py-4">
              <p className="text-sm font-medium text-sb-text">
                Runtime: {runtime.enabled ? 'Virtual' : 'Real'} / {runtime.playbackState}
              </p>
              <p className="mt-1 text-sm text-sb-text-muted">
                {runtime.scenarioName ?? 'No scenario selected'}
                {runtime.virtualTime ? ` • ${new Date(runtime.virtualTime).toLocaleString('en-GB')}` : ''}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => sendControl('start')} disabled={busy || saving || settings.virtual_mode_enabled !== 'true'}>
              Start
            </Button>
            <Button variant="secondary" onClick={() => sendControl('pause')} disabled={busy || !runtime?.enabled}>
              Pause
            </Button>
            <Button variant="secondary" onClick={() => sendControl('reset')} disabled={busy || !runtime?.enabled}>
              Reset
            </Button>
            <Button variant="ghost" onClick={() => sendControl('disable')} disabled={busy || !runtime?.enabled}>
              Disable Runtime
            </Button>
          </div>

          {controlMessage ? <p className="text-sm text-sb-text-muted">{controlMessage}</p> : null}
        </SettingsSection>
      </Card>

      <SaveButton
        saving={saving}
        message={message}
        onSave={() => { void saveSettingsAndRefresh('Virtual inverter settings saved.'); }}
      />
    </div>
  );
}
