# `/gate` — Pre-Merge Safety Gate & Weekly Health Check

**Date:** 2026-03-16
**Status:** Approved
**Branch:** feat/stage-2-outcome-lifecycle

---

## Problem

The codebase has strong automated CI (typecheck, lint, test, architecture, security scanning) and superpowers skills for code quality during development. But there are two gaps:

1. **No final safety verdict before merge.** CI checks pass/fail individually — nobody synthesizes "is this safe to ship?" in plain English. A non-technical founder needs a single clear answer.
2. **No weekly trend tracking.** The `arch-check.ts` script runs in CI but nobody tracks whether the codebase is improving or declining over time.
3. **Security is a blind spot.** No existing skill or CI check catches org-scoping gaps, input validation issues, auth bypass, or PII logging in new code. The March 2026 security audit found 4 critical and 8 high findings.

Additionally, 3 existing custom skills overlap with superpowers and each other:

- `arch-guard` overlaps with superpowers `requesting-code-review` and `verification-before-completion`
- `refactor-reviewer` overlaps with superpowers `simplify`
- `health-audit` is useful but only covers architecture, not security

## Solution

One custom skill called `/gate` with two modes, replacing all 3 existing skills.

---

## Mode 1: `/gate` (Pre-Merge)

### When to run

Before merging any branch to `main`.

### What it does

1. Runs `git diff main...HEAD --name-only` to get changed files
2. Reads each changed file
3. Runs 3 check categories against those files
4. Outputs a verdict: `SHIP IT` or `HOLD — fix these N things`

### Check categories

#### Check 1: Security

Scans only changed files for:

| Check                | What It Catches                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Org-scoping          | Database queries missing `organizationId` filter; route handlers accepting `orgId` from params without verifying against auth |
| Input validation     | `request.body as SomeType` without Zod validation; `request.query` used without parsing                                       |
| Auth checks          | New routes missing auth middleware; string comparison instead of `timingSafeEqual` for secrets                                |
| PII in logs          | `console.error` / `logger.info` calls containing email, phone, name fields                                                    |
| User-controlled URLs | `fetch()` or HTTP calls using values from request params/body                                                                 |

#### Check 2: Architecture

Scans only changed files for:

| Check               | What It Catches                                                                 |
| ------------------- | ------------------------------------------------------------------------------- |
| Import boundaries   | `core` importing cartridges, cartridges importing `db`, cross-cartridge imports |
| File size           | Modified file exceeds 400 lines (warn) or 600 lines (block)                     |
| Test file exists    | New `.ts` source file has no `__tests__/<name>.test.ts`                         |
| `.js` extensions    | Relative imports missing `.js` extension                                        |
| `as any`            | New `as any` introduced in the diff                                             |
| Cartridge checklist | New cartridge missing manifest, guardrails, Dockerfile entry, ESLint blocklist  |

#### Check 3: Completeness

| Check            | What It Catches                  |
| ---------------- | -------------------------------- |
| Typecheck passes | Types compile cleanly            |
| Tests pass       | Tests pass for affected packages |
| No `console.log` | Diff contains `console.log`      |

### Output format

Pass:

```
SHIP IT
  Security: pass
  Architecture: pass
  Completeness: pass
```

Fail:

```
HOLD -- 2 issues to fix

1. [SECURITY] apps/api/src/routes/new-route.ts:34
   -> User input reaches database without org-scoping

2. [COMPLETENESS] apps/chat/src/jobs/new-job.ts
   -> No test file exists for this module

Fix these, then run /gate again.
```

### What it does NOT check (left to superpowers)

- Code quality / refactoring quality -> superpowers `simplify`
- Whether implementation matches the plan -> superpowers `requesting-code-review`
- Whether tests actually ran and passed -> superpowers `verification-before-completion`

---

## Mode 2: `/gate weekly`

### When to run

Once per week (manually or via cron).

### What it does

1. Runs `arch-check.ts` script
2. Reads `docs/health/last-report.json` (previous snapshot)
3. Reads `docs/health/security-backlog.md` (counts unchecked items)
4. Compares numbers, computes grade and trends
5. Outputs the report
6. Saves new snapshot to `docs/health/last-report.json`

### Grading logic

| Grade | Criteria                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| A     | No critical security backlog. God files trending down. Test coverage stable or improving. No new `as any`. |
| B     | <=2 critical security items. God files stable. Test coverage stable.                                       |
| C     | 3+ critical security items. God files growing. Test coverage declining.                                    |
| D     | Critical security items growing. New god files introduced. Packages with zero tests.                       |

### Output format

```
CODEBASE HEALTH: B+ (stable)

Trend: No change from last week
Security backlog: 4 critical (unchanged)
God files: 14 (unchanged)
Test coverage: adequate
as-any count: 23 (down from 25)

Top priority this week:
  Fix CRM getContact() org-scoping (C4 from security audit)
```

### Trend tracking

After each run, saves a snapshot to `docs/health/last-report.json`:

```json
{
  "date": "2026-03-16",
  "grade": "B+",
  "godFiles": 14,
  "asAnyCount": 23,
  "securityBacklog": { "critical": 4, "high": 8 },
  "packagesWithLowTests": 3
}
```

---

## Files

### Created

| File                              | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `.claude/skills/gate/SKILL.md`    | The skill definition                                                 |
| `docs/health/security-backlog.md` | Known security findings checklist                                    |
| `docs/health/last-report.json`    | Auto-generated weekly snapshot (created on first `/gate weekly` run) |

### Deleted

| File                                        | Reason                             |
| ------------------------------------------- | ---------------------------------- |
| `.claude/skills/arch-guard/SKILL.md`        | Rules absorbed into `/gate`        |
| `.claude/skills/refactor-reviewer/SKILL.md` | Replaced by superpowers `simplify` |
| `.claude/skills/health-audit/SKILL.md`      | Absorbed into `/gate weekly`       |

---

## Relationship to Superpowers

| Concern                                    | Who Handles It                               |
| ------------------------------------------ | -------------------------------------------- |
| Code quality (reuse, efficiency, patterns) | superpowers `simplify`                       |
| Implementation correctness (matches plan)  | superpowers `requesting-code-review`         |
| Claims verified with evidence              | superpowers `verification-before-completion` |
| TDD workflow                               | superpowers `test-driven-development`        |
| **Safety before merge**                    | **`/gate`**                                  |
| **Weekly health trends**                   | **`/gate weekly`**                           |

Superpowers = quality during development (building inspector).
`/gate` = safety before merge (occupancy permit).

---

## Typical Workflow

```
1. Start feature branch
2. Write code (Claude uses TDD, simplify, code-review as needed)
3. Think you're done
4. Run /gate
5. Fix any blockers
6. Merge
```

---

## Security Backlog (from March 2026 audit)

The initial security backlog is seeded from the audit conducted on 2026-03-16. See `docs/health/security-backlog.md` for the full checklist.

### Critical (4)

- C1: SSRF via webhook URL — `apps/api/src/routes/webhooks.ts:168`
- C2: Missing org-scoping on business config — `apps/api/src/routes/business-config.ts:24`
- C3: Missing org-scoping on deployment readiness — `apps/api/src/routes/deployment.ts:23`
- C4: CRM getContact() missing org filter — `packages/db/src/storage/prisma-crm-provider.ts:39`

### High (8)

- H1: PII logged in webhook handler — `apps/api/src/routes/inbound-webhooks.ts:149`
- H2: Facebook webhook signature not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:141`
- H3: Booking webhook signature not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:229`
- H4: Facebook verify token not timing-safe — `apps/api/src/routes/inbound-webhooks.ts:304`
- H5: Internal API secret not timing-safe — `apps/chat/src/main.ts:247`
- H6: Connection store list() without org returns all — `packages/db/src/storage/prisma-connection-store.ts:91`
- H7: No body validation on org config PUT — `apps/api/src/routes/org-config.ts:58`
- H8: No body validation on channel provisioning — `apps/api/src/routes/org-channels.ts:32`

### Production Resilience (top 5)

- P1: No execution timeout on cartridge calls — `packages/core/src/orchestrator/execution-manager.ts:136`
- P2: No unhandled rejection handler — `apps/api/src/server.ts`, `apps/chat/src/main.ts`
- P3: No optimistic concurrency on envelope updates — `packages/db/src/storage/prisma-envelope-store.ts:65`
- P4: Envelope save-then-update not atomic — `packages/core/src/orchestrator/propose-pipeline.ts:283`
- P5: InMemoryConversationStore grows without bound — `apps/chat/src/conversation/store.ts:10`
