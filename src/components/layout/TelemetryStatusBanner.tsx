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
    message = 'Displaying last known inverter values while waiting for fresh MQTT updates.';
  } else if (!connected) {
    kind = 'warning';
    message = 'Reconnecting to the live update stream.';
  } else if (!state.mqtt_connected) {
    kind = 'warning';
    message = 'Waiting for MQTT broker connection.';
  } else {
    message = 'Connected to MQTT. Awaiting inverter telemetry.';
  }

  const timestamp = formatTimestamp(showingCachedTelemetry ? cachedTelemetryAt ?? state.last_updated : null);

  return (
    <div className="border-b border-sb-border bg-sb-card/50 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge kind={kind}>{title}</Badge>
            {timestamp ? <span className="text-[0.65rem] text-sb-text-muted">Saved {timestamp}</span> : null}
          </div>
          <p className="mt-2 text-[0.75rem] leading-6 text-sb-text-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
