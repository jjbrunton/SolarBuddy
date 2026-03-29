'use client';

import { Card } from '@/components/ui/Card';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton } from '@/components/settings/shared';

export default function SettingsGeneralView() {
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Settings</h1>
      <SettingsTabs />

      <Card>
        <div className="space-y-4">
          <Field label="Default Work Mode" description="Mode to revert to after scheduled charging completes">
            <select
              className={inputClass}
              value={settings.default_work_mode}
              onChange={(e) => update('default_work_mode', e.target.value)}
            >
              <option value="Battery first">Battery first</option>
              <option value="Load first">Load first</option>
            </select>
          </Field>
          <Field label="Auto Schedule" description="Automatically run the scheduler daily to plan charge windows">
            <select
              className={inputClass}
              value={settings.auto_schedule}
              onChange={(e) => update('auto_schedule', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
        </div>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
