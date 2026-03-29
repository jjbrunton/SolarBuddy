'use client';

import type { InverterState } from '@/lib/types';
import { Sun, Home, Battery, Zap } from 'lucide-react';

interface EnergyFlowProps {
  state: InverterState;
}

/* ─── layout constants ─── */
const W = 440;
const H = 340;

const NODE = {
  solar:   { x: 220, y: 48,  color: '#facc15' },
  grid:    { x: 58,  y: 155, color: '#5d9cec' },
  battery: { x: 382, y: 155, color: '#27c24c' },
  home:    { x: 220, y: 255, color: '#a78bfa' },
} as const;

type NodeId = keyof typeof NODE;

/* Curved paths (center-to-center, nodes rendered on top to cover ends) */
const PATHS: Record<string, { d: string; labelPos: { x: number; y: number } }> = {
  solar_home:     { d: 'M 220 48 C 205 130, 235 180, 220 255',   labelPos: { x: 220, y: 152 } },
  solar_battery:  { d: 'M 220 48 Q 330 55, 382 155',             labelPos: { x: 310, y: 82 } },
  grid_home:      { d: 'M 58 155 Q 75 245, 220 255',             labelPos: { x: 112, y: 228 } },
  battery_home:   { d: 'M 382 155 Q 365 245, 220 255',           labelPos: { x: 328, y: 228 } },
  home_grid:      { d: 'M 220 255 Q 75 245, 58 155',             labelPos: { x: 112, y: 228 } },
};

const ICONS: Record<NodeId, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  solar: Sun, grid: Zap, battery: Battery, home: Home,
};

/* ─── helpers ─── */
function fmt(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${w}W`;
}

/* ─── SVG defs ─── */
function Defs() {
  return (
    <defs>
      <filter id="ef-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ef-glow-lg" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="8" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  );
}

/* ─── animated flow path ─── */
function FlowPath({ pathKey, power, color }: { pathKey: string; power: number; color: string }) {
  if (power <= 0) return null;
  const { d, labelPos } = PATHS[pathKey];
  const sw = Math.max(2, Math.min(5, power / 500 + 1.5));
  const label = fmt(power);
  const tw = label.length * 7 + 16;

  return (
    <g>
      {/* Dim base path showing the route */}
      <path d={d} fill="none" stroke={color} strokeWidth={sw + 2} opacity={0.06} strokeLinecap="round" />
      {/* Animated flowing dashes */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray="8 16"
        strokeLinecap="round"
        opacity={0.35}
        className="animate-flow"
      />
      {/* Flowing particles */}
      {[0, -0.8, -1.6].map((begin, i) => (
        <circle key={i} r={sw * 0.6 + 1.2} fill={color} opacity={0.9} filter="url(#ef-glow)">
          <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${begin}s`} path={d} />
        </circle>
      ))}
      {/* Power badge */}
      <rect
        x={labelPos.x - tw / 2}
        y={labelPos.y - 10}
        width={tw}
        height={20}
        rx={10}
        fill="var(--color-sb-bg, #1a1a1a)"
        stroke={color}
        strokeWidth={1.2}
        opacity={0.95}
      />
      <text
        x={labelPos.x}
        y={labelPos.y + 4}
        textAnchor="middle"
        fill={color}
        fontSize="11"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

/* ─── node circle ─── */
function NodeCircle({ id, value, sub, active }: {
  id: NodeId;
  value: string;
  sub?: string;
  active: boolean;
}) {
  const { x, y, color } = NODE[id];
  const Icon = ICONS[id];
  const r = 28;
  const label = id === 'solar' ? 'Solar' : id === 'grid' ? 'Grid' : id === 'battery' ? 'Battery' : 'Home';

  return (
    <g>
      {/* Ambient glow (active) */}
      {active && (
        <circle cx={x} cy={y} r={r + 10} fill={color} opacity={0.06} filter="url(#ef-glow-lg)" />
      )}
      {/* Pulse ring (active) */}
      {active && (
        <circle cx={x} cy={y} r={r + 5} fill="none" stroke={color} strokeWidth={1.5}>
          <animate attributeName="opacity" values="0.12;0.35;0.12" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="r" values={`${r + 4};${r + 7};${r + 4}`} dur="2.5s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Node background */}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="var(--color-sb-card, #2a2a2a)"
        stroke={color}
        strokeWidth={active ? 2.5 : 1}
        opacity={active ? 1 : 0.35}
      />
      {/* Icon */}
      <foreignObject x={x - 11} y={y - 11} width={22} height={22}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <Icon size={18} style={{ color: active ? color : 'var(--color-sb-text-muted, #999)' }} />
        </div>
      </foreignObject>
      {/* Label */}
      <text
        x={x}
        y={y + r + 15}
        textAnchor="middle"
        fill="var(--color-sb-text-muted, #999)"
        fontSize="10"
        fontWeight="600"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
      {/* Value */}
      <text
        x={x}
        y={y + r + 28}
        textAnchor="middle"
        fill={active ? 'var(--color-sb-text, #e1e2e3)' : 'var(--color-sb-text-muted, #999)'}
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {value}
      </text>
      {/* Sub-label (battery charge/discharge, grid import/export) */}
      {sub && (
        <text
          x={x}
          y={y + r + 40}
          textAnchor="middle"
          fill={color}
          fontSize="9"
          fontWeight="600"
          fontFamily="system-ui, sans-serif"
          opacity={0.8}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/* ─── main component ─── */
export function EnergyFlowDiagram({ state }: EnergyFlowProps) {
  const pv = state.pv_power ?? 0;
  const grid = state.grid_power ?? 0;
  const batt = state.battery_power ?? 0;
  const load = state.load_power ?? 0;

  const flows: { pathKey: string; power: number; color: string }[] = [];

  if (pv > 0)
    flows.push({ pathKey: 'solar_home', power: pv, color: NODE.solar.color });

  if (batt > 0)
    flows.push({ pathKey: 'solar_battery', power: batt, color: NODE.battery.color });
  else if (batt < 0)
    flows.push({ pathKey: 'battery_home', power: Math.abs(batt), color: NODE.battery.color });

  if (grid > 0)
    flows.push({ pathKey: 'grid_home', power: grid, color: NODE.grid.color });
  else if (grid < 0)
    flows.push({ pathKey: 'home_grid', power: Math.abs(grid), color: NODE.grid.color });

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sb-text">Energy Flow</h2>
        <span className="flex items-center gap-1.5 text-xs text-sb-text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sb-success animate-pulse" />
          Live
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-md" role="img" aria-label="Energy flow diagram">
        <Defs />

        {/* Flow paths (rendered behind nodes) */}
        {flows.map((f) => (
          <FlowPath key={f.pathKey} {...f} />
        ))}

        {/* Nodes */}
        <NodeCircle
          id="solar"
          value={fmt(pv)}
          active={pv > 0}
        />
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
        <NodeCircle
          id="home"
          value={fmt(load)}
          active={load > 0}
        />
      </svg>
    </div>
  );
}
