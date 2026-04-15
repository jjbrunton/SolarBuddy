# GitHub Repository Settings

Some of SolarBuddy's safety controls live in GitHub repository settings rather than in versioned files.

Use this document as the maintainer checklist when creating a new repository copy or auditing the existing one.

## Recommended Settings for `main`

- Require pull requests before merging.
- Require approvals before merging.
- Require the `Validation`, `Dependency Review`, and `CodeQL` checks before merging.
- Restrict force pushes and branch deletion on `main`.
- Limit release creation and repository administration to trusted maintainers.

## Security Features

- Enable secret scanning if the repository plan supports it.
- Enable push protection if the repository plan supports it.
- Review Dependabot alerts and CodeQL alerts regularly.
- Install and enable the Codecov GitHub App for the repository if you want pull-request coverage annotations and badge history in the hosted Codecov UI.

## Release Permissions

- Ensure GitHub Actions can publish packages to GHCR for this repository.
- Keep the `GITHUB_TOKEN` package permissions available for the `Release` workflow.
- Ensure the published GHCR package remains public so the README package link and pull instructions work for self-hosters without authentication.
- Prefer tagged releases over force-moving tags.

## After Changing Settings

1. Open a test pull request and confirm the required checks are enforced.
2. Confirm `dependabot.yml` is active.
3. Confirm the release workflow can publish a dry-run or test release before relying on it for public releases.
