# API Reference

This document lists the HTTP routes currently exposed by the Next.js App Router backend under `src/app/api/`.

## Configuration and Status

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/settings` | Return the current persisted settings merged with defaults. |
| `POST` | `/api/settings` | Update known settings keys, including charging strategy selection, and reconnect MQTT if connection settings change. |
| `GET` | `/api/status` | Return the latest in-memory inverter and connection state. |
| `GET` | `/api/system` | Return health, stats, runtime metadata, and database information. |

## Tariffs, Scheduling, and Overrides

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/octopus/verify` | Verify Octopus account details and infer tariff metadata. |
| `GET` | `/api/rates` | Return stored Agile rates, optionally filtered by query range. |
| `POST` | `/api/rates` | Fetch the latest Agile rates from Octopus and store them. |
| `GET` | `/api/schedule` | Return recent planned and executed schedules. |
| `POST` | `/api/schedule` | Trigger a scheduling cycle and return the resulting schedules. |
| `GET` | `/api/overrides` | Return manual charge-slot overrides for the current day. |
| `POST` | `/api/overrides` | Replace the current day’s manual overrides with the provided slots. |
| `DELETE` | `/api/overrides` | Clear the current day’s manual overrides. |

## Telemetry and Event Streams

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/events` | Stream live inverter state over server-sent events. |
| `GET` | `/api/events-log` | Return persisted event history for operator review. |
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

## Change Management

- Update this document when new routes are added, removed, or change purpose.
- If a route’s request or response contract becomes more complex, add a focused per-endpoint section or split that area into a dedicated API spec.
