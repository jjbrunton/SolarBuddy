import type { Metadata } from 'next';
import EnergyFlowView from './EnergyFlowView';

export const metadata: Metadata = { title: 'Energy Flow' };

export default function EnergyFlowPage() {
  return <EnergyFlowView />;
}
