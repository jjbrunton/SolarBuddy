import type { AgileRate } from '../octopus/rates';
import type { PlanAction } from '../plan-actions';
import type { ResolvedSlotAction } from './resolve';

export type RateBand =
  | 'free'
  | 'negative'
  | 'cheap'
  | 'typical'
  | 'expensive'
  | 'very expensive';

export type ExportBand =
  | 'zero'
  | 'negative'
  | 'very low'
  | 'low'
  | 'good'
  | 'very good';

export interface PlanSlotRow {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string | null;
  expected_soc_after: number | null;
  expected_value: number | null;
}

export type BulletTone = 'default' | 'info' | 'good' | 'warn';

export interface PlanSummaryBullet {
  key: string;
  text: string;
  tone: BulletTone;
}

export interface BuildPlanSummaryInput {
  now: Date;
  rates: AgileRate[];
  exportRates?: AgileRate[];
  planSlots: PlanSlotRow[];
  currentAction: ResolvedSlotAction | null;
  currentSoc: number | null;
  /** Horizon for the rate band summary, in hours. Defaults to 24. */
  horizonHours?: number;
}

const HOUR_MS = 60 * 60 * 1000;

export function buildPlanSummary(input: BuildPlanSummaryInput): PlanSummaryBullet[] {
  const horizonHours = input.horizonHours ?? 24;
  const horizonEnd = new Date(input.now.getTime() + horizonHours * HOUR_MS);
  const bullets: PlanSummaryBullet[] = [];

  const importBullet = buildRateBullet(input.rates, input.now, horizonEnd, 'import');
  if (importBullet) bullets.push({ ...importBullet, key: 'import-rates' });

  if (input.exportRates && input.exportRates.length > 0) {
    const exportBullet = buildRateBullet(input.exportRates, input.now, horizonEnd, 'export');
    if (exportBullet) bullets.push({ ...exportBullet, key: 'export-rates' });
  }

  if (input.currentAction || input.currentSoc !== null) {
    const currentBullet = buildCurrentStateBullet(input);
    if (currentBullet) bullets.push({ ...currentBullet, key: 'current-state' });
  }

  const currentAction = input.currentAction?.action;
  if (input.planSlots.length > 0 && currentAction !== 'charge') {
    const nextCharge = buildNextActionBullet(input.planSlots, input.rates, input.now, 'charge');
    if (nextCharge) bullets.push({ ...nextCharge, key: 'next-charge' });
  }

  if (input.planSlots.length > 0 && currentAction !== 'discharge') {
    const nextDischarge = buildNextActionBullet(
      input.planSlots,
      input.exportRates?.length ? input.exportRates : input.rates,
      input.now,
      'discharge',
      Boolean(input.exportRates?.length),
    );
    if (nextDischarge) bullets.push({ ...nextDischarge, key: 'next-discharge' });
  }

  const horizonBullet = buildHorizonSocBullet(input.planSlots, input.now);
  if (horizonBullet) bullets.push({ ...horizonBullet, key: 'horizon-soc' });

  return bullets;
}

function buildRateBullet(
  rates: AgileRate[],
  now: Date,
  horizonEnd: Date,
  kind: 'import' | 'export',
): Omit<PlanSummaryBullet, 'key'> | null {
  const windowRates = rates
    .filter((r) => new Date(r.valid_to).getTime() > now.getTime() && new Date(r.valid_from).getTime() < horizonEnd.getTime())
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  if (windowRates.length === 0) return null;

  const prices = windowRates.map((r) => r.price_inc_vat);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return {
      text: `${capitalise(kind)} rate is flat at ${formatPence(min)} across the next ${formatDuration(horizonEnd.getTime() - now.getTime())}.`,
      tone: 'default',
    };
  }

  const runs = mergeRateRuns(windowRates, min, max, kind);
  if (runs.length === 0) return null;

  const parts = runs.slice(0, 3).map((run, idx) => {
    const duration = formatDuration(new Date(run.end).getTime() - new Date(run.start).getTime());
    const range = run.priceMin === run.priceMax
      ? formatPence(run.priceMin)
      : `${formatPence(run.priceMin)} – ${formatPence(run.priceMax)}`;
    const prefix = idx === 0 ? `${capitalise(kind)} rates are ${run.band}` : `then ${run.band}`;
    return `${prefix} (${range}) for ${duration}`;
  });

  return {
    text: `${parts.join(', ')}.`,
    tone: toneForBand(runs[0].band, kind),
  };
}

interface RateRun {
  start: string;
  end: string;
  band: RateBand | ExportBand;
  priceMin: number;
  priceMax: number;
}

function mergeRateRuns(
  rates: AgileRate[],
  min: number,
  max: number,
  kind: 'import' | 'export',
): RateRun[] {
  const runs: RateRun[] = [];
  for (const r of rates) {
    const band = kind === 'import' ? importBand(r.price_inc_vat, min, max) : exportBand(r.price_inc_vat, min, max);
    const last = runs[runs.length - 1];
    if (last && last.band === band && last.end === r.valid_from) {
      last.end = r.valid_to;
      last.priceMin = Math.min(last.priceMin, r.price_inc_vat);
      last.priceMax = Math.max(last.priceMax, r.price_inc_vat);
    } else {
      runs.push({
        start: r.valid_from,
        end: r.valid_to,
        band,
        priceMin: r.price_inc_vat,
        priceMax: r.price_inc_vat,
      });
    }
  }
  return runs;
}

export function importBand(price: number, min: number, max: number): RateBand {
  if (price === 0) return 'free';
  if (price < 0) return 'negative';
  if (min === max) return 'typical';
  const frac = (price - min) / (max - min);
  if (frac <= 0.33) return 'cheap';
  if (frac <= 0.67) return 'typical';
  if (frac <= 0.9) return 'expensive';
  return 'very expensive';
}

export function exportBand(price: number, min: number, max: number): ExportBand {
  if (price === 0) return 'zero';
  if (price < 0) return 'negative';
  if (min === max) return 'good';
  const frac = (price - min) / (max - min);
  if (frac <= 0.25) return 'very low';
  if (frac <= 0.5) return 'low';
  if (frac <= 0.75) return 'good';
  return 'very good';
}

function buildCurrentStateBullet(input: BuildPlanSummaryInput): Omit<PlanSummaryBullet, 'key'> | null {
  const socText = input.currentSoc === null
    ? 'Battery SOC unknown'
    : `Battery at ${Math.round(input.currentSoc)}%`;

  if (!input.currentAction) {
    return { text: `${socText}, no current action resolved.`, tone: 'default' };
  }

  const action = input.currentAction.action;
  const run = findContiguousRun(input.planSlots, input.now, action);

  if (!run) {
    const verb = actionVerbPresent(action);
    return { text: `${socText}, ${verb}.`, tone: toneForAction(action) };
  }

  const duration = formatDuration(new Date(run.end).getTime() - input.now.getTime());
  const targetSoc = run.expectedSocAfter !== null ? ` to ${Math.round(run.expectedSocAfter)}%` : '';
  const verb = actionVerbPresent(action);
  const tailText = action === 'hold'
    ? `${verb} for the next ${duration}`
    : `${verb}${targetSoc} for the next ${duration}`;
  return {
    text: `${socText}, ${tailText}.`,
    tone: toneForAction(action),
  };
}

function buildNextActionBullet(
  planSlots: PlanSlotRow[],
  rates: AgileRate[],
  now: Date,
  action: Extract<PlanAction, 'charge' | 'discharge'>,
  asExport = false,
): Omit<PlanSummaryBullet, 'key'> | null {
  const futureSlots = planSlots
    .filter((s) => new Date(s.slot_start).getTime() >= now.getTime() && s.action === action)
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start));

  if (futureSlots.length === 0) {
    return {
      text: `No ${actionLabel(action, asExport)} slots planned.`,
      tone: 'default',
    };
  }

  const first = futureSlots[0];
  let runEnd = first.slot_end;
  for (const slot of futureSlots.slice(1)) {
    if (slot.slot_start === runEnd) {
      runEnd = slot.slot_end;
    } else {
      break;
    }
  }

  const untilStart = formatDuration(new Date(first.slot_start).getTime() - now.getTime());
  const windowDuration = formatDuration(new Date(runEnd).getTime() - new Date(first.slot_start).getTime());

  const windowRates = rates.filter(
    (r) => r.valid_from >= first.slot_start && r.valid_to <= runEnd,
  );
  let bandText = '';
  if (windowRates.length > 0) {
    const allPrices = rates.map((r) => r.price_inc_vat);
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const priceMin = Math.min(...windowRates.map((r) => r.price_inc_vat));
    const priceMax = Math.max(...windowRates.map((r) => r.price_inc_vat));
    const band = asExport ? exportBand(priceMin, min, max) : importBand(priceMin, min, max);
    const range = priceMin === priceMax ? formatPence(priceMin) : `${formatPence(priceMin)} – ${formatPence(priceMax)}`;
    bandText = ` — ${band} ${asExport ? 'export' : 'import'} (${range})`;
  }

  return {
    text: `Next ${actionLabel(action, asExport)} slot is in ${untilStart} for ${windowDuration}${bandText}.`,
    tone: toneForAction(action),
  };
}

function buildHorizonSocBullet(
  planSlots: PlanSlotRow[],
  now: Date,
): Omit<PlanSummaryBullet, 'key'> | null {
  const future = planSlots
    .filter((s) => new Date(s.slot_end).getTime() > now.getTime())
    .sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  if (future.length === 0) return null;

  const last = future[future.length - 1];
  if (last.expected_soc_after === null) return null;

  const endTime = new Date(last.slot_end).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
  return {
    text: `Plan runs to ${endTime}, ending at ${Math.round(last.expected_soc_after)}% SOC.`,
    tone: 'info',
  };
}

interface ContiguousRun {
  start: string;
  end: string;
  expectedSocAfter: number | null;
}

function findContiguousRun(
  planSlots: PlanSlotRow[],
  now: Date,
  action: PlanAction,
): ContiguousRun | null {
  const sorted = [...planSlots].sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  const nowIso = now.toISOString();
  const startIdx = sorted.findIndex(
    (s) => s.slot_start <= nowIso && s.slot_end > nowIso && s.action === action,
  );
  if (startIdx === -1) return null;

  let endIdx = startIdx;
  while (
    endIdx + 1 < sorted.length &&
    sorted[endIdx + 1].slot_start === sorted[endIdx].slot_end &&
    sorted[endIdx + 1].action === action
  ) {
    endIdx++;
  }
  return {
    start: sorted[startIdx].slot_start,
    end: sorted[endIdx].slot_end,
    expectedSocAfter: sorted[endIdx].expected_soc_after,
  };
}

function actionVerbPresent(action: PlanAction): string {
  switch (action) {
    case 'charge': return 'charging';
    case 'discharge': return 'discharging';
    case 'hold': return 'holding';
  }
}

function actionLabel(action: PlanAction, asExport: boolean): string {
  if (action === 'discharge') return asExport ? 'export' : 'discharge';
  return action;
}

function toneForAction(action: PlanAction): BulletTone {
  switch (action) {
    case 'charge': return 'info';
    case 'discharge': return 'good';
    case 'hold': return 'default';
  }
}

function toneForBand(band: RateBand | ExportBand, kind: 'import' | 'export'): BulletTone {
  if (kind === 'import') {
    if (band === 'cheap' || band === 'free' || band === 'negative') return 'good';
    if (band === 'expensive' || band === 'very expensive') return 'warn';
    return 'default';
  }
  if (band === 'good' || band === 'very good') return 'good';
  if (band === 'very low' || band === 'zero') return 'warn';
  return 'default';
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const remainder = totalMinutes - hours * 60;
  const quarter = Math.round(remainder / 15);
  if (hours >= 8 || quarter === 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const fraction = quarter === 1 ? 'and a quarter' : quarter === 2 ? 'and a half' : 'and three quarters';
  const unit = hours === 1 && quarter === 2 ? 'hours' : hours === 1 ? 'hours' : 'hours';
  return `${hours} ${fraction} ${unit}`;
}

function formatPence(price: number): string {
  const rounded = price.toFixed(1).replace(/\.0$/, '');
  return `${rounded}p`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
