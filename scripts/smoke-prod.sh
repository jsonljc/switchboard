#!/usr/bin/env bash
# smoke-prod.sh — automated production smoke checks for the deployment spec's runbook.
#
# Usage:
#   API_URL=https://api.example.com \
#   CHAT_URL=https://chat.example.com \
#   API_KEY=<value from API_KEYS env var on the api service> \
#   ./scripts/smoke-prod.sh
#
# API_KEY is one of the keys configured in the api service's API_KEYS env var
# (see apps/api/src/middleware/auth.ts `loadHashedKeys`). It is sent as
# `Authorization: Bearer <key>` to authenticated endpoints like /api/health/deep.
#
# Exits 0 if every check passes, non-zero (and prints which check failed) otherwise.
# Browser-side smoke (dashboard drag-and-drop, Sentry test events, rollback rehearsal)
# is documented in docs/superpowers/specs/2026-05-15-deployment-hosting-design.md §10
# steps 7 + 11 + 12 and stays manual.

set -euo pipefail

# Required CLI dependencies. Fail early with a clear message if anything is missing.
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required" >&2; exit 64; }
command -v jq   >/dev/null 2>&1 || { echo "ERROR: jq is required (brew install jq / apt-get install jq)" >&2; exit 64; }

require() {
  local var_name="$1"
  if [ -z "${!var_name:-}" ]; then
    echo "ERROR: $var_name is required" >&2
    exit 64
  fi
}

require API_URL
require CHAT_URL
require API_KEY

pass=0
fail=0

check() {
  local label="$1"
  shift
  printf "  %-50s " "$label"
  if "$@" >/tmp/smoke-prod-last.log 2>&1; then
    echo "OK"
    pass=$((pass + 1))
  else
    echo "FAIL"
    echo "    last output:"
    sed 's/^/      /' /tmp/smoke-prod-last.log
    fail=$((fail + 1))
  fi
}

check_http_ok() {
  local url="$1"
  shift
  local status
  status=$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' "$@" "$url")
  [ "$status" = "200" ] || { echo "expected 200, got $status"; return 1; }
}

check_http_status() {
  local url="$1"
  local expected="$2"
  shift 2
  local status
  status=$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' "$@" "$url")
  [ "$status" = "$expected" ] || { echo "expected $expected, got $status"; return 1; }
}

check_json_field() {
  local url="$1"
  local field="$2"
  local expected="$3"
  shift 3
  local actual
  actual=$(curl --max-time 10 -s "$@" "$url" | jq -r "$field")
  [ "$actual" = "$expected" ] || { echo "$field: expected $expected, got $actual"; return 1; }
}

echo "Running production smoke checks against:"
echo "  API_URL=$API_URL"
echo "  CHAT_URL=$CHAT_URL"
echo

echo "[api]"
check "GET /health returns 200" \
  check_http_ok "$API_URL/health"
check "GET /api/health/deep returns 200" \
  check_http_ok "$API_URL/api/health/deep" -H "Authorization: Bearer $API_KEY"
check "/api/health/deep reports database=connected" \
  check_json_field "$API_URL/api/health/deep" '.checks.database.status' 'connected' \
    -H "Authorization: Bearer $API_KEY"
check "/api/health/deep reports redis=connected" \
  check_json_field "$API_URL/api/health/deep" '.checks.redis.status' 'connected' \
    -H "Authorization: Bearer $API_KEY"

echo "[chat]"
# chat /api/health/deep is added in Phase 2 — once that PR lands, swap the
# /health probe below for /api/health/deep and re-add database/redis/api
# field assertions parallel to the api block.
check "GET /health returns 200" \
  check_http_ok "$CHAT_URL/health"

echo "[webhook routing — negative case]"
check "chat returns 4xx for an unknown managed-webhook id (routing alive)" \
  check_http_status "$CHAT_URL/webhook/managed/__smoke__" "404" -X POST -H "content-type: application/json" -d '{}'

# This check proves only that the routing layer is alive — it is NOT a signature-
# verification test. Real signature verification (Meta hub.verify_token, Slack signing
# secret, Telegram secret token) is channel-specific and requires real webhookIds and
# valid signed payloads; it remains a manual smoke step in the runbook.

echo
echo "Summary: $pass passed, $fail failed"
if [ $fail -gt 0 ]; then
  exit 1
fi
exit 0
