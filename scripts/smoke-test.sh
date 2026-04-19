#!/usr/bin/env bash
# Smoke test the production build by booting the Next.js standalone server and
# curling a slice of core endpoints. Proves the standalone artifact is
# self-contained and that no route crashes on a cold DB.
#
# Run after `npm run build`. Used directly in CI (see validation.yml).
set -euo pipefail

PORT="${PORT:-3101}"
# Pin the host to loopback so curl treats the origin as secure and will send
# the auth session cookie (marked Secure in production builds). Inheriting the
# CI runner's HOSTNAME env var here breaks the auth bootstrap silently.
HOSTNAME="127.0.0.1"
BASE_URL="http://${HOSTNAME}:${PORT}"

if [[ -z "${DB_PATH:-}" ]]; then
  DB_PATH="$(mktemp "${TMPDIR:-/tmp}/solarbuddy-smoke-db.XXXXXX")"
fi

# Next.js standalone build does not copy .next/static or public/ — the server
# 404s every client chunk without them. Mirror the same setup Playwright uses
# so the smoke test exercises a realistic static-asset serving path.
if [[ ! -d .next/standalone/.next/static ]]; then
  rm -rf .next/standalone/.next/static
  mkdir -p .next/standalone/.next
  cp -R .next/static .next/standalone/.next/static
fi
if [[ -d public && ! -d .next/standalone/public ]]; then
  cp -R public .next/standalone/public
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

PORT="${PORT}" HOSTNAME="${HOSTNAME}" DB_PATH="${DB_PATH}" SOLARBUDDY_AUTH_COOKIE_SECURE=0 node .next/standalone/server.js >/tmp/solarbuddy-smoke.log 2>&1 &
SERVER_PID=$!

# Wait for the server to come up. Health endpoint is public and authoritative.
for _ in $(seq 1 30); do
  if curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Bootstrap the single admin account so the rest of the smoke test exercises
# the real authenticated surface. The auth gate redirects pages and 409s APIs
# until setup completes, so a fresh DB smoke run must do this first.
COOKIE_JAR="$(mktemp "${TMPDIR:-/tmp}/solarbuddy-smoke-cookies.XXXXXX")"
SETUP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -c "${COOKIE_JAR}" \
  -X POST "${BASE_URL}/api/auth/setup" \
  -H 'content-type: application/json' \
  -d '{"username":"smoke","password":"smoke-smoke-smoke"}')"
if [[ "${SETUP_STATUS}" != "200" ]]; then
  echo "FAIL: /api/auth/setup returned ${SETUP_STATUS}" >&2
  exit 1
fi
echo "  auth bootstrap OK"

# Assertion helpers — fail fast with a clear message so CI output is readable.
assert_status() {
  local url="$1"
  local expected="$2"
  local actual
  actual="$(curl -s -o /dev/null -w '%{http_code}' -b "${COOKIE_JAR}" "${url}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "FAIL: ${url} returned ${actual}, expected ${expected}" >&2
    return 1
  fi
  echo "  ${expected}  ${url}"
}

assert_non_5xx() {
  local url="$1"
  local actual
  actual="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -b "${COOKIE_JAR}" "${url}")"
  if [[ "${actual}" -ge 500 ]]; then
    echo "FAIL: ${url} returned ${actual} (>= 500)" >&2
    return 1
  fi
  echo "  ${actual}  ${url}"
}

echo "Page renders:"
assert_status "${BASE_URL}/" 200
assert_status "${BASE_URL}/simulate" 200
assert_status "${BASE_URL}/settings" 200
assert_status "${BASE_URL}/schedule" 200

echo "Core API endpoints (non-5xx):"
# These are the GET routes that must never crash on a bare DB. /api/events is
# excluded because it's a Server-Sent Events stream that never closes.
for path in \
  /api/health \
  /api/status \
  /api/settings \
  /api/overrides \
  /api/schedule \
  /api/scheduled-actions \
  /api/rates \
  /api/forecast \
  /api/readings \
  /api/analytics/savings \
  /api/analytics/attribution \
  /api/events-log \
  /api/system \
  /api/usage-profile \
  /api/virtual-inverter \
  /api/home-assistant/status \
; do
  assert_non_5xx "${BASE_URL}${path}"
done

echo "Health payload shape:"
HEALTH_JSON="$(curl -fsS "${BASE_URL}/api/health")"
echo "${HEALTH_JSON}" | node -e '
  let data = "";
  process.stdin.on("data", (c) => data += c);
  process.stdin.on("end", () => {
    const body = JSON.parse(data);
    if (body.ok !== true) throw new Error("health.ok is not true");
    if (body.service !== "solarbuddy") throw new Error("health.service is wrong");
    if (!body.build || typeof body.build.commit !== "string") throw new Error("health.build.commit missing");
    if (body.build.commit !== "unknown" && body.build.commitShort.length !== 7) {
      throw new Error("health.build.commitShort is not a 7-char prefix");
    }
    console.log("  health payload OK (commit=" + body.build.commitShort + ")");
  });
'

echo "Overrides POST → GET → DELETE round-trip:"
TODAY="$(date -u +%Y-%m-%d)"
SLOT_START="${TODAY}T23:00:00Z"
SLOT_END="${TODAY}T23:30:00Z"

curl -fsS -b "${COOKIE_JAR}" -X POST "${BASE_URL}/api/overrides" \
  -H 'content-type: application/json' \
  -d "{\"slots\":[{\"slot_start\":\"${SLOT_START}\",\"slot_end\":\"${SLOT_END}\",\"action\":\"charge\"}]}" \
  >/dev/null
GET_RESPONSE="$(curl -fsS -b "${COOKIE_JAR}" "${BASE_URL}/api/overrides")"
if ! echo "${GET_RESPONSE}" | grep -q "${SLOT_START}"; then
  echo "FAIL: override for ${SLOT_START} not returned by GET" >&2
  echo "Got: ${GET_RESPONSE}" >&2
  exit 1
fi
echo "  POST+GET round-trip OK"

DELETE_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -b "${COOKIE_JAR}" -X DELETE "${BASE_URL}/api/overrides?slot_start=${SLOT_START}")"
if [[ "${DELETE_STATUS}" != "200" ]]; then
  echo "FAIL: DELETE returned ${DELETE_STATUS}" >&2
  exit 1
fi
echo "  DELETE OK"

echo "Smoke test passed."
