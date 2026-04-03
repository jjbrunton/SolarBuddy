import type { Metadata } from 'next';
import AccountingView from './AccountingView';

export const metadata: Metadata = { title: 'Cost & Profit' };

export default function AccountingPage() {
  return <AccountingView />;
}
