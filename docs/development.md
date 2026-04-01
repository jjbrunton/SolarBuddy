# Development and Verification

This document covers local setup, common commands, and the minimum verification workflow for SolarBuddy.

## Prerequisites

- Node.js 18 or newer
- An accessible Solar Assistant MQTT broker if you want live inverter telemetry
- An Octopus Energy account on an Agile tariff if you want live tariff verification and scheduling

## Local Setup

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

## Configuration Workflow

Most runtime configuration is managed through the web UI under **Settings**:

1. Configure MQTT connectivity for Solar Assistant.
2. Enter Octopus API credentials and verify the account.
3. Configure charging behavior such as strategy, max charge slots, SOC target, overnight window for Night Fill, and auto-scheduling.
   - `Night Fill` uses the overnight window and the max-slot cap.
   - `Opportunistic Top-up` plans across the currently published tariff horizon and uses live telemetry to avoid forcing grid charging while solar surplus is available.

The current settings model is defined in [`src/lib/config.ts`](../src/lib/config.ts).

## Key Commands

```bash
npm run dev
npm test
npm run build
```

There is currently no separate lint script in `package.json`. `npm test` runs the Vitest suite defined by the repository, and `npm run build` performs the production compile plus TypeScript validation.

## Verification Expectations

- Run the relevant baseline checks before making changes.
- Re-run the relevant checks after making changes.
- When logic changes, add or update tests rather than relying on a successful build alone.
- Documentation-only changes should still record the verification commands that were run for the change set.
- Scheduling logic changes should verify both the planning engine and any execution-path behavior that depends on live inverter telemetry.

## Data and Runtime Notes

- The default SQLite database path is `data/solarbuddy.db`.
- Background services are started from [`src/instrumentation.ts`](../src/instrumentation.ts) when the app is running on the Node.js server runtime.
- The app uses process-local in-memory state for live telemetry and timer-based schedule execution. This is important when reasoning about deployment topology.

## Where to Document Future Changes

- API behavior changes: update [API Reference](api.md)
- Runtime or module boundary changes: update [Software Architecture](architecture.md)
- Local setup or verification workflow changes: update this document
