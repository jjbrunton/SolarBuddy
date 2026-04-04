'use client';

import { Badge } from '@/components/ui/Badge';
import { useSSE } from '@/hooks/useSSE';

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TelemetryStatusBanner() {
  const { connected, state, hasTelemetry, showingCachedTelemetry, cachedTelemetryAt } = useSSE();

  if (state.runtime_mode === 'virtual') {
    return null;
  }

  if (hasTelemetry && !showingCachedTelemetry) {
    return null;
  }

  let kind: 'info' | 'warning' = 'info';
  let title = 'Waiting for telemetry';
  let message = 'Live MQTT telemetry has not arrived yet.';

  if (showingCachedTelemetry) {
    kind = 'warning';
    title = 'Showing cached telemetry';
    message = 'Displaying the last known inverter values while SolarBuddy waits for fresh MQTT updates.';
  } else if (!connected) {
    kind = 'warning';
    message = 'The browser is reconnecting to the live update stream.';
  } else if (!state.mqtt_connected) {
    kind = 'warning';
    message = 'SolarBuddy is waiting for the MQTT broker connection before inverter data can appear.';
  } else {
    message = 'SolarBuddy is connected to MQTT but the inverter has not published telemetry yet.';
  }

  const timestamp = formatTimestamp(showingCachedTelemetry ? cachedTelemetryAt ?? state.last_updated : null);

  return (
    <div className="border-b border-sb-border bg-sb-card/65 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge kind={kind}>{title}</Badge>
            {timestamp ? <span className="text-xs text-sb-text-muted">Saved {timestamp}</span> : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-sb-text-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
