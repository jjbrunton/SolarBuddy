# Documentation Index

This directory is the documentation entry point for SolarBuddy. Use it alongside the project [README](../README.md), which remains the quickest overview and install guide.

## Core Documents

- [Software Architecture](architecture.md) explains the runtime model, main modules, data flow, and persistence layout.
- [API Reference](api.md) lists the current HTTP endpoints exposed by the Next.js app.
- [Development and Verification](development.md) covers local setup, test commands, and expected verification workflow.
- [Deployment](deployment.md) documents the container runtime contract and platform-neutral self-hosting guidance.
- [Testing Strategy](testing-strategy.md) defines the automated verification layers and required regression areas.
- [AI-Assisted Workflow](ai-workflow.md) captures the repo's human-led, AI-assisted development model.
- [Release Process](release-process.md) documents how maintainers publish trustworthy artifacts for self-hosters.
- [Runbooks](runbooks.md) provides operator and maintainer procedures for backup, restore, and release checks.
- [GitHub Repository Settings](github-settings.md) lists the GitHub-side controls that maintainers should enable outside Git.
- [Design System](design-system.md) defines the shared visual language, tokens, UI primitives, and page anatomy for the application.

## Canonical Starting Points

- Project overview and quickstart: [README](../README.md)
- Background services and module boundaries: [Software Architecture](architecture.md)
- Route inventory and integration surface: [API Reference](api.md)
- Local run and test workflow: [Development and Verification](development.md)
- Test coverage and smoke checks: [Testing Strategy](testing-strategy.md)
- Deployment and self-hosting: [Deployment](deployment.md)
- Open source release workflow: [Release Process](release-process.md)
- Durable AI guidance: [AI-Assisted Workflow](ai-workflow.md)
- GitHub-side branch and security controls: [GitHub Repository Settings](github-settings.md)
- Shared UI strategy and styling conventions: [Design System](design-system.md)

## Documentation Maintenance

- Add or update a focused document whenever behavior changes in a way that operators or developers need to understand.
- Register new documents in this index so future changes have a clear documentation-first entry point.
- Record durable architecture decisions in [`decisions/`](decisions/README.md) when the reasoning should outlive a pull request.
