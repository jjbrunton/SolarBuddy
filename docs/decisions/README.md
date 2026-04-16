# Architectural Decisions

Use this directory for durable, versioned decisions that would otherwise be lost in pull requests or chat history. ADRs are mandatory for the trigger categories listed in [`AGENTS.md`](../../AGENTS.md#mandatory-record-architectural-decisions).

## Authoring

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-short-kebab-title.md`, where `NNNN` is the next zero-padded number.
2. Fill in Status, Context, Decision, Consequences, and Alternatives Considered.
3. Register the new ADR in the list below in the same change.
4. To revise an earlier decision, add a new ADR and mark the prior one `Superseded by NNNN` rather than editing it in place.

## When to write one

Write an ADR when the change introduces or alters a runtime model, persistence choice, external integration contract, scheduling/control-loop strategy, security/trust boundary, or a reversal of an earlier ADR. See [`AGENTS.md`](../../AGENTS.md#mandatory-record-architectural-decisions) for the full trigger list and exclusions.

## Current Decisions

- [0001: Single-instance runtime and self-hosted release model](0001-single-instance-runtime.md)
