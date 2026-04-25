import { getDb } from './db';
import { recomputeAttributionRange } from './attribution';
import { recomputeSlotScoresForRange } from './backtest/engine';
import { appendEvent } from './events';

// Warm the savings cache once on app boot if it looks empty. The daily
// cron at 03:45 keeps it fresh; this runs before that first cron tick so
// the first /savings load on a fresh install (or after a schema migration
// that introduced these tables) doesn't pay the full-window readings scan.
//
// Non-blocking: returns immediately, runs the recompute on the next tick.
// Failures are logged but never thrown — the savings page falls back to
// live compute when the cache is missing.
export function ensureSavingsCacheWarm(): void {
  setImmediate(() => {
    try {
      const db = getDb();
      const row = db
        .prepare('SELECT COUNT(*) AS c FROM attribution_daily_cache')
        .get() as { c: number };
      if (row.c > 0) return; // already warm

      const startedAt = Date.now();
      const attribution = recomputeAttributionRange(90);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const fromISO = new Date(today.getTime() - 90 * 86400000).toISOString();
      const toISO = today.toISOString();
      const slots = recomputeSlotScoresForRange({ fromISO, toISO });
      appendEvent({
        level: 'info',
        category: 'savings-cache',
        message: `Savings cache warmed at boot: ${attribution.days_recomputed} days, ${slots.slots_recomputed} slots in ${Date.now() - startedAt}ms.`,
      });
    } catch (err) {
      try {
        appendEvent({
          level: 'error',
          category: 'savings-cache',
          message: `Savings cache warm-up failed: ${(err as Error).message}`,
        });
      } catch {
        // swallow — boot path must never throw
      }
    }
  });
}
