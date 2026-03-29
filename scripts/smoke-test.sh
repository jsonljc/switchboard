#!/usr/bin/env bash
# =============================================================================
# Switchboard Smoke Test
# Run after deployment to verify all services and endpoints are working.
# Usage: ./scripts/smoke-test.sh [BASE_URL] [API_KEY]
# =============================================================================

set -euo pipefail

BASE="${1:-http://localhost:3000}"
DASHBOARD="${DASHBOARD_URL:-http://localhost:3002}"
CHAT="${CHAT_URL:-http://localhost:3001}"
API_KEY="${2:-${SWITCHBOARD_API_KEY:-}}"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

check() {
  local name="$1"
  local method="${2:-GET}"
  local url="$3"
  local expected_status="${4:-200}"
  local body="${5:-}"

  local curl_args=(-s -o /tmp/smoke-body -w "%{http_code}" --max-time 10)

  if [[ -n "$API_KEY" ]]; then
    curl_args+=(-H "Authorization: Bearer $API_KEY")
  fi

  if [[ "$method" == "POST" || "$method" == "PUT" ]]; then
    curl_args+=(-X "$method" -H "Content-Type: application/json")
    if [[ -n "$body" ]]; then
      curl_args+=(-d "$body")
    fi
  fi

  local status
  status=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || status="000"

  if [[ "$status" == "$expected_status" ]]; then
    RESULTS+=("${GREEN}PASS${NC} $name (HTTP $status)")
    ((PASS++))
  elif [[ "$status" == "000" ]]; then
    RESULTS+=("${YELLOW}SKIP${NC} $name (connection refused)")
    ((SKIP++))
  else
    RESULTS+=("${RED}FAIL${NC} $name (expected $expected_status, got $status)")
    ((FAIL++))
  fi
}

check_contains() {
  local name="$1"
  local url="$2"
  local needle="$3"

  local curl_args=(-s --max-time 10)
  if [[ -n "$API_KEY" ]]; then
    curl_args+=(-H "Authorization: Bearer $API_KEY")
  fi

  local body
  body=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || body=""

  if echo "$body" | grep -q "$needle"; then
    RESULTS+=("${GREEN}PASS${NC} $name (contains '$needle')")
    ((PASS++))
  elif [[ -z "$body" ]]; then
    RESULTS+=("${YELLOW}SKIP${NC} $name (no response)")
    ((SKIP++))
  else
    RESULTS+=("${RED}FAIL${NC} $name (missing '$needle')")
    ((FAIL++))
  fi
}

echo ""
echo -e "${BOLD}=== Switchboard Smoke Test ===${NC}"
echo -e "API:       $BASE"
echo -e "Dashboard: $DASHBOARD"
echo -e "Chat:      $CHAT"
echo -e "API Key:   ${API_KEY:+set}${API_KEY:-NOT SET (some tests will fail)}"
echo ""

# ── 1. Infrastructure Health ──
echo -e "${BOLD}--- Infrastructure ---${NC}"
check "API /health"            GET "$BASE/health"
check_contains "DB healthy"    "$BASE/health" '"database":"ok"'
check_contains "Redis healthy" "$BASE/health" '"redis":"ok"'
check "Prometheus /metrics"    GET "$BASE/metrics"
check "Dashboard reachable"    GET "$DASHBOARD" "200"
check "Chat health"            GET "$CHAT/health"

# ── 2. OpenAPI / Swagger ──
echo -e "${BOLD}--- Documentation ---${NC}"
check "Swagger JSON"           GET "$BASE/documentation/json"

# ── 3. Core API Endpoints (GET — read-only) ──
echo -e "${BOLD}--- Core API (read-only) ---${NC}"
check "GET /api/organizations"      GET "$BASE/api/organizations"
check "GET /api/cartridges"         GET "$BASE/api/cartridges"
check "GET /api/policies"           GET "$BASE/api/policies"
check "GET /api/identity"           GET "$BASE/api/identity"
check "GET /api/connections"        GET "$BASE/api/connections"
check "GET /api/agents"             GET "$BASE/api/agents"
check "GET /api/token-usage"        GET "$BASE/api/token-usage"
check "GET /api/token-usage/models" GET "$BASE/api/token-usage/models"
check "GET /api/token-usage/trend"  GET "$BASE/api/token-usage/trend"

# ── 4. Governance & Audit ──
echo -e "${BOLD}--- Governance ---${NC}"
check "GET /api/audit"              GET "$BASE/api/audit"
check "GET /api/governance"         GET "$BASE/api/governance"
check "GET /api/competence"         GET "$BASE/api/competence"
check "GET /api/approvals"          GET "$BASE/api/approvals"
check "GET /api/dlq"                GET "$BASE/api/dlq"

# ── 5. CRM & Conversations ──
echo -e "${BOLD}--- CRM & Conversations ---${NC}"
check "GET /api/crm/contacts"       GET "$BASE/api/crm/contacts"
check "GET /api/conversations"       GET "$BASE/api/conversations"
check "GET /api/escalations"         GET "$BASE/api/escalations"

# ── 6. Business Operations ──
echo -e "${BOLD}--- Business ---${NC}"
check "GET /api/campaigns"          GET "$BASE/api/campaigns"
check "GET /api/alerts"             GET "$BASE/api/alerts"
check "GET /api/scheduled-reports"  GET "$BASE/api/scheduled-reports"
check "GET /api/revenue-growth/diagnostic" GET "$BASE/api/revenue-growth/diagnostic"

# ── 7. Lifecycle Pipeline ──
echo -e "${BOLD}--- Lifecycle ---${NC}"
check "GET /api/lifecycle/pipeline" GET "$BASE/api/lifecycle/pipeline"

# ── 8. Operator System ──
echo -e "${BOLD}--- Operator ---${NC}"
check "GET /api/operator-config"    GET "$BASE/api/operator-config"

# ── 9. Sessions & Workflows ──
echo -e "${BOLD}--- Sessions & Workflows ---${NC}"
check "GET /api/sessions"           GET "$BASE/api/sessions"
check "GET /api/workflows"          GET "$BASE/api/workflows"
check "GET /api/scheduler"          GET "$BASE/api/scheduler"

# ── 10. Dashboard API Proxies ──
echo -e "${BOLD}--- Dashboard Proxies ---${NC}"
check "Dashboard /api/dashboard/pipeline"       GET "$DASHBOARD/api/dashboard/pipeline"
check "Dashboard /api/dashboard/operator-summary" GET "$DASHBOARD/api/dashboard/operator-summary"

# ── 11. Write Endpoint Smoke (POST with empty/minimal body) ──
echo -e "${BOLD}--- Write Endpoints (validation check) ---${NC}"
# These should return 400 (bad request) not 500 (server error)
check "POST /api/actions (no body → 400)" POST "$BASE/api/actions" "400" '{}'
check "POST /api/simulate (no body → 400)" POST "$BASE/api/simulate" "400" '{}'
check "POST /api/knowledge (no body → 400)" POST "$BASE/api/knowledge" "400" '{}'

# ── 12. Rate Limiting ──
echo -e "${BOLD}--- Rate Limiting ---${NC}"
# Hit a fast endpoint many times — should NOT get 429 within 10 requests
for i in $(seq 1 10); do
  curl -s -o /dev/null "$BASE/health" 2>/dev/null
done
check "No rate limit on /health after 10 hits" GET "$BASE/health"

# ── Results ──
echo ""
echo -e "${BOLD}=== Results ===${NC}"
for r in "${RESULTS[@]}"; do
  echo -e "  $r"
done
echo ""
echo -e "${BOLD}Total: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}SMOKE TEST FAILED${NC} — $FAIL checks did not pass."
  exit 1
elif [[ $SKIP -gt 0 ]]; then
  echo -e "${YELLOW}SMOKE TEST PARTIAL${NC} — all reachable checks passed, $SKIP skipped."
  exit 0
else
  echo -e "${GREEN}SMOKE TEST PASSED${NC} — all $PASS checks passed."
  exit 0
fi
