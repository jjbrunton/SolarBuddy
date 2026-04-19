// Bucket raw readings into half-hour slots with measured load and PV energy.
//
// Each reading is a point-in-time power sample (W). We estimate energy per
// slot by taking the mean of the samples that fall inside the slot and
// multiplying by the slot duration. That matches how attribution.ts prices
// actual cost.
//
// A slot with no readings is omitted — the caller decides whether to treat
// that as a gap or fall back to usage-profile forecasts.

const HALF_HOUR_MS = 30 * 60 * 1000;

export interface ReadingSample {
  timestamp: string;
  load_power: number | null;
  pv_power: number | null;
  grid_power: number | null;
  battery_soc: number | null;
}

export interface MeasuredSlot {
  slot_start: string;
  load_kwh: number;
  pv_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  starting_soc: number | null;
}

export function halfHourStartISO(ts: string): string {
  const ms = new Date(ts).getTime();
  const bucket = Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
  return new Date(bucket).toISOString();
}

export function aggregateReadingsBySlot(readings: ReadingSample[]): MeasuredSlot[] {
  if (readings.length === 0) return [];

  interface Acc {
    slot_start: string;
    load_sum: number;
    load_n: number;
    pv_sum: number;
    pv_n: number;
    import_sum: number;
    import_n: number;
    export_sum: number;
    export_n: number;
    first_soc: number | null;
  }

  const buckets = new Map<string, Acc>();

  for (const r of readings) {
    const slotStart = halfHourStartISO(r.timestamp);
    let acc = buckets.get(slotStart);
    if (!acc) {
      acc = {
        slot_start: slotStart,
        load_sum: 0,
        load_n: 0,
        pv_sum: 0,
        pv_n: 0,
        import_sum: 0,
        import_n: 0,
        export_sum: 0,
        export_n: 0,
        first_soc: r.battery_soc ?? null,
      };
      buckets.set(slotStart, acc);
    }
    if (r.load_power != null) {
      acc.load_sum += r.load_power;
      acc.load_n += 1;
    }
    if (r.pv_power != null) {
      acc.pv_sum += r.pv_power;
      acc.pv_n += 1;
    }
    if (r.grid_power != null) {
      if (r.grid_power > 0) {
        acc.import_sum += r.grid_power;
        acc.import_n += 1;
      } else if (r.grid_power < 0) {
        acc.export_sum += -r.grid_power;
        acc.export_n += 1;
      } else {
        acc.import_n += 1;
        acc.export_n += 1;
      }
    }
  }

  const slots: MeasuredSlot[] = [];
  for (const acc of buckets.values()) {
    const meanLoadW = acc.load_n > 0 ? acc.load_sum / acc.load_n : 0;
    const meanPvW = acc.pv_n > 0 ? acc.pv_sum / acc.pv_n : 0;
    const meanImportW = acc.import_n > 0 ? acc.import_sum / acc.import_n : 0;
    const meanExportW = acc.export_n > 0 ? acc.export_sum / acc.export_n : 0;
    slots.push({
      slot_start: acc.slot_start,
      load_kwh: (meanLoadW * 0.5) / 1000,
      pv_kwh: (meanPvW * 0.5) / 1000,
      grid_import_kwh: (meanImportW * 0.5) / 1000,
      grid_export_kwh: (meanExportW * 0.5) / 1000,
      starting_soc: acc.first_soc,
    });
  }

  slots.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  return slots;
}
