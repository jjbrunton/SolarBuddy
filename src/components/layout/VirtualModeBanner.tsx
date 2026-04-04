'use client';

import { Badge } from '@/components/ui/Badge';
import { useSSE } from '@/hooks/useSSE';

export function VirtualModeBanner() {
  const { state } = useSSE();

  if (state.runtime_mode !== 'virtual') {
    return null;
  }

  return (
    <div className="border-b border-sb-border bg-sb-warning/10 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge kind="warning">Virtual Inverter</Badge>
            {state.virtual_playback_state ? (
              <span className="text-xs uppercase tracking-[0.14em] text-sb-text-subtle">
                {state.virtual_playback_state}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-sb-text-muted">
            SolarBuddy is running against scripted synthetic telemetry. Real MQTT inverter commands are blocked until virtual mode is disabled.
          </p>
        </div>
        {state.virtual_scenario_name ? (
          <p className="text-sm text-sb-text">
            {state.virtual_scenario_name}
            {state.virtual_time ? ` • ${new Date(state.virtual_time).toLocaleString('en-GB')}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
