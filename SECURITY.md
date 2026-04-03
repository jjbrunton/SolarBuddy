# Security Policy

## Supported Versions

Security fixes are applied on the latest code on `main` and the latest published release artifacts.

## Reporting a Vulnerability

Please do not open a public issue with exploit details.

Instead:

1. Email the maintainer listed in the repository profile or open a private GitHub security advisory if enabled.
2. Include reproduction steps, impact, and any affected configuration details.
3. Allow time for triage before public disclosure.

## Secure Usage Notes for Self-Hosters

- Run a single SolarBuddy instance only.
- Store SQLite on persistent storage and back it up regularly.
- Keep MQTT and Octopus credentials out of Git and out of container images.
- Put SolarBuddy behind HTTPS via your reverse proxy or ingress.

