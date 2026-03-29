import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'SolarBuddy',
  description: 'Octopus Agile + Solar Assistant charging optimizer',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-sb-bg text-sb-text">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
