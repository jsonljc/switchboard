# coverage-vs-threshold

**Charter:** Compare configured coverage thresholds across packages against canonical from CLAUDE.md: global `55/50/52/55`, core `65/65/70/65`. Flag packages drifting below (regression) and packages whose threshold has crept up without explicit update.

**Method:** Read root and each per-package `vitest.config.ts`. Extracted threshold blocks. No actual coverage reports run — config-only audit.

**Scope exclusions applied:** None.

## Per-package threshold inventory

| Package           | Statements | Branches | Functions | Lines  | Notes                                         |
| ----------------- | ---------- | -------- | --------- | ------ | --------------------------------------------- |
| Root (global)     | 55         | 50       | 52        | 55     | Canonical, correct                            |
| core              | 65         | 65       | 70        | 65     | Canonical for core, correct                   |
| sdk               | None       | None     | None      | None   | No thresholds configured                      |
| db                | 50         | 50       | 55        | 50     | Below canonical: -5 stmts, -5 lines, +3 funcs |
| creative-pipeline | None       | None     | None      | None   | No thresholds configured                      |
| ad-optimizer      | None       | None     | None      | None   | No thresholds configured                      |
| mcp-server        | 45         | 40       | 45        | 45     | Below canonical: -10/-10/-7/-10               |
| dashboard         | 40         | 35       | 40        | 40     | Below canonical: -15/-15/-12/-15              |
| schemas           | (root)     | (root)   | (root)    | (root) | Relies on root config                         |
| cartridge-sdk     | (root)     | (root)   | (root)    | (root) | Pending removal                               |
| api               | (root)     | (root)   | (root)    | (root) | Relies on root config                         |
| chat              | (root)     | (root)   | (root)    | (root) | Relies on root config                         |

## Findings

### [CRITICAL] packages/sdk — No coverage thresholds configured

- **Where:** `packages/sdk/vitest.config.ts:1-15`
- **Evidence:** `coverage: { provider: "v8", reporter: [...] }` with NO `thresholds` block
- **Why it matters:** Layer-2 package (dependency of core). Should enforce global thresholds per CLAUDE.md. Absence = regression detection disabled.
- **Fix:** Add `thresholds: { statements: 55, branches: 50, functions: 52, lines: 55 }`
- **Effort:** S
- **Risk if untouched:** Coverage regressions in SDK never trigger CI failure
- **Collides with active work?:** no

### [CRITICAL] packages/creative-pipeline — No coverage thresholds configured

- **Where:** `packages/creative-pipeline/vitest.config.ts:1-11`
- **Evidence:** No `coverage` block at all
- **Why it matters:** Layer-2 package. Async job pipeline is mission-critical; coverage drift is a high-risk blind spot.
- **Fix:** Add full coverage block with global thresholds
- **Effort:** S
- **Risk if untouched:** creative-pipeline coverage can drop to zero with no CI signal
- **Collides with active work?:** no

### [CRITICAL] packages/ad-optimizer — No coverage thresholds configured

- **Where:** `packages/ad-optimizer/vitest.config.ts:1-11`
- **Evidence:** No `coverage` block
- **Why it matters:** Revenue-critical code path. Layer-2 dependency.
- **Fix:** Add full coverage block with global thresholds
- **Effort:** S
- **Risk if untouched:** Ad platform integration can lose coverage silently
- **Collides with active work?:** no

### [HIGH] packages/db — Below canonical on statements and lines

- **Where:** `packages/db/vitest.config.ts:13-18`
- **Evidence:** `statements: 50, branches: 50, functions: 55, lines: 50` vs canonical `55/50/52/55`
- **Why it matters:** Lowered thresholds indicate prior coverage debt was cut rather than fixed. db is mission-critical (canonical persistence).
- **Fix:** Raise to canonical (may require test additions or coverage-gap investigation first)
- **Effort:** M
- **Risk if untouched:** Store layer regressions undetected
- **Collides with active work?:** no

### [HIGH] apps/mcp-server — Significantly below canonical

- **Where:** `apps/mcp-server/vitest.config.ts:11-16`
- **Evidence:** `statements: 45, branches: 40, functions: 45, lines: 45` (regression -10 across the board)
- **Why it matters:** mcp-server is the LLM tool interface; coverage gaps mean unsafe tool integration
- **Fix:** Investigate test gaps; raise toward canonical or document why mcp-server requires lower thresholds
- **Effort:** M
- **Risk if untouched:** Agent runtime risk
- **Collides with active work?:** no

### [HIGH] apps/dashboard — Lowest in monorepo + config inconsistency

- **Where:** `apps/dashboard/vitest.config.ts:15-20`
- **Evidence:** `statements: 40, branches: 35, functions: 40, lines: 40` (regression -15 across the board). Root config also EXCLUDES dashboard (`vitest.config.ts:8: exclude: [..., "apps/dashboard/**", ...]`), yet dashboard has its own local thresholds — inconsistency.
- **Why it matters:** Operator UI coverage is weakest in monorepo; ambiguous what coverage actually matters
- **Fix:** Decide: (a) dashboard not in monorepo coverage → remove its threshold block, or (b) include in root + raise local to at least 50/45/50/50. Requires product-owner input.
- **Effort:** M (decision-level, then implementation)
- **Risk if untouched:** Operator-facing code with unclear test guardrails
- **Collides with active work?:** no

### [MED] Root excludes dashboard but dashboard has own threshold config

- **Where:** Root: `vitest.config.ts:8`; Dashboard: `apps/dashboard/vitest.config.ts:1-28`
- **Evidence:** Signals unclear ownership
- **Why it matters:** Local thresholds are theater if dashboard tests don't run in CI
- **Fix:** Document intent in CLAUDE.md or add CI check `pnpm --filter @switchboard/dashboard test` with explicit threshold enforcement
- **Effort:** S
- **Risk if untouched:** Ambiguity about coverage ownership
- **Collides with active work?:** no

### [LOW] schemas/cartridge-sdk/api/chat — No vitest.config.ts (rely on root)

- **Where:** Various
- **Evidence:** Rely on root config; coverage measured at global 55/50/52/55
- **Status:** No action needed
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- Actual coverage report execution
- Historical analysis of why packages chose lower thresholds
- Dashboard's jsdom vs node environment justification
