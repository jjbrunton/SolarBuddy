import { AgileRate } from '../octopus/rates';
import { AppSettings } from '../config';

export interface ChargeWindow {
  slot_start: string;
  slot_end: string;
  avg_price: number;
  slots: AgileRate[];
}

export function findCheapestSlots(rates: AgileRate[], settings: AppSettings): ChargeWindow[] {
  const chargeHours = parseInt(settings.charge_hours) || 4;
  const priceThreshold = parseFloat(settings.price_threshold) || 0;
  const windowStart = settings.charge_window_start || '23:00';
  const windowEnd = settings.charge_window_end || '07:00';

  // Filter rates to charge window
  const eligible = rates.filter((rate) => isInChargeWindow(rate.valid_from, windowStart, windowEnd));

  if (eligible.length === 0) return [];

  let selected: AgileRate[];

  if (priceThreshold > 0) {
    // Mode: charge whenever price is below threshold
    selected = eligible.filter((r) => r.price_inc_vat <= priceThreshold);
  } else {
    // Mode: pick the cheapest N half-hour slots
    const sorted = [...eligible].sort((a, b) => a.price_inc_vat - b.price_inc_vat);
    selected = sorted.slice(0, chargeHours);
  }

  if (selected.length === 0) return [];

  // Sort selected slots by time and merge adjacent ones
  selected.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  return mergeAdjacentSlots(selected);
}

function isInChargeWindow(validFrom: string, windowStart: string, windowEnd: string): boolean {
  const dt = new Date(validFrom);
  const hours = dt.getUTCHours();
  const minutes = dt.getUTCMinutes();
  const time = hours * 60 + minutes;

  const [startH, startM] = windowStart.split(':').map(Number);
  const [endH, endM] = windowEnd.split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  if (start > end) {
    // Overnight window (e.g. 23:00 to 07:00)
    return time >= start || time < end;
  }
  return time >= start && time < end;
}

function mergeAdjacentSlots(slots: AgileRate[]): ChargeWindow[] {
  if (slots.length === 0) return [];

  const windows: ChargeWindow[] = [];
  let currentSlots: AgileRate[] = [slots[0]];

  for (let i = 1; i < slots.length; i++) {
    const prev = currentSlots[currentSlots.length - 1];
    const curr = slots[i];

    // Check if this slot is adjacent to the previous one
    if (prev.valid_to === curr.valid_from) {
      currentSlots.push(curr);
    } else {
      windows.push(createWindow(currentSlots));
      currentSlots = [curr];
    }
  }

  windows.push(createWindow(currentSlots));
  return windows;
}

function createWindow(slots: AgileRate[]): ChargeWindow {
  const totalPrice = slots.reduce((sum, s) => sum + s.price_inc_vat, 0);
  return {
    slot_start: slots[0].valid_from,
    slot_end: slots[slots.length - 1].valid_to,
    avg_price: totalPrice / slots.length,
    slots,
  };
}
