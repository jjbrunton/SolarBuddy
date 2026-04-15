# Testing Strategy

This document defines the automated verification layers for SolarBuddy as an open source, self-hosted application.

## Goals

- Keep the repository green before merges and releases.
- Catch regressions in scheduler logic, MQTT integration boundaries, and operator workflows before self-hosters deploy updates.
- Make local and CI verification use the same commands.

## Verification Commands

```bash
npm run docs:check
npm run lint
npm test
npm run test:integration
npm run build
npm run test:smoke
npm run test:e2e
npm run verify
```

`npm run verify` is the maintainer-facing default for non-trivial changes. It runs the API docs inventory check, lint, the Vitest suite, a production build, a smoke test against the built server, and Playwright E2E checks.

## Test Layers

### 1. Unit and service tests

- Implemented with Vitest under `src/**/__tests__` and `src/**/*.test.ts`.
- Focus on scheduling logic, API handlers, persistence helpers, and integration adapters.
- These tests should remain the main regression net for planner behavior and runtime services.

### 2. Production smoke test

- `scripts/smoke-test.sh` starts the built app with a temporary SQLite database.
- It verifies that the production server boots and serves key routes such as `/api/health`, `/`, `/simulate`, and `/api/status`.
- This catches packaging or startup regressions that unit tests can miss.

### 3. Integration tests

- Integration suites live alongside source under `src/**` and use the `*.integration.test.ts` suffix.
- These tests exercise cross-module behavior with fixed fixtures and in-memory SQLite, while avoiding live network dependencies.
- Current integration coverage targets:
  - Schedule lifecycle across API route + SQLite persistence (`plan -> persist -> execute status -> read back`)
  - Scheduler orchestration against real repository writes using fixed tariff fixtures
  - SSE event/log pipelines for state changes and MQTT log streaming

### 4. Documentation inventory check

- `scripts/check-api-docs.mjs` compares `src/app/api/**/route.ts` against [`api.md`](api.md).
- Pull requests should not merge if API behavior has drifted from the published route inventory.

### 5. Browser E2E tests

- Playwright tests live under `e2e/`.
- The E2E suite runs against the production server started from the built app, not against `next dev`.
- Run `npm run test:e2e:install` once on a new machine before the first local E2E run.

## Required Regression Areas

Changes in these areas should add or update tests in the same pull request:

- Scheduler engine and execution behavior
- Watchdog reconciliation and override precedence
- MQTT topic parsing, command publishing, and log capture
- SQLite-backed storage and additive migrations
- API request validation and error handling
- Simulator logic and operator planning views
- Virtual inverter runtime behavior, scenario playback, and mode-aware API fallbacks

## Release Expectations

- GitHub Actions runs the validation workflow on pushes and pull requests.
- The validation workflow now runs docs sync, lint, unit tests, backend/API coverage generation, a production build, smoke checks, and Playwright E2E tests.
- Coverage uploads flow to Codecov from the generated `coverage/lcov.info` report so the public coverage badge tracks the same backend/API scope documented in this repository.
- GitHub Actions also runs CodeQL and dependency review checks.
- Releases should be cut only from a green `main`.
