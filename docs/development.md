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
2. Enter Octopus API credentials and verify the account. Successful verification now persists the detected region, tariff metadata, MPAN, and meter serial immediately so the scheduler can start using Agile rates without a second manual save step.
3. Configure charging behavior such as strategy, max charge slots, SOC targets, discharge reserve floor, overnight window for Night Fill, and auto-scheduling.
4. Use Settings > General to control whether background automation is allowed to schedule windows automatically and whether the inverter watchdog may send periodic corrective commands.
   - `Night Fill` uses the overnight window and the max-slot cap.
   - `Opportunistic Top-up` plans across the currently published tariff horizon and uses live telemetry to avoid forcing grid charging while solar surplus is available.
   - `Smart Discharge` simulates the future charge/discharge horizon, so it can add cheap recharge slots when needed before scheduling later expensive discharge windows.
   - The scheduler now persists a canonical `plan_slots` timeline with `charge`, `discharge`, and `hold` actions, then derives execution windows into `schedules`.
   - `hold` is no longer just a UI label. The watchdog maps it to an explicit inverter state intended to prevent battery discharge during that slot.

The current settings model is defined in [`src/lib/config.ts`](../src/lib/config.ts).

## Key Commands

```bash
npm run dev
npm test
npm run build
docker build -t solarbuddy .
```

There is currently no separate lint script in `package.json`. `npm test` runs the Vitest suite defined by the repository, and `npm run build` performs the production compile plus TypeScript validation.

## Verification Expectations

- Run the relevant baseline checks before making changes.
- Re-run the relevant checks after making changes.
- When logic changes, add or update tests rather than relying on a successful build alone.
- Documentation-only changes should still record the verification commands that were run for the change set.
- Scheduling logic changes should verify both the planning engine and any execution-path behavior that depends on live inverter telemetry.
- Scheduler changes should verify both the canonical `plan_slots.action` output and the derived `schedules.type` values used for execution history.

## Data and Runtime Notes

- The default SQLite database path is `data/solarbuddy.db`.
- Background services are started from [`src/instrumentation.ts`](../src/instrumentation.ts) when the app is running on the Node.js server runtime.
- The app uses process-local in-memory state for live telemetry and timer-based schedule execution. This is important when reasoning about deployment topology.
- The repository also includes a generic container image definition for self-hosting. Deployment-specific configuration is documented in [Deployment](deployment.md).

## Where to Document Future Changes

- API behavior changes: update [API Reference](api.md)
- Runtime or module boundary changes: update [Software Architecture](architecture.md)
- Local setup or verification workflow changes: update this document
- Deployment or hosting contract changes: update [Deployment](deployment.md)
