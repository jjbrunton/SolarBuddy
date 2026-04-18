'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';
import { formatCost } from '@/lib/forecast';

const PERIODS = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface AttributionDay {
  date: string;
  load_kwh: number;
  import_kwh: number;
  export_kwh: number;
  passive_import_kwh: number;
  passive_export_kwh: number;
  baseline_cost: number;
  passive_cost: number;
  actual_cost: number;
  hardware_saving: number;
  scheduling_saving: number;
  total_saving: number;
}

interface PassiveConfig {
  capacity_kwh: number;
  min_soc_pct: number;
  max_power_kw: number;
  round_trip_efficiency: number;
  starting_soc_pct: number;
}

interface AttributionSummary {
  load_kwh: number;
  import_kwh: number;
  export_kwh: number;
  passive_import_kwh: number;
  passive_export_kwh: number;
  avg_import_rate: number;
  baseline_cost: number;
  passive_cost: number;
  actual_cost: number;
  hardware_saving: number;
  scheduling_saving: number;
  total_saving: number;
  passive_config: PassiveConfig;
}

interface BillEstimate {
  today: { date: string; total_cost_pence: number; confidence: string };
  tomorrow: { date: string; total_cost_pence: number; confidence: string };
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function signedCost(p: number) {
  if (Math.abs(p) < 0.5) return formatCost(0);
  return (p >= 0 ? '+' : '−') + formatCost(Math.abs(p));
}

export default function SavingsPageView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';

  const [summary, setSummary] = useState<AttributionSummary | null>(null);
  const [daily, setDaily] = useState<AttributionDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<BillEstimate | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/attribution?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setSummary(json.summary);
        setDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    fetch('/api/analytics/bill-estimate')
      .then((r) => r.json())
      .then((json) => setBill(json))
      .catch(() => {});
  }, []);

  const hasData = daily.length > 0;
  const maxBarValue = useMemo(() => {
    if (!hasData) return 1;
    return Math.max(
      1,
      ...daily.map((d) => Math.max(d.baseline_cost, d.passive_cost, d.actual_cost)),
    );
  }, [daily, hasData]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Savings"
        description="Compares what you paid to two counterfactuals: a passive self-use battery (measures SolarBuddy's scheduling value) and no hardware at all on the same tariff (measures solar + battery hardware value)."
        actions={<PeriodSelector periods={PERIODS} selected={period} />}
      />

      {/* Hero: scheduling saving is the headline — that's what SolarBuddy
          specifically earns. The other two savings stats sit underneath as
          context, with no visual competition for the top spot. */}
      <HeroBand summary={summary} />

      {/* Bill estimate strip */}
      {bill ? (
        <Card tone="subtle" padding="sm">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[0.78rem]">
            <div>
              <span className="font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Today </span>
              <span className="ml-2 text-sb-text">{formatCost(bill.today.total_cost_pence)}</span>
              <span className="ml-1 text-sb-text-muted">({bill.today.confidence} confidence)</span>
            </div>
            <div>
              <span className="font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Tomorrow </span>
              <span className="ml-2 text-sb-text">{formatCost(bill.tomorrow.total_cost_pence)}</span>
              <span className="ml-1 text-sb-text-muted">({bill.tomorrow.confidence} confidence)</span>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Scenario comparison */}
      <Card>
        <CardHeader
          title="How the savings break down"
          subtitle="Three scenarios for the selected period. The gaps between them tell you what each piece of the setup is worth."
        />
        {loading && !summary ? (
          <p className="py-12 text-center text-sb-text-muted">Loading attribution data…</p>
        ) : !summary || summary.load_kwh === 0 ? (
          <EmptyState
            title="Not enough data yet"
            description="SolarBuddy needs stored readings, tariff data, and battery settings for the selected period before it can simulate a passive-battery baseline."
          />
        ) : (
          <ScenarioBreakdown summary={summary} />
        )}
      </Card>

      {/* Daily strip */}
      <Card>
        <CardHeader
          title="Day by day"
          subtitle="Each day's actual cost compared to the passive-battery simulation."
        />
        {loading && !hasData ? (
          <p className="py-12 text-center text-sb-text-muted">Loading daily data…</p>
        ) : !hasData ? (
          <EmptyState
            title="No daily data yet"
            description="Once SolarBuddy has recorded readings and tariff data for a day, it'll appear here."
          />
        ) : (
          <ul className="divide-y divide-sb-border/50">
            {[...daily].reverse().map((d) => (
              <DailyRow
                key={d.date}
                day={d}
                maxValue={maxBarValue}
                expanded={expanded === d.date}
                onToggle={() => setExpanded(expanded === d.date ? null : d.date)}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function HeroBand({ summary }: { summary: AttributionSummary | null }) {
  const schedulingValue = summary?.scheduling_saving ?? 0;
  const schedulingColor =
    !summary
      ? 'text-sb-text'
      : schedulingValue > 0
        ? 'text-sb-success'
        : schedulingValue < 0
          ? 'text-sb-danger'
          : 'text-sb-text';

  return (
    <div className="space-y-3">
      <Card tone="highlight" padding="lg">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
          SolarBuddy scheduling value
        </p>
        <p className={`mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.5rem] ${schedulingColor}`}>
          {summary ? signedCost(schedulingValue) : '—'}
        </p>
        <p className="mt-1 text-[0.78rem] text-sb-text-muted">
          {summary
            ? schedulingValue > 0
              ? `Saved vs a passive self-use battery with the same hardware`
              : schedulingValue < 0
                ? `Cost more than a passive self-use battery would have`
                : `No measurable difference vs a passive self-use battery`
            : ''}
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard
          label="You paid"
          value={summary ? formatCost(summary.actual_cost) : '—'}
          subtext={
            summary
              ? `${summary.import_kwh} kWh imported · ${summary.export_kwh} kWh exported`
              : undefined
          }
        />
        <StatCard
          label="Passive battery"
          value={summary ? formatCost(summary.passive_cost) : '—'}
          subtext={
            summary
              ? `Simulated self-use · ${summary.passive_import_kwh} kWh in / ${summary.passive_export_kwh} kWh out`
              : undefined
          }
        />
        <StatCard
          label="No hardware"
          value={summary ? formatCost(summary.baseline_cost) : '—'}
          subtext={
            summary
              ? `${summary.load_kwh} kWh × your tariff (~${summary.avg_import_rate.toFixed(1)}p avg) · no solar or battery`
              : undefined
          }
        />
      </div>
    </div>
  );
}

function ScenarioBreakdown({ summary }: { summary: AttributionSummary }) {
  const hardware = summary.hardware_saving;
  const scheduling = summary.scheduling_saving;
  const positiveTotal =
    Math.max(0, hardware) + Math.max(0, scheduling);
  const negativeTotal = Math.max(0, -hardware) + Math.max(0, -scheduling);
  const scale = Math.max(positiveTotal, negativeTotal, 1);

  const parts = [
    {
      key: 'hardware',
      label: 'Hardware value',
      tooltip:
        'No-hardware cost minus the passive-battery cost, both priced on your current tariff. What solar and the battery earn without SolarBuddy making any decisions.',
      value: hardware,
      color: 'bg-sb-grid',
    },
    {
      key: 'scheduling',
      label: 'Scheduling value',
      tooltip:
        "Passive-battery cost minus what you actually paid. What SolarBuddy's scheduling adds on top.",
      value: scheduling,
      color: 'bg-sb-ember',
    },
  ];

  return (
    <div className="space-y-5">
      {positiveTotal > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.16em] text-sb-text-subtle">
            <span>Reduced your bill</span>
            <span>{formatCost(positiveTotal)}</span>
          </div>
          <div className="flex h-4 w-full overflow-hidden border border-sb-border/40 bg-sb-surface-muted">
            {parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <div
                  key={p.key}
                  className={p.color}
                  style={{ width: `${(p.value / scale) * 100}%` }}
                  title={`${p.label}: ${formatCost(p.value)}`}
                />
              ))}
          </div>
        </div>
      ) : null}

      {negativeTotal > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.16em] text-sb-text-subtle">
            <span>Added to your bill</span>
            <span className="text-sb-danger">−{formatCost(negativeTotal)}</span>
          </div>
          <div className="flex h-4 w-full overflow-hidden border border-sb-border/40 bg-sb-surface-muted">
            {parts
              .filter((p) => p.value < 0)
              .map((p) => (
                <div
                  key={p.key}
                  className="bg-sb-danger/70"
                  style={{ width: `${(Math.abs(p.value) / scale) * 100}%` }}
                  title={`${p.label}: ${formatCost(p.value)}`}
                />
              ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {parts.map((p) => (
          <div key={p.key} className="flex items-start gap-2 text-[0.78rem]">
            <span className={`mt-1 h-3 w-3 flex-shrink-0 ${p.color}`} aria-hidden />
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-sb-text">{p.label}</span>
                <span className={`font-mono ${p.value >= 0 ? 'text-sb-text' : 'text-sb-danger'}`}>
                  {signedCost(p.value)}
                </span>
              </div>
              <p className="mt-0.5 text-[0.72rem] leading-5 text-sb-text-muted">{p.tooltip}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-sb-rule pt-4 text-[0.72rem] leading-5 text-sb-text-muted">
        <p>
          All three scenarios are priced against your real half-hour import &amp; export rates,
          so the comparison isolates the hardware and scheduling effects rather than bundling in
          the value of your tariff choice. Your tariff averaged{' '}
          <span className="text-sb-text">{summary.avg_import_rate.toFixed(1)}p/kWh</span> weighted
          by your load this period.
        </p>
        <p>
          <span className="font-semibold uppercase tracking-[0.12em] text-sb-text-subtle">Passive&nbsp;battery&nbsp;assumptions&nbsp;·&nbsp;</span>
          <span className="text-sb-text">{summary.passive_config.capacity_kwh}kWh capacity</span>
          {', '}
          <span className="text-sb-text">{summary.passive_config.min_soc_pct}% floor</span>
          {', '}
          <span className="text-sb-text">{summary.passive_config.max_power_kw}kW max</span>
          {', '}
          <span className="text-sb-text">
            {Math.round(summary.passive_config.round_trip_efficiency * 100)}% round-trip
          </span>
          {', starting SOC '}
          <span className="text-sb-text">{summary.passive_config.starting_soc_pct.toFixed(0)}%</span>.
        </p>
      </div>
    </div>
  );
}

function DailyRow({
  day,
  maxValue,
  expanded,
  onToggle,
}: {
  day: AttributionDay;
  maxValue: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const baselinePct = (day.baseline_cost / maxValue) * 100;
  const passivePct = (day.passive_cost / maxValue) * 100;
  const actualPct = (day.actual_cost / maxValue) * 100;
  const schedColor = day.scheduling_saving >= 0 ? 'text-sb-success' : 'text-sb-danger';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-sb-surface-muted/50"
      >
        <div className="w-[7rem] flex-shrink-0 text-[0.8rem] text-sb-text">{formatDate(day.date)}</div>

        {/* Three-layer mini bar: baseline (subtle) / passive (grid blue) / actual (ember) */}
        <div className="flex-1 space-y-1">
          <div className="relative h-2 w-full overflow-hidden bg-sb-surface-muted">
            <div
              className="absolute left-0 top-0 h-full bg-sb-text-subtle/30"
              style={{ width: `${Math.max(0, baselinePct)}%` }}
              aria-label={`Standard tariff ${formatCost(day.baseline_cost)}`}
            />
            <div
              className="absolute left-0 top-0 h-full bg-sb-grid/70"
              style={{ width: `${Math.max(0, passivePct)}%` }}
              aria-label={`Passive battery ${formatCost(day.passive_cost)}`}
            />
            <div
              className={`absolute left-0 top-0 h-full ${day.actual_cost < 0 ? 'bg-sb-success' : 'bg-sb-ember'}`}
              style={{ width: `${Math.max(0, actualPct)}%` }}
              aria-label={`Actual ${formatCost(day.actual_cost)}`}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 text-[0.7rem] text-sb-text-muted">
            <span>
              Actual <span className="text-sb-text">{formatCost(day.actual_cost)}</span>
            </span>
            <span>
              Passive <span className="text-sb-text">{formatCost(day.passive_cost)}</span>
            </span>
            <span>
              No hardware <span className="text-sb-text">{formatCost(day.baseline_cost)}</span>
            </span>
          </div>
        </div>

        <div className="w-[6rem] flex-shrink-0 text-right">
          <div className={`font-mono text-[0.9rem] font-semibold ${schedColor}`}>
            {signedCost(day.scheduling_saving)}
          </div>
          <div className="text-[0.65rem] uppercase tracking-[0.16em] text-sb-text-subtle">
            scheduling
          </div>
        </div>

        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`text-sb-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded ? (
        <div className="mb-3 grid grid-cols-2 gap-3 border-l-2 border-sb-ember/40 bg-sb-surface-muted/40 px-4 py-3 text-[0.78rem] sm:grid-cols-4">
          <Stat label="Load" value={`${day.load_kwh} kWh`} />
          <Stat label="Imported (actual)" value={`${day.import_kwh} kWh`} />
          <Stat label="Exported (actual)" value={`${day.export_kwh} kWh`} />
          <Stat
            label="Imported (passive)"
            value={`${day.passive_import_kwh} kWh`}
          />
          <AttributionStat label="Scheduling value" value={day.scheduling_saving} bold />
          <AttributionStat label="Hardware value" value={day.hardware_saving} />
          <AttributionStat label="Total saving" value={day.total_saving} />
          <Stat label="No-hardware baseline" value={formatCost(day.baseline_cost)} />
        </div>
      ) : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.65rem] uppercase tracking-[0.16em] text-sb-text-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-sb-text">{value}</div>
    </div>
  );
}

function AttributionStat({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  const color = value >= 0 ? (bold ? 'text-sb-success' : 'text-sb-text') : 'text-sb-danger';
  return (
    <div>
      <div className="text-[0.65rem] uppercase tracking-[0.16em] text-sb-text-subtle">{label}</div>
      <div className={`mt-0.5 font-mono ${color} ${bold ? 'font-semibold' : ''}`}>
        {signedCost(value)}
      </div>
    </div>
  );
}
