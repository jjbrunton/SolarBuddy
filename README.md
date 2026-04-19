# SolarBuddy

[![Validation](https://github.com/jjbrunton/SolarBuddy/actions/workflows/validation.yml/badge.svg)](https://github.com/jjbrunton/SolarBuddy/actions/workflows/validation.yml)
[![CodeQL](https://github.com/jjbrunton/SolarBuddy/actions/workflows/codeql.yml/badge.svg)](https://github.com/jjbrunton/SolarBuddy/actions/workflows/codeql.yml)
[![Dependency Review](https://github.com/jjbrunton/SolarBuddy/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/jjbrunton/SolarBuddy/actions/workflows/dependency-review.yml)
[![Release](https://github.com/jjbrunton/SolarBuddy/actions/workflows/release.yml/badge.svg)](https://github.com/jjbrunton/SolarBuddy/actions/workflows/release.yml)
[![Coverage](https://raw.githubusercontent.com/jjbrunton/SolarBuddy/badge-data/badges/coverage.svg)](https://github.com/jjbrunton/SolarBuddy/actions/workflows/validation.yml)
![GitHub Release](https://img.shields.io/github/v/release/jjbrunton/SolarBuddy?include_prereleases)
![GitHub last commit](https://img.shields.io/github/last-commit/jjbrunton/SolarBuddy)
![GitHub Repo stars](https://img.shields.io/github/stars/jjbrunton/SolarBuddy)
![GitHub License](https://img.shields.io/github/license/jjbrunton/SolarBuddy)
[![Node 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](https://github.com/jjbrunton/SolarBuddy/blob/main/.nvmrc)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2Fjjbrunton%2Fsolarbuddy-2496ED?logo=docker&logoColor=white)](https://github.com/jjbrunton/SolarBuddy/pkgs/container/solarbuddy)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/jjbrunton)

If you're on Octopus Energy or thinking of switching, you can use my [referral link](https://share.octopus.energy/beige-briar-856) — we both get £50 credit.

A self-hosted dashboard for managing solar battery charging and discharge with Octopus Energy Agile tariff integration. It plans battery actions across half-hour tariff slots and executes the resulting charge and discharge windows automatically.

## Screenshots

**Dashboard** — live gauges, energy flow diagram, and current rate overview

![Dashboard](docs/images/dashboard.png)

**Energy Rates** — Agile tariff visualization with charge, discharge, and hold slot overlays

![Energy Rates](docs/images/rates.png)

**Schedule** — slot-by-slot charge plan with planner reasoning and manual override controls

![Schedule](docs/images/schedule.png)

## Documentation

- [Documentation Index](docs/README.md)
- [Software Architecture](docs/architecture.md)
- [API Reference](docs/api.md)
- [Development and Verification](docs/development.md)
- [Deployment](docs/deployment.md)
- [Testing Strategy](docs/testing-strategy.md)
- [AI-Assisted Workflow](docs/ai-workflow.md)
- [Virtual Inverter](docs/virtual-inverter.md)
- [Home Assistant Integration](docs/home-assistant.md)
- [Release Process](docs/release-process.md)
- [Design System](docs/design-system.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [License](LICENSE)

## Features

- Mandatory single-user login with a first-run setup flow, plus issuable API keys so Home Assistant, scripts, and other external systems can reach SolarBuddy endpoints programmatically
- Real-time inverter monitoring via Solar Assistant (MQTT)
- Optional Home Assistant integration via MQTT Discovery — publishes sensors, switches, selects and buttons to HA and accepts commands from HA automations ([docs/home-assistant.md](docs/home-assistant.md))
- Optional Virtual Inverter mode with preset sandbox scenarios for safe end-to-end testing without touching live hardware
- Browser-side fallback for live telemetry: the UI restores the last known inverter state after a reload and shows a global status banner while waiting for fresh MQTT data
- Live MQTT traffic log on the System Logs page for broker troubleshooting
- Dashboard current-rate card with live Agile slot, next-slot preview, and loaded rate benchmarks
- Inverter configuration read-back, including compatibility fallbacks for renamed Solar Assistant settings and clear unavailable-state messaging when an inverter does not publish a read-back value
- Octopus Energy Agile rate tracking and visualization, with optional Nordpool N2EX day-ahead forecasts to preview and plan tomorrow's slots before Octopus publishes them
- Solcast-backed PV generation forecasting used by the planner, bill estimate, and dashboard forecast card
- Usage-profile learning that can pull half-hour household import data from Octopus (with automatic fallback to local telemetry when Octopus data is unavailable)
- Automatic battery scheduling with selectable Night Fill and Opportunistic Top-up strategies, horizon-aware smart discharge, and slot-level hold planning
- Manual charge window and work mode overrides, plus time-of-day scheduled operator actions (charge/discharge/hold) with day and SOC conditions
- Daily charge-plan navigation that defaults to today and keeps recent schedule history available for review
- Inverter watchdog reconciliation that re-applies the active schedule or override after restarts and inverter drift
- Analytics views for savings, battery profit, savings attribution, and today/tomorrow bill estimates
- Optional Discord and Telegram notifications for operator-facing events
- Activity log and system status

## Architecture

- **Frontend**: Next.js App Router with React, Tailwind CSS, Recharts
- **Backend**: Next.js API routes, SQLite (via better-sqlite3) for persistence
- **Integrations**: MQTT for Solar Assistant, Octopus Energy REST API for tariff rates, Nordpool N2EX for day-ahead forecasts, Solcast for PV forecasts, Home Assistant via MQTT Discovery, and Discord/Telegram for notifications
- **Scheduling**: node-cron for periodic rate fetching and charge window calculation

### Key Modules

| Path | Purpose |
|------|---------|
| `src/lib/octopus/` | Octopus Energy API client (rates, account verification) |
| `src/lib/nordpool/` | Nordpool N2EX day-ahead forecast client and Agile-rate converter |
| `src/lib/solcast/` | Solcast PV forecast client and storage |
| `src/lib/mqtt/` | MQTT client for Solar Assistant inverter data |
| `src/lib/home-assistant/` | Home Assistant MQTT Discovery publisher and command handler |
| `src/lib/notifications/` | Dispatcher and channel adapters for Discord and Telegram |
| `src/lib/scheduler/` | Cron jobs, slot planner, and execution engine |
| `src/lib/usage/` | Usage-profile learning from Octopus consumption and local telemetry |
| `src/lib/analytics.ts`, `src/lib/accounting.ts`, `src/lib/attribution.ts`, `src/lib/bill-estimate.ts` | Savings, battery profit, attribution, and bill-estimate analytics |
| `src/lib/config.ts` | Settings schema and SQLite persistence |
| `src/lib/db/` | Database initialization, migrations, and repository modules |

## Getting Started

### Prerequisites

- Node.js 22 recommended (`.nvmrc` is provided)
- A Solar Assistant device on your network (for inverter data)
- An Octopus Energy account with an Agile tariff (for rate data)

### Install and Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. On first launch you'll be redirected to `/setup` to create the single administrator account — a username and password of at least 8 characters. After that, every page and API route requires either a signed session cookie (obtained via the login form) or an API key sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`. `GET /api/health` stays unauthenticated so platform health checks keep working.

## Deployment

SolarBuddy now ships with a generic multi-stage `Dockerfile` so the repo can be deployed on Dokploy, plain Docker, or other container platforms without committing platform-specific manifests.

- Run it as a single instance only. Scheduler timers, watchdog reconciliation, and live telemetry state are process-local.
- Mount persistent storage for SQLite and point `DB_PATH` at that volume. The default container path is `/app/data/solarbuddy.db`.
- Use `GET /api/health` as the platform health check. It verifies that the process is up and the database can be queried, without depending on MQTT or Octopus connectivity.

For the full deployment contract and Dokploy guidance, see [docs/deployment.md](docs/deployment.md).

### Configuration

All settings are managed through the web UI under **Settings**:

1. **MQTT** — Solar Assistant host, port, and credentials
2. **Octopus Energy** — API key and account number (region and tariff are auto-detected)
3. **Charging** — Strategy, max slots, price thresholds, charge/discharge SOC targets, night window, work mode, and usage-profile source (Octopus vs local telemetry)
4. **General** — Background automation toggles such as Auto Schedule and the inverter watchdog
5. **Virtual Inverter** — Optional sandbox mode with preset scenarios, playback controls, and live-command blocking
6. **Account** — Change the administrator password and create or revoke API keys for external systems. The plaintext key is shown exactly once at creation; see [docs/runbooks.md](docs/runbooks.md) for password-reset and key-rotation procedures.

### Dashboard Highlights

- The dashboard overview is intentionally limited to seven non-overlapping widgets: live gauges, current mode, energy flow, current rate, rate chart, upcoming charges, and solar forecast.
- The dashboard includes a dedicated **Current Mode** card showing the scheduler's resolved live action (`charge`, `hold`, or `discharge`), its source, and the active slot timing.
- The dashboard includes a dedicated **Current Rate** card showing the active Agile half-hour slot, the next slot price, and low/average benchmarks from the currently loaded rates.
- Click the current-rate card or the rate chart to jump to the full `/rates` view for detailed rate inspection and manual scheduling actions.
- Current-day operational charts such as the dashboard rate chart, the full rates view, and the charge-plan overview start at the active or next slot instead of midnight, so operators see the actionable horizon first.

#### Scheduling Notes

- `Night Fill` uses the configured overnight window and tries to reach the target SOC by selecting the cheapest eligible slots needed, capped by the configured max slot count.
- `Opportunistic Top-up` ignores the overnight window and plans across the current and future slots in the currently published Agile tariff horizon.
- `Price Threshold` is an optional eligibility ceiling for either strategy. If it is greater than `0`, SolarBuddy only plans slots at or below that price.
- `Max Charge Slots` is now a cap rather than a fixed target. When live battery SOC and charge-power settings are available, SolarBuddy trims the plan to only the slots needed to reach the target SOC.
- `Smart Discharge` now simulates the published tariff horizon slot by slot, so it can charge cheaply first, discharge later in expensive slots, and still preserve the configured reserve SOC floor.
- In `Opportunistic Top-up` with `Smart Discharge` enabled, SolarBuddy now caps base charge-slot selection using expected demand in high-value discharge periods, so it avoids over-filling when the battery already has enough energy above the reserve floor.
- `Discharge Price Threshold` is an optional minimum value for automatic discharge windows. If export rates are loaded, SolarBuddy applies this threshold to the export price for each slot; otherwise it falls back to the import slot price.
- Smart Discharge candidate ranking now uses slot export value (falling back to import price when export rates are unavailable) so discharge priority tracks what energy is actually worth at that time.
- Smart Discharge value checks now use a conservative discharge economics model (discharge-efficiency and per-kWh battery wear cost) and compare candidate discharge value against a weighted average cost of purchased energy currently stored in the battery.
- Usage-profile learning now prefers Octopus import-consumption intervals when `Usage Profile Source` is set to `Octopus`. If Octopus credentials or meter identifiers are missing, or Octopus usage retrieval fails, SolarBuddy falls back to local telemetry-derived usage until Octopus data becomes available again.
- When a profitable discharge would otherwise cause SolarBuddy to miss a later SOC target, it can add extra cheap charge slots within the configured charge-slot budget to keep the plan feasible.
- The scheduler now persists a canonical slot-by-slot battery plan in `plan_slots` with `charge`, `discharge`, or `hold` for every future tariff slot in the published horizon. Charge and discharge windows in `schedules` are derived from that plan for execution and history views.
- `hold` means SolarBuddy drives the inverter into a battery-preserving state for that slot to prevent discharge. It may be preserving energy for a better later discharge opportunity, or simply deciding to wait.
- When SolarBuddy switches from charging to a planned discharge, it now clears the inverter charge slot first so models with partial Solar Assistant read-back cannot stay stuck charging.
- Setting an override on the current half-hour slot now triggers an immediate inverter reconciliation pass instead of waiting for the next scheduled timer.
- A background watchdog reconciles the desired inverter state on startup, every 30 seconds, and after relevant telemetry changes. That lets SolarBuddy recover an active window after a restart and retry drifted inverter state if the inverter is no longer in the requested mode.
- The watchdog can be disabled from Settings > General when you want SolarBuddy to stop sending background corrective inverter commands. Disabling it does not remove stored plans or block explicit operator actions such as saving an override.
- Charge window times are evaluated in UK local time (`Europe/London`), including daylight saving changes.
- Overnight schedules can only be generated once Octopus has published the relevant upcoming Agile rates, which is typically later the same day.
- Running the scheduler with valid rates but no eligible slots clears any existing planned schedule for that day and reports that no charge windows matched the current configuration.
- The Charge Plan page groups slot history by UK-local day, opens on today by default, and lets operators step through recent stored days without losing the slot-by-slot planner rationale.

#### Octopus Energy Setup

1. Get your API key from [Octopus Energy Developer Dashboard](https://octopus.energy/dashboard/new/accounts/personal-details/api-access)
2. Enter your API key and account number (format: `A-1234ABCD`) in Settings > Octopus Energy
3. Click **Verify Account** — your region, tariff, MPAN, and meter serial are auto-detected and saved immediately
4. Use **Save Settings** if you manually adjust any Octopus values afterwards

## Key API Routes

For the full route inventory, see [docs/api.md](docs/api.md).

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/auth/setup` | First-run administrator account creation |
| POST | `/api/auth/login` | Exchange username/password for a session cookie |
| POST | `/api/auth/logout` | Clear the session cookie |
| GET | `/api/auth/status` | Report whether auth is configured and whether the caller is authenticated |
| POST | `/api/auth/password` | Change the administrator password |
| GET, POST | `/api/auth/api-keys` | List or create API keys for external systems |
| DELETE | `/api/auth/api-keys/[prefix]` | Revoke an API key by its prefix |
| GET | `/api/settings` | Retrieve all settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/octopus/verify` | Verify Octopus account and auto-detect tariff details |
| GET | `/api/rates?from=&to=` | Retrieve stored Agile rates |
| POST | `/api/rates` | Trigger rate fetch from Octopus API |
| POST | `/api/rates/nordpool/refresh` | Manually refresh the Nordpool N2EX day-ahead forecast |
| GET, POST | `/api/forecast` | Return stored Solcast PV forecasts or trigger a refresh when stale |
| GET | `/api/status` | Current inverter status |
| GET | `/api/health` | Deployment health check for container platforms |
| GET, POST | `/api/schedule` | Current battery windows plus slot-by-slot plan; `POST` re-runs the scheduler |
| GET, POST, PATCH, DELETE | `/api/overrides` | Read, replace, upsert, or clear manual charge-slot overrides for today |
| GET, POST, PATCH, DELETE | `/api/scheduled-actions` | Manage time-of-day scheduled operator actions |
| POST | `/api/simulate` | Dry-run the planner and simulator against stored tariff data |
| GET | `/api/readings` | Historical inverter readings |
| GET | `/api/events` | SSE stream of real-time events |
| GET | `/api/events-log` | Historical event log |
| GET | `/api/system` | System health info |
| POST | `/api/system/time-sync` | Trigger an inverter clock synchronization |
| POST | `/api/system/tariff-check` | Trigger a tariff-change check against the configured Octopus account |
| GET | `/api/system/mqtt-log` | SSE stream of recent MQTT connection and topic activity |
| GET | `/api/analytics/savings` | Savings analytics and comparative cost views |
| GET | `/api/analytics/accounting` | Accounting-oriented savings and cashflow totals |
| GET | `/api/analytics/battery-profit` | Battery charge cost, discharge revenue, and net profit |
| GET | `/api/analytics/attribution` | Savings-vs-standard-tariff breakdown (solar, tariff shift, export) |
| GET | `/api/analytics/bill-estimate` | Today and tomorrow bill estimate combining rates, PV, usage, and plan |
| GET | `/api/usage-profile` | Learned half-hour consumption profile |
| POST | `/api/usage-profile/refresh` | Recompute the usage profile on demand |
| POST | `/api/notifications/test` | Send a test notification to a configured channel (Discord or Telegram) |
| GET | `/api/home-assistant/status` | Home Assistant publisher status |
| POST | `/api/home-assistant/test` | Test the Home Assistant MQTT discovery publish without affecting the live publisher |
| GET | `/api/virtual-inverter` | Current virtual runtime status |
| POST | `/api/virtual-inverter` | Enable, start, pause, reset, or disable the virtual runtime |
| GET | `/api/virtual-inverter/scenarios` | List the available virtual inverter presets |

## Testing

```bash
npm test          # Run all tests once
npm run test:coverage  # Generate a backend/API coverage report
npm run test:integration  # Run *.integration.test.ts suites under src/**
npm run test:watch  # Run in watch mode
npm run lint      # Run the Next.js/TypeScript lint rules
npm run typecheck  # Run the TypeScript compiler in no-emit mode
npm run test:e2e:install  # One-time Playwright browser install
npm run test:e2e  # Run browser E2E tests against the production build
npm run verify    # Docs check, lint, tests, production build, smoke test, and E2E
npm run release:dry-run  # Build the release Docker image locally
```

Tests use [Vitest](https://vitest.dev/) and live in `__tests__/` directories alongside source files.
Coverage currently focuses on non-UI code under `src/lib/` and `src/app/api/`.

GitHub Actions validates commits and pull requests with the workflows under [`.github/workflows/`](.github/workflows/): validation, dependency review, and CodeQL. The validation workflow uses the same repo-facing commands documented in [docs/development.md](docs/development.md) and [docs/testing-strategy.md](docs/testing-strategy.md).

The repository publishes backend/API coverage as a GitHub Actions artifact and a repository-hosted badge from the validation workflow, exposes a public GHCR package at `ghcr.io/jjbrunton/solarbuddy`, and is licensed under [Apache 2.0](LICENSE).

For local setup and verification workflow details, see [docs/development.md](docs/development.md).

## Releases

SolarBuddy is an open source, self-hosted application. There is no shared hosted deployment: maintainers publish source changes and release artifacts, and self-hosters choose when to deploy them.

- `main` is the integration branch
- GitHub Releases publish container artifacts to GHCR
- The published container image is available at `ghcr.io/jjbrunton/solarbuddy`
- Self-hosters can deploy from the published image or build from source with the included `Dockerfile`

See [docs/release-process.md](docs/release-process.md) and [docs/deployment.md](docs/deployment.md) for the release and self-hosting contract.

## Data Storage

SQLite database at `data/solarbuddy.db` (override with `DB_PATH`). Tables:

- `settings` — key-value configuration store
- `rates` — cached Agile tariff rates (with `source` column for `octopus`, `nordpool`, or `tariff`)
- `export_rates` — cached Agile export rates
- `pv_forecasts` — cached Solcast PV generation forecasts
- `readings` — inverter telemetry snapshots
- `events` — system event history
- `mqtt_logs` — recent MQTT connection, topic, and command activity
- `plan_slots` — canonical slot-level battery policy and planner reasoning
- `plan_slot_executions` — per-slot execution log with actual import/export and command metadata
- `schedules` — computed charge and discharge windows derived from `plan_slots`
- `carbon_intensity` — cached grid carbon intensity data
- `manual_overrides` — operator-defined charge/discharge/hold slots for the current day
- `auto_overrides` — runtime-generated short-lived overrides (e.g. SOC protection)
- `scheduled_actions` — time-of-day scheduled operator actions with day and SOC conditions
- `usage_profile`, `usage_profile_meta` — learned half-hour consumption profile and metadata
- `api_keys` — hashed API keys used by external systems (only the sha256 digest, display prefix, name, and last-used timestamp are stored)
