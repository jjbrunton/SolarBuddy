'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedTabs } from '@/components/ui/Tabs';
import SettingsGeneralView from './SettingsGeneralView';
import MqttSettingsView from './mqtt/MqttSettingsView';
import OctopusSettingsView from './octopus/OctopusSettingsView';
import ChargingSettingsView from './charging/ChargingSettingsView';
import SolarSettingsView from './solar/SolarSettingsView';
import ScheduledActionsView from './scheduled-actions/ScheduledActionsView';

const TABS = [
  { label: 'General', value: 'general' },
  { label: 'MQTT', value: 'mqtt' },
  { label: 'Octopus Energy', value: 'octopus' },
  { label: 'Charging', value: 'charging' },
  { label: 'Solar Forecast', value: 'solar' },
  { label: 'Scheduled Actions', value: 'actions' },
];

export default function SettingsPageView() {
  const [tab, setTab] = useState('general');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure SolarBuddy's connections, tariff, charging strategy, and automation rules."
      />

      <SegmentedTabs items={TABS} activeValue={tab} onChange={setTab} />

      {tab === 'general' && <SettingsGeneralView />}
      {tab === 'mqtt' && <MqttSettingsView />}
      {tab === 'octopus' && <OctopusSettingsView />}
      {tab === 'charging' && <ChargingSettingsView />}
      {tab === 'solar' && <SolarSettingsView />}
      {tab === 'actions' && <ScheduledActionsView />}
    </div>
  );
}
