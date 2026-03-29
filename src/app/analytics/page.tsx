import type { Metadata } from 'next';
import SavingsView from './SavingsView';

export const metadata: Metadata = { title: 'Cost Savings' };

export default function SavingsPage() {
  return <SavingsView />;
}
