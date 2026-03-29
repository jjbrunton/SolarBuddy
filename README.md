# SolarBuddy

A self-hosted dashboard for managing solar battery charging with Octopus Energy Agile tariff integration. Automatically schedules battery charging during the cheapest half-hour slots each day.

## Features

- Real-time inverter monitoring via Solar Assistant (MQTT)
- Octopus Energy Agile rate tracking and visualization
- Automatic charge scheduling based on cheapest rate slots
- Manual charge window and work mode overrides
- Activity log and system status

## Architecture

- **Frontend**: Next.js App Router with React, Tailwind CSS, Recharts
- **Backend**: Next.js API routes, SQLite (via better-sqlite3) for persistence
- **Integrations**: MQTT for Solar Assistant, Octopus Energy REST API for tariff rates
- **Scheduling**: node-cron for periodic rate fetching and charge window calculation

### Key Modules

| Path | Purpose |
|------|---------|
| `src/lib/octopus/` | Octopus Energy API client (rates, account verification) |
| `src/lib/mqtt/` | MQTT client for Solar Assistant inverter data |
| `src/lib/scheduler/` | Cron jobs and charge window engine |
| `src/lib/config.ts` | Settings schema and SQLite persistence |
| `src/lib/db.ts` | Database initialization and access |

## Getting Started

### Prerequisites

- Node.js 18+
- A Solar Assistant device on your network (for inverter data)
- An Octopus Energy account with an Agile tariff (for rate data)

### Install and Run

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

### Configuration

All settings are managed through the web UI under **Settings**:

1. **MQTT** — Solar Assistant host, port, and credentials
2. **Octopus Energy** — API key and account number (region and tariff are auto-detected)
3. **Charging** — Number of slots, price threshold, SOC target, charge window, work mode

#### Octopus Energy Setup

1. Get your API key from [Octopus Energy Developer Dashboard](https://octopus.energy/dashboard/new/accounts/personal-details/api-access)
2. Enter your API key and account number (format: `A-1234ABCD`) in Settings > Octopus Energy
3. Click **Verify Account** — your region, tariff, MPAN, and meter serial are auto-detected
4. Click **Save Settings**

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/settings` | Retrieve all settings |
| POST | `/api/settings` | Update settings |
| POST | `/api/octopus/verify` | Verify Octopus account and auto-detect tariff details |
| GET | `/api/rates?from=&to=` | Retrieve stored Agile rates |
| POST | `/api/rates` | Trigger rate fetch from Octopus API |
| GET | `/api/status` | Current inverter status |
| GET | `/api/schedule` | Current charge schedule |
| GET | `/api/readings` | Historical inverter readings |
| GET | `/api/events` | SSE stream of real-time events |
| GET | `/api/events-log` | Historical event log |
| GET | `/api/system` | System health info |

## Testing

```bash
npm test          # Run all tests once
npm run test:watch  # Run in watch mode
```

Tests use [Vitest](https://vitest.dev/) and live in `__tests__/` directories alongside source files.

## Data Storage

SQLite database at `data/solarbuddy.db`. Tables:

- `settings` — key-value configuration store
- `rates` — cached Agile tariff rates
- `readings` — inverter telemetry snapshots
- `events_log` — system event history
- `schedule` — computed charge windows
