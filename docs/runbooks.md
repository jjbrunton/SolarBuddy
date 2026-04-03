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

## Triage a Bug Report

1. Ask for the SolarBuddy version or image digest.
2. Ask whether the reporter built from source or used a published image.
3. Gather relevant screenshots, logs, and configuration context without requesting secrets.
4. Reproduce against the current `main` branch when possible.

