'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

interface HomeAssistantStatusResponse {
  enabled: boolean;
  connected: boolean;
  host: string | null;
  lastError: string | null;
  publishedEntities: number;
  connectAttemptedAt: string | null;
  connectedAt: string | null;
  awaitingConnect: boolean;
}

export default function HomeAssistantSettingsView() {
  const { settings, update, save, saving, message } = useSettings();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [status, setStatus] = useState<HomeAssistantStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/home-assistant/status');
        const data = (await res.json()) as HomeAssistantStatusResponse;
        if (!cancelled) setStatus(data);
      } catch {
        // ignore — status card shows stale/empty state
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!settings) {
    return (
      <Card>
        <p className="text-sb-text-muted">Loading settings...</p>
      </Card>
    );
  }

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/home-assistant/test', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  const canTest = settings.homeassistant_enabled === 'true' && !!settings.homeassistant_host;

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="Home Assistant"
          description="Publish SolarBuddy state and controls to Home Assistant via MQTT Discovery. Use a separate broker from the Solar Assistant MQTT connection — for example the Mosquitto add-on running alongside Home Assistant."
        >
          <div className="space-y-4">
            <Field label="Enable Home Assistant Integration">
              <select
                className={inputClass}
                value={settings.homeassistant_enabled}
                onChange={(e) => update('homeassistant_enabled', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Broker Host" description="Hostname or IP of the MQTT broker Home Assistant is connected to.">
              <input
                className={inputClass}
                value={settings.homeassistant_host}
                onChange={(e) => update('homeassistant_host', e.target.value)}
                placeholder="192.168.1.10"
              />
            </Field>
            <Field label="Broker Port">
              <input
                className={inputClass}
                value={settings.homeassistant_port}
                onChange={(e) => update('homeassistant_port', e.target.value)}
                placeholder="1883"
              />
            </Field>
            <Field label="Username" description="Optional. Leave blank for anonymous brokers.">
              <input
                className={inputClass}
                value={settings.homeassistant_username}
                onChange={(e) => update('homeassistant_username', e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                value={settings.homeassistant_password}
                onChange={(e) => update('homeassistant_password', e.target.value)}
              />
            </Field>
            <Field label="Base Topic" description="Prefix for SolarBuddy's own state and command topics. Cannot be 'homeassistant'.">
              <input
                className={inputClass}
                value={settings.homeassistant_base_topic}
                onChange={(e) => update('homeassistant_base_topic', e.target.value)}
                placeholder="solarbuddy"
              />
            </Field>
            <Field label="Discovery Prefix" description="Home Assistant discovery prefix. Match whatever you configured in the HA MQTT integration — default is 'homeassistant'.">
              <input
                className={inputClass}
                value={settings.homeassistant_discovery_prefix}
                onChange={(e) => update('homeassistant_discovery_prefix', e.target.value)}
                placeholder="homeassistant"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={!canTest || testing} onClick={sendTest}>
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
              {testResult && (
                <span className={`text-sm ${testResult.ok ? 'text-sb-success' : 'text-sb-danger'}`}>
                  {testResult.ok ? 'Connection OK' : testResult.error}
                </span>
              )}
            </div>
          </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Publisher Status"
          description="Live status of the Home Assistant publisher. Refreshes every few seconds."
        >
          {status ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-sb-text-muted">Enabled</dt>
              <dd className="text-sb-text">{status.enabled ? 'Yes' : 'No'}</dd>
              <dt className="text-sb-text-muted">Connected</dt>
              <dd className={status.connected ? 'text-sb-success' : 'text-sb-danger'}>
                {status.connected ? 'Yes' : status.awaitingConnect ? 'Connecting…' : 'No'}
              </dd>
              <dt className="text-sb-text-muted">Host</dt>
              <dd className="text-sb-text">{status.host ?? '—'}</dd>
              <dt className="text-sb-text-muted">Entities published</dt>
              <dd className="text-sb-text">{status.publishedEntities}</dd>
              <dt className="text-sb-text-muted">Last connect attempt</dt>
              <dd className="text-sb-text">{status.connectAttemptedAt ?? '—'}</dd>
              <dt className="text-sb-text-muted">Last connected</dt>
              <dd className="text-sb-text">{status.connectedAt ?? '—'}</dd>
              <dt className="text-sb-text-muted">Last error</dt>
              <dd className="text-sb-text">{status.lastError ?? 'None'}</dd>
            </dl>
          ) : (
            <p className="text-sb-text-muted">Loading status...</p>
          )}
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
