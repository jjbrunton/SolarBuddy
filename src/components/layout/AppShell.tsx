'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TelemetryStatusBanner } from './TelemetryStatusBanner';
import { VirtualModeBanner } from './VirtualModeBanner';
import { ThemeProvider } from '@/hooks/useTheme';
import { SSEProvider } from '@/hooks/useSSE';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <ThemeProvider>
      <SSEProvider>
        <div className="relative flex min-h-screen bg-sb-bg">
          <div className="sb-grid-overlay pointer-events-none absolute inset-0 opacity-50" />
          <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

          <div className="relative flex flex-1 flex-col lg:ml-[260px]">
            <Header onMenuClick={() => setMobileOpen(true)} />
            <VirtualModeBanner />
            <TelemetryStatusBanner />
            <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </SSEProvider>
    </ThemeProvider>
  );
}
