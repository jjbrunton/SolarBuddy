# Contributing

SolarBuddy is an open source, self-hosted application. Contributions are welcome, but changes to scheduler behavior, MQTT command flows, persistence, and operator-facing workflows should stay well-documented and well-tested.

## Development Workflow

1. Read [`README.md`](README.md) and the relevant docs in [`docs/`](docs/README.md).
2. Make code, docs, and tests part of the same change whenever practical.
3. Run `npm run verify` before opening a pull request.
4. Use the pull request template to call out testing, docs, and rollback notes.

## Review Expectations

- Pull requests to `main` should go through review.
- [`CODEOWNERS`](.github/CODEOWNERS) marks the maintainers who must review sensitive areas.
- Changes to scheduler logic, MQTT command behavior, and SQLite schema should include explicit risk notes.

## Recommended GitHub Settings

Some controls live in GitHub repository settings rather than in versioned files. Maintainers should enable them alongside the committed workflows:

- require pull requests for `main`
- require the validation, dependency review, and CodeQL checks before merge
- enable secret scanning and push protection when the repository plan supports them
- keep releases limited to trusted maintainers

See [`docs/github-settings.md`](docs/github-settings.md) for the full checklist.

## Release Model

- `main` is the source branch for releases.
- GitHub Releases publish versioned Docker images to GHCR through CI.
- Self-hosters can use the published image or build from source with the repository `Dockerfile`.

## Security

- Do not commit secrets, `.env` files, or credentials.
- If you discover a vulnerability, follow [`SECURITY.md`](SECURITY.md) instead of opening a public issue with exploit details.
