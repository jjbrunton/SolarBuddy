'use client';

import { buildEnergyFlows, type EnergyFlowPathKey } from '@/lib/energy-flow';
import type { InverterState } from '@/lib/types';
import { Sun, Home, Battery, Zap } from 'lucide-react';

interface EnergyFlowProps {
  state: InverterState;
}

/* ─── layout ─── */
const W = 460;
const H = 380;

/*
 * Node colours reference Terminal Blueprint design tokens.
 * CSS vars used for SVG presentation attributes; hex fallbacks
 * for contexts that can't resolve custom properties.
 */
const NODE = {
  solar:   { x: 230, y: 56,  color: 'var(--color-sb-ember, #ff6600)' },
  grid:    { x: 62,  y: 172, color: 'var(--color-sb-frost, #00aaff)' },
  battery: { x: 398, y: 172, color: 'var(--color-sb-success, #00cc66)' },
  home:    { x: 230, y: 288, color: 'var(--color-sb-load, #aa66ff)' },
} as const;

type NodeId = keyof typeof NODE;

const PATHS: Record<EnergyFlowPathKey, { d: string; labelPos: { x: number; y: number } }> = {
  solar_home:    { d: 'M 230 56 C 215 140, 245 200, 230 288',  labelPos: { x: 230, y: 172 } },
  solar_battery: { d: 'M 230 56 Q 340 62, 398 172',            labelPos: { x: 328, y: 92 } },
  grid_battery:  { d: 'M 62 172 C 130 90, 330 90, 398 172',    labelPos: { x: 168, y: 108 } },
  grid_home:     { d: 'M 62 172 Q 80 258, 230 288',            labelPos: { x: 138, y: 262 } },
  battery_home:  { d: 'M 398 172 Q 380 258, 230 288',          labelPos: { x: 322, y: 262 } },
  home_grid:     { d: 'M 230 288 Q 80 258, 62 172',            labelPos: { x: 138, y: 262 } },
};

const ICONS: Record<NodeId, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  solar: Sun, grid: Zap, battery: Battery, home: Home,
};

const MONO = "var(--font-sb-mono, 'JetBrains Mono'), monospace";

/* ─── helpers ─── */
function fmt(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${w}W`;
}

/* ─── SVG defs ─── */
function Defs() {
  return (
    <defs>
      {/* Technical dot-grid background */}
      <pattern id="ef-dots" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="0.5" fill="var(--color-sb-text-subtle, #505050)" opacity="0.5" />
      </pattern>

      {/* 24-hour day/night gradient for timeline strip */}
      <linearGradient id="ef-daynight" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#00aaff" stopOpacity="0.18" />
        <stop offset="22%" stopColor="#00aaff" stopOpacity="0.18" />
        <stop offset="25%" stopColor="#ff8833" stopOpacity="0.28" />
        <stop offset="32%" stopColor="#ff6600" stopOpacity="0.35" />
        <stop offset="50%" stopColor="#ff6600" stopOpacity="0.4" />
        <stop offset="68%" stopColor="#ff6600" stopOpacity="0.35" />
        <stop offset="75%" stopColor="#ff8833" stopOpacity="0.28" />
        <stop offset="78%" stopColor="#00aaff" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#00aaff" stopOpacity="0.18" />
      </linearGradient>

      {/* Layered glow filters for depth */}
      <filter id="ef-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ef-glow-md" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ef-glow-lg" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="12" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

/* ─── animated flow path with multi-layer glow ─── */
function FlowPath({ pathKey, power, color }: {
  pathKey: EnergyFlowPathKey; power: number; color: string;
}) {
  if (power <= 0) return null;
  const { d, labelPos } = PATHS[pathKey];
  const sw = Math.max(2, Math.min(5, power / 500 + 1.5));
  const label = fmt(power);
  const tw = label.length * 7.5 + 18;

  return (
    <g>
      {/* Wide ambient glow */}
      <path d={d} fill="none" stroke={color} strokeWidth={sw + 10} opacity={0.04} filter="url(#ef-glow-lg)" strokeLinecap="round" />
      {/* Medium glow */}
      <path d={d} fill="none" stroke={color} strokeWidth={sw + 4} opacity={0.08} filter="url(#ef-glow-md)" strokeLinecap="round" />
      {/* Dim base route */}
      <path d={d} fill="none" stroke={color} strokeWidth={sw + 1} opacity={0.08} strokeLinecap="round" />
      {/* Animated flowing dashes */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray="6 18"
        strokeLinecap="round"
        opacity={0.4}
        className="animate-flow"
      />
      {/* Flowing particles with glow halos */}
      {[0, -0.7, -1.4].map((begin, i) => (
        <g key={i}>
          <circle r={sw + 3} fill={color} opacity={0.12} filter="url(#ef-glow-md)">
            <animateMotion dur="2.2s" repeatCount="indefinite" begin={`${begin}s`} path={d} />
          </circle>
          <circle r={sw * 0.5 + 1.2} fill={color} opacity={0.9} filter="url(#ef-glow)">
            <animateMotion dur="2.2s" repeatCount="indefinite" begin={`${begin}s`} path={d} />
          </circle>
        </g>
      ))}
      {/* Power badge — sharp terminal style */}
      <rect
        x={labelPos.x - tw / 2}
        y={labelPos.y - 10}
        width={tw}
        height={20}
        rx={2}
        fill="var(--color-sb-bg, #0a0a0a)"
        stroke={color}
        strokeWidth={1}
        opacity={0.95}
      />
      {/* Top accent stripe */}
      <line
        x1={labelPos.x - tw / 2 + 2}
        y1={labelPos.y - 10}
        x2={labelPos.x + tw / 2 - 2}
        y2={labelPos.y - 10}
        stroke={color}
        strokeWidth={2}
        opacity={0.7}
      />
      <text
        x={labelPos.x}
        y={labelPos.y + 4}
        textAnchor="middle"
        fill={color}
        fontSize="10.5"
        fontWeight="600"
        fontFamily={MONO}
        letterSpacing="0.03em"
      >
        {label}
      </text>
    </g>
  );
}

/* ─── 24-hour day/night timeline strip ─── */
function DayNightStrip() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;

  const barL = 80, barR = 380, barY = 366, barH = 3;
  const barW = barR - barL;
  const toX = (h: number) => barL + (h / 24) * barW;

  const sunriseH = 6, sunsetH = 18;
  const sunriseX = toX(sunriseH);
  const sunsetX = toX(sunsetH);
  const noonX = toX(12);
  const nowX = toX(hour);
  const isDaytime = hour >= sunriseH && hour < sunsetH;

  return (
    <g>
      {/* Gradient strip — frost night, ember day */}
      <rect x={barL} y={barY} width={barW} height={barH} rx={1.5} fill="url(#ef-daynight)" />

      {/* Sunrise notch */}
      <line x1={sunriseX} y1={barY - 2} x2={sunriseX} y2={barY + barH + 2}
        stroke="#ff8833" strokeWidth={0.75} opacity={0.3} />
      {/* Noon notch */}
      <line x1={noonX} y1={barY - 1.5} x2={noonX} y2={barY + barH + 1.5}
        stroke="#ff6600" strokeWidth={0.5} opacity={0.2} />
      {/* Sunset notch */}
      <line x1={sunsetX} y1={barY - 2} x2={sunsetX} y2={barY + barH + 2}
        stroke="#ff8833" strokeWidth={0.75} opacity={0.3} />

      {/* Current position — glow */}
      <circle cx={nowX} cy={barY + barH / 2} r={8}
        fill={isDaytime ? '#ff6600' : '#00aaff'} opacity={0.06} filter="url(#ef-glow-md)" />
      {/* Current position — dot */}
      <circle cx={nowX} cy={barY + barH / 2} r={3.5}
        fill={isDaytime ? 'var(--color-sb-ember, #ff6600)' : 'var(--color-sb-frost, #00aaff)'}
        opacity={0.75} filter="url(#ef-glow)" />
    </g>
  );
}

/* ─── node with spinning instrument ring ─── */
function NodeCircle({ id, value, sub, active }: {
  id: NodeId; value: string; sub?: string; active: boolean;
}) {
  const { x, y, color } = NODE[id];
  const Icon = ICONS[id];
  const r = 28;
  const label = id === 'solar' ? 'SOLAR' : id === 'grid' ? 'GRID' : id === 'battery' ? 'BATTERY' : 'HOME';

  return (
    <g>
      {/* Ambient glow (active) */}
      {active && (
        <circle cx={x} cy={y} r={r + 18} fill={color} opacity={0.05} filter="url(#ef-glow-lg)" />
      )}

      {/* Spinning segmented ring */}
      {active && (
        <circle
          cx={x} cy={y} r={r + 8}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeDasharray="8 12"
          strokeLinecap="round"
          opacity={0.35}
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${x} ${y}`}
            to={`360 ${x} ${y}`}
            dur="20s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Pulsing ring */}
      {active && (
        <circle cx={x} cy={y} r={r + 3} fill="none" stroke={color} strokeWidth={1.5}>
          <animate attributeName="opacity" values="0.1;0.3;0.1" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="r" values={`${r + 2};${r + 6};${r + 2}`} dur="2.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Cardinal tick marks — instrument aesthetic */}
      {([
        [x, y - r - 1, x, y - r - 5],
        [x + r + 1, y, x + r + 5, y],
        [x, y + r + 1, x, y + r + 5],
        [x - r - 1, y, x - r - 5, y],
      ] as const).map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color}
          strokeWidth={active ? 1.5 : 0.75}
          opacity={active ? 0.5 : 0.12}
          strokeLinecap="round"
        />
      ))}

      {/* Main circle */}
      <circle
        cx={x} cy={y} r={r}
        fill="var(--color-sb-bg, #0a0a0a)"
        stroke={color}
        strokeWidth={active ? 2.5 : 1}
        opacity={active ? 1 : 0.3}
      />
      {/* Inner accent ring */}
      <circle
        cx={x} cy={y} r={r - 5}
        fill="none"
        stroke={color}
        strokeWidth={0.5}
        opacity={active ? 0.15 : 0.05}
      />

      {/* Icon */}
      <foreignObject x={x - 11} y={y - 11} width={22} height={22}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <Icon size={18} style={{ color: active ? color : 'var(--color-sb-text-subtle, #505050)' }} />
        </div>
      </foreignObject>

      {/* Eyebrow label */}
      <text
        x={x}
        y={y + r + 16}
        textAnchor="middle"
        fill={active ? color : 'var(--color-sb-text-subtle, #505050)'}
        fontSize="8"
        fontWeight="500"
        fontFamily={MONO}
        letterSpacing="0.22em"
      >
        {label}
      </text>
      {/* Value readout */}
      <text
        x={x}
        y={y + r + 32}
        textAnchor="middle"
        fill={active ? 'var(--color-sb-text, #d4d4d4)' : 'var(--color-sb-text-muted, #808080)'}
        fontSize="13"
        fontWeight="700"
        fontFamily={MONO}
        letterSpacing="-0.01em"
      >
        {value}
      </text>
      {/* Sub-label (status) */}
      {sub && (
        <text
          x={x}
          y={y + r + 45}
          textAnchor="middle"
          fill={color}
          fontSize="9"
          fontWeight="500"
          fontFamily={MONO}
          opacity={0.8}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/* ─── main ─── */
export function EnergyFlowDiagram({ state }: EnergyFlowProps) {
  const pv = state.pv_power ?? 0;
  const grid = state.grid_power ?? 0;
  const batt = state.battery_power ?? 0;
  const load = state.load_power ?? 0;

  const flows = buildEnergyFlows(state).map((flow) => ({
    ...flow,
    color:
      flow.pathKey === 'grid_home' || flow.pathKey === 'grid_battery' || flow.pathKey === 'home_grid'
        ? NODE.grid.color
        : flow.pathKey === 'battery_home'
          ? NODE.battery.color
          : NODE.solar.color,
  }));

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="sb-eyebrow">Energy Flow</h2>
        <span
          className="flex items-center gap-1.5"
          style={{
            fontFamily: MONO,
            fontSize: '0.6rem',
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-sb-text-muted)',
          }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sb-success animate-pulse" />
          Live
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-md" role="img" aria-label="Energy flow diagram">
        <Defs />

        {/* Technical dot grid */}
        <rect width={W} height={H} fill="url(#ef-dots)" />

        {/* Day/night cycle strip */}
        <DayNightStrip />

        {/* Flow paths (behind nodes) */}
        {flows.map((f) => (
          <FlowPath key={f.pathKey} {...f} />
        ))}

        {/* Nodes (on top) */}
        <NodeCircle id="solar" value={fmt(pv)} active={pv > 0} />
        <NodeCircle
          id="grid"
          value={grid !== 0 ? fmt(Math.abs(grid)) : '0W'}
          sub={grid > 0 ? 'Importing' : grid < 0 ? 'Exporting' : undefined}
          active={grid !== 0}
        />
        <NodeCircle
          id="battery"
          value={`${state.battery_soc ?? '\u2014'}%`}
          sub={batt > 0 ? `Charging ${fmt(batt)}` : batt < 0 ? `Discharging ${fmt(Math.abs(batt))}` : undefined}
          active={batt !== 0}
        />
        <NodeCircle id="home" value={fmt(load)} active={load > 0} />
      </svg>
    </div>
  );
}
