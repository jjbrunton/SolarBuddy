import type { Metadata } from 'next';
import SolarSettingsView from './SolarSettingsView';

export const metadata: Metadata = { title: 'Solar Forecast' };

export default function SolarSettingsPage() {
  return <SolarSettingsView />;
}
