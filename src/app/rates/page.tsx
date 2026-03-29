import type { Metadata } from 'next';
import RatesView from './RatesView';

export const metadata: Metadata = { title: 'Energy Rates' };

export default function RatesPage() {
  return <RatesView />;
}
