import type { Metadata } from 'next';
import TariffComparisonView from './TariffComparisonView';

export const metadata: Metadata = { title: 'Tariff Comparison' };

export default function TariffComparisonPage() {
  return <TariffComparisonView />;
}
