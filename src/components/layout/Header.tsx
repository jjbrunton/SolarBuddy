'use client';

import { Menu, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { Badge } from '@/components/ui/Badge';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { connected, state } = useSSE();

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  // Inverter connection status — three states: virtual playback, live MQTT, or
  // waiting for a connection. The label is written for an operator glance, not
  // the protocol name.
  const inverterStatus =
    state.runtime_mode === 'virtual'
      ? { kind: 'warning' as const, text: `Virtual ${state.virtual_playback_state ?? 'mode'}` }
      : state.mqtt_connected
        ? { kind: 'info' as const, text: 'Inverter connected' }
        : { kind: 'warning' as const, text: 'Waiting for inverter' };

  return (
    <header className="sb-shell-panel sticky top-0 z-30 border-b border-sb-rule bg-sb-header">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button
          onClick={onMenuClick}
          className="rounded-lg border border-sb-rule bg-transparent p-2 text-sb-text-muted transition-colors hover:border-sb-ember/60 hover:text-sb-ember lg:hidden"
        >
          <Menu size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sb-display text-lg text-sb-text sm:text-xl">{todayLabel}</span>
            <span className="h-3 w-px bg-sb-rule" />
            <Badge kind={connected ? 'success' : 'warning'}>
              {connected ? 'Live' : 'Reconnecting…'}
            </Badge>
            <Badge kind={inverterStatus.kind}>{inverterStatus.text}</Badge>
          </div>
        </div>

        <button
          onClick={toggle}
          className="rounded-lg border border-sb-rule bg-transparent p-2 text-sb-text-muted transition-colors hover:border-sb-ember/60 hover:text-sb-ember"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
