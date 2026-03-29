import type { Metadata } from 'next';
import SettingsGeneralView from './SettingsGeneralView';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <SettingsGeneralView />;
}
