'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSSE } from '@/hooks/useSSE';
import { ACTION_COLORS, type PlanAction } from '@/lib/plan-actions';
import { toSlotKey, expandHalfHourSlotKeys } from '@/lib/slot-key';

interface Rate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

interface Schedule {
  slot_start: string;
  slot_end: string;
  status: string;
  type?: 'charge' | 'discharge';
}

interface PlannedSlotRow {
  slot_start: string;
  action: PlanAction;
}

interface TickerSlot {
  validFrom: string;
  validTo: string;
  price: number;
  action: PlanAction;
  isCurrent: boolean;
}

const WINDOW_SIZE = 12; // 6 hours of half-hour slots around "now"
const WINDOW_LEAD = 2; // slots to show before the current one

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(price: number) {
  return `${price.toFixed(1).replace(/\.0$/, '')}p`;
}

/*
 * TariffTicker — the persistent half-hour heartbeat of the app.
 *
 * Mounted once in AppShell so it sits above every route. Shows a
 * centred window of Agile slots around the current one, with the
 * current slot pinned and highlighted. Each slot shows its time,
 * price, and a small action dot (ember / signal / rule) reflecting
 * what the planner intends to do. Clicking any slot jumps to /rates.
 *
 * Rendering cost is intentionally low: a single fetch on mount + every
 * 60s, same cadence as CurrentRateWidget, and no per-slot re-render
 * beyond the "current" membership check.
 */
export function TariffTicker() {
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () =>
      state.runtime_mode === 'virtual' && state.virtual_time
        ? new Date(state.virtual_time)
        : new Date(),
    [state.runtime_mode, state.virtual_time],
  );
  const effectiveNowRef = useRef(effectiveNow);
  const [slots, setSlots] = useState<TickerSlot[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    effectiveNowRef.current = effectiveNow;
  }, [effectiveNow]);

  useEffect(() => {
    async function load() {
      try {
        const [ratesRes, scheduleRes] = await Promise.all([
          fetch('/api/rates'),
          fetch('/api/schedule'),
        ]);
        const ratesJson = await ratesRes.json();
        const scheduleJson = await scheduleRes.json();

        const rates: Rate[] = ratesJson.rates || [];
        const schedules: Schedule[] = scheduleJson.schedules || [];
        const plannedSlots: PlannedSlotRow[] = scheduleJson.plan_slots || [];

        const plannedActionMap = new Map<string, PlanAction>();
        for (const slot of plannedSlots) {
          plannedActionMap.set(toSlotKey(slot.slot_start), slot.action);
        }
        for (const s of schedules) {
          if (s.status === 'planned' || s.status === 'active') {
            for (const slotKey of expandHalfHourSlotKeys(s.slot_start, s.slot_end)) {
              if (!plannedActionMap.has(slotKey)) {
                plannedActionMap.set(slotKey, s.type === 'discharge' ? 'discharge' : 'charge');
              }
            }
          }
        }

        const now = effectiveNowRef.current;
        const all: TickerSlot[] = rates.map((rate) => {
          const dt = new Date(rate.valid_from);
          const end = new Date(rate.valid_to);
          return {
            validFrom: rate.valid_from,
            validTo: rate.valid_to,
            price: Math.round(rate.price_inc_vat * 100) / 100,
            action: plannedActionMap.get(toSlotKey(rate.valid_from)) ?? 'hold',
            isCurrent: now >= dt && now < end,
          };
        });

        // Centre the window around the current slot (or the nearest
        // upcoming one if there is no active slot in the loaded rates).
        const currentIdx = all.findIndex((s) => s.isCurrent);
        const anchor =
          currentIdx >= 0
            ? currentIdx
            : all.findIndex((s) => new Date(s.validFrom) >= new Date());
        const start = Math.max(0, (anchor >= 0 ? anchor : 0) - WINDOW_LEAD);
        const windowed = all.slice(start, start + WINDOW_SIZE);
        setSlots(windowed);
        setReady(true);
      } catch {
        setSlots([]);
        setReady(true);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [state.runtime_mode, state.virtual_time]);

  if (!ready || slots.length === 0) {
    return (
      <div className="border-b border-sb-rule bg-sb-bg-elevated/50">
        <div className="flex h-[52px] items-center gap-3 px-4 sm:px-6">
          <span className="sb-eyebrow">Tariff</span>
          <span className="text-xs text-sb-text-subtle">Waiting for rates…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-sb-rule bg-sb-bg-elevated/50">
      <div className="relative flex items-center gap-3 px-4 py-2 sm:px-6">
        <span className="sb-eyebrow shrink-0">Tariff</span>
        <div className="h-4 w-px bg-sb-rule" />
        <div className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto">
          {slots.map((slot, i) => (
            <Link
              key={slot.validFrom}
              href="/rates"
              aria-label={`${formatTime(slot.validFrom)} ${formatPrice(slot.price)}`}
              className={`animate-ticker-rise group relative flex min-w-[72px] flex-col justify-center border-r border-sb-rule/60 px-3 py-1.5 text-left transition-colors last:border-r-0 hover:bg-sb-card/60 ${
                slot.isCurrent ? 'bg-sb-ember/8' : ''
              }`}
              style={{ animationDelay: `${i * 28}ms` }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: ACTION_COLORS[slot.action] }}
                />
                <span className="font-[family-name:var(--font-sb-mono)] text-[0.64rem] tracking-[0.06em] text-sb-text-subtle">
                  {formatTime(slot.validFrom)}
                </span>
              </div>
              <span
                className={`sb-display mt-0.5 text-base leading-none ${
                  slot.isCurrent ? 'text-sb-ember' : 'text-sb-text'
                }`}
              >
                {formatPrice(slot.price)}
              </span>
              {slot.isCurrent ? (
                <span className="absolute inset-x-0 -bottom-[1px] h-[2px] bg-sb-ember" />
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
