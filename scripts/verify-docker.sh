#!/usr/bin/env bash
# =============================================================================
# Switchboard Docker Verification
# Validates Dockerfile structure, builds images, and checks containers boot.
# Usage: ./scripts/verify-docker.sh
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

ok()   { echo -e "  ${GREEN}PASS${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; ((WARN++)); }

echo -e "${BOLD}=== Switchboard Docker Verification ===${NC}"
echo ""

# ── 1. Prerequisites ──
echo -e "${BOLD}--- Prerequisites ---${NC}"

if command -v docker &>/dev/null; then
  ok "Docker installed ($(docker --version | head -1))"
else
  fail "Docker not installed"
  echo -e "${RED}Cannot continue without Docker. Install from https://docs.docker.com/get-docker/${NC}"
  exit 1
fi

if command -v docker compose &>/dev/null || docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose available"
else
  fail "Docker Compose not available"
  exit 1
fi

# ── 2. Dockerfile Structure ──
echo -e "${BOLD}--- Dockerfile Validation ---${NC}"

if [[ -f Dockerfile ]]; then
  ok "Dockerfile exists"
else
  fail "Dockerfile not found"
  exit 1
fi

# Check all required stages exist
for stage in base build api chat dashboard mcp-server; do
  if grep -q "^FROM .* AS $stage" Dockerfile; then
    ok "Stage '$stage' defined"
  else
    fail "Stage '$stage' missing"
  fi
done

# Check agents package is copied (was a previous bug)
if grep -q "packages/agents" Dockerfile; then
  ok "agents package included"
else
  fail "agents package missing from Dockerfile"
fi

# Check all cartridges are copied
for cart in digital-ads crm payments customer-engagement revenue-growth; do
  if grep -q "cartridges/$cart" Dockerfile; then
    ok "Cartridge '$cart' included"
  else
    fail "Cartridge '$cart' missing from Dockerfile"
  fi
done

# Check production stages don't run as root
if grep -c "^USER node" Dockerfile | grep -q "4"; then
  ok "All production stages run as non-root (USER node)"
else
  warn "Not all stages use USER node — check security"
fi

# ── 3. Docker Compose Validation ──
echo -e "${BOLD}--- docker-compose.yml Validation ---${NC}"

if [[ -f docker-compose.yml ]]; then
  ok "docker-compose.yml exists"
else
  fail "docker-compose.yml not found"
  exit 1
fi

# Check pgvector image (not plain postgres)
if grep -q "pgvector/pgvector:pg16" docker-compose.yml; then
  ok "Using pgvector/pgvector:pg16 (vector embeddings supported)"
else
  fail "Not using pgvector image — vector embeddings will fail"
fi

# Check health checks exist for all services
for svc in api chat dashboard postgres redis; do
  if grep -A5 "^  $svc:" docker-compose.yml | grep -q "healthcheck" || \
     grep -A20 "^  $svc:" docker-compose.yml | grep -q "healthcheck"; then
    ok "Service '$svc' has healthcheck"
  else
    warn "Service '$svc' missing healthcheck"
  fi
done

# Check dependency ordering
if grep -q "service_completed_successfully" docker-compose.yml; then
  ok "DB migration runs before API start"
else
  warn "No migration dependency — API may start before DB is ready"
fi

# ── 4. Environment Variables ──
echo -e "${BOLD}--- Environment Check ---${NC}"

if [[ -f .env ]]; then
  ok ".env file exists"

  # Check critical vars
  for var in DATABASE_URL ANTHROPIC_API_KEY CREDENTIALS_ENCRYPTION_KEY; do
    if grep -q "^$var=" .env && ! grep -q "^$var=$" .env; then
      ok "$var is set"
    else
      warn "$var not set in .env"
    fi
  done
else
  warn ".env file not found — using defaults from docker-compose.yml"
fi

# ── 5. Docker Build ──
echo -e "${BOLD}--- Docker Build ---${NC}"

echo "  Building images (this may take a few minutes)..."
if docker compose build 2>&1 | tail -5; then
  ok "Docker build succeeded"
else
  fail "Docker build failed"
  echo ""
  echo -e "${RED}Fix build errors above before continuing.${NC}"
  exit 1
fi

# ── 6. Container Boot Test ──
echo -e "${BOLD}--- Container Boot Test ---${NC}"

echo "  Starting containers..."
docker compose up -d 2>&1 | tail -3

echo "  Waiting 30s for services to initialize..."
sleep 30

# Check each container is running
for svc in api chat dashboard postgres redis; do
  status=$(docker compose ps --format "{{.State}}" "$svc" 2>/dev/null || echo "missing")
  if [[ "$status" == "running" ]]; then
    ok "Container '$svc' is running"
  else
    fail "Container '$svc' status: $status"
  fi
done

# Check health endpoints
echo -e "${BOLD}--- Service Health ---${NC}"

for endpoint in "http://localhost:3000/health:API" "http://localhost:3001/health:Chat" "http://localhost:3002:Dashboard"; do
  url="${endpoint%%:*}:${endpoint#*:}"
  url="${endpoint%%:*}"

  # Parse name — everything after last colon
  name="${endpoint##*:}"
  # Parse URL — everything before last colon
  url="${endpoint%:*}"

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    ok "$name health check passed (HTTP 200)"
  elif [[ "$status" == "000" ]]; then
    fail "$name unreachable"
  else
    fail "$name returned HTTP $status"
  fi
done

# ── 7. Cleanup ──
echo ""
read -p "Stop containers? [Y/n] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  docker compose down
  echo "  Containers stopped."
fi

# ── Results ──
echo ""
echo -e "${BOLD}=== Docker Verification Results ===${NC}"
echo -e "  ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$WARN warnings${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}DOCKER VERIFICATION FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}DOCKER VERIFICATION PASSED${NC}"
  exit 0
fi
