# Release Process

SolarBuddy does not auto-deploy to a hosted production environment. Releases produce trustworthy artifacts for self-hosters to deploy themselves.

## Source of Truth

- `main` is the integration branch.
- GitHub Releases are the public release event.
- The repository `Dockerfile` and the GitHub release workflow are the canonical image build paths.

## Release Steps

1. Merge reviewed changes into `main`.
2. Confirm the repository is green in GitHub Actions.
3. Optionally run `npm run release:dry-run` locally to validate the shipping Docker image before publication.
4. Create and publish a GitHub Release.
5. The `Release` workflow builds the container image and publishes it to GHCR.
6. The workflow also generates an SBOM and build provenance attestation for the pushed image.

## Published Artifacts

- Versioned container image tags in GHCR
- Public package page at `ghcr.io/jjbrunton/solarbuddy`
- Image digest for immutable pulls
- SBOM generated during the build
- Build provenance attestation attached to the pushed image
- OCI image metadata including source repository, description, and license

## Maintainer Checklist

- Verify docs, tests, and release notes are up to date.
- Call out any scheduler or deployment contract changes prominently in the release notes.
- Avoid force-pushing release tags after publication.

## Self-Hoster Guidance

- Prefer pulling a tagged image digest for repeatable installs.
- The GHCR package page surfaces the image source, description, and Apache 2.0 license metadata from the published image.
- Use [`deployment.md`](deployment.md) for runtime configuration and persistence requirements.
- Back up the SQLite database before upgrading.
