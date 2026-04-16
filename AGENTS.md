# AI Agent Instructions

## Mandatory: Read Documentation First

Before implementing any change, read the documentation that defines the affected behavior.

1. Start with the project's main README or documentation index
2. Then read the docs that match your task (API specs, architecture docs, setup guides, testing docs, infrastructure docs)
3. If the task involves a proposal, new capability, breaking change, or architecture shift, read any relevant design or spec documents before coding

Do not skip this step. Use existing documentation and specs as the starting point, not reverse-engineer intent from code alone.

## Mandatory: Update Documentation

Documentation changes are part of the definition of done.

- New functionality MUST ship with documentation in the same change
- API behavior, request/response shape, orchestration flow, or data model changes: update the relevant API or backend docs
- Frontend user flows, configuration, setup steps, or environment variable changes: update the relevant frontend docs
- Local development or verification workflow changes: update setup and run guides
- New capability, changed requirement, or breaking behavior: update the relevant specification or design documents
- If no existing document is a clean fit, create a new focused document and register it in the documentation index
- Do not consider a feature complete until its operator-facing, developer-facing, or behaviour-facing documentation exists

If code and docs disagree, fix the docs in the same change unless the user explicitly asked you to leave documentation untouched.

## Mandatory: Record Architectural Decisions

Durable architectural choices MUST be captured as an ADR in [`docs/decisions/`](docs/decisions/README.md), using the [template](docs/decisions/TEMPLATE.md). PR descriptions and chat history are not durable.

Write an ADR when the change introduces or alters any of the following:

- A runtime model or process boundary (e.g. single-instance vs. multi-instance, in-process vs. external service)
- A persistence choice or schema-shape decision (storage engine, migration strategy, retention policy)
- An external integration contract (new third-party API, MQTT topic structure, webhook protocol)
- A scheduling, planning, or control-loop strategy (planner algorithm, override precedence, watchdog behavior)
- A security, authentication, or trust-boundary change
- A reversal or material revision of an earlier ADR (supersede the prior ADR rather than editing it in place)

Do NOT write an ADR for: bug fixes, refactors that preserve behavior, dependency bumps, copy/UX tweaks, or anything fully captured by updating an existing focused doc.

ADR file naming: `NNNN-short-kebab-title.md`, where `NNNN` is the next zero-padded number. Register the new ADR in [`docs/decisions/README.md`](docs/decisions/README.md).

## Mandatory: Testing and Verification

Verification is required both before and after changes.

### Before making changes

- Run the relevant baseline checks for the area you are touching
- For cross-module scheduler/API/MQTT or persistence-to-route flow changes, run `npm run test:integration` as part of the baseline
- If the baseline already fails, stop and report it unless the task is to fix that failure

### After making changes

- Re-run the relevant checks
- For cross-module scheduler/API/MQTT or persistence-to-route flow changes, re-run `npm run test:integration`
- Add or update tests for the behaviour you changed
- Do not treat lint or a successful build as a substitute for tests when logic changed

### Minimum completion bar

A change is not complete if:

- Relevant docs were not updated
- New functionality was added without corresponding documentation
- An architectural decision matching the ADR triggers above was made without an ADR
- Relevant verification commands were not run
- A change requiring integration coverage did not run `npm run test:integration`
- Changed behaviour has no test coverage and no explicit justification

## Engineering Expectations

- Follow the existing architecture and naming conventions in the touched area
- Keep route handlers and UI entry points thin; move business logic into focused services or helpers
- Prefer small, composable modules over large mixed-responsibility files
- Validate data at the boundary of the system
- Do not add new dependencies without a clear reason
- Do not leave TODOs in place of missing behaviour, docs, or tests unless the user explicitly approves that tradeoff

## Security Expectations

- Never commit secrets, keys, tokens, or `.env` contents
- Validate and sanitize untrusted input before it reaches storage or external APIs
- Avoid leaking internal error details in responses or logs
- Apply least-privilege thinking to new integrations, credentials, and data access paths

## Working Agreement

- Check for uncommitted user changes before editing and do not overwrite them
- Keep documentation, tests, and code changes in the same change set whenever practical
- In final responses, state which docs were updated and which verification commands were run
