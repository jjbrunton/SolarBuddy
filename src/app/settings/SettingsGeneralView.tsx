'use client';

import { usePathname } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { useSettings, SettingsTabs, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function SettingsGeneralView() {
  const pathname = usePathname();
  const { settings, update, save, saving, message } = useSettings();

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="General settings"
        description="Set the default operating mode SolarBuddy should restore after managed charging and decide which background automation loops are active."
      />
      <SettingsTabs pathname={pathname} />

      <Card>
        <SettingsSection
          title="Automation defaults"
          description="These values shape the baseline operating behavior once scheduled windows complete."
        >
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
          <Field
            label="Inverter Watchdog"
            description="Periodically reconcile the inverter state against the active override or current plan slot. Disable this to stop background corrective commands."
          >
            <select
              className={inputClass}
              value={settings.watchdog_enabled}
              onChange={(e) => update('watchdog_enabled', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field
            label="Inverter Time Sync"
            description="Sync inverter clock daily at 03:00"
          >
            <select
              className={inputClass}
              value={settings.time_sync_enabled}
              onChange={(e) => update('time_sync_enabled', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field
            label="Tariff Change Monitor"
            description="Check daily at 06:00 for tariff changes and auto-update settings"
          >
            <select
              className={inputClass}
              value={settings.tariff_monitor_enabled}
              onChange={(e) => update('tariff_monitor_enabled', e.target.value)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
