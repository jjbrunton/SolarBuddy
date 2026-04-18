'use client';

import { Menu, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { Badge } from '@/components/ui/Badge';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { connected, state } = useSSE();

  const now = new Date();
  const todayLabel = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const shortDateLabel = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });

  const inverterStatus =
    state.runtime_mode === 'virtual'
      ? { kind: 'warning' as const, text: `Virtual ${state.virtual_playback_state ?? 'mode'}` }
      : state.mqtt_connected
        ? { kind: 'info' as const, text: 'Inverter connected' }
        : { kind: 'warning' as const, text: 'Waiting for inverter' };

  return (
    <header className="sb-shell-panel sticky top-0 z-30 border-b border-sb-border bg-sb-header">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
        <button
          onClick={onMenuClick}
          className="shrink-0 border border-sb-border bg-transparent p-1.5 text-sb-text-muted transition-colors hover:border-sb-ember hover:text-sb-ember lg:hidden"
          aria-label="Open menu"
        >
          <Menu size={16} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[0.7rem] uppercase tracking-[0.08em] text-sb-text-muted sm:text-[0.75rem]">
              <span className="sm:hidden">{shortDateLabel}</span>
              <span className="hidden sm:inline">{todayLabel}</span>
            </span>
            <span className="hidden h-3 w-px bg-sb-rule-strong sm:inline-block" />
            <Badge kind={connected ? 'success' : 'warning'}>
              {connected ? 'Live' : 'Reconnecting'}
            </Badge>
            <Badge kind={inverterStatus.kind}>{inverterStatus.text}</Badge>
          </div>
        </div>

        <button
          onClick={toggle}
          className="shrink-0 border border-sb-border bg-transparent p-1.5 text-sb-text-muted transition-colors hover:border-sb-ember hover:text-sb-ember"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
