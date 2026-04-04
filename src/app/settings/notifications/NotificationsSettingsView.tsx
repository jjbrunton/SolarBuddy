'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useSettings, Field, inputClass, SaveButton, SettingsSection } from '@/components/settings/shared';

export default function NotificationsSettingsView() {
  const { settings, update, save, saving, message } = useSettings();
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ channel: string; ok: boolean; error?: string } | null>(null);

  if (!settings) return <Card><p className="text-sb-text-muted">Loading settings...</p></Card>;

  const sendTest = async (channel: 'discord' | 'telegram') => {
    setTestingChannel(channel);
    setTestResult(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      setTestResult({ channel, ok: data.ok, error: data.error });
    } catch (err) {
      setTestResult({ channel, ok: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setTestingChannel(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SettingsSection
          title="Notification events"
          description="Choose which events trigger notifications. You must also enable at least one channel below."
        >
          <div className="space-y-4">
            <Field label="State Change" description="Notify when the inverter transitions between charge, discharge, hold, or idle">
              <select
                className={inputClass}
                value={settings.notifications_state_change}
                onChange={(e) => update('notifications_state_change', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Battery Exhausted" description="Notify when battery SOC reaches the discharge floor">
              <select
                className={inputClass}
                value={settings.notifications_battery_exhausted}
                onChange={(e) => update('notifications_battery_exhausted', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Battery Charged" description="Notify when battery SOC reaches the charge target during a charge window">
              <select
                className={inputClass}
                value={settings.notifications_battery_charged}
                onChange={(e) => update('notifications_battery_charged', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Schedule Updated" description="Notify when a new charge/discharge schedule is generated">
              <select
                className={inputClass}
                value={settings.notifications_schedule_updated}
                onChange={(e) => update('notifications_schedule_updated', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
          </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Discord"
          description="Send notifications to a Discord channel via webhook. Create a webhook in your Discord server's channel settings."
        >
          <div className="space-y-4">
            <Field label="Enable Discord">
              <select
                className={inputClass}
                value={settings.notifications_discord_enabled}
                onChange={(e) => update('notifications_discord_enabled', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Webhook URL">
              <input
                className={inputClass}
                value={settings.notifications_discord_webhook_url}
                onChange={(e) => update('notifications_discord_webhook_url', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={testingChannel === 'discord' || settings.notifications_discord_enabled !== 'true' || !settings.notifications_discord_webhook_url}
                onClick={() => sendTest('discord')}
              >
                {testingChannel === 'discord' ? 'Sending...' : 'Send Test'}
              </Button>
              {testResult?.channel === 'discord' && (
                <span className={`text-sm ${testResult.ok ? 'text-sb-success' : 'text-sb-danger'}`}>
                  {testResult.ok ? 'Test sent successfully' : testResult.error}
                </span>
              )}
            </div>
          </div>
        </SettingsSection>
      </Card>

      <Card>
        <SettingsSection
          title="Telegram"
          description="Send notifications via a Telegram bot. Create a bot with @BotFather and get your chat ID from @userinfobot."
        >
          <div className="space-y-4">
            <Field label="Enable Telegram">
              <select
                className={inputClass}
                value={settings.notifications_telegram_enabled}
                onChange={(e) => update('notifications_telegram_enabled', e.target.value)}
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </Field>
            <Field label="Bot Token">
              <input
                className={inputClass}
                type="password"
                value={settings.notifications_telegram_bot_token}
                onChange={(e) => update('notifications_telegram_bot_token', e.target.value)}
                placeholder="123456:ABC-DEF..."
              />
            </Field>
            <Field label="Chat ID">
              <input
                className={inputClass}
                value={settings.notifications_telegram_chat_id}
                onChange={(e) => update('notifications_telegram_chat_id', e.target.value)}
                placeholder="-1001234567890"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={testingChannel === 'telegram' || settings.notifications_telegram_enabled !== 'true' || !settings.notifications_telegram_bot_token || !settings.notifications_telegram_chat_id}
                onClick={() => sendTest('telegram')}
              >
                {testingChannel === 'telegram' ? 'Sending...' : 'Send Test'}
              </Button>
              {testResult?.channel === 'telegram' && (
                <span className={`text-sm ${testResult.ok ? 'text-sb-success' : 'text-sb-danger'}`}>
                  {testResult.ok ? 'Test sent successfully' : testResult.error}
                </span>
              )}
            </div>
          </div>
        </SettingsSection>
      </Card>

      <SaveButton saving={saving} message={message} onSave={save} />
    </div>
  );
}
