# AI-Assisted Workflow

SolarBuddy is designed for human-led development with AI coding tools as collaborators, not autonomous operators.

## Supported Pattern

- Humans define the change, review the code, and approve merges.
- AI tools help with implementation, test updates, documentation, and code review.
- High-risk actions stay human-gated.

## Project Memory

Durable memory for AI tools should live in versioned repository files:

- [`AGENTS.md`](../AGENTS.md) for canonical repo policy
- [`../CLAUDE.md`](../CLAUDE.md) for Claude-specific entry guidance
- [`development.md`](development.md), [`testing-strategy.md`](testing-strategy.md), and [`release-process.md`](release-process.md) for workflow details
- [`decisions/`](decisions/README.md) for architecture decisions worth preserving

Do not rely on a chat transcript as the only place where important repo knowledge lives.

## Safety Boundaries

- AI tools should not have direct access to deployment credentials.
- AI-generated changes to scheduler execution, MQTT commands, or persistence should receive human review before merge.
- Documentation updates are part of the expected output, not an afterthought.

## Review Prompts That Age Well

Useful recurring prompts for AI-assisted work in this repository include:

- "Review this change for scheduler regressions, missing tests, and docs drift."
- "Update the relevant docs and rerun `npm run verify`."
- "Check whether this API change is reflected in `docs/api.md`."

