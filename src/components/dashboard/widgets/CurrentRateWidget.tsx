'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/Card';
import {
  summarizeCurrentRate,
  type CurrentRateStatus,
} from '@/lib/octopus/current-rate-summary';
import type { AgileRate } from '@/lib/octopus/rates';
import { Badge } from '@/components/ui/Badge';
import { ACTION_LABELS, ACTION_BADGE_KIND, type PlanAction } from '@/lib/plan-actions';
import { useSSE } from '@/hooks/useSSE';

function formatPrice(price: number) {
  return price.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatTimeRange(startIso: string, endIso: string) {
  const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const start = new Date(startIso).toLocaleTimeString('en-GB', timeFormat);
  const end = new Date(endIso).toLocaleTimeString('en-GB', timeFormat);
  return `${start} - ${end}`;
}

function getStatusStyles(status: CurrentRateStatus) {
  switch (status) {
    case 'negative':
      return {
        badge: 'border-sb-success/40 bg-sb-success/12 text-sb-success',
        accent: 'text-sb-success',
      };
    case 'best':
      return {
        badge: 'border-sb-ember/40 bg-sb-ember/12 text-sb-ember',
        accent: 'text-sb-ember',
      };
    case 'cheap':
      return {
        badge: 'border-sb-frost/40 bg-sb-frost/12 text-sb-frost',
        accent: 'text-sb-frost',
      };
    case 'expensive':
      return {
        badge: 'border-sb-warning/40 bg-sb-warning/12 text-sb-warning',
        accent: 'text-sb-warning',
      };
    default:
      return {
        badge: 'border-sb-rule bg-sb-surface-muted text-sb-text-muted',
        accent: 'text-sb-text',
      };
  }
}

function getStatusLabel(status: CurrentRateStatus) {
  switch (status) {
    case 'negative':
      return 'Negative';
    case 'best':
      return 'Cheapest';
    case 'cheap':
      return 'Low';
    case 'expensive':
      return 'High';
    default:
      return 'Typical';
  }
}

function getStatusCopy(status: CurrentRateStatus, currentPrice: number, averagePrice: number) {
  if (status === 'negative') {
    return 'Grid import is currently being paid.';
  }

  const difference = Math.abs(currentPrice - averagePrice).toFixed(2).replace(/\.00$/, '');

  switch (status) {
    case 'best':
      return 'This is the cheapest active Agile slot currently loaded.';
    case 'cheap':
      return `${difference}p below the loaded average rate.`;
    case 'expensive':
      return `${difference}p above the loaded average rate.`;
    default:
      return 'Close to the loaded average rate.';
  }
}

export default function CurrentRateWidget() {
  const router = useRouter();
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );
  const [rates, setRates] = useState<AgileRate[]>([]);
  // Server-resolved current action: walks the same priority cascade as the
  // watchdog (manual override > scheduled action > plan slot > target-SOC /
  // solar-surplus holds > default hold). Computing this client-side from
  // plan_slots alone would drift from what the watchdog is actually doing.
  const [currentAction, setCurrentAction] = useState<PlanAction | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [ratesRes, schedRes] = await Promise.all([
          fetch('/api/rates'),
          fetch('/api/schedule'),
        ]);
        const ratesJson = await ratesRes.json();
        setRates(ratesJson.rates || []);

        const schedJson = await schedRes.json();
        setCurrentAction(schedJson.current_action?.action ?? null);
      } catch {
        // Silent: the dashboard should remain usable without rate data.
      }
    }

    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const summary = useMemo(() => summarizeCurrentRate(rates, effectiveNow), [effectiveNow, rates]);

  if (!summary) return null;

  const styles = getStatusStyles(summary.status);
  const nextDelta = summary.next
    ? summary.next.price_inc_vat - summary.current.price_inc_vat
    : null;
  const nextDirection =
    nextDelta === null || nextDelta === 0
      ? null
      : nextDelta > 0
        ? `+${formatPrice(nextDelta)}p`
        : `${formatPrice(nextDelta)}p`;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-sb-card-hover"
      onClick={() => router.push('/rates')}
    >
      <CardHeader title="Current Rate">
        <span className="text-xs text-sb-text-muted">{formatTimeRange(summary.current.valid_from, summary.current.valid_to)}</span>
      </CardHeader>

      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div key={summary.current.valid_from} className="animate-value-pop">
            <div className={`sb-display flex items-baseline gap-2 text-[4rem] leading-none sm:text-[5rem] ${styles.accent}`}>
              <span>{formatPrice(summary.current.price_inc_vat)}</span>
              <span className="text-[0.22em] font-medium tracking-[0.18em] text-sb-text-muted uppercase">
                p/kWh
              </span>
            </div>
            <p className="mt-3 max-w-md text-sm text-sb-text-muted">
              {getStatusCopy(summary.status, summary.current.price_inc_vat, summary.averagePrice)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge kind={currentAction ? ACTION_BADGE_KIND[currentAction] : 'default'}>
              {currentAction ? ACTION_LABELS[currentAction] : 'No Plan'}
            </Badge>
            <span
              className={`inline-flex items-center border px-2.5 py-[0.15rem] text-[0.6rem] font-semibold uppercase tracking-[0.14em] ${styles.badge}`}
            >
              {getStatusLabel(summary.status)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-0 border-t border-sb-rule sm:grid-cols-3 sm:gap-0">
          <div className="border-b border-sb-rule px-4 py-4 sm:border-b-0 sm:border-r sm:border-sb-rule">
            <p className="sb-eyebrow">Next Slot</p>
            <p className="sb-display mt-2 text-2xl text-sb-text">
              {summary.next ? `${formatPrice(summary.next.price_inc_vat)}p` : '—'}
            </p>
            <p className="mt-1 text-[0.7rem] text-sb-text-muted">
              {summary.next
                ? `${formatTimeRange(summary.next.valid_from, summary.next.valid_to)}${nextDirection ? ` (${nextDirection})` : ''}`
                : 'Latest loaded rate'}
            </p>
          </div>

          <div className="border-b border-sb-rule px-4 py-4 sm:border-b-0 sm:border-r sm:border-sb-rule">
            <p className="sb-eyebrow">Loaded Low</p>
            <p className="sb-display mt-2 text-2xl text-sb-ember">{formatPrice(summary.minPrice)}p</p>
            <p className="mt-1 text-[0.7rem] text-sb-text-muted">Best available slot</p>
          </div>

          <div className="px-4 py-4">
            <p className="sb-eyebrow">Loaded Average</p>
            <p className="sb-display mt-2 text-2xl text-sb-text">{formatPrice(summary.averagePrice)}p</p>
            <p className="mt-1 text-[0.7rem] text-sb-text-muted">Across fetched rates</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
