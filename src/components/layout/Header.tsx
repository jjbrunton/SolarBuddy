'use client';

import { Menu, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { Badge } from '@/components/ui/Badge';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { connected, state } = useSSE();

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const inverterStatus =
    state.runtime_mode === 'virtual'
      ? { kind: 'warning' as const, text: `Virtual ${state.virtual_playback_state ?? 'mode'}` }
      : state.mqtt_connected
        ? { kind: 'info' as const, text: 'Inverter connected' }
        : { kind: 'warning' as const, text: 'Waiting for inverter' };

  return (
    <header className="sb-shell-panel sticky top-0 z-30 border-b border-sb-border bg-sb-header">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <button
          onClick={onMenuClick}
          className="border border-sb-border bg-transparent p-1.5 text-sb-text-muted transition-colors hover:border-sb-ember hover:text-sb-ember lg:hidden"
        >
          <Menu size={16} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.75rem] uppercase tracking-[0.08em] text-sb-text-muted">
              {todayLabel}
            </span>
            <span className="h-3 w-px bg-sb-rule-strong" />
            <Badge kind={connected ? 'success' : 'warning'}>
              {connected ? 'Live' : 'Reconnecting'}
            </Badge>
            <Badge kind={inverterStatus.kind}>{inverterStatus.text}</Badge>
          </div>
        </div>

        <button
          onClick={toggle}
          className="border border-sb-border bg-transparent p-1.5 text-sb-text-muted transition-colors hover:border-sb-ember hover:text-sb-ember"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
