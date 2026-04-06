'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/analytics/StatCard';
import { SegmentedTabs } from '@/components/ui/Tabs';

type DayType = 'weekday' | 'weekend';

interface UsageBucket {
  day_type: DayType;
  slot_index: number;
  median_w: number;
  p25_w: number;
  p75_w: number;
  mean_w: number;
  sample_count: number;
}

interface HighPeriod {
  start_slot: number;
  end_slot: number;
  median_w: number;
  start_local: string;
  end_local: string;
}

interface UsageProfileMeta {
  baseload_w: number;
  baseload_percentile: number;
  window_days: number;
  window_start: string;
  window_end: string;
  total_samples: number;
  computed_at: string;
}

interface UsageProfileResponse {
  status: 'ok' | 'empty';
  reason?: string;
  meta?: UsageProfileMeta;
  buckets?: UsageBucket[];
  high_periods?: { weekday: HighPeriod[]; weekend: HighPeriod[] };
  baseload_w?: number;
}

const DAY_TYPE_FILTERS: Array<{ label: string; value: 'all' | DayType }> = [
  { label: 'All', value: 'all' },
  { label: 'Weekday', value: 'weekday' },
  { label: 'Weekend', value: 'weekend' },
];

function slotLabel(slotIndex: number): string {
  const hours = Math.floor(slotIndex / 2);
  const mins = slotIndex % 2 === 0 ? '00' : '30';
  return `${String(hours).padStart(2, '0')}:${mins}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function UsageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: Record<string, number | string> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">Slot {label}</p>
      {typeof data.weekday_median === 'number' && (
        <p className="text-sm text-sb-text">
          Weekday: {Math.round(data.weekday_median)} W
          <span className="text-xs text-sb-text-muted">
            {' '}
            (p25 {Math.round(Number(data.weekday_p25))}–p75 {Math.round(Number(data.weekday_p75))})
          </span>
        </p>
      )}
      {typeof data.weekend_median === 'number' && (
        <p className="text-sm" style={{ color: '#4fc3f7' }}>
          Weekend: {Math.round(data.weekend_median)} W
          <span className="text-xs text-sb-text-muted">
            {' '}
            (p25 {Math.round(Number(data.weekend_p25))}–p75 {Math.round(Number(data.weekend_p75))})
          </span>
        </p>
      )}
      <p className="text-xs text-sb-text-muted">
        Samples: weekday {data.weekday_n ?? 0}, weekend {data.weekend_n ?? 0}
      </p>
    </div>
  );
}

export function UsageProfileChart() {
  const [profile, setProfile] = useState<UsageProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<'all' | DayType>('all');

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/usage-profile');
      const json = (await res.json()) as UsageProfileResponse;
      setProfile(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage profile');
    } finally {
      setLoading(false);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/usage-profile/refresh', { method: 'POST' });
      const json = await res.json();
      if (json.status === 'skipped') {
        setError(json.reason ?? 'Refresh skipped');
      }
      await fetchProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  const chartData = useMemo(() => {
    if (!profile || profile.status !== 'ok' || !profile.buckets) return [];
    const byDayAndSlot: Record<DayType, Map<number, UsageBucket>> = {
      weekday: new Map(),
      weekend: new Map(),
    };
    for (const b of profile.buckets) {
      byDayAndSlot[b.day_type].set(b.slot_index, b);
    }
    return Array.from({ length: 48 }, (_, slot) => {
      const wd = byDayAndSlot.weekday.get(slot);
      const we = byDayAndSlot.weekend.get(slot);
      return {
        slot,
        label: slotLabel(slot),
        weekday_median: wd?.median_w ?? null,
        weekday_p25: wd?.p25_w ?? null,
        weekday_p75: wd?.p75_w ?? null,
        weekday_band: wd ? [wd.p25_w, wd.p75_w] : null,
        weekday_n: wd?.sample_count ?? 0,
        weekend_median: we?.median_w ?? null,
        weekend_p25: we?.p25_w ?? null,
        weekend_p75: we?.p75_w ?? null,
        weekend_band: we ? [we.p25_w, we.p75_w] : null,
        weekend_n: we?.sample_count ?? 0,
      };
    });
  }, [profile]);

  const highPeriods = useMemo(() => {
    if (!profile || profile.status !== 'ok' || !profile.high_periods) {
      return { weekday: [] as HighPeriod[], weekend: [] as HighPeriod[] };
    }
    return profile.high_periods;
  }, [profile]);

  const showWeekday = dayFilter === 'all' || dayFilter === 'weekday';
  const showWeekend = dayFilter === 'all' || dayFilter === 'weekend';

  const baseload = profile?.baseload_w ?? null;

  return (
    <div className="space-y-4">
      {profile?.status === 'ok' && profile.meta && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Baseload"
            value={`${Math.round(profile.meta.baseload_w)} W`}
            subtext={`p${profile.meta.baseload_percentile} of window`}
          />
          <StatCard
            label="Window"
            value={`${profile.meta.window_days} days`}
            subtext={`${profile.meta.total_samples.toLocaleString()} samples`}
          />
          <StatCard
            label="High periods"
            value={`${highPeriods.weekday.length + highPeriods.weekend.length}`}
            subtext={`${highPeriods.weekday.length} wkday / ${highPeriods.weekend.length} wkend`}
          />
          <StatCard
            label="Last refreshed"
            value={formatDateTime(profile.meta.computed_at)}
          />
        </div>
      )}

      <Card>
        <CardHeader
          title="Learned usage profile"
          subtitle="Typical half-hour consumption pattern, computed from the configured usage source over the selected learning window."
        >
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs
              items={DAY_TYPE_FILTERS.map((f) => ({ label: f.label, value: f.value }))}
              activeValue={dayFilter}
              onChange={(v) => setDayFilter(v as 'all' | DayType)}
            />
            <button
              type="button"
              onClick={refreshNow}
              disabled={refreshing}
              className="rounded-lg border border-sb-border bg-sb-surface-muted px-3 py-1.5 text-sm text-sb-text hover:border-sb-active disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh now'}
            </button>
          </div>
        </CardHeader>

        {loading && !profile ? (
          <p className="py-12 text-center text-sb-text-muted">Loading usage profile…</p>
        ) : error ? (
          <p className="py-12 text-center text-sb-danger">{error}</p>
        ) : !profile || profile.status === 'empty' ? (
          <EmptyState
            title="Still learning your usage"
            description="SolarBuddy refreshes the usage profile at 03:17 each night. You can also press Refresh now to build it from your configured source (Octopus import data or local telemetry)."
          />
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
              {showWeekday && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-[#ff902b]" /> Weekday median
                </span>
              )}
              {showWeekend && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 border-b-2 border-dashed border-[#4fc3f7]" />{' '}
                  Weekend median
                </span>
              )}
              {baseload !== null && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 border-b-2 border-dotted border-sb-text-muted" />{' '}
                  Baseload ({Math.round(baseload)} W)
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-[rgba(255,144,43,0.15)]" /> High
                periods
              </span>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#999', fontSize: 11 }}
                  interval={3}
                />
                <YAxis
                  tick={{ fill: '#999', fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(Number(v))} W`}
                />
                <Tooltip content={<UsageTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />

                {showWeekday && (
                  <Area
                    type="monotone"
                    dataKey="weekday_band"
                    stroke="none"
                    fill="#ff902b"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                )}
                {showWeekend && (
                  <Area
                    type="monotone"
                    dataKey="weekend_band"
                    stroke="none"
                    fill="#4fc3f7"
                    fillOpacity={0.1}
                    isAnimationActive={false}
                  />
                )}

                {showWeekday &&
                  highPeriods.weekday.map((hp, idx) => (
                    <ReferenceArea
                      key={`wd-${idx}`}
                      x1={slotLabel(hp.start_slot)}
                      x2={slotLabel(hp.end_slot)}
                      strokeOpacity={0}
                      fill="#ff902b"
                      fillOpacity={0.08}
                    />
                  ))}
                {showWeekend &&
                  highPeriods.weekend.map((hp, idx) => (
                    <ReferenceArea
                      key={`we-${idx}`}
                      x1={slotLabel(hp.start_slot)}
                      x2={slotLabel(hp.end_slot)}
                      strokeOpacity={0}
                      fill="#4fc3f7"
                      fillOpacity={0.08}
                    />
                  ))}

                {baseload !== null && (
                  <ReferenceLine
                    y={baseload}
                    stroke="#888"
                    strokeDasharray="2 4"
                    label={{
                      value: `Baseload ${Math.round(baseload)} W`,
                      position: 'insideTopRight',
                      fill: '#aaa',
                      fontSize: 11,
                    }}
                  />
                )}

                {showWeekday && (
                  <Line
                    type="monotone"
                    dataKey="weekday_median"
                    stroke="#ff902b"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="weekday_median"
                  />
                )}
                {showWeekend && (
                  <Line
                    type="monotone"
                    dataKey="weekend_median"
                    stroke="#4fc3f7"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                    name="weekend_median"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {(highPeriods.weekday.length > 0 || highPeriods.weekend.length > 0) && (
              <div className="mt-4 space-y-2 text-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  High-consumption periods
                </p>
                {[...highPeriods.weekday.map((hp) => ({ ...hp, kind: 'Weekday' as const })),
                  ...highPeriods.weekend.map((hp) => ({ ...hp, kind: 'Weekend' as const }))].map(
                  (hp, idx) => (
                    <p key={idx} className="text-sb-text-muted">
                      <span className="text-sb-text">{hp.kind}</span> {hp.start_local}–{hp.end_local}
                      {' '}· median ~{Math.round(hp.median_w)} W
                    </p>
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
