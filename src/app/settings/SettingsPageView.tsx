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
import SettingsVirtualInverterView from './SettingsVirtualInverterView';
import NotificationsSettingsView from './notifications/NotificationsSettingsView';
import HomeAssistantSettingsView from './home-assistant/HomeAssistantSettingsView';

// Settings used to render eight flat tabs in a single row. That exposed
// every setting at once and forced the user to guess which bucket anything
// lived in. This two-level structure groups related settings and hides
// sub-tabs when a group only has one view.
interface SettingSubView {
  label: string;
  value: string;
  component: React.ComponentType;
}

interface SettingGroup {
  label: string;
  value: string;
  subViews: SettingSubView[];
}

const GROUPS: SettingGroup[] = [
  {
    label: 'General',
    value: 'general',
    subViews: [
      { label: 'General', value: 'general', component: SettingsGeneralView },
    ],
  },
  {
    label: 'Connections',
    value: 'connections',
    subViews: [
      { label: 'MQTT', value: 'mqtt', component: MqttSettingsView },
      { label: 'Octopus Energy', value: 'octopus', component: OctopusSettingsView },
      { label: 'Notifications', value: 'notifications', component: NotificationsSettingsView },
      { label: 'Home Assistant', value: 'home-assistant', component: HomeAssistantSettingsView },
    ],
  },
  {
    label: 'Battery & Solar',
    value: 'battery',
    subViews: [
      { label: 'Charging', value: 'charging', component: ChargingSettingsView },
      { label: 'Solar Forecast', value: 'solar', component: SolarSettingsView },
      { label: 'Virtual Inverter', value: 'virtual', component: SettingsVirtualInverterView },
    ],
  },
  {
    label: 'Automation',
    value: 'automation',
    subViews: [
      { label: 'Scheduled Actions', value: 'actions', component: ScheduledActionsView },
    ],
  },
];

const GROUP_TABS = GROUPS.map((group) => ({ label: group.label, value: group.value }));

export default function SettingsPageView() {
  const [groupValue, setGroupValue] = useState(GROUPS[0].value);
  const [subValue, setSubValue] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const group of GROUPS) defaults[group.value] = group.subViews[0].value;
    return defaults;
  });

  const activeGroup = GROUPS.find((g) => g.value === groupValue) ?? GROUPS[0];
  const activeSub =
    activeGroup.subViews.find((s) => s.value === subValue[activeGroup.value]) ?? activeGroup.subViews[0];
  const ActiveComponent = activeSub.component;

  const showSubTabs = activeGroup.subViews.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Configure SolarBuddy's connections, tariff, charging strategy, and automation rules."
      />

      {/* Each tab bar is wrapped in its own block so that the inline-flex
          SegmentedTabs component doesn't flow the group tabs and sub-tabs
          onto the same visual row. */}
      <div>
        <SegmentedTabs items={GROUP_TABS} activeValue={groupValue} onChange={setGroupValue} />
      </div>

      {showSubTabs && (
        <div>
          <SegmentedTabs
            items={activeGroup.subViews.map((s) => ({ label: s.label, value: s.value }))}
            activeValue={activeSub.value}
            onChange={(value) => setSubValue((prev) => ({ ...prev, [activeGroup.value]: value }))}
          />
        </div>
      )}

      <ActiveComponent />
    </div>
  );
}
