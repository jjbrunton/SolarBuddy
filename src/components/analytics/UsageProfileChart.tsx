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
import { useChartColors } from '@/hooks/useTheme';

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

/** Convert watts average over a 30-min slot to kWh for that slot. */
function wToSlotKwh(w: number): number {
  return w / 2000;
}

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
          Weekday: {data.weekday_median.toFixed(2)} kWh
          <span className="text-xs text-sb-text-muted">
            {' '}
            (p25 {Number(data.weekday_p25).toFixed(2)}–p75 {Number(data.weekday_p75).toFixed(2)})
          </span>
        </p>
      )}
      {typeof data.weekend_median === 'number' && (
        <p className="text-sm" style={{ color: '#4fc3f7' }}>
          Weekend: {data.weekend_median.toFixed(2)} kWh
          <span className="text-xs text-sb-text-muted">
            {' '}
            (p25 {Number(data.weekend_p25).toFixed(2)}–p75 {Number(data.weekend_p75).toFixed(2)})
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
  const colors = useChartColors();
  const [profile, setProfile] = useState<UsageProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<'all' | DayType>('all');

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/usage-profile', { cache: 'no-store' });
      const json = (await res.json()) as UsageProfileResponse;
      setProfile(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage profile');
    } finally {
      setLoading(false);
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
        weekday_median: wd ? wToSlotKwh(wd.median_w) : null,
        weekday_p25: wd ? wToSlotKwh(wd.p25_w) : null,
        weekday_p75: wd ? wToSlotKwh(wd.p75_w) : null,
        weekday_band: wd ? [wToSlotKwh(wd.p25_w), wToSlotKwh(wd.p75_w)] : null,
        weekday_n: wd?.sample_count ?? 0,
        weekend_median: we ? wToSlotKwh(we.median_w) : null,
        weekend_p25: we ? wToSlotKwh(we.p25_w) : null,
        weekend_p75: we ? wToSlotKwh(we.p75_w) : null,
        weekend_band: we ? [wToSlotKwh(we.p25_w), wToSlotKwh(we.p75_w)] : null,
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

  const baseloadKwh = profile?.baseload_w != null ? wToSlotKwh(profile.baseload_w) : null;

  return (
    <div className="space-y-4">
      {profile?.status === 'ok' && profile.meta && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Baseload"
            value={`${wToSlotKwh(profile.meta.baseload_w).toFixed(2)} kWh`}
            subtext={`p${profile.meta.baseload_percentile} per 30 min`}
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
          subtitle="Expected kWh load per half-hour slot, computed from the configured usage source over the selected learning window."
        >
          <SegmentedTabs
            items={DAY_TYPE_FILTERS.map((f) => ({ label: f.label, value: f.value }))}
            activeValue={dayFilter}
            onChange={(v) => setDayFilter(v as 'all' | DayType)}
          />
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
                  <span className="inline-block h-0.5 w-4" style={{ backgroundColor: colors.chartAmber }} /> Weekday median
                </span>
              )}
              {showWeekend && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 border-b-2 border-dashed border-[#4fc3f7]" />{' '}
                  Weekend median
                </span>
              )}
              {baseloadKwh !== null && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 border-b-2 border-dotted border-sb-text-muted" />{' '}
                  Baseload ({baseloadKwh.toFixed(2)} kWh)
                </span>
              )}
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-sb-chart-amber) 15%, transparent)' }}
                />{' '}
                High
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
                  tickFormatter={(v) => `${Number(v).toFixed(1)}`}
                  label={{ value: 'kWh', angle: -90, position: 'insideLeft', fill: '#999', fontSize: 11 }}
                />
                <Tooltip content={<UsageTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />

                {showWeekday && (
                  <Area
                    type="monotone"
                    dataKey="weekday_band"
                    stroke="none"
                    fill={colors.chartAmber}
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
                      fill={colors.chartAmber}
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

                {baseloadKwh !== null && (
                  <ReferenceLine
                    y={baseloadKwh}
                    stroke="#888"
                    strokeDasharray="2 4"
                    label={{
                      value: `Baseload ${baseloadKwh.toFixed(2)} kWh`,
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
                    stroke={colors.chartAmber}
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
                      {' '}· median ~{wToSlotKwh(hp.median_w).toFixed(2)} kWh
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
