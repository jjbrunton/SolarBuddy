import type { Metadata } from 'next';
import OctopusSettingsView from './OctopusSettingsView';

export const metadata: Metadata = { title: 'Octopus Energy' };

export default function OctopusSettingsPage() {
  return <OctopusSettingsView />;
}
