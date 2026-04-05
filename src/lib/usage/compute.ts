/**
 * Nightly refresh job for the usage profile.
 *
 * Reads readings.load_power over a trailing window, buckets samples by
 * (day_type, half-hour slot), computes percentiles, derives baseload and
 * high-consumption periods, and persists everything atomically to
 * usage_profile + usage_profile_meta.
 *
 * Note on virtual mode: readings/ingest.ts refuses to insert readings while
 * the runtime is in virtual mode, so running this refresh during a virtual
 * session will not produce updated buckets — the existing profile (if any)
 * remains intact, and fallback to estimated_consumption_w applies.
 */

import { getDb } from '../db';
import { getSettings } from '../config';
import { localDayType, localHalfHourIndex, slotIndexToLocalTime } from './slot-index';
import { percentileSorted } from './percentile';
import type {
  DayType,
  UsageBucket,
  UsageHighPeriod,
  UsageHighPeriods,
  UsageProfile,
  UsageProfileMeta,
  UsageProfileResult,
} from './types';
import { invalidateUsageProfileCache, getUsageProfile } from './repository';

const DAY_TYPES: DayType[] = ['weekday', 'weekend'];
const SLOTS_PER_DAY = 48;
const MIN_SAMPLES_PER_DAY = 200; // ~14% of 1-min coverage; days below this are dropped
const MAX_VALID_LOAD_W = 20000; // sanity clamp for residential sensors

export interface ComputeUsageProfileOptions {
  windowDays?: number;
  baseloadPercentile?: number;
  now?: Date;
}

interface ReadingRow {
  timestamp: string;
  load_power: number;
}

export async function computeUsageProfile(
  opts: ComputeUsageProfileOptions = {},
): Promise<UsageProfileResult> {
  const settings = getSettings();
  const windowDays = opts.windowDays ?? (parseInt(settings.usage_learning_window_days, 10) || 14);
  const baseloadPercentile =
    opts.baseloadPercentile ?? (parseFloat(settings.usage_baseload_percentile) || 10);
  const highPeriodMultiplier = parseFloat(settings.usage_high_period_multiplier) || 1.5;
  const highPeriodMinSlots = parseInt(settings.usage_high_period_min_slots, 10) || 2;

  const now = opts.now ?? new Date();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT timestamp, load_power FROM readings
       WHERE timestamp >= ?
         AND timestamp <= ?
         AND load_power IS NOT NULL
         AND load_power >= 0
         AND load_power <= ?
       ORDER BY timestamp`,
    )
    .all(windowStart.toISOString(), windowEnd.toISOString(), MAX_VALID_LOAD_W) as ReadingRow[];

  // Group samples by day (YYYY-MM-DD local) so we can drop undersampled days.
  const samplesByDay: Map<
    string,
    { dayType: DayType; entries: Array<{ slotIndex: number; load: number }> }
  > = new Map();

  for (const row of rows) {
    const d = new Date(row.timestamp);
    const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    let bucket = samplesByDay.get(dayKey);
    if (!bucket) {
      bucket = { dayType: localDayType(d), entries: [] };
      samplesByDay.set(dayKey, bucket);
    }
    bucket.entries.push({ slotIndex: localHalfHourIndex(d), load: row.load_power });
  }

  let droppedDays = 0;
  const bucketSamples: number[][] = Array.from({ length: 2 * SLOTS_PER_DAY }, () => []);
  const globalSamples: number[] = [];
  let weekdaySamples = 0;
  let weekendSamples = 0;

  for (const { dayType, entries } of samplesByDay.values()) {
    if (entries.length < MIN_SAMPLES_PER_DAY) {
      droppedDays += 1;
      continue;
    }
    const offset = dayType === 'weekday' ? 0 : SLOTS_PER_DAY;
    for (const entry of entries) {
      bucketSamples[offset + entry.slotIndex].push(entry.load);
      globalSamples.push(entry.load);
      if (dayType === 'weekday') weekdaySamples += 1;
      else weekendSamples += 1;
    }
  }

  const totalSamples = globalSamples.length;
  const minimumRequired = 2 * windowDays * 24; // ~2 samples/hour averaged across the window

  if (totalSamples < minimumRequired) {
    return {
      ok: false,
      reason: `insufficient data: ${totalSamples} samples < required ${minimumRequired}`,
      stats: {
        total_samples: totalSamples,
        weekday_samples: weekdaySamples,
        weekend_samples: weekendSamples,
        dropped_days: droppedDays,
      },
    };
  }

  // Sort once for percentile extraction.
  for (const arr of bucketSamples) arr.sort((a, b) => a - b);
  globalSamples.sort((a, b) => a - b);

  const baseloadW = percentileSorted(globalSamples, baseloadPercentile);
  const updatedAt = new Date().toISOString();

  const buckets: UsageBucket[] = [];
  for (let d = 0; d < DAY_TYPES.length; d++) {
    const dayType = DAY_TYPES[d];
    const offset = d * SLOTS_PER_DAY;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const samples = bucketSamples[offset + i];
      if (samples.length === 0) {
        buckets.push({
          day_type: dayType,
          slot_index: i,
          median_w: 0,
          p25_w: 0,
          p75_w: 0,
          mean_w: 0,
          sample_count: 0,
          updated_at: updatedAt,
        });
        continue;
      }
      const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
      buckets.push({
        day_type: dayType,
        slot_index: i,
        median_w: percentileSorted(samples, 50),
        p25_w: percentileSorted(samples, 25),
        p75_w: percentileSorted(samples, 75),
        mean_w: mean,
        sample_count: samples.length,
        updated_at: updatedAt,
      });
    }
  }

  const highPeriods: UsageHighPeriods = {
    weekday: detectHighPeriods(
      buckets.filter((b) => b.day_type === 'weekday'),
      baseloadW,
      highPeriodMultiplier,
      highPeriodMinSlots,
    ),
    weekend: detectHighPeriods(
      buckets.filter((b) => b.day_type === 'weekend'),
      baseloadW,
      highPeriodMultiplier,
      highPeriodMinSlots,
    ),
  };

  const meta: UsageProfileMeta = {
    baseload_w: baseloadW,
    baseload_percentile: baseloadPercentile,
    window_days: windowDays,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    total_samples: totalSamples,
    computed_at: updatedAt,
    high_periods: highPeriods,
  };

  // Compare with prior snapshot to decide whether to trigger a replan.
  const prior = getUsageProfile();

  const insertBucket = db.prepare(
    `INSERT INTO usage_profile
       (day_type, slot_index, median_w, p25_w, p75_w, mean_w, sample_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const clearBuckets = db.prepare('DELETE FROM usage_profile');
  const clearMeta = db.prepare('DELETE FROM usage_profile_meta');
  const insertMeta = db.prepare(
    `INSERT INTO usage_profile_meta
       (id, baseload_w, baseload_percentile, window_days, window_start, window_end,
        total_samples, computed_at, high_periods_json)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const writeTxn = db.transaction(() => {
    clearBuckets.run();
    clearMeta.run();
    for (const b of buckets) {
      insertBucket.run(
        b.day_type,
        b.slot_index,
        b.median_w,
        b.p25_w,
        b.p75_w,
        b.mean_w,
        b.sample_count,
        b.updated_at,
      );
    }
    insertMeta.run(
      meta.baseload_w,
      meta.baseload_percentile,
      meta.window_days,
      meta.window_start,
      meta.window_end,
      meta.total_samples,
      meta.computed_at,
      JSON.stringify(meta.high_periods),
    );
  });
  writeTxn();

  // Invalidate AFTER commit so concurrent readers don't see a half-updated cache.
  invalidateUsageProfileCache();

  const profile: UsageProfile = { buckets, meta };

  // Trigger replan if the profile has meaningfully shifted.
  if (shouldTriggerReplan(prior, profile)) {
    try {
      // Late import to avoid a circular dependency (scheduler → usage → scheduler).
      const { requestReplan } = await import('../scheduler/reevaluate');
      requestReplan('usage profile refreshed');
    } catch {
      // Replan triggering is best-effort; failures are not fatal.
    }
  }

  return {
    ok: true,
    profile,
    stats: {
      total_samples: totalSamples,
      weekday_samples: weekdaySamples,
      weekend_samples: weekendSamples,
      dropped_days: droppedDays,
    },
  };
}

export function detectHighPeriods(
  buckets: UsageBucket[],
  baseloadW: number,
  multiplier: number,
  minSlots: number,
): UsageHighPeriod[] {
  if (baseloadW <= 0) return [];
  const threshold = baseloadW * multiplier;
  const ordered = [...buckets].sort((a, b) => a.slot_index - b.slot_index);

  const periods: UsageHighPeriod[] = [];
  let runStart: number | null = null;
  let runMedianSum = 0;
  let runLength = 0;
  let lastHighSlot = -1;

  const flush = () => {
    if (runStart !== null && runLength >= minSlots) {
      periods.push({
        start_slot: runStart,
        end_slot: lastHighSlot,
        median_w: runMedianSum / runLength,
        start_local: slotIndexToLocalTime(runStart),
        end_local: slotIndexToLocalTime(Math.min(47, lastHighSlot + 1)),
      });
    }
    runStart = null;
    runMedianSum = 0;
    runLength = 0;
    lastHighSlot = -1;
  };

  for (const bucket of ordered) {
    const isHigh = bucket.sample_count > 0 && bucket.median_w > threshold;
    if (isHigh) {
      if (runStart === null) runStart = bucket.slot_index;
      runMedianSum += bucket.median_w;
      runLength += 1;
      lastHighSlot = bucket.slot_index;
    } else {
      flush();
    }
  }
  flush();

  return periods;
}

function shouldTriggerReplan(prior: UsageProfile | null, next: UsageProfile): boolean {
  if (!prior || !prior.meta) return true;
  const priorBaseload = prior.meta.baseload_w;
  const nextBaseload = next.meta?.baseload_w ?? 0;
  if (Math.abs(priorBaseload - nextBaseload) > 50) return true;

  const priorByKey = new Map<string, UsageBucket>();
  for (const b of prior.buckets) priorByKey.set(`${b.day_type}:${b.slot_index}`, b);
  for (const nb of next.buckets) {
    const pb = priorByKey.get(`${nb.day_type}:${nb.slot_index}`);
    if (!pb || pb.median_w === 0) continue;
    const delta = Math.abs(nb.median_w - pb.median_w) / pb.median_w;
    if (delta > 0.2) return true;
  }
  return false;
}
