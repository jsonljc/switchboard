# missing-co-located-tests

**Charter:** Identify production modules without sibling `*.test.ts` files, prioritizing HIGH-risk modules (stores, services, route handlers, executors) per CLAUDE.md rule "Every new module must include co-located tests."

**Method:** Mechanical find across `packages/*/src/` and `apps/*/src/`, filtering exclusions (index.ts, \*.types.ts, **tests** paths, generated files), checking for sibling `.test.ts` existence. Classification by risk pattern.

**Scope exclusions applied:**

- Riley/recommendation paths per spec mask — none found in missing-test list
- local-readiness branches (specs/plans only, no code)

## Headline counts

- Total production .ts files (packages + apps): 1331
- Files without co-located \*.test.ts: 1068
- packages/\*\* missing tests: 591
- apps/\*\* missing tests: 477
- HIGH-risk gaps (stores/services/executors): 114
- MED-risk gaps (routes/handlers): 10
- LOW-risk gaps (utilities/other): 944

## Findings

### [CRITICAL] Doctrine-specified core stores without co-located tests

- **Where:** All 14 storage classes in `packages/db/src/storage/`:
  - `prisma-approval-store.ts` (105 LOC, mod 2026-03-03)
  - `prisma-competence-store.ts` (172 LOC, mod 2026-03-03)
  - `prisma-connection-store.ts` (151 LOC, mod 2026-03-16)
  - `prisma-envelope-store.ts` (156 LOC, mod 2026-03-03)
  - `prisma-governance-profile-store.ts` (74 LOC, mod 2026-04-04)
  - `prisma-identity-store.ts` (227 LOC, mod 2026-03-03)
  - `prisma-lifecycle-store.ts` (387 LOC, mod 2026-04-22)
  - `prisma-pause-store.ts` (102 LOC)
  - `prisma-policy-store.ts` (218 LOC)
  - `prisma-risk-posture-store.ts` (23 LOC)
  - `prisma-role-override-store.ts` (60 LOC)
  - `prisma-run-store.ts` (70 LOC)
  - `prisma-session-store.ts` (159 LOC)
  - `prisma-tool-event-store.ts` (91 LOC)
- **Evidence:** Zero `*.test.ts` siblings; these are runtime stores backing canonical persistence (DOCTRINE Invariants 2, 3)
- **Why it matters:** No unit-level verification of store semantics (schema mapping, transaction isolation, null-handling). Integration tests cover happy paths but not store-level error handling.
- **Fix:** Add `prisma-*-store.test.ts` for each. Cover CRUD, error cases, transaction semantics. ~50–100 LOC each.
- **Effort:** L (14 × 1–2 hrs = ~20–28 hrs)
- **Risk if untouched:** Schema changes propagate without unit verification; regressions surface only in production governance/approval lifecycle
- **Collides with active work?:** no

### [CRITICAL] Platform ingress & work-trace layer without co-located tests

- **Where:**
  - `packages/core/src/platform/platform-ingress.ts`
  - `packages/core/src/platform/work-trace.ts` and `work-trace-{recorder,integrity,lock,hash}.ts`
  - `packages/core/src/platform/deployment-context.ts`
  - `packages/core/src/platform/intent-registry.ts`, `intent-registration.ts`
  - `packages/core/src/platform/execution-context.ts`
  - `packages/core/src/platform/governance/governance-gate.ts`
  - `packages/core/src/platform/modes/{skill-mode,cartridge-mode,workflow-mode}.ts`
- **Evidence:** Integration tests exist at `apps/api/src/__tests__/ingress-boundary.test.ts` etc., but ZERO unit tests at the `packages/core/src/platform/` module boundary
- **Why it matters:** DOCTRINE explicitly names PlatformIngress and WorkTrace as non-negotiable invariants. Unit tests would catch governance-gate evaluation errors, work-trace serialization bugs, deployment-context resolution failures before they reach integration tests.
- **Fix:** Co-located `*.test.ts` for each platform module. Prioritize platform-ingress, work-trace, intent-registry, governance-gate.
- **Effort:** L (~15–20 hrs)
- **Risk if untouched:** Platform-layer bugs surface only in integration or production
- **Collides with active work?:** no

### [HIGH] Additional critical data-persistence stores without tests

- **Where:**
  - `packages/db/src/prisma-approved-compliance-claim-store.ts`
  - `packages/db/src/prisma-consent-store.ts`
  - `packages/db/src/prisma-conversation-lifecycle-snapshot-store.ts`
  - `packages/db/src/prisma-conversation-lifecycle-transition-store.ts`
  - `packages/db/src/prisma-governance-verdict-store.ts`
  - `packages/db/src/recommendation-store.ts`
  - `packages/db/src/stores/prisma-work-trace-store.ts` (canonical persistence of governed actions)
  - `packages/db/src/stores/prisma-approval-*` (9 approval-path stores)
  - `packages/db/src/stores/prisma-workflow-store.ts`
  - `packages/db/src/stores/prisma-deployment-lifecycle-store.ts`
- **Evidence:** 20+ stores in `packages/db/src/` without sibling test files
- **Why it matters:** No unit-level verification of edge cases (concurrent updates, null fields, schema version mismatches)
- **Fix:** Add unit tests per store; prioritize `prisma-work-trace-store.ts` then approval/workflow stores
- **Effort:** M (~30–40 hrs)
- **Risk if untouched:** Approval workflow regressions, work-trace data corruption, concurrency bugs
- **Collides with active work?:** no (recommendation-store may collide with recommendation exclusion mask; verify)

### [HIGH] Core services and engines without tests

- **Where:**
  - `packages/core/src/engine/policy-engine.ts`
  - `packages/core/src/engine/risk-scorer.ts`
  - `packages/core/src/engine/rule-evaluator.ts`
  - `packages/core/src/engine/simulator.ts`
  - `packages/core/src/approval/lifecycle-service.ts`
  - `packages/core/src/approval/{binding,chain,delegation,respond-to-approval}.ts`
  - `packages/core/src/execution-service.ts`
  - `packages/core/src/consent/consent-service.ts`
  - `packages/core/src/identity/normalize.ts`
- **Evidence:** 12 service/engine files without tests
- **Why it matters:** Pure-logic services should have unit tests
- **Fix:** Add unit tests with focused input/output verification
- **Effort:** M (~18 hrs)
- **Risk if untouched:** Business-logic regressions in approval chains, risk-scoring, consent validation
- **Collides with active work?:** no

### [HIGH] Recent ad-optimizer modules (19) without tests

- **Where:** All 19 files in `packages/ad-optimizer/src/` (meta-leads-ingester, recommendation-sink, inngest-functions, audit-runner, facebook-oauth, ad-conversion-dispatcher, funnel-analyzer, metric-diagnostician, funnel-detector, meta-capi-client, signal-health-checker, learning-phase-guard, recommendation-engine, saturation-detector, trend-engine, creative-analyzer, meta-ads-client, budget-analyzer, period-comparator)
- **Evidence:** Modified 2026-03 to 2026-05 (0–2 months old)
- **Why it matters:** Recent files without tests are high-regression risk. Live implementations in ad-optimizer subsystem (Meta platform integration).
- **Fix:** Mock external APIs (Meta) and verify transformation logic. ~1 hr each.
- **Effort:** M (~19 hrs)
- **Risk if untouched:** Ad-optimizer logic changes without regression protection
- **Collides with active work?:** no (ad-optimizer is Layer 2; no blocking work)

### [MED] Route handlers and registrars without co-located tests

- **Where:**
  - `packages/core/src/approval/router.ts`
  - `packages/core/src/platform/pipeline-intent-registrar.ts`
  - `packages/core/src/platform/skill-intent-registrar.ts`
  - `packages/core/src/platform/cartridge-intent-registrar.ts`
  - Plus 6 more registrars/routers
- **Evidence:** 10 files matching route/handler/registrar patterns
- **Why it matters:** Co-located unit tests would provide faster feedback on registration schema changes
- **Fix:** Optional — these are typically covered by integration tests. Recommend co-located unit tests for new intent types.
- **Effort:** S
- **Risk if untouched:** Bugs discovered in integration tests only
- **Collides with active work?:** no

### [LOW] Utility and non-runtime modules without tests

- **Where:** 944 files (helpers, type transformers, formatters, pure utilities)
- **Evidence:** Examples: `packages/core/src/dialogue/{bilingual-handler, language-detector, naturalness-assembler}.ts`, `packages/schemas/src/{all 100+ type schema files}`, `packages/core/src/utils/{circuit-breaker, nested-value, pagination, retry}.ts`, adapters
- **Why it matters:** Lower-priority — pure types/formatting have low mutation risk
- **Fix:** Defer to Wave 2. Prioritize only utilities with complex logic (retry, circuit-breaker, pagination). Schemas and formatters can remain untested.
- **Effort:** Deferred
- **Risk if untouched:** Indirect coverage via integration tests usually sufficient
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- **apps/** testing gap (477 missing tests) — lower priority; apps integrated via E2E
- **Recent integration test coverage validation** — separate audit lane
- **Cartridge-sdk testing gap** (9 files) — pending removal per DOCTRINE; low ROI
- **Test flakiness assessment** — handled by `test-stability-inventory` lane

## Summary

- 591 production modules in packages/ lack co-located tests
- 114 are HIGH-risk
- Most critical: 14 core storage classes + 14 platform-ingress/work-trace modules
- 944 LOW-risk utilities can be deferred
- Ready for Wave 2 triage
