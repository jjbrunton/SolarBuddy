'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/analytics/StatCard';
import { formatCost } from '@/lib/forecast';

// "What if?" replays the period through the planner with different strategy
// settings, scored against the same measured load/PV. The delta vs the
// current-config backtest isolates the value of the override.

interface BacktestSummary {
  scheduling_saving: number;
  actual_cost: number;
  baseline_cost: number;
  passive_cost: number;
  hardware_saving: number;
  total_saving: number;
  days_covered: number;
  slots_covered: number;
}

interface BacktestDay {
  date: string;
  actual_cost: number;
  scheduling_saving: number;
}

interface BacktestResponse {
  ok: true;
  summary: BacktestSummary;
  daily: BacktestDay[];
}

interface Overrides {
  charging_strategy: string;
  price_threshold: string;
  charge_hours: string;
  smart_discharge: string;
  discharge_price_threshold: string;
}

const DEFAULT_OVERRIDES: Overrides = {
  charging_strategy: '',
  price_threshold: '',
  charge_hours: '',
  smart_discharge: '',
  discharge_price_threshold: '',
};

function buildBody(period: string, overrides: Overrides) {
  const cleanOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== '' && v !== 'inherit') cleanOverrides[k] = v;
  }
  return { period, settings_overrides: cleanOverrides };
}

function signedCost(p: number): string {
  if (Math.abs(p) < 0.5) return formatCost(0);
  return (p >= 0 ? '+' : '−') + formatCost(Math.abs(p));
}

export function WhatIfPanel({ period }: { period: string }) {
  const [baseline, setBaseline] = useState<BacktestSummary | null>(null);
  const [alt, setAlt] = useState<BacktestSummary | null>(null);
  const [overrides, setOverrides] = useState<Overrides>(DEFAULT_OVERRIDES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Baseline is backtest with NO overrides — represents the current settings
  // applied to the historical window. Keeping it as its own fetch means the
  // alt/baseline comparison always reflects the same scoring, and the alt
  // column changes instantly when knobs move.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/analytics/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(period, DEFAULT_OVERRIDES)),
    })
      .then((r) => r.json())
      .then((json: BacktestResponse) => {
        if (cancelled) return;
        if (json.ok) setBaseline(json.summary);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load baseline backtest.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const hasOverrides = Object.values(overrides).some((v) => v !== '' && v !== 'inherit');

  function runAlt() {
    if (!hasOverrides) {
      setAlt(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch('/api/analytics/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(period, overrides)),
    })
      .then((r) => r.json())
      .then((json: BacktestResponse) => {
        if (json.ok) setAlt(json.summary);
      })
      .catch(() => setError('Failed to run backtest.'))
      .finally(() => setLoading(false));
  }

  const delta =
    baseline && alt ? alt.scheduling_saving - baseline.scheduling_saving : null;
  const deltaColor =
    delta == null ? 'text-sb-text' : delta > 0 ? 'text-sb-success' : delta < 0 ? 'text-sb-danger' : 'text-sb-text';

  return (
    <Card>
      <CardHeader
        title="What if?"
        subtitle="Replay the same period with different strategy settings to see what would have changed. Baseline uses your current settings; overrides apply to the alt column."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <OverrideSelect
          label="Strategy"
          value={overrides.charging_strategy}
          onChange={(v) => setOverrides({ ...overrides, charging_strategy: v })}
          options={[
            { value: '', label: 'Inherit' },
            { value: 'night_fill', label: 'Night Fill' },
            { value: 'opportunistic_topup', label: 'Opportunistic' },
          ]}
        />
        <OverrideNumber
          label="Price threshold (p/kWh)"
          value={overrides.price_threshold}
          placeholder="Inherit"
          onChange={(v) => setOverrides({ ...overrides, price_threshold: v })}
        />
        <OverrideNumber
          label="Max charge slots"
          value={overrides.charge_hours}
          placeholder="Inherit"
          onChange={(v) => setOverrides({ ...overrides, charge_hours: v })}
        />
        <OverrideSelect
          label="Smart discharge"
          value={overrides.smart_discharge}
          onChange={(v) => setOverrides({ ...overrides, smart_discharge: v })}
          options={[
            { value: '', label: 'Inherit' },
            { value: 'true', label: 'On' },
            { value: 'false', label: 'Off' },
          ]}
        />
        <OverrideNumber
          label="Discharge threshold (p/kWh)"
          value={overrides.discharge_price_threshold}
          placeholder="Inherit"
          onChange={(v) => setOverrides({ ...overrides, discharge_price_threshold: v })}
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={runAlt}
            disabled={!hasOverrides || loading}
            className="w-full border border-sb-border bg-sb-ember px-3 py-2 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-sb-background hover:bg-sb-ember/90 disabled:opacity-40"
          >
            {loading ? 'Running…' : 'Run backtest'}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-[0.78rem] text-sb-danger">{error}</p>
      ) : null}

      {baseline ? (
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard
            label="Current settings"
            value={formatCost(baseline.scheduling_saving)}
            subtext={`Scheduling value over ${baseline.days_covered} day${baseline.days_covered === 1 ? '' : 's'} · ${baseline.slots_covered} slots replayed`}
          />
          <StatCard
            label="Alt settings"
            value={alt ? formatCost(alt.scheduling_saving) : hasOverrides ? '—' : 'Set overrides'}
            subtext={alt ? `Scheduling value with overrides applied` : hasOverrides ? 'Click Run backtest' : 'Adjust a knob above to compare'}
          />
          <div className="border border-sb-border bg-sb-surface-muted/50 p-4">
            <div className="text-[0.65rem] uppercase tracking-[0.16em] text-sb-text-subtle">Delta</div>
            <div className={`mt-2 font-mono text-[1.5rem] ${deltaColor}`}>
              {delta != null ? signedCost(delta) : '—'}
            </div>
            <p className="mt-1 text-[0.72rem] text-sb-text-muted">
              {delta != null
                ? delta > 0
                  ? 'Alt config would have saved more than current settings over this period.'
                  : delta < 0
                    ? 'Alt config would have cost more than current settings over this period.'
                    : 'No measurable difference.'
                : 'Run the alt backtest to see the delta.'}
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-[0.72rem] leading-5 text-sb-text-muted">
        Replay uses measured load and PV from <span className="text-sb-text">readings</span>. The
        planner sees the same forecast it had at plan time — no lookahead on the alt config.
        Historical accuracy depends on readings density for the selected period.
      </p>
    </Card>
  );
}

function OverrideSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.12em] text-sb-text-subtle">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-sb-border bg-sb-surface px-2 py-2 text-[0.85rem] text-sb-text focus:outline-none focus:ring-1 focus:ring-sb-ember"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OverrideNumber({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[0.72rem] uppercase tracking-[0.12em] text-sb-text-subtle">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="border border-sb-border bg-sb-surface px-2 py-2 text-[0.85rem] text-sb-text focus:outline-none focus:ring-1 focus:ring-sb-ember"
      />
    </label>
  );
}
