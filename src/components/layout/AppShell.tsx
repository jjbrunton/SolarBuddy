'use client';

import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
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
        <div className="flex min-h-screen bg-sb-bg">
          <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

          {/* Main content */}
          <div className="flex flex-1 flex-col lg:ml-[220px]">
            <Header onMenuClick={() => setMobileOpen(true)} />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </SSEProvider>
    </ThemeProvider>
  );
}
