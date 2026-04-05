import type { Metadata } from 'next';
import UsageView from './UsageView';

export const metadata: Metadata = { title: 'Usage Profile' };

export default function UsagePage() {
  return <UsageView />;
}
