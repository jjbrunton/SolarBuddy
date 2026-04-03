'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function MqttSettingsView() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="Solar Assistant broker"
          description="SolarBuddy listens to Solar Assistant MQTT topics for live inverter telemetry and command publishing."
        >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="MQTT Host" description="IP address of your Solar Assistant device">
            <input
              className={inputClass}
              value={settings.mqtt_host}
              onChange={(e) => update('mqtt_host', e.target.value)}
              placeholder="192.168.1.100"
            />
          </Field>
          <Field label="MQTT Port">
            <input
              className={inputClass}
              value={settings.mqtt_port}
              onChange={(e) => update('mqtt_port', e.target.value)}
            />
          </Field>
          <Field label="Username (optional)">
            <input
              className={inputClass}
              value={settings.mqtt_username}
              onChange={(e) => update('mqtt_username', e.target.value)}
            />
          </Field>
          <Field label="Password (optional)">
            <input
              className={inputClass}
              type="password"
              value={settings.mqtt_password}
              onChange={(e) => update('mqtt_password', e.target.value)}
            />
          </Field>
        </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
