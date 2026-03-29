import type { Metadata } from 'next';
import MqttSettingsView from './MqttSettingsView';

export const metadata: Metadata = { title: 'MQTT Settings' };

export default function MqttSettingsPage() {
  return <MqttSettingsView />;
}
