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
        badge: 'border-sb-success/30 bg-sb-success/15 text-sb-success',
        accent: 'text-sb-success',
      };
    case 'best':
      return {
        badge: 'border-sb-accent/30 bg-sb-accent/15 text-sb-accent',
        accent: 'text-sb-accent',
      };
    case 'cheap':
      return {
        badge: 'border-sb-info/30 bg-sb-info/15 text-sb-info',
        accent: 'text-sb-info',
      };
    case 'expensive':
      return {
        badge: 'border-sb-warning/30 bg-sb-warning/15 text-sb-warning',
        accent: 'text-sb-warning',
      };
    default:
      return {
        badge: 'border-sb-border bg-sb-bg text-sb-text-muted',
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
  const [rates, setRates] = useState<AgileRate[]>([]);
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
        const planSlots: { slot_start: string; slot_end: string; action: PlanAction }[] = schedJson.plan_slots || [];
        const now = Date.now();
        const match = planSlots.find(
          (s) => now >= new Date(s.slot_start).getTime() && now < new Date(s.slot_end).getTime(),
        );
        setCurrentAction(match?.action ?? null);
      } catch {
        // Silent: the dashboard should remain usable without rate data.
      }
    }

    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const summary = useMemo(() => summarizeCurrentRate(rates), [rates]);

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

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`text-4xl font-bold ${styles.accent}`}>
              {formatPrice(summary.current.price_inc_vat)}
              <span className="ml-1 text-base font-medium text-sb-text-muted">p/kWh</span>
            </p>
            <p className="mt-2 text-sm text-sb-text-muted">
              {getStatusCopy(summary.status, summary.current.price_inc_vat, summary.averagePrice)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge kind={currentAction ? ACTION_BADGE_KIND[currentAction] : 'default'}>
              {currentAction ? ACTION_LABELS[currentAction] : 'No Plan'}
            </Badge>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${styles.badge}`}>
              {getStatusLabel(summary.status)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-sb-bg px-3 py-2">
            <p className="text-xs text-sb-text-muted">Next Slot</p>
            <p className="mt-1 text-sm font-semibold text-sb-text">
              {summary.next ? `${formatPrice(summary.next.price_inc_vat)}p` : 'No later slot'}
            </p>
            <p className="text-xs text-sb-text-muted">
              {summary.next
                ? `${formatTimeRange(summary.next.valid_from, summary.next.valid_to)}${nextDirection ? ` (${nextDirection})` : ''}`
                : 'Latest loaded rate'}
            </p>
          </div>

          <div className="rounded-md bg-sb-bg px-3 py-2">
            <p className="text-xs text-sb-text-muted">Loaded Low</p>
            <p className="mt-1 text-sm font-semibold text-sb-text">{formatPrice(summary.minPrice)}p</p>
            <p className="text-xs text-sb-text-muted">Best available slot</p>
          </div>

          <div className="rounded-md bg-sb-bg px-3 py-2">
            <p className="text-xs text-sb-text-muted">Loaded Average</p>
            <p className="mt-1 text-sm font-semibold text-sb-text">{formatPrice(summary.averagePrice)}p</p>
            <p className="text-xs text-sb-text-muted">Across fetched rates</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
