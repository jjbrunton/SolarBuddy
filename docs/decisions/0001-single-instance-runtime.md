# 0001: Single-instance runtime and self-hosted release model

## Status

Accepted

## Context

SolarBuddy keeps live telemetry state, scheduler timers, and watchdog reconciliation in process-local memory. SQLite is the durable system of record, but runtime coordination is not distributed across replicas.

The project is also open source and does not operate a shared hosted deployment for users. Releases therefore need to produce trustworthy artifacts for self-hosters rather than trigger an internal production rollout.

## Decision

- SolarBuddy officially supports one active application instance per deployment.
- Releases publish versioned Docker artifacts for self-hosters instead of deploying to a central managed environment.
- Repository automation should focus on verification, provenance, and documentation quality more than hosted deployment orchestration.

## Consequences

- Horizontal scaling is unsupported without an architectural change to runtime coordination.
- Deployment docs must keep warning about split-brain scheduling if multiple instances are run.
- CI/CD should prioritize tests, smoke checks, dependency review, CodeQL, and release artifact provenance.

