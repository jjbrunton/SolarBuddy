'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatCost } from '@/lib/forecast';
import type { BillEstimateResult, DayBillEstimate } from '@/lib/bill-estimate';

function confidenceKind(c: DayBillEstimate['confidence']) {
  switch (c) {
    case 'high': return 'success' as const;
    case 'medium': return 'default' as const;
    case 'low': return 'warning' as const;
  }
}

function DayColumn({ label, day }: { label: string; day: DayBillEstimate }) {
  const isEarning = day.total_cost_pence < 0;
  const costColor = isEarning ? 'text-sb-success' : 'text-sb-text';

  return (
    <div className="flex flex-col gap-2">
      <p className="sb-eyebrow">{label}</p>

      <p className={`sb-display text-2xl leading-none sm:text-4xl ${costColor}`}>
        {isEarning ? '-' : ''}{formatCost(Math.abs(day.total_cost_pence))}
      </p>

      {day.actual_cost_pence !== 0 && (
        <div className="space-y-0.5 text-[0.7rem] text-sb-text-muted">
          <p>actual {formatCost(day.actual_cost_pence)}</p>
          <p>+ forecast {formatCost(day.forecast_cost_pence)}</p>
        </div>
      )}

      {day.actual_cost_pence === 0 && day.forecast_cost_pence !== 0 && (
        <p className="text-[0.7rem] text-sb-text-muted">fully forecast</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge kind={confidenceKind(day.confidence)}>{day.confidence}</Badge>
        {(day.import_kwh > 0 || day.export_kwh > 0) && (
          <span className="text-[0.65rem] text-sb-text-muted">
            {day.import_kwh > 0 ? `${day.import_kwh} kWh in` : ''}
            {day.import_kwh > 0 && day.export_kwh > 0 ? ' / ' : ''}
            {day.export_kwh > 0 ? `${day.export_kwh} kWh out` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

export default function BillEstimateWidget() {
  const [estimate, setEstimate] = useState<BillEstimateResult | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/analytics/bill-estimate');
        if (!res.ok) return;
        const data: BillEstimateResult = await res.json();
        setEstimate(data);
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!estimate) return null;

  return (
    <Card>
      <CardHeader title="Estimated Bill" subtitle="Energy cost only" />

      <div className="grid grid-cols-2 gap-6">
        <DayColumn label="Today" day={estimate.today} />
        <DayColumn label="Tomorrow" day={estimate.tomorrow} />
      </div>
    </Card>
  );
}
