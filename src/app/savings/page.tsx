import type { Metadata } from 'next';
import SavingsPageView from './SavingsPageView';

export const metadata: Metadata = { title: 'Savings' };

export default function SavingsPage() {
  return <SavingsPageView />;
}
