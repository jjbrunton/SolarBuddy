import type { Metadata } from 'next';
import CarbonView from './CarbonView';

export const metadata: Metadata = { title: 'Carbon Intensity' };

export default function CarbonPage() {
  return <CarbonView />;
}
