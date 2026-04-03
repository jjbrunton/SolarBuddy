#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3101}"
HOSTNAME="${HOSTNAME:-127.0.0.1}"
if [[ -z "${DB_PATH:-}" ]]; then
  DB_PATH="$(mktemp "${TMPDIR:-/tmp}/solarbuddy-smoke.XXXXXX.db")"
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

PORT="${PORT}" HOSTNAME="${HOSTNAME}" DB_PATH="${DB_PATH}" node .next/standalone/server.js >/tmp/solarbuddy-smoke.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "http://${HOSTNAME}:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "http://${HOSTNAME}:${PORT}/api/health" >/dev/null
curl -fsS "http://${HOSTNAME}:${PORT}/" >/dev/null
curl -fsS "http://${HOSTNAME}:${PORT}/simulate" >/dev/null
curl -fsS "http://${HOSTNAME}:${PORT}/api/status" >/dev/null

echo "Smoke test passed."
