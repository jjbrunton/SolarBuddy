'use client';

import { Badge } from '@/components/ui/Badge';
import { useSSE } from '@/hooks/useSSE';

export function VirtualModeBanner() {
  const { state } = useSSE();

  if (state.runtime_mode !== 'virtual') {
    return null;
  }

  return (
    <div className="border-b border-sb-warning/20 bg-sb-warning/5 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge kind="warning">Virtual Inverter</Badge>
            {state.virtual_playback_state ? (
              <span className="text-[0.65rem] uppercase tracking-[0.14em] text-sb-text-subtle">
                {state.virtual_playback_state}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[0.75rem] leading-6 text-sb-text-muted">
            Running against synthetic telemetry. Real MQTT commands are blocked.
          </p>
        </div>
        {state.virtual_scenario_name ? (
          <p className="text-[0.75rem] text-sb-text">
            {state.virtual_scenario_name}
            {state.virtual_time ? ` // ${new Date(state.virtual_time).toLocaleString('en-GB')}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
