import type { Metadata } from 'next';
import BatteryHealthView from './BatteryHealthView';

export const metadata: Metadata = { title: 'Battery Health' };

export default function BatteryHealthPage() {
  return <BatteryHealthView />;
}
