import type { Metadata } from 'next';
import ChargingSettingsView from './ChargingSettingsView';

export const metadata: Metadata = { title: 'Charging Settings' };

export default function ChargingSettingsPage() {
  return <ChargingSettingsView />;
}
