import type { Metadata } from 'next';
import RateTrendsView from './RateTrendsView';

export const metadata: Metadata = { title: 'Rate Trends' };

export default function RateTrendsPage() {
  return <RateTrendsView />;
}
