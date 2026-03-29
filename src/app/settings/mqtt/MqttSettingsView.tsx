'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton } from '@/components/settings/shared';

export default function MqttSettingsView() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Settings</h1>
      <SettingsTabs />

      <Card>
        <h3 className="mb-4 font-medium text-sb-text">Solar Assistant (MQTT)</h3>
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
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
