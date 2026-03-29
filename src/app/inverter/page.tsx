import type { Metadata } from 'next';
import InverterView from './InverterView';

export const metadata: Metadata = { title: 'Inverter' };

export default function InverterPage() {
  return <InverterView />;
}
