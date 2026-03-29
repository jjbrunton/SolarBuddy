import { getState } from '../state';
import { getDb } from '../db';

const INTERVAL_MS = 60_000; // snapshot every 60 seconds

let timer: ReturnType<typeof setInterval> | null = null;

const INSERT_SQL = `
  INSERT INTO readings (
    timestamp, battery_soc, pv_power, grid_power, load_power,
    battery_voltage, battery_temperature, inverter_temperature,
    grid_voltage, grid_frequency, pv_power_1, pv_power_2
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function snapshot() {
  const state = getState();

  // Don't record if MQTT isn't connected (stale data)
  if (!state.mqtt_connected) return;

  try {
    const db = getDb();
    db.prepare(INSERT_SQL).run(
      new Date().toISOString(),
      state.battery_soc,
      state.pv_power,
      state.grid_power,
      state.load_power,
      state.battery_voltage,
      state.battery_temperature,
      state.inverter_temperature,
      state.grid_voltage,
      state.grid_frequency,
      state.pv_power_1,
      state.pv_power_2,
    );
  } catch (err) {
    console.error('[Readings] Insert failed:', (err as Error).message);
  }
}

export function startReadingsIngestion() {
  if (timer) return;
  console.log(`[Readings] Ingestion started (every ${INTERVAL_MS / 1000}s)`);
  timer = setInterval(snapshot, INTERVAL_MS);
}

export function stopReadingsIngestion() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
