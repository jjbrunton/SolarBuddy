'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { formatSlotTimeLabel, formatSlotTooltipLabel } from '@/lib/slot-key';
import { OVERRIDE_COLOR, type PlanAction } from '@/lib/plan-actions';

interface ChartData {
  price: number;
  plannedAction: PlanAction;
  isCurrent: boolean;
  isOverride: boolean;
  forecastSOC?: number;
  validFrom: string;
  validTo: string;
  pvGenerationKw?: number;
}

interface ChartColors {
  muted: string;
  border: string;
  ember: string;
  success: string;
  danger: string;
  warning: string;
  solar: string;
  frost: string;
  override: string;
  actionCharge: string;
  actionDischarge: string;
  actionHold: string;
}

const SHARED_RIGHT = 50;

/**
 * Map a price into the cheap → mid → expensive gradient using terciles.
 * Mid sits at neutral muted (not warning amber) so it can't be confused with
 * the warm action / override colours elsewhere in the chart.
 */
function priceToColor(price: number, lowBand: number, highBand: number, colors: ChartColors): string {
  if (price < 0) return colors.success;
  if (price <= lowBand) return colors.success;
  if (price >= highBand) return colors.danger;
  return colors.muted;
}

function PriceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[0.5rem] border border-sb-rule-strong bg-sb-card/95 px-3 py-2 backdrop-blur-sm">
      <p className="sb-eyebrow text-[0.6rem]">{label ? formatSlotTooltipLabel(label) : ''}</p>
      <p className="sb-display mt-0.5 text-xl leading-none text-sb-ember">
        {payload[0].value}
        <span className="ml-1 text-[0.55rem] uppercase tracking-[0.18em] text-sb-text-muted">p/kWh</span>
      </p>
    </div>
  );
}

function MiniTooltip({
  active,
  payload,
  label,
  unit,
  precision = 0,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unit: string;
  precision?: number;
}) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="rounded-[0.5rem] border border-sb-rule-strong bg-sb-card/95 px-3 py-1.5 backdrop-blur-sm">
      <p className="sb-eyebrow text-[0.6rem]">{label ? formatSlotTooltipLabel(label) : ''}</p>
      <p className="font-[family-name:var(--font-sb-mono)] text-sm text-sb-text">
        {payload[0].value.toFixed(precision)}
        <span className="ml-1 text-[0.55rem] uppercase tracking-[0.18em] text-sb-text-muted">{unit}</span>
      </p>
    </div>
  );
}

interface Props {
  data: ChartData[];
  colors: ChartColors;
  pvEnabled: boolean;
  hasPvData: boolean;
  hasSocData: boolean;
  socFloor?: number;
}

export function RatesChartSmallMultiples({
  data,
  colors,
  pvEnabled,
  hasPvData,
  hasSocData,
  socFloor,
}: Props) {
  // Tercile boundaries drive the cheap/mid/expensive colour gradient.
  const { lowBand, highBand } = useMemo(() => {
    if (data.length === 0) return { lowBand: 0, highBand: 0 };
    const sorted = data.map((d) => d.price).sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length / 3)] ?? 0;
    const hi = sorted[Math.floor((sorted.length * 2) / 3)] ?? 0;
    return { lowBand: lo, highBand: hi };
  }, [data]);

  const sharedXAxisProps = {
    dataKey: 'validFrom' as const,
    interval: 'preserveStartEnd' as const,
    tickCount: 12,
    tick: { fill: colors.muted, fontSize: 11 },
  };

  const hiddenXAxisProps = {
    dataKey: 'validFrom' as const,
    interval: 'preserveStartEnd' as const,
    tickCount: 12,
    tick: false as const,
    axisLine: false as const,
    height: 0,
  };

  return (
    <div className="space-y-4">
      {/* PRICE — the hero strip */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.18em] text-sb-text-muted">
          <span>Price · p/kWh</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colors.success }} />
              Cheap
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colors.muted }} />
              Mid
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colors.danger }} />
              Expensive
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: OVERRIDE_COLOR }} />
              Override
            </span>
          </span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 5, right: SHARED_RIGHT, bottom: 5, left: 5 }}>
            <XAxis {...sharedXAxisProps} tickFormatter={formatSlotTimeLabel} />
            <YAxis tick={{ fill: colors.muted, fontSize: 11 }} width={45} />
            <ReferenceLine y={0} stroke={colors.border} />
            <Tooltip content={<PriceTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
            <Bar dataKey="price" radius={[2, 2, 0, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.isOverride ? OVERRIDE_COLOR : priceToColor(entry.price, lowBand, highBand, colors)}
                  stroke={entry.isCurrent ? colors.ember : 'none'}
                  strokeWidth={entry.isCurrent ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ACTION RIBBON — thin categorical strip showing what the planner is doing */}
      <ActionRibbon data={data} colors={colors} />

      {/* SOC — battery state of charge over time */}
      {hasSocData && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.18em] text-sb-text-muted">
            <span>Battery · SOC %</span>
            {socFloor != null && socFloor > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-3 border-t border-dashed border-sb-text-muted" />
                Floor {socFloor}%
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={data} margin={{ top: 5, right: SHARED_RIGHT, bottom: 0, left: 5 }}>
              <XAxis {...hiddenXAxisProps} />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: colors.muted, fontSize: 11 }}
                tickFormatter={(v: number) => `${v}%`}
                ticks={[0, 50, 100]}
                width={45}
              />
              {socFloor != null && socFloor > 0 && (
                <ReferenceLine y={socFloor} stroke={colors.muted} strokeDasharray="3 3" strokeOpacity={0.4} />
              )}
              <Tooltip content={<MiniTooltip unit="%" precision={0} />} cursor={{ stroke: colors.border }} />
              <Line
                type="linear"
                dataKey="forecastSOC"
                stroke={colors.muted}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* PV — solar generation forecast (only when configured) */}
      {pvEnabled && hasPvData && (
        <div>
          <div className="mb-1 text-[0.65rem] uppercase tracking-[0.18em] text-sb-text-muted">
            Solar · kW
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <AreaChart data={data} margin={{ top: 5, right: SHARED_RIGHT, bottom: 5, left: 5 }}>
              <XAxis {...hiddenXAxisProps} />
              <YAxis tick={{ fill: colors.muted, fontSize: 11 }} width={45} />
              <Tooltip content={<MiniTooltip unit="kW" precision={2} />} cursor={{ stroke: colors.border }} />
              <Area
                type="monotone"
                dataKey="pvGenerationKw"
                fill={colors.solar}
                fillOpacity={0.25}
                stroke={colors.solar}
                strokeWidth={1.5}
                strokeOpacity={0.8}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/**
 * A thin categorical strip showing what the planner is doing, slot by slot.
 * Renders inside a Recharts BarChart so it shares axis-padding with the
 * price chart above and stays pixel-aligned at any width.
 */
function ActionRibbon({ data, colors }: { data: ChartData[]; colors: ChartColors }) {
  if (data.length === 0) return null;

  const ribbonData = data.map((d, i) => ({ ...d, _i: i, _v: 1 }));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.18em] text-sb-text-muted">
        <span>Plan</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: colors.actionCharge }} />
            Charge
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: colors.actionDischarge }} />
            Discharge
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-sb-rule" />
            Hold
          </span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={18}>
        <BarChart data={ribbonData} margin={{ top: 0, right: SHARED_RIGHT, bottom: 0, left: 5 }} barCategoryGap={1}>
          <XAxis dataKey="validFrom" tick={false} axisLine={false} height={0} />
          <YAxis hide domain={[0, 1]} width={45} />
          <Bar dataKey="_v" radius={0} isAnimationActive={false}>
            {ribbonData.map((entry, i) => {
              const action = entry.plannedAction;
              const fill = entry.isOverride
                ? OVERRIDE_COLOR
                : action === 'charge'
                ? colors.actionCharge
                : action === 'discharge'
                ? colors.actionDischarge
                : colors.muted;
              const opacity = entry.isOverride || action !== 'hold' ? 0.85 : 0.12;
              return (
                <Cell
                  key={i}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={entry.isCurrent ? colors.ember : 'none'}
                  strokeWidth={entry.isCurrent ? 1.5 : 0}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
