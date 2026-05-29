# Architecture & Codebase Cleanup Audit — Synthesis

**Date:** 2026-05-15
**Source:** Wave 1 of the audit plan at `docs/superpowers/plans/2026-05-15-architecture-cleanup-audit-wave-1.md`, dispatched against the design at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`.
**Lanes run:** 18 of 20 active (`ci-gate-gaps` and `spec-plan-rot` deferred per design).
**Coverage:** **22 CRITICAL** (12 already-FIXED from security-sweep-delta), **62 HIGH**, **36 MED**, **30 LOW** raw counts before dedupe. Post-dedupe estimated **~70 distinct findings** worth Wave 2 attention.

This is a triaged ranked backlog. **Wave 2 (cleanup) is gated on user approval per item or per group.**

## Wave-1 raw severity tallies by lane

| Lane                                   | CRITICAL | HIGH   | MED    | LOW    |
| -------------------------------------- | -------- | ------ | ------ | ------ |
| **Batch A — Architecture & contracts** |          |        |        |        |
| doctrine-compliance                    | 4        | 3      | 0      | 0      |
| route-chain-integrity                  | 1        | 3      | 3      | 0      |
| layer-hygiene                          | 0        | 0      | 6      | 0      |
| api-consistency                        | 2        | 4      | 3      | 2      |
| security-sweep-delta                   | 4        | 8      | 8      | 2      |
| **Batch B — Code health**              |          |        |        |        |
| dead-code                              | 0        | 2      | 0      | 0      |
| cartridge-sdk-removal-readiness        | 1        | 3      | 2      | 1      |
| file-size-splits                       | 2        | 24     | 0      | 0      |
| type-safety                            | 1        | 3      | 3      | 2      |
| lint-debt                              | 0        | 0      | 2      | 2      |
| **Batch C — Data, infra, tests, docs** |          |        |        |        |
| prisma-hygiene                         | 0        | 0      | 2      | 3      |
| fixture-schema-alignment               | 0        | 0      | 0      | 0      |
| deploy-infra-parity                    | 1        | 2      | 1      | 2      |
| coverage-vs-threshold                  | 3        | 3      | 1      | 1      |
| missing-co-located-tests               | 2        | 3      | 1      | 1      |
| test-stability-inventory               | 0        | 1      | 1      | 9      |
| surface-agnostic-backend               | 0        | 1      | 1      | 2      |
| doctrine-architecture-drift            | 1        | 2      | 2      | 2      |
| **TOTAL (raw)**                        | **22**   | **62** | **36** | **30** |

### Dedup notes

Cross-lane overlaps (folded into single backlog items below):

- **Ingress-bypass routes** flagged in `doctrine-compliance`, `route-chain-integrity`, **and** `api-consistency`. Same 4 routes (`recommendations.ts`, `admin-consent.ts`, `lifecycle-disqualifications.ts`, `dashboard-opportunities.ts`) get one canonical entry each in the backlog below.
- **Inngest DLQ gap** flagged by both `deploy-infra-parity` (#18 expanded scope) and `doctrine-architecture-drift` (Invariant 7). Single backlog item; deploy-infra-parity lane owns it.
- **TI-9 nullable orgId** flagged by `prisma-hygiene` and `security-sweep-delta`. Single backlog item; prisma-hygiene lane owns the per-model classification.
- **ApprovalManager drift** flagged by `doctrine-compliance` (code state) and `doctrine-architecture-drift` (docs). The code is fine (ApprovalManager removed, PlatformLifecycle owns); the **docs** need updating. Single backlog item in docs lane.
- **PrismaCredentialResolver** flagged by `dead-code` only; not double-counted in cartridge-sdk-removal-readiness (which explicitly excluded cartridge-sdk).
- **14 storage stores** flagged by `missing-co-located-tests` (HIGH-priority test gap) and also classified by `dead-code` as "all alive with ≥1 caller." No conflict — tests are missing despite stores being live.

## Top 10 by impact (CRITICAL/HIGH first)

These are the highest-leverage Wave 2 candidates. Sorted by impact × tractability.

### 1. CRITICAL — Audit-trail and idempotency coverage gap on ~90+ mutating routes

- **Source:** `api-consistency` (2 separate findings)
- **Where:** `apps/api/src/routes/` — 48 of 64 route files lack audit/WorkTrace; 38 of 42 mutating routes lack idempotency-key handling
- **Fix:** Wrap mutating handlers with `app.auditLedger.record()` + WorkTrace; require `Idempotency-Key` header via shared middleware
- **Effort:** M (90+ routes × 2 concerns; consider pre-handler hook)
- **Wave 2 path:** Track B structural — needs design spec for the shared middleware

### 2. CRITICAL — 4 routes bypass PlatformIngress (Invariant 1 violation)

- **Source:** `doctrine-compliance` + `route-chain-integrity` + `api-consistency` (overlap dedup'd)
- **Where:** `apps/api/src/routes/recommendations.ts:184`, `admin-consent.ts:66,90,113`, `lifecycle-disqualifications.ts:128,195`, `dashboard-opportunities.ts:55`
- **Fix:** Register intents (`operator.respond_recommendation`, `admin.grant_consent`/`revoke_consent`/`clear_consent`, `operator.confirm_disqualification`/`dismiss_disqualification`, `operator.transition_opportunity_stage`); migrate routes to `ingress.submit()`
- **Effort:** M-L per route (4 routes × intent + executor + tests)
- **Wave 2 path:** Track B structural — one PR per route or grouped by domain
- **Collision:** lifecycle-disqualifications.ts collides with PR #444 (Phase 3b); see "Deferred-collision list"

### 3. CRITICAL — Zero Inngest `onFailure` handlers across 14 async functions

- **Source:** `deploy-infra-parity` (expanded scope of launch-blocker #18)
- **Where:** 14 functions across `apps/api/src/services/cron/*`, `apps/api/src/bootstrap/inngest.ts` (dailyPatternDecayCron), `packages/creative-pipeline/src/{mode-dispatcher,creative-job-runner,ugc/ugc-job-runner}.ts`, `packages/ad-optimizer/src/inngest-functions.ts` (3), `packages/core/src/skill-runtime/batch-executor-function.ts`
- **Fix:** Add `onFailure` to each `createFunction`; emit `{functionId}.failed` event; wire FailedMessageStore/OutboxEvent for DLQ persistence; operator alert on critical failures
- **Effort:** L (handler + DLQ store wiring across 14 functions)
- **Wave 2 path:** Track B structural — needs design for the DLQ pattern; then mechanical apply

### 4. CRITICAL — Security-critical `as any` on auth bootstrap

- **Source:** `type-safety`
- **Where:** `apps/api/src/bootstrap/routes.ts:215, 227` — `(req as any).principalIdFromAuth` and `.organizationIdFromAuth`
- **Fix:** `declare module "fastify" { interface FastifyRequest { principalIdFromAuth?: string; organizationIdFromAuth?: string; } }`
- **Effort:** S (one declaration + remove the two casts)
- **Wave 2 path:** Track A mechanical — tiny PR, no design

### 5. CRITICAL — Cartridge-sdk types duplicated with @switchboard/schemas (layer violation)

- **Source:** `cartridge-sdk-removal-readiness`
- **Where:** 13 type-only imports in `packages/core/src/` that should come from `@switchboard/schemas` instead of `@switchboard/cartridge-sdk`
- **Fix:** Search-replace `import type { X } from "@switchboard/cartridge-sdk"` → `import type { X } from "@switchboard/schemas"` in 13 files
- **Effort:** S (mechanical)
- **Wave 2 path:** Track A mechanical — first step of cartridge-sdk removal (per the 6-step removal order in the lane report)

### 6. CRITICAL — Three packages with NO coverage thresholds configured

- **Source:** `coverage-vs-threshold`
- **Where:** `packages/sdk/vitest.config.ts`, `packages/creative-pipeline/vitest.config.ts`, `packages/ad-optimizer/vitest.config.ts`
- **Fix:** Add `coverage: { provider: "v8", reporter: [...], thresholds: { statements: 55, branches: 50, functions: 52, lines: 55 } }` to each
- **Effort:** S (3 file edits)
- **Wave 2 path:** Track A mechanical — verify tests pass thresholds after adding

### 7. CRITICAL — 28 mission-critical modules missing co-located tests

- **Source:** `missing-co-located-tests` (2 findings — 14 stores + 14 platform-ingress/work-trace)
- **Where:** All 14 storage classes in `packages/db/src/storage/` (approval, identity, lifecycle, etc.) + 14 modules in `packages/core/src/platform/` (platform-ingress, work-trace-\*, intent-registry, governance-gate, mode dispatchers)
- **Fix:** Add `*.test.ts` co-located with each; cover CRUD + edge cases for stores, dispatch + serialization for platform modules; ~50–100 LOC each
- **Effort:** L (~35–48 hrs across 28 files)
- **Wave 2 path:** Track B structural; can be split into smaller PRs by store/module

### 8. CRITICAL — ApprovalManager doctrine drift (DOCTRINE + ARCHITECTURE both stale)

- **Source:** `doctrine-architecture-drift`
- **Where:** `docs/DOCTRINE.md` §2, §3, Legacy Bridge Registry §110; `docs/ARCHITECTURE.md` §3e and §3k
- **Fix:** Update DOCTRINE.md and ARCHITECTURE.md to reflect that `ApprovalManager` was deleted 2026-04-19 (commit `7cd24569`) and PlatformLifecycle now owns approval lifecycle. Mark Phase 2 as complete.
- **Effort:** S
- **Wave 2 path:** Track A mechanical (docs-only)

### 9. HIGH — 2 CSS modules >1000 LOC + 22 files >600 LOC need splits

- **Source:** `file-size-splits`
- **Where:**
  - CRITICAL: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css` (1350 LOC), `apps/dashboard/src/app/globals.css` (1193 LOC)
  - HIGH: 22 files 600–972 LOC including `packages/db/prisma/seed-marketplace.ts` (972), `apps/api/src/app.ts` (815), `apps/api/src/bootstrap/inngest.ts` (654), `packages/core/src/orchestrator/propose-pipeline.ts` (818), 11 test files >600 LOC
- **Fix:** See per-file split proposals in `docs/audits/2026-05-15-cleanup/file-size-splits.md`
- **Effort:** M each (24 files; can batch the test-file splits)
- **Wave 2 path:** Track B — split into per-file PRs or per-package groups

### 10. HIGH — 1 store orphan + cartridge-sdk wind-down readiness

- **Source:** `dead-code` + `cartridge-sdk-removal-readiness`
- **Where:** `packages/db/src/storage/prisma-credential-resolver.ts` (zero callers); `packages/cartridge-sdk` (245 refs, all type-only or test fixtures)
- **Fix:** Either wire PrismaCredentialResolver into DI or delete it; then follow the 6-step cartridge-sdk removal order
- **Effort:** S (PrismaCredentialResolver) + L (full cartridge-sdk wind-down across 5 steps)
- **Wave 2 path:** Track A for PrismaCredentialResolver; Track B with brainstorm for cartridge-sdk wind-down

## Full ranked backlog

### CRITICAL (post-dedup, currently-actionable)

(Excludes 12 historical FIXED items from security-sweep-delta which are confirmed-resolved.)

1. Audit-trail gap on 48 mutating routes (api-consistency)
2. Idempotency-key gap on 38 mutating routes (api-consistency)
3. recommendations.ts bypasses PlatformIngress (doctrine-compliance + route-chain + api-consistency)
4. admin-consent.ts 3 endpoints bypass PlatformIngress (doctrine-compliance)
5. lifecycle-disqualifications.ts 2 endpoints bypass PlatformIngress (doctrine-compliance) — **collides with PR #444**
6. dashboard-opportunities.ts stage transition bypasses PlatformIngress (doctrine-compliance)
7. Zero Inngest `onFailure` handlers across 14 functions (deploy-infra-parity, launch-blocker #18 expanded)
8. `as any` on FastifyRequest auth fields (type-safety)
9. Cartridge-sdk types duplicated with @switchboard/schemas (cartridge-sdk-removal-readiness)
10. packages/sdk no coverage thresholds (coverage-vs-threshold)
11. packages/creative-pipeline no coverage thresholds (coverage-vs-threshold)
12. packages/ad-optimizer no coverage thresholds (coverage-vs-threshold)
13. 14 storage classes missing co-located tests (missing-co-located-tests)
14. 14 platform-ingress/work-trace modules missing co-located tests (missing-co-located-tests)
15. reports.module.css 1350 LOC needs split (file-size-splits)
16. globals.css 1193 LOC needs split (file-size-splits)
17. ApprovalManager doc drift in DOCTRINE.md + ARCHITECTURE.md (doctrine-architecture-drift)

### HIGH (post-dedup)

18. meta-deletion.ts lacks WorkTrace traceability (doctrine-compliance)
19. dashboard-reports.ts cache mutation lacks governance (doctrine-compliance)
20. whatsapp-send-test.ts lacks audit + idempotency (doctrine-compliance)
21. opportunity-stage transition needs intent registration (route-chain-integrity)
22. admin consent operations need audit-trail integration (route-chain-integrity)
23. lifecycle disqualifications need governance design decision (route-chain-integrity)
24. Error response shape inconsistency across 7+ routes (api-consistency)
25. Missing auth guards on 3 webhook routes — ad-optimizer.ts, whatsapp-send-test.ts, managed-webhook.ts (api-consistency)
26. ApprovalRecord type defined locally in 2+ places (api-consistency)
27. ConversationState type defined locally in chat + api (api-consistency)
28. TI-7 prisma-approval-store updateMany lacks orgId scoping (security-sweep-delta, STILL-OPEN)
29. TI-8 prisma-lifecycle-store updateMany lacks orgId scoping (security-sweep-delta, STILL-OPEN)
30. TI-9 11 nullable organizationId fields — all re-verified ORPHAN-RISK (prisma-hygiene + security-sweep-delta)
31. AU-3 API key revocation 60s cache latency (security-sweep-delta, STILL-OPEN)
32. AU-4 Auth rate limit per-IP only (security-sweep-delta, STILL-OPEN)
33. OW-3 Dashboard CSP `'unsafe-inline'` (security-sweep-delta) — **collides with `apps/dashboard/next.config.mjs` exclusion mask**
34. AI-4 Tool outputs lack adversarial sentinel markers (security-sweep-delta)
35. AI-6 Mutating tools bypass PlatformIngress (calendar-book, crm-write) (security-sweep-delta — architectural decision pending)
36. PrismaCredentialResolver orphan store (dead-code)
37. cartridge-sdk test fixtures block deletion (TestCartridge, createTestManifest — 14 imports) (cartridge-sdk-removal-readiness)
38. GuardedCartridge wrapper imports types from cartridge-sdk (cartridge-sdk-removal-readiness)
39. Layer 3 (core) over-imports for test infrastructure (cartridge-sdk-removal-readiness)
40. 22 `.ts/.tsx` files 600–972 LOC need splits (file-size-splits) — 22 separate items
41. `(verdictStore.save as any)` cast in 5+ call sites (type-safety)
42. Untyped Graph API response fields in whatsapp-management.ts (type-safety)
43. Missing null guard on agentContext in re-engagement reader (type-safety)
44. batch-executor-function exported but never registered (deploy-infra-parity)
45. Sentry not initialized in mcp-server app (deploy-infra-parity)
46. packages/db coverage thresholds below canonical (coverage-vs-threshold)
47. apps/mcp-server thresholds significantly below canonical (coverage-vs-threshold)
48. apps/dashboard thresholds lowest in monorepo + config inconsistency (coverage-vs-threshold)
49. 20+ stores in packages/db/src/ without co-located tests (missing-co-located-tests)
50. 12 core services and engines without tests (missing-co-located-tests)
51. 19 recent ad-optimizer modules without tests (missing-co-located-tests)
52. 3 unimplemented it.todo on work-trace-update-caller-rule (test-stability-inventory)
53. DashboardOverview type named after surface (surface-agnostic-backend)
54. Cartridge documentation describes 5 cartridges that don't exist (doctrine-architecture-drift)
55. ARCHITECTURE.md §3 references deleted ApprovalManager (doctrine-architecture-drift)

### MED (post-dedup)

56–91. (36 items — see per-lane reports for details; bundle by lane for Wave 2 batching)

Notable MED items worth surfacing:

- 6 barrel-files >40 exports (layer-hygiene) — by-package split
- 10 Prisma indexes >63 char (prisma-hygiene) — single mechanical PR with explicit names
- Validation error structure inconsistent across routes (api-consistency)
- 4 surface-URL strings in core projections (surface-agnostic-backend) — backlog
- \_stripe and \_idSeq prefix bugs (lint-debt) — 2-line fix
- ARCHITECTURE.md missing §10 and route table incomplete (doctrine-architecture-drift)

### LOW (post-dedup)

92–121. (30 items — mostly polish/documentation/test-stability quarantine items.)

## Mechanical-only sweep candidates (Track A pre-bundle)

These can land as a single Wave 2 Track A PR with user pre-authorization. All are mechanical, low-risk, no design needed:

1. Add coverage thresholds to packages/sdk, creative-pipeline, ad-optimizer (3 file edits)
2. Fix `as any` on FastifyRequest auth fields via module augmentation (1 file edit removing 2 casts)
3. Rename `_stripe` → `stripe` in `apps/api/src/services/stripe-service.ts`
4. Rename `_idSeq` → `idSeq` in `apps/api/src/__tests__/integration-lifecycle-3b.test.ts`
5. Replace 16 `console.log` → `console.error/warn` in `packages/db/prisma/seed.ts`
6. Strip `.js` from 36 dashboard imports (mechanical find-replace)
7. Add explicit `name:` to 10 Prisma indexes >63 char (single migration commit)
8. Update DOCTRINE.md + ARCHITECTURE.md to remove ApprovalManager references (docs-only)
9. Update DOCTRINE.md last-updated timestamp
10. Cartridge-sdk Step 1: replace 13 type imports `@switchboard/cartridge-sdk` → `@switchboard/schemas` (mechanical)

**Estimated effort for Track A bundle:** ~4–6 hours; produces a single small PR.

## Deferred-collision list

Findings blocked on in-flight branches. Release to Wave 2 once their branch merges.

| Finding                                            | Colliding branch / PR                                                  | Release condition                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `lifecycle-disqualifications.ts` ingress migration | PR #444 (Phase 3b) — local-readiness-followup work expected to migrate | After PR #444 merges; re-snapshot evidence                                                 |
| OW-3 Dashboard CSP `'unsafe-inline'`               | `apps/dashboard/next.config.mjs` is masked                             | Always-collision (file in always-excluded mask); revisit when CSP nonce design is approved |
| OW-6 Duplicate `headers()` in `next.config.mjs`    | Same                                                                   | Same                                                                                       |

## Deferred lanes (re-run later)

- **ci-gate-gaps** — re-run after `docs/local-readiness-spec` and `docs/local-readiness-plan` merge to main, OR by 2026-05-29, whichever comes first.
- **spec-plan-rot** — re-run after named in-flight workstreams merge, OR by 2026-05-29 with narrower scope, whichever comes first.

## Verification status

Per the design's severity-prioritized re-verification rule:

- **CRITICAL findings:** all 22 file:line refs verified against HEAD at commit `68dabd6e` (or its descendant on `audit/wave-1-execution-2026-05-15`) during dispatch. Subagents read code directly at their cited paths. No `STALE — re-snapshot before action` flags raised by subagents in their reports.
- **HIGH findings:** spot-checked via the pre-dispatch baseline cross-reference (e.g., 11 nullable orgId fields matches exactly; 4 CSS files >400 LOC matches; 14 Inngest function files matches).
- **MED/LOW findings:** per design, NOT re-verified at synthesis; will be re-verified at Wave 2 fix-PR creation time.

## Source reports

All raw findings live under `docs/audits/2026-05-15-cleanup/`:

- `_pre-dispatch.md` (orchestrator baseline)
- 18 per-lane reports — one per slug:
  - **Batch A:** `doctrine-compliance.md`, `route-chain-integrity.md`, `layer-hygiene.md`, `api-consistency.md`, `security-sweep-delta.md`
  - **Batch B:** `dead-code.md`, `cartridge-sdk-removal-readiness.md`, `file-size-splits.md`, `type-safety.md`, `lint-debt.md`
  - **Batch C:** `prisma-hygiene.md`, `fixture-schema-alignment.md`, `deploy-infra-parity.md`, `coverage-vs-threshold.md`, `missing-co-located-tests.md`, `test-stability-inventory.md`, `surface-agnostic-backend.md`, `doctrine-architecture-drift.md`

## Next step

**User triages this synthesis.** For each approved Wave 2 item, follow the procedure in the design doc:

- **Track A (mechanical sweep)** — bundle approved mechanical items into one PR. The list above proposes 10 such items totaling ~4–6 hours. User can pre-authorize this bundle or review the diff first.
- **Track B (structural fix)** — one worktree per item at `.claude/worktrees/<slug>` with the `audit/<item-slug>` branch. Brainstorm → spec → plan only if effort = L. For Track B items that intersect the always-excluded mask, defer until that mask's underlying branch merges.

**Hard gate:** Wave 2 does NOT auto-execute. User approval required per item or per group.
