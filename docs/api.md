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

## Tariffs, Scheduling, and Overrides

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/octopus/verify` | Verify Octopus account details and infer tariff metadata. |
| `GET` | `/api/rates` | Return stored Agile rates, optionally filtered by query range. |
| `POST` | `/api/rates` | Fetch the latest Agile rates from Octopus and store them. |
| `GET` | `/api/schedule` | Return recent schedule history for the Charge Plan page, including persisted charge/discharge windows and the canonical slot-by-slot battery plan for roughly the last 30 days plus any future stored horizon. |
| `POST` | `/api/schedule` | Trigger a scheduling cycle and return the refreshed recent schedule history payload. |
| `GET` | `/api/overrides` | Return manual charge-slot overrides for the current day. |
| `POST` | `/api/overrides` | Replace the current day’s manual overrides with the provided slots and immediately reconcile the inverter if the current slot changed. |
| `PATCH` | `/api/overrides` | Upsert a single override slot and immediately reconcile the inverter when that slot is active now. |
| `DELETE` | `/api/overrides` | Clear one or all current-day overrides and immediately reconcile the inverter state. |

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
| `GET` | `/api/analytics/energy` | Return energy-flow analytics for a selected period. |
| `GET` | `/api/analytics/savings` | Return savings analytics and comparative cost views. |
| `GET` | `/api/analytics/rates-compare` | Return tariff comparison analytics. |
| `GET` | `/api/analytics/carbon` | Return carbon intensity analytics. |
| `GET` | `/api/analytics/battery` | Return battery health and charge-cycle analytics. |

## API Design Notes

- Route handlers are implemented with App Router `route.ts` files.
- Request validation is performed at the route boundary before data is persisted or services are invoked.
- Most routes either query SQLite directly for simple reads or delegate to focused modules under `src/lib/`.
- `/api/events` and `/api/system/mqtt-log` are streaming endpoints. The rest return JSON responses.
- `/api/health` is the deployment-oriented liveness/readiness probe. It should stay cheap and should not depend on MQTT or Octopus API freshness.
- `/api/overrides` now doubles as an actuator trigger for the live slot: after override writes complete, the scheduler watchdog recalculates the desired inverter state and sends MQTT commands when the inverter is not already compliant.

## `/api/schedule` Response Notes

- `GET /api/schedule` returns `{ schedules, plan_slots }`.
- `plan_slots` is the canonical planner output for each future half-hour slot and includes the planned `action`, planner `reason`, `expected_soc_after`, and `expected_value`. Normal future planner output should now be `charge`, `discharge`, or `hold`, where `hold` means the runtime should actively prevent battery discharge in that slot.
- `schedules` is the derived charge/discharge window view used for execution history and timer scheduling. Discharge windows are marked with `type = 'discharge'`.
- `POST /api/schedule` returns the same `schedules` and `plan_slots` collections plus the schedule-cycle result metadata (`ok`, `status`, and any operator-facing message).

## Change Management

- Update this document when new routes are added, removed, or change purpose.
- If a route’s request or response contract becomes more complex, add a focused per-endpoint section or split that area into a dedicated API spec.
