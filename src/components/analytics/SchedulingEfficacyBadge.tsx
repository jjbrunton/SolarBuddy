'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { formatCost } from '@/lib/forecast';

// Decomposes the headline scheduling-value number into its gross components
// so a small net result doesn't read as "scheduler does nothing". Even a
// −£0.41 week typically hides £2 of wins balanced against £2.41 of losses;
// surfacing both makes the tradeoff visible.

interface Efficacy {
  gross_wins_pence: number;
  gross_losses_pence: number;
  net_pence: number;
  efficacy_pct: number;
  win_slot_count: number;
  loss_slot_count: number;
  neutral_slot_count: number;
  total_slot_count: number;
}

export function SchedulingEfficacyBadge({ period }: { period: string }) {
  const [data, setData] = useState<Efficacy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analytics/scheduling-efficacy?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (loading && !data) {
    return (
      <Card tone="subtle" padding="sm">
        <p className="text-[0.78rem] text-sb-text-muted">Loading scheduling efficacy…</p>
      </Card>
    );
  }

  if (!data || data.total_slot_count === 0) return null;

  const activeSlots = data.win_slot_count + data.loss_slot_count;
  const efficacy = data.efficacy_pct;
  const efficacyColor =
    efficacy >= 60
      ? 'text-sb-success'
      : efficacy >= 40
        ? 'text-sb-text'
        : 'text-sb-danger';

  return (
    <Card tone="subtle" padding="sm">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[0.78rem]">
        <div>
          <span className="font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
            Efficacy
          </span>
          <span className={`ml-2 font-mono text-[0.95rem] font-semibold ${efficacyColor}`}>
            {efficacy.toFixed(0)}%
          </span>
          <span className="ml-1 text-sb-text-muted">
            of active decisions helped
          </span>
        </div>
        <div className="text-sb-text-muted">
          <span className="text-sb-success">+{formatCost(data.gross_wins_pence)}</span>
          {' wins · '}
          <span className="text-sb-danger">−{formatCost(data.gross_losses_pence)}</span>
          {' losses · '}
          <span className="text-sb-text">{data.win_slot_count}</span>
          {' helpful slots vs '}
          <span className="text-sb-text">{data.loss_slot_count}</span>
          {' costly'}
          {data.neutral_slot_count > 0 ? (
            <>
              {' · '}
              <span className="text-sb-text">{data.neutral_slot_count}</span>
              {' neutral'}
            </>
          ) : null}
          {activeSlots > 0 ? null : ' · no scheduler activity to score'}
        </div>
      </div>
    </Card>
  );
}
