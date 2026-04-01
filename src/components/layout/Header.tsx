'use client';

import { Menu, Sun, Moon, Activity, Radio } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { Badge } from '@/components/ui/Badge';

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { connected, state } = useSSE();

  return (
    <header className="sb-shell-panel sticky top-0 z-30 border-b border-sb-border bg-sb-header px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-xl border border-sb-border bg-sb-card p-2 text-sb-text-muted transition-colors hover:text-sb-text lg:hidden"
        >
          <Menu size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-sb-text-subtle">
            Energy Control
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-sb-text sm:text-base">SolarBuddy operations console</span>
            <Badge kind={connected ? 'success' : 'warning'}>
              {connected ? 'SSE online' : 'SSE reconnecting'}
            </Badge>
            <Badge kind={state.mqtt_connected ? 'info' : 'warning'}>
              {state.mqtt_connected ? 'MQTT live' : 'MQTT waiting'}
            </Badge>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-2xl border border-sb-border bg-sb-card px-3 py-2 text-xs text-sb-text-muted sm:flex">
          <Activity size={14} className="text-sb-accent" />
          <span>{state.device_mode || 'Awaiting inverter mode'}</span>
          <Radio size={14} className={state.mqtt_connected ? 'text-sb-success' : 'text-sb-warning'} />
        </div>

        <button
          onClick={toggle}
          className="rounded-xl border border-sb-border bg-sb-card p-2 text-sb-text-muted transition-colors hover:text-sb-text"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
