'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ACTION_BADGE_KIND, ACTION_LABELS, type PlanAction } from '@/lib/plan-actions';
import { useSSE } from '@/hooks/useSSE';

interface CurrentAction {
  action: PlanAction;
  source: string;
  reason: string;
  detail: string;
  slotStart?: string;
  slotEnd?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual override',
  auto: 'Automatic override',
  scheduled: 'Scheduled action',
  plan: 'Planned slot',
  target_soc: 'Target SOC hold',
  solar_surplus: 'Solar surplus hold',
  default: 'Default hold',
};

function formatTimeRange(startIso?: string, endIso?: string): string | null {
  if (!startIso || !endIso) return null;
  const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const start = new Date(startIso).toLocaleTimeString('en-GB', timeFormat);
  const end = new Date(endIso).toLocaleTimeString('en-GB', timeFormat);
  return `${start} - ${end}`;
}

function formatRemainingTime(endIso?: string, now?: Date): string | null {
  if (!endIso || !now) return null;
  const remainingMs = new Date(endIso).getTime() - now.getTime();
  if (remainingMs <= 0) return 'Slot end reached';

  const totalMinutes = Math.ceil(remainingMs / 60000);
  if (totalMinutes < 60) {
    return `Ends in ${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `Ends in ${hours}h`;
  }
  return `Ends in ${hours}h ${minutes}m`;
}

function getSourceLabel(source?: string): string {
  if (!source) return 'Scheduler';
  return SOURCE_LABELS[source] ?? source;
}

export default function CurrentModeWidget() {
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );
  const [currentAction, setCurrentAction] = useState<CurrentAction | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/schedule');
        const payload = await response.json();
        if (cancelled) return;
        setCurrentAction(payload.current_action ?? null);
        setLoadError(false);
      } catch {
        if (cancelled) return;
        setLoadError(true);
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const modeLabel = currentAction ? ACTION_LABELS[currentAction.action] : 'Unknown';
  const rangeLabel = formatTimeRange(currentAction?.slotStart, currentAction?.slotEnd);
  const remainingLabel = formatRemainingTime(currentAction?.slotEnd, effectiveNow);

  return (
    <Card>
      <CardHeader title="Current Mode">
        <Badge kind={currentAction ? ACTION_BADGE_KIND[currentAction.action] : 'default'}>
          {modeLabel}
        </Badge>
      </CardHeader>

      <div className="space-y-3">
        <p className="sb-display text-4xl leading-none text-sb-text sm:text-5xl">{modeLabel}</p>
        <p className="text-sm text-sb-text-muted">
          {rangeLabel
            ? `${rangeLabel}${remainingLabel ? ` • ${remainingLabel}` : ''}`
            : loadError
              ? 'Unable to load the current mode slot.'
              : 'Waiting for current mode slot information.'}
        </p>
        <div className="rounded-md border border-sb-rule bg-sb-bg px-3 py-2">
          <p className="sb-eyebrow">Source</p>
          <p className="mt-1 text-sm text-sb-text">{getSourceLabel(currentAction?.source)}</p>
        </div>
        {currentAction?.detail ? (
          <p className="text-sm text-sb-text-muted">{currentAction.detail}</p>
        ) : null}
      </div>
    </Card>
  );
}
