import type { Metadata } from 'next';
import SettingsPageView from './SettingsPageView';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return <SettingsPageView />;
}
