import type { Metadata } from 'next';
import SetupView from './SetupView';

export const metadata: Metadata = { title: 'Welcome to SolarBuddy' };

export default function SetupPage() {
  return <SetupView />;
}
