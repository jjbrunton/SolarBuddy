# Deployment

This document defines the deployment contract for SolarBuddy without coupling the repository to a specific platform. It is intended to work equally well for Dokploy, plain Docker, and other container-oriented hosts.

SolarBuddy is open source and does not have a shared hosted production environment. Maintainers publish source changes and release artifacts; self-hosters choose how and when to deploy them.

## Deployment Model

- SolarBuddy runs as a single Node.js process.
- Deploy exactly one replica. Do not scale this service horizontally.
- Persist SQLite on a mounted volume and set `DB_PATH` to a file on that volume.
- Expose HTTP on port `3000`.
- Use `GET /api/health` for liveness/readiness checks.

The single-replica requirement exists because live telemetry state, scheduler timers, and watchdog reconciliation are process-local today. Running multiple instances would produce split-brain scheduling and duplicate MQTT command attempts.

## Generic Container Packaging

The repository includes a multi-stage `Dockerfile` that:

- installs dependencies with `npm ci`
- builds the Next.js app in standalone mode
- runs the production server as a non-root user
- defaults `DB_PATH` to `/app/data/solarbuddy.db`

Example local build and run:

```bash
docker build \
  --build-arg BUILD_COMMIT="$(git rev-parse HEAD)" \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t solarbuddy .
docker run --rm -p 3000:3000 \
  -e DB_PATH=/app/data/solarbuddy.db \
  -v "$(pwd)/data:/app/data" \
  solarbuddy
```

Published releases can also ship a prebuilt container image via GitHub Container Registry. Self-hosters may choose either the published image or the repository `Dockerfile`, but the runtime contract stays the same.

### Build metadata (important)

The `Dockerfile` accepts two build args that are baked into the running image and surfaced from `GET /api/health`:

| Build arg | Purpose |
| --- | --- |
| `BUILD_COMMIT` | Full git SHA of the source tree being built. |
| `BUILD_TIME` | ISO-8601 UTC timestamp of the build (`date -u +%Y-%m-%dT%H:%M:%SZ`). |

Deploy pipelines **must** pass both build args. `.dockerignore` excludes `.git` to keep image size down, so the fallback to `git rev-parse HEAD` inside the builder stage has no repo to read and will report `"unknown"` — which makes it impossible to verify from the outside which commit is running. A health response like

```json
{ "ok": true, "build": { "commit": "unknown", "commitShort": "unknown", "builtAt": "..." } }
```

means the build args were not forwarded by your deploy pipeline; it is not a build failure.

For Dokploy, GitHub Actions, and similar, configure the build step to inject the values from the host git state before invoking `docker build`.

## Runtime Environment

SolarBuddy keeps most operator settings in SQLite and manages them through the UI. The runtime environment contract is intentionally small:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DB_PATH` | No | Override the SQLite database path. Default: `data/solarbuddy.db` locally, `/app/data/solarbuddy.db` in the container image. |
| `PORT` | No | HTTP listen port. Default: `3000`. |
| `HOSTNAME` | No | HTTP bind address for containerized deployments. Recommended: `0.0.0.0`. |

MQTT broker settings, Octopus credentials, and scheduling preferences are configured through the application UI and stored in SQLite.

## Persistence and Backup

- Treat the SQLite database as operational state that must survive container replacement.
- Mount the database on persistent storage.
- Back up the database before upgrades and before manual experimentation with scheduler settings.
- Keep at least one previous known-good image tag or digest available so you can roll back quickly.

## Health Checks

Use `GET /api/health` as the deployment health check.

- `200 OK` means the process is serving requests and can query SQLite.
- `503 Service Unavailable` means the process is up but SQLite is not currently available.

The health endpoint intentionally does not require MQTT connectivity or fresh Octopus rates. Those are operational signals, not process-health signals, and should not cause the host platform to restart the app.

## Dokploy Guidance

To keep the repo platform-neutral, prefer configuring Dokploy in the Dokploy UI rather than committing Dokploy-specific manifests.

Recommended Dokploy setup:

1. Deploy with the repo `Dockerfile`, or point Dokploy at a prebuilt image from your registry.
2. Set the container port to `3000`.
3. Add a persistent volume mounted at `/app/data`.
4. Set `DB_PATH=/app/data/solarbuddy.db`.
5. Configure the health check path as `/api/health`.
6. Keep the app at one replica.

If you later want a more production-oriented flow, publish versioned images from CI and have Dokploy deploy those images instead of building from source on the host.

## What Stays Out of Git

The public application repository should not contain:

- Dokploy application exports
- environment-specific domains, TLS, or ingress settings
- private environment values or secrets
- server-specific volume names, host paths, or backup configuration

That data belongs in Dokploy itself or in a separate private infrastructure repository.
