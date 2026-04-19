# Runbooks

This document collects operator and maintainer procedures that are worth keeping in the repository instead of rediscovering during incidents.

## Backup Before Upgrade

1. Stop the SolarBuddy container or take a filesystem-consistent snapshot of the mounted data volume.
2. Copy the SQLite database referenced by `DB_PATH`.
3. Keep the previous image digest available until the upgrade is verified.

## Restore From Backup

1. Stop the container.
2. Restore the SQLite database file onto the mounted data volume.
3. Restart SolarBuddy with the previous known-good image if needed.
4. Verify `/api/health`, recent schedules, and the System view before re-enabling normal use.

## Verify a New Release

1. Pull the new image tag or digest.
2. Start SolarBuddy with the existing mounted data volume.
3. Check `/api/health`.
4. Confirm settings still load, schedules render, and live MQTT connectivity returns as expected.
5. If scheduler behavior changed, verify the next planned slots before allowing the system to actuate.

## Database Retention

SolarBuddy runs a daily prune at 03:30 local time that deletes rows older than 30 days from `events` and `mqtt_logs`. These tables back the Activity feed and System Logs view; calculations (accounting, scheduler, forecasts, bill estimates) read from other tables and are never touched.

To change retention or add a target table, edit `RETENTION_TARGETS` in [`src/lib/db/prune.ts`](../src/lib/db/prune.ts). Only add tables that are display-only or diagnostic — never tables whose history feeds a calculation.

To prune manually (e.g. after importing a large historical log), use the **DB Retention Prune** task on the System → Tasks page (the *Run now* button calls `POST /api/system/retention-prune`).

## Reset a Forgotten Password

The administrator account is single-user and the password is stored only as a scrypt hash — it cannot be recovered. To regain access:

1. Stop SolarBuddy.
2. Open the SQLite database referenced by `DB_PATH` with `sqlite3`.
3. Clear the auth rows:
   ```sql
   DELETE FROM settings WHERE key IN ('auth_username', 'auth_password_hash', 'auth_session_secret');
   ```
4. Start SolarBuddy. The next visit to any page redirects to `/setup` so a new administrator account can be created. Existing API keys keep working — rotate them from the new Account settings tab if desired.

Clearing `auth_session_secret` is important: it invalidates any cookies minted under the old secret so no stale session sneaks past the new credentials.

## Revoke or Rotate API Keys

API keys authenticate external systems (Home Assistant, scripts) against SolarBuddy via `Authorization: Bearer <key>` or `X-API-Key: <key>`.

- **Rotate:** create a new key under Settings → Account, update the dependent system, then revoke the old one. The plaintext key is shown exactly once at creation.
- **Revoke one:** use the Revoke button in the Account tab or `DELETE /api/auth/api-keys/<prefix>`. The key is removed and any further request with it returns 401.
- **Emergency revoke-all:** run `DELETE FROM api_keys;` against the SQLite database and restart.

## Triage a Bug Report

1. Ask for the SolarBuddy version or image digest.
2. Ask whether the reporter built from source or used a published image.
3. Gather relevant screenshots, logs, and configuration context without requesting secrets.
4. Reproduce against the current `main` branch when possible.

