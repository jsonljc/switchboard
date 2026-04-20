# Launch Polish: README Rewrite + Preflight Command

**Date:** 2026-04-19
**Status:** Approved
**Scope:** README truth alignment, launch preflight script, package.json entry point

---

## Problem

The repo front door (README) still frames Switchboard as a marketplace with trust-based pricing tiers — a concept that has been superseded by the governed revenue-operating-system direction. Any reviewer auditing the repo gets the wrong mental model first.

Additionally, all the ingredients for a launch readiness check exist as separate scripts (`arch-check.ts`, `smoke-test.sh`, `verify-docker.sh`) but there is no single command that composes them into a launch-grade preflight.

## Solution

Two changes, one spec:

1. **README rewrite** — align the front door with what the system actually is and does today
2. **Preflight script** — single `pnpm preflight` command that validates deploy readiness

---

## Part 1: README Rewrite

### Changes

1. **Remove Trust Score Mechanics block** (current lines 46-53). Trust scores are an internal governance mechanism documented in DOCTRINE.md and ARCHITECTURE.md. They are not a front-door concept.

2. **Reframe API "Marketplace" section** to "Skills & Deployment" with operational one-liners:
   - Skill registration and deployment surfaces
   - Execution and governance state
   - Provisioning and runtime management

3. **Add "What's Live" section** after the architecture diagram:
   - Names Alex as the first revenue wedge
   - Shows the concrete deployed path: `WhatsApp → PlatformIngress/governance → Alex skill execution → calendar booking → attribution/outcome recording`
   - 3-4 sentences max, developer-facing, not marketing copy

4. **Keep unchanged:** intro paragraph, architecture diagram, project structure, dependency layers, quick start, docker, testing sections.

### Non-goals

- Not a marketing page rewrite
- Not adding new sections beyond "What's Live"
- Not changing DOCTRINE.md or ARCHITECTURE.md

---

## Part 2: Preflight Script

### New file: `scripts/preflight.sh`

A single bash script that runs checks in dependency order with a unified pass/fail summary. Same visual style as existing `smoke-test.sh` and `verify-docker.sh` (colored PASS/FAIL/WARN, final tally).

### Check Sequence

| #   | Step                                   | Behavior                                                                                                                                                                      |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Env validation (tiered)                | See tiering below. Sources `.env` if present, falls back to current environment.                                                                                              |
| 2   | Prisma client generation & drift check | Runs `pnpm db:generate`. If generated output changes (git diff on `packages/db/src/generated`), warns "Prisma client was stale — now regenerated." Labeled as repair + check. |
| 3   | Build                                  | `pnpm build`. Hard fail.                                                                                                                                                      |
| 4   | Typecheck                              | `pnpm typecheck`. Hard fail.                                                                                                                                                  |
| 5   | Tests                                  | `pnpm test`. Hard fail.                                                                                                                                                       |
| 6   | Architecture check                     | `pnpm arch:check`. Hard fail.                                                                                                                                                 |
| 7   | Docker build sanity (optional)         | If `docker` is available, builds `api` production target only (`docker build --target api -t switchboard-api-preflight .`). Skips with WARN if docker not installed.          |

### Env Validation Tiering

**Hard fail (platform cannot operate securely without these):**

- `DATABASE_URL`
- `CREDENTIALS_ENCRYPTION_KEY`
- `SESSION_TOKEN_SECRET`

**Feature-required (warn — platform boots but key capabilities disabled):**

- `ANTHROPIC_API_KEY` — skill execution disabled
- `INNGEST_EVENT_KEY` — creative pipeline disabled
- `VOYAGE_API_KEY` — real embeddings disabled (zero-vector stubs used)

**Optional integrations (warn — specific channels/services disabled):**

- `GOOGLE_CALENDAR_CREDENTIALS` / `GOOGLE_CALENDAR_ID` — Alex booking disabled
- `WHATSAPP_TOKEN` — WhatsApp channel disabled
- `TELEGRAM_BOT_TOKEN` — Telegram channel disabled

### Final Summary Block

```
═══ Launch Preflight Summary ═══
  Required checks passed: 6/6
  Warnings: 2
    - ANTHROPIC_API_KEY not set (skill execution disabled)
    - GOOGLE_CALENDAR_ID not set (Alex booking disabled)

  Ready for launch audit: YES
```

"Ready for launch audit" = YES when all hard-fail checks pass. Warnings are informational.

### Exit Behavior

- Exit 0: all hard-fail checks pass (with or without warnings)
- Exit 1: any hard-fail check fails
- Timing: elapsed time per step + total elapsed

### Non-goals

- No container boot or health checks (that's `smoke-test.sh`)
- No Alex wedge validation (future `pnpm test:wedge` command)
- No interactive prompts

---

## Part 3: package.json

Add script: `"preflight": "bash scripts/preflight.sh"`

---

## Implementation Sequence

1. Write `scripts/preflight.sh`
2. Add `preflight` script to root `package.json`
3. Edit `README.md` — remove trust mechanics, reframe marketplace, add What's Live
4. Run `pnpm preflight` to validate the script works
5. Commit as single `chore: add launch preflight + align README with current direction`
