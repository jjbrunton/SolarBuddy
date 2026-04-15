# API Reference

This document lists the HTTP routes currently exposed by the Next.js App Router backend under `src/app/api/`.

## Configuration and Status

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/settings` | Return the current persisted settings merged with defaults. |
| `POST` | `/api/settings` | Update known settings keys, including charging strategy selection, and reconnect MQTT if connection settings change. |
| `GET` | `/api/status` | Return the latest in-memory inverter and connection state. |
| `GET` | `/api/health` | Return deployment health for container platforms. This endpoint only checks process and SQLite availability. |
| `GET` | `/api/system` | Return health, stats, runtime metadata, and database information, including whether Auto Schedule and the inverter watchdog are enabled. |
| `POST` | `/api/system/time-sync` | Trigger an inverter clock synchronization and return the outcome. |
| `POST` | `/api/system/tariff-check` | Trigger a tariff-change check against the configured Octopus account and return the result. |
| `GET` | `/api/virtual-inverter` | Return the current virtual runtime status, selected scenario, playback state, and available controls. |
| `POST` | `/api/virtual-inverter` | Enable, start, pause, reset, or disable the virtual inverter runtime. |
| `GET` | `/api/virtual-inverter/scenarios` | Return the catalog of built-in virtual inverter scenarios. |

## Tariffs, Scheduling, and Overrides

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/octopus/verify` | Verify Octopus account details and infer tariff metadata. |
| `GET` | `/api/rates` | Return stored Agile rates, optionally filtered by query range. |
| `POST` | `/api/rates` | Fetch the latest Agile rates from Octopus and store them. |
| `POST` | `/api/rates/nordpool/refresh` | Manually trigger the Nordpool N2EX day-ahead forecast: fetch tomorrow's prices, convert to estimated Agile rates using the configured multiplier and peak adder, and replan. Only runs when `nordpool_forecast_enabled` is `true` and the tariff shape is Agile. |
| `GET` | `/api/forecast` | Return stored PV forecast data, optionally filtered by query range, plus forecast age in minutes. |
| `POST` | `/api/forecast` | Fetch fresh PV forecast data from Solcast when the cached forecast is stale enough to refresh. |
| `GET` | `/api/schedule` | Return recent schedule history for the Charge Plan page, including persisted charge/discharge windows and the canonical slot-by-slot battery plan for roughly the last 30 days plus any future stored horizon. |
| `POST` | `/api/schedule` | Trigger a scheduling cycle and return the refreshed recent schedule history payload. |
| `GET` | `/api/overrides` | Return manual charge-slot overrides for the current day. |
| `POST` | `/api/overrides` | Replace the current day’s manual overrides with the provided slots and immediately reconcile the inverter if the current slot changed. |
| `PATCH` | `/api/overrides` | Upsert a single override slot and immediately reconcile the inverter when that slot is active now. |
| `DELETE` | `/api/overrides` | Clear one or all current-day overrides and immediately reconcile the inverter state. |
| `GET` | `/api/scheduled-actions` | Return the configured scheduled operator actions stored in SQLite. |
| `POST` | `/api/scheduled-actions` | Create or replace a scheduled operator action. |
| `PATCH` | `/api/scheduled-actions` | Update an existing scheduled operator action by id. |
| `DELETE` | `/api/scheduled-actions` | Delete a scheduled operator action by id. |
| `POST` | `/api/simulate` | Run the planner and simulator against stored tariff data and return projected slot-by-slot outcomes without sending inverter commands. |

## Notifications

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/notifications/test` | Send a test notification to the specified channel (`discord` or `telegram`) using the current saved settings. Returns `{ ok }` on success or `{ ok, error }` on failure. |

## Home Assistant Integration

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/home-assistant/status` | Return the current Home Assistant publisher status: `{ enabled, connected, host, lastError, publishedEntities }`. Used by the Settings UI status panel. |
| `POST` | `/api/home-assistant/test` | Open a throwaway MQTT connection with the current settings, publish and retract a test discovery config, and return `{ ok }` or `{ ok: false, error }`. Does not affect the live publisher. |

## Telemetry and Event Streams

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/events` | Stream live inverter state over server-sent events. |
| `GET` | `/api/events-log` | Return operator-facing event history for review. If the dedicated `events` table is still empty, the response synthesizes recent scheduler and MQTT lifecycle activity so existing installs do not render a blank activity feed. |
| `GET` | `/api/system/mqtt-log` | Stream recent MQTT connection and topic activity over server-sent events. |
| `GET` | `/api/readings` | Return persisted telemetry readings for charting and history views. |

## Analytics

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/analytics/accounting` | Return accounting-oriented savings and cashflow totals for the selected period. |
| `GET` | `/api/analytics/savings` | Return savings analytics and comparative cost views. |
| `GET` | `/api/analytics/battery-profit` | Return battery charge cost, discharge revenue, and net profit for the selected period. |
| `GET` | `/api/analytics/bill-estimate` | Return estimated electricity bill for today (actual + forecast) and tomorrow (fully forecast), combining import rates, PV generation, learned consumption, and planned battery actions. |
| `GET` | `/api/usage-profile` | Return the learned half-hour consumption profile with weekday/weekend buckets, baseload, and high-consumption periods. |
| `POST` | `/api/usage-profile/refresh` | Recompute the usage profile on demand from the configured usage source (Octopus consumption data when selected, otherwise local telemetry). |

## API Design Notes

- Route handlers are implemented with App Router `route.ts` files.
- Request validation is performed at the route boundary before data is persisted or services are invoked.
- Most routes either query SQLite directly for simple reads or delegate to focused modules under `src/lib/`.
- `/api/events` and `/api/system/mqtt-log` are streaming endpoints. The rest return JSON responses.
- `/api/health` is the deployment-oriented liveness/readiness probe. It should stay cheap and should not depend on MQTT or Octopus API freshness.
- `/api/overrides` now doubles as an actuator trigger for the live slot: after override writes complete, the scheduler watchdog recalculates the desired inverter state and sends MQTT commands when the inverter is not already compliant.
- When Virtual Inverter mode is enabled, `/api/status`, `/api/events`, `/api/rates`, `/api/forecast`, `/api/schedule`, `/api/simulate`, and `/api/system` become mode-aware and return scenario-backed data while keeping their response shapes compatible with live mode.
- `POST /api/rates` and `POST /api/forecast` do not call external services in virtual mode; they return the active scenario fixtures instead.
- Usage profile refresh always uses local inverter telemetry (`readings.load_power`) to learn actual household consumption, unaffected by solar generation offset.

## `/api/schedule` Response Notes

- `GET /api/schedule` returns `{ schedules, plan_slots }`.
- `plan_slots` is the canonical planner output for each future half-hour slot and includes the planned `action`, planner `reason`, `expected_soc_after`, and `expected_value`. Normal future planner output should now be `charge`, `discharge`, or `hold`, where `hold` means the runtime should actively prevent battery discharge in that slot.
- `schedules` is the derived charge/discharge window view used for execution history and timer scheduling. Discharge windows are marked with `type = 'discharge'`.
- `POST /api/schedule` returns the same `schedules` and `plan_slots` collections plus the schedule-cycle result metadata (`ok`, `status`, and any operator-facing message).
- In virtual mode, the route does not persist sandbox plan rows into SQLite. It derives the same response shape from the in-memory scenario and current virtual SOC.

## `/api/virtual-inverter` Notes

- `GET /api/virtual-inverter` returns the current runtime status plus `mode`, `enabled`, `scenarioId`, `scenarioName`, `playbackState`, `speed`, `virtualTime`, `startSoc`, `loadMultiplier`, and `availableControls`.
- `POST /api/virtual-inverter` accepts an `action` of `enable`, `start`, `pause`, `reset`, or `disable`. `start`, `enable`, and `reset` may also include `scenarioId`, `speed`, `startSoc`, and `loadMultiplier`.
- `GET /api/virtual-inverter/scenarios` returns the preset metadata used by the Settings UI.

## Change Management

- Update this document when new routes are added, removed, or change purpose.
- If a route’s request or response contract becomes more complex, add a focused per-endpoint section or split that area into a dedicated API spec.
