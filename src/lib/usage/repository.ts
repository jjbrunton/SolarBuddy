/**
 * Read-side access to the usage profile with an in-process cache.
 *
 * `getForecastedConsumptionW` is the single chokepoint for fallback logic:
 * no scheduler call site checks `usage_learning_enabled` itself — callers
 * just pass their own fallback value (usually `estimated_consumption_w`) and
 * trust this module to apply the precedence rules.
 */

import { getDb } from '../db';
import { getSettings } from '../config';
import { localDayType, localHalfHourIndex } from './slot-index';
import type {
  DayType,
  UsageBucket,
  UsageHighPeriods,
  UsageProfile,
  UsageProfileMeta,
} from './types';

const HALF_HOUR_MS = 30 * 60 * 1000;

// Cached snapshot. `undefined` means "not yet loaded from DB"; `null` means
// "loaded but no profile persisted". The two states matter because we only
// want to hit SQLite once per snapshot.
let cachedProfile: UsageProfile | null | undefined = undefined;
// Quick lookup keyed by `${day_type}:${slot_index}` built from cachedProfile.
let bucketLookup: Map<string, UsageBucket> | null = null;

interface UsageProfileMetaRow {
  baseload_w: number;
  baseload_percentile: number;
  window_days: number;
  window_start: string;
  window_end: string;
  total_samples: number;
  computed_at: string;
  high_periods_json: string;
}

function loadProfileFromDb(): UsageProfile | null {
  let metaRow: UsageProfileMetaRow | undefined;
  let bucketRows: UsageBucket[] = [];
  try {
    const db = getDb();
    metaRow = db.prepare('SELECT * FROM usage_profile_meta WHERE id = 1').get() as
      | UsageProfileMetaRow
      | undefined;
    if (!metaRow) return { buckets: [], meta: null };
    bucketRows = db.prepare('SELECT * FROM usage_profile').all() as UsageBucket[];
  } catch {
    // Missing tables, DB not ready, or similar — treat as "no profile yet".
    // Scheduler call sites will fall back to estimated_consumption_w via the
    // repository's precedence rules.
    return { buckets: [], meta: null };
  }

  let highPeriods: UsageHighPeriods = { weekday: [], weekend: [] };
  try {
    const parsed = JSON.parse(metaRow.high_periods_json);
    if (parsed && typeof parsed === 'object') {
      highPeriods = {
        weekday: Array.isArray(parsed.weekday) ? parsed.weekday : [],
        weekend: Array.isArray(parsed.weekend) ? parsed.weekend : [],
      };
    }
  } catch {
    // Corrupt JSON — fall through with empty arrays; profile still usable.
  }

  const meta: UsageProfileMeta = {
    baseload_w: metaRow.baseload_w,
    baseload_percentile: metaRow.baseload_percentile,
    window_days: metaRow.window_days,
    window_start: metaRow.window_start,
    window_end: metaRow.window_end,
    total_samples: metaRow.total_samples,
    computed_at: metaRow.computed_at,
    high_periods: highPeriods,
  };

  return { buckets: bucketRows, meta };
}

function ensureLoaded(): UsageProfile | null {
  if (cachedProfile !== undefined) return cachedProfile;
  const loaded = loadProfileFromDb();
  // Treat "no meta row" as null so callers can distinguish "computed but empty"
  // (impossible in practice — we refuse to write empty) from "never computed".
  cachedProfile = loaded && loaded.meta ? loaded : null;
  if (cachedProfile) {
    bucketLookup = new Map();
    for (const b of cachedProfile.buckets) {
      bucketLookup.set(`${b.day_type}:${b.slot_index}`, b);
    }
  } else {
    bucketLookup = null;
  }
  return cachedProfile;
}

/** Drop the in-process cache. Called by the refresh job after commit. */
export function invalidateUsageProfileCache(): void {
  cachedProfile = undefined;
  bucketLookup = null;
}

/** Read the cached profile; loads from DB on first call. Returns null if never computed. */
export function getUsageProfile(): UsageProfile | null {
  return ensureLoaded();
}

/** Convenience accessor for the learned baseload. Returns null if not yet computed. */
export function getBaseloadW(): number | null {
  const p = ensureLoaded();
  return p?.meta?.baseload_w ?? null;
}

/** High periods for both day types. Returns empty arrays if not yet computed. */
export function getUsageHighPeriods(): UsageHighPeriods {
  const p = ensureLoaded();
  return p?.meta?.high_periods ?? { weekday: [], weekend: [] };
}

function isLearningEnabled(): boolean {
  return getSettings().usage_learning_enabled === 'true';
}

function getMinSamplesPerBucket(): number {
  return parseInt(getSettings().usage_min_samples_per_bucket, 10) || 5;
}

/**
 * Forecast consumption in watts at a given moment.
 *
 * Precedence:
 *   1. Learning disabled → fallback.
 *   2. No profile → fallback.
 *   3. Bucket has `sample_count < usage_min_samples_per_bucket` → baseload if
 *      available, otherwise fallback.
 *   4. Otherwise → bucket median.
 */
export function getForecastedConsumptionW(timestamp: Date, fallbackW: number): number {
  if (!isLearningEnabled()) return fallbackW;
  const profile = ensureLoaded();
  if (!profile || !profile.meta || !bucketLookup) return fallbackW;

  const dayType: DayType = localDayType(timestamp);
  const slotIndex = localHalfHourIndex(timestamp);
  const bucket = bucketLookup.get(`${dayType}:${slotIndex}`);
  const minSamples = getMinSamplesPerBucket();

  if (!bucket || bucket.sample_count < minSamples) {
    const baseload = profile.meta.baseload_w;
    return baseload > 0 ? baseload : fallbackW;
  }
  return bucket.median_w;
}

/**
 * Average forecasted consumption (W) across a time range. Used by planner
 * code that needs a single scalar (e.g. calculateDischargeSlotsAvailable).
 *
 * Samples the forecast at every half-hour boundary inside [startMs, endMs)
 * and returns the arithmetic mean. If the range is empty or degenerate,
 * returns the fallback.
 */
export function getAverageForecastedConsumptionW(
  startMs: number,
  endMs: number,
  fallbackW: number,
): number {
  if (!isLearningEnabled()) return fallbackW;
  const profile = ensureLoaded();
  if (!profile || !profile.meta) return fallbackW;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return fallbackW;
  }

  let total = 0;
  let count = 0;
  const alignedStart = Math.floor(startMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  for (let t = alignedStart; t < endMs; t += HALF_HOUR_MS) {
    if (t < startMs) continue;
    total += getForecastedConsumptionW(new Date(t), fallbackW);
    count += 1;
  }
  if (count === 0) return fallbackW;
  return total / count;
}
