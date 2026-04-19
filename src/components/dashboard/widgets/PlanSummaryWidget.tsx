'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { useSSE } from '@/hooks/useSSE';
import { buildPlanSummary, type BulletTone, type PlanSlotRow } from '@/lib/scheduler/plan-summary';
import type { AgileRate } from '@/lib/octopus/rates';
import type { ResolvedSlotAction } from '@/lib/scheduler/resolve';

interface ScheduleResponse {
  plan_slots: PlanSlotRow[];
  current_action: ResolvedSlotAction | null;
}

interface RatesResponse {
  rates: AgileRate[];
  exportRates?: AgileRate[];
}

const toneClasses: Record<BulletTone, string> = {
  default: 'text-sb-text',
  info: 'text-sb-frost',
  good: 'text-sb-success',
  warn: 'text-sb-warning',
};

const toneMarker: Record<BulletTone, string> = {
  default: 'border-sb-rule',
  info: 'border-sb-frost',
  good: 'border-sb-success',
  warn: 'border-sb-warning',
};

export default function PlanSummaryWidget() {
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );

  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [rates, setRates] = useState<RatesResponse | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [schedRes, ratesRes] = await Promise.all([
          fetch('/api/schedule'),
          fetch('/api/rates'),
        ]);
        setSchedule(await schedRes.json());
        setRates(await ratesRes.json());
      } catch {
        // Silent: widget simply hides if data can't be loaded.
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const bullets = useMemo(() => {
    if (!schedule || !rates) return [];
    return buildPlanSummary({
      now: effectiveNow,
      rates: rates.rates ?? [],
      exportRates: rates.exportRates ?? [],
      planSlots: schedule.plan_slots ?? [],
      currentAction: schedule.current_action,
      currentSoc: state.battery_soc,
    });
  }, [schedule, rates, effectiveNow, state.battery_soc]);

  if (bullets.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Plan Summary" subtitle="What the system is about to do" />
      <ul className="space-y-2">
        {bullets.map((bullet) => (
          <li
            key={bullet.key}
            className={`border-l-2 pl-3 text-sm leading-relaxed ${toneMarker[bullet.tone]} ${toneClasses[bullet.tone]}`}
          >
            {bullet.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
