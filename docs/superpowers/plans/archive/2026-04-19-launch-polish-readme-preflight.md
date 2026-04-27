# Launch Polish: README Rewrite + Preflight Command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `pnpm preflight` launch-audit command and align the README with the current governed-operating-system direction.

**Architecture:** Three changes — a new bash script (`scripts/preflight.sh`) that chains env validation, Prisma drift check, build, typecheck, test, arch-check, and optional Docker build into a unified pass/fail report; a `preflight` entry in root `package.json`; and a README edit that removes marketplace/trust-tier framing and adds a "What's Live" section anchored to the Alex wedge.

**Tech Stack:** Bash, pnpm, Prisma CLI, Docker (optional), Markdown

---

## File Map

| File                   | Action                                                                        | Responsibility                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/preflight.sh` | Create                                                                        | Tiered env validation, Prisma drift check, build/typecheck/test/arch-check/docker steps, unified summary |
| `package.json`         | Modify (line 19, add script)                                                  | Add `"preflight"` entry                                                                                  |
| `README.md`            | Modify (lines 46-53 remove, lines 126-138 reframe, add section after line 43) | Remove trust mechanics, reframe marketplace, add What's Live                                             |

---

### Task 1: Create `scripts/preflight.sh`

**Files:**

- Create: `scripts/preflight.sh`

- [ ] **Step 1: Write the preflight script**

```bash
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

ok()   { echo -e "  ${GREEN}PASS${NC} $1"; ((PASS++)); ((TOTAL++)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; ((FAIL++)); ((TOTAL++)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; ((WARN++)); WARNINGS+=("$1"); }

step_start() { STEP_START=$(date +%s); }
step_end() {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo -e "  ${BOLD}(${elapsed}s)${NC}"
  echo ""
}

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║          SWITCHBOARD LAUNCH PREFLIGHT            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Environment Validation ──
echo -e "${BOLD}--- Environment Validation ---${NC}"
step_start

# Source .env if present
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
  echo -e "  Loaded .env file"
else
  echo -e "  ${YELLOW}No .env file found — using current environment${NC}"
fi

# Hard fail: platform cannot operate securely without these
for var in DATABASE_URL CREDENTIALS_ENCRYPTION_KEY SESSION_TOKEN_SECRET; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    ok "$var is set"
  else
    fail "$var is not set (required for secure operation)"
  fi
done

# Feature-required: platform boots but key capabilities disabled
declare -A FEATURE_VARS=(
  ["ANTHROPIC_API_KEY"]="skill execution disabled"
  ["INNGEST_EVENT_KEY"]="creative pipeline disabled"
  ["VOYAGE_API_KEY"]="real embeddings disabled (zero-vector stubs used)"
)
for var in "${!FEATURE_VARS[@]}"; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    ok "$var is set"
  else
    warn "$var not set (${FEATURE_VARS[$var]})"
  fi
done

# Optional integrations: specific channels/services disabled
declare -A OPTIONAL_VARS=(
  ["GOOGLE_CALENDAR_CREDENTIALS"]="Alex booking disabled"
  ["GOOGLE_CALENDAR_ID"]="Alex booking disabled"
  ["WHATSAPP_TOKEN"]="WhatsApp channel disabled"
  ["TELEGRAM_BOT_TOKEN"]="Telegram channel disabled"
)
for var in "${!OPTIONAL_VARS[@]}"; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    ok "$var is set"
  else
    warn "$var not set (${OPTIONAL_VARS[$var]})"
  fi
done

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
if [[ -f "$PRISMA_SCHEMA" ]]; then
  BEFORE_HASH=$(find node_modules/.prisma packages/db/node_modules/.prisma -type f 2>/dev/null | sort | xargs cat 2>/dev/null | shasum | cut -d' ' -f1)
  pnpm db:generate > /dev/null 2>&1
  AFTER_HASH=$(find node_modules/.prisma packages/db/node_modules/.prisma -type f 2>/dev/null | sort | xargs cat 2>/dev/null | shasum | cut -d' ' -f1)

  if [[ "$BEFORE_HASH" != "$AFTER_HASH" ]]; then
    warn "Prisma client was stale — now regenerated. Commit updated client before launch."
    echo -e "  ${YELLOW}→ The schema has drifted from the generated client.${NC}"
    echo -e "  ${YELLOW}→ This is fine for local repair, but commit before deploying.${NC}"
  else
    ok "Prisma client is current (no drift)"
  fi
else
  fail "Prisma schema not found at $PRISMA_SCHEMA"
fi

step_end

# ── 3. Build ──
echo -e "${BOLD}--- Build ---${NC}"
step_start

if pnpm build > /dev/null 2>&1; then
  ok "pnpm build succeeded"
else
  fail "pnpm build failed"
fi

step_end

# ── 4. Typecheck ──
echo -e "${BOLD}--- Typecheck ---${NC}"
step_start

if pnpm typecheck > /dev/null 2>&1; then
  ok "pnpm typecheck passed"
else
  fail "pnpm typecheck failed"
fi

step_end

# ── 5. Tests ──
echo -e "${BOLD}--- Tests ---${NC}"
step_start

if pnpm test > /dev/null 2>&1; then
  ok "pnpm test passed"
else
  fail "pnpm test failed"
fi

step_end

# ── 6. Architecture Check ──
echo -e "${BOLD}--- Architecture Check ---${NC}"
step_start

if pnpm arch:check 2> /dev/null; then
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
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/preflight.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/preflight.sh && git commit -m "feat: add launch preflight script with tiered env validation"
```

---

### Task 2: Add `preflight` script to `package.json`

**Files:**

- Modify: `package.json:19` (add after `arch:check` line)

- [ ] **Step 1: Add the preflight script entry**

In root `package.json`, add this line after the `"arch:check"` entry:

```json
"preflight": "bash scripts/preflight.sh"
```

The scripts block should look like:

```json
"scripts": {
  "build": "turbo build",
  "dev": "turbo dev",
  "lint": "turbo lint",
  "test": "turbo test",
  "test:unit": "turbo test:unit",
  "test:integration": "turbo test:integration",
  "clean": "turbo clean",
  "typecheck": "turbo typecheck",
  "format:check": "prettier --check \"packages/*/src/**/*.ts\" \"apps/*/src/**/*.ts\"",
  "db:generate": "pnpm --filter @switchboard/db generate",
  "db:migrate": "pnpm --filter @switchboard/db migrate",
  "db:seed": "pnpm --filter @switchboard/db seed",
  "prepare": "husky || true",
  "arch:check": "npx tsx scripts/arch-check.ts",
  "preflight": "bash scripts/preflight.sh"
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json && git commit -m "chore: add pnpm preflight script entry"
```

---

### Task 3: Rewrite README.md

**Files:**

- Modify: `README.md` (lines 45-53 remove, lines 125-138 reframe, add section after line 43)

- [ ] **Step 1: Remove Trust Score Mechanics block**

Remove lines 45-53 (the `### Trust Score Mechanics` heading and the 5 bullet points below it). These are:

```markdown
### Trust Score Mechanics

- **Starting score**: 0 (blank slate, no implied credibility)
- **Approval**: +3 points + streak bonus (up to +5 for consecutive approvals)
- **Rejection**: −10 points, streak resets to 0
- **Autonomy levels**: supervised (0-29) → guided (30-54) → autonomous (55+)
- **Price tiers**: free (0-29) → basic (30-54) → pro (55-79) → elite (80-100)
```

- [ ] **Step 2: Add "What's Live" section**

Insert the following after the architecture diagram closing triple-backtick (after current line 43, which ends the code block):

```markdown
### What's Live

Alex is the first revenue wedge — a WhatsApp-native booking assistant that converts inbound leads to calendar meetings. The deployed path: WhatsApp → PlatformIngress/governance → Alex skill execution → Google Calendar booking → attribution/outcome recording. Everything flows through the governed control plane with idempotency, audit trail, and human override.
```

- [ ] **Step 3: Reframe the Marketplace API section**

Replace the current API section block:

```markdown
### Marketplace (`/api/marketplace`)

Skill discovery and deployment. Trust score tracking. Operator deployment management.
```

With:

```markdown
### Skills & Deployment (`/api/marketplace`)

Skill registration and deployment surfaces. Execution and governance state. Provisioning and runtime management.
```

- [ ] **Step 4: Verify README renders correctly**

Run: `head -160 README.md`

Confirm:

- No Trust Score Mechanics section
- "What's Live" section exists after the architecture diagram
- "Skills & Deployment" replaces "Marketplace" in API section
- All other sections unchanged

- [ ] **Step 5: Commit**

```bash
git add README.md && git commit -m "docs: align README with governed operating system direction"
```

---

### Task 4: Validate preflight works

- [ ] **Step 1: Run the preflight script**

Run: `pnpm preflight`

Expected: The script runs through all 7 steps. Since this is a dev environment without all env vars, expect:

- Hard-fail vars may cause early exit if `.env` is not configured — that's correct behavior
- If `.env` exists with required vars: full run with PASS/WARN/FAIL tally
- Script exits with 0 or 1 depending on results

- [ ] **Step 2: Verify env validation tiering works**

Run without any env vars to confirm hard-fail behavior:

```bash
env -i HOME="$HOME" PATH="$PATH" bash scripts/preflight.sh
```

Expected: Script fails with "Required environment variables missing" after checking DATABASE_URL, CREDENTIALS_ENCRYPTION_KEY, SESSION_TOKEN_SECRET.

- [ ] **Step 3: Verify the summary denominator is dynamic**

Check the output from step 1 — the "Required checks passed: X/Y" line should show the actual count of checks that ran, not a hardcoded number. If Docker was skipped, the denominator should be lower than if Docker ran.
