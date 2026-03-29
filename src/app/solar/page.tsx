import type { Metadata } from 'next';
import SolarView from './SolarView';

export const metadata: Metadata = { title: 'Solar Production' };

export default function SolarPage() {
  return <SolarView />;
}
