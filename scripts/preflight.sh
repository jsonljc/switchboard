#!/usr/bin/env bash
# =============================================================================
# Switchboard Launch Preflight
# Single command to validate deploy readiness.
# Usage: ./scripts/preflight.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
TOTAL=0
WARNINGS=()
START_TIME=$(date +%s)

ok()   { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; WARN=$((WARN + 1)); WARNINGS+=("$1"); }

step_start() { STEP_START=$(date +%s); }
step_end() {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo -e "  ${BOLD}(${elapsed}s)${NC}"
  echo ""
}

# Resolve pnpm — use global if available, otherwise npx
if command -v pnpm &>/dev/null; then
  PNPM="pnpm"
else
  PNPM="npx pnpm@9.15.4"
fi

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          SWITCHBOARD LAUNCH PREFLIGHT            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Environment Validation ──
echo -e "${BOLD}--- Environment Validation ---${NC}"
step_start

# Source .env if present (line-by-line to handle unquoted special chars)
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip comments and blank lines
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Only export lines that look like VAR=value (non-empty value)
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z_0-9]*)=(.+)$ ]]; then
      export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
    fi
  done < .env
  echo -e "  Loaded .env file"
else
  echo -e "  ${YELLOW}No .env file found — using current environment${NC}"
fi

# Hard fail: platform cannot operate securely without these
check_required() {
  local var="$1"
  local val="${!var:-}"
  if [[ -n "$val" ]]; then
    ok "$var is set"
  else
    fail "$var is not set (required for secure operation)"
  fi
}

check_required DATABASE_URL
check_required CREDENTIALS_ENCRYPTION_KEY
check_required SESSION_TOKEN_SECRET

# Feature-required: platform boots but key capabilities disabled
check_warn() {
  local var="$1" msg="$2"
  local val="${!var:-}"
  if [[ -n "$val" ]]; then
    ok "$var is set"
  else
    warn "$var not set ($msg)"
  fi
}

check_warn ANTHROPIC_API_KEY "skill execution disabled"
check_warn INNGEST_EVENT_KEY "creative pipeline disabled"
check_warn VOYAGE_API_KEY "real embeddings disabled (zero-vector stubs used)"

# Optional integrations: specific channels/services disabled
check_warn GOOGLE_CALENDAR_CREDENTIALS "Alex booking disabled"
check_warn GOOGLE_CALENDAR_ID "Alex booking disabled"
check_warn WHATSAPP_TOKEN "WhatsApp channel disabled"
check_warn TELEGRAM_BOT_TOKEN "Telegram channel disabled"

step_end

# Bail early if required env vars are missing
if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Required environment variables missing — cannot continue preflight.${NC}"
  echo -e "Set missing variables in .env or environment, then re-run."
  exit 1
fi

# ── 2. Prisma Client Generation & Drift Check ──
echo -e "${BOLD}--- Prisma Client Generation & Drift Check ---${NC}"
step_start

PRISMA_SCHEMA="packages/db/prisma/schema.prisma"
prisma_hash() {
  local files
  files=$(find node_modules/.prisma packages/db/node_modules/.prisma -type f 2>/dev/null | sort) || true
  if [[ -n "$files" ]]; then
    echo "$files" | xargs cat 2>/dev/null | shasum | cut -d' ' -f1
  else
    echo "empty"
  fi
}
if [[ -f "$PRISMA_SCHEMA" ]]; then
  BEFORE_HASH=$(prisma_hash)
  if $PNPM db:generate > /dev/null 2>&1; then
    AFTER_HASH=$(prisma_hash)
    if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
      warn "Prisma client was stale — now regenerated. Commit updated client before launch."
      echo -e "  ${YELLOW}→ The schema has drifted from the generated client.${NC}"
      echo -e "  ${YELLOW}→ This is fine for local repair, but commit before deploying.${NC}"
    else
      ok "Prisma client is current (no drift)"
    fi
  else
    fail "Prisma client generation failed"
  fi
else
  fail "Prisma schema not found at $PRISMA_SCHEMA"
fi

step_end

# ── 3. Build ──
echo -e "${BOLD}--- Build ---${NC}"
step_start

if $PNPM build > /dev/null 2>&1; then
  ok "Build succeeded"
else
  fail "Build failed"
fi

step_end

# ── 4. Typecheck ──
echo -e "${BOLD}--- Typecheck ---${NC}"
step_start

if $PNPM typecheck > /dev/null 2>&1; then
  ok "Typecheck passed"
else
  fail "Typecheck failed"
fi

step_end

# ── 5. Tests ──
echo -e "${BOLD}--- Tests ---${NC}"
step_start

if $PNPM test > /dev/null 2>&1; then
  ok "Tests passed"
else
  fail "Tests failed"
fi

step_end

# ── 6. Architecture Check ──
echo -e "${BOLD}--- Architecture Check ---${NC}"
step_start

if $PNPM arch:check > /dev/null 2>&1; then
  ok "Architecture check passed"
else
  fail "Architecture check failed"
fi

step_end

# ── 7. Docker Build Sanity (optional) ──
echo -e "${BOLD}--- Docker Build Sanity ---${NC}"
step_start

if command -v docker &>/dev/null; then
  if docker build --target api -t switchboard-api-preflight . > /dev/null 2>&1; then
    ok "Docker api target builds successfully"
  else
    fail "Docker api target build failed"
  fi
else
  warn "Docker not installed — skipping container build validation"
fi

step_end

# ── Summary ──
ELAPSED=$(( $(date +%s) - START_TIME ))
REQUIRED_PASSED=$PASS
REQUIRED_TOTAL=$TOTAL

echo -e "${BOLD}═══ Launch Preflight Summary ═══${NC}"
echo -e "  Required checks passed: ${REQUIRED_PASSED}/${REQUIRED_TOTAL}"
echo -e "  Warnings: ${WARN}"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  for w in "${WARNINGS[@]}"; do
    echo -e "    ${YELLOW}- ${w}${NC}"
  done
fi

echo ""
echo -e "  Total time: ${ELAPSED}s"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}Ready for launch audit: NO${NC}"
  echo ""
  exit 1
else
  echo -e "  ${GREEN}${BOLD}Ready for launch audit: YES${NC}"
  echo ""
  exit 0
fi
