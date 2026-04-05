'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TariffTicker } from './TariffTicker';
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
          <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

          <div className="relative flex flex-1 flex-col lg:ml-[240px]">
            <Header onMenuClick={() => setMobileOpen(true)} />
            <TariffTicker />
            <VirtualModeBanner />
            <TelemetryStatusBanner />
            <main className="relative flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-10">
              <div className="mx-auto max-w-[1280px]">{children}</div>
            </main>
          </div>
        </div>
      </SSEProvider>
    </ThemeProvider>
  );
}
