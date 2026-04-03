# SolarBuddy Agent Context

This repository stays human-driven. Claude, Codex, and similar tools help with implementation, review, and documentation, but humans remain the approvers for merges and releases.

## Start Here

1. Read [`README.md`](README.md), then the relevant docs in [`docs/`](docs/README.md).
2. Treat [`AGENTS.md`](AGENTS.md) as the canonical repo policy. If this file and `AGENTS.md` disagree, follow `AGENTS.md`.
3. Check for uncommitted changes before editing and do not overwrite user work.

## Definition of Done

- Update code, docs, and tests together.
- Run `npm run verify` for non-trivial changes.
- Keep API route docs in sync with `src/app/api/**/route.ts`.
- Keep route handlers thin and move logic into `src/lib/`.

## Safety Boundaries

- Do not assume a managed production environment exists.
- Do not add deployment secrets or credentials to the repo.
- Treat scheduler, MQTT command, and SQLite migration changes as high-risk and require human review.
- Preserve the single-instance runtime model documented in [`docs/architecture.md`](docs/architecture.md).

## Durable Memory

- Put stable repo knowledge in versioned docs under [`docs/`](docs/README.md), not only in chat transcripts.
- Record architectural decisions in [`docs/decisions/`](docs/decisions/README.md).
- Capture operator procedures in [`docs/runbooks.md`](docs/runbooks.md).

