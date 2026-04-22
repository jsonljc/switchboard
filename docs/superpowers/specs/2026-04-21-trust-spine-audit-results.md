# Trust Spine Audit Results (2026-04-21)

Verified against codebase on 2026-04-21. Each issue checked by code inspection.

## Critical Issues (C1–C6)

| #   | Issue                                    | Status              | Notes                                                                                                                                  |
| --- | ---------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Idempotency cache replays wrong response | **FIXED**           | Fingerprint (method+route+bodyHash) validated on replay, 409 on mismatch                                                               |
| C2  | `/api/execute` approval not durable      | **FIXED**           | `createApprovalForWorkUnit()` creates durable approval record                                                                          |
| C3  | Patched approvals don't change execution | **PARTIALLY FIXED** | Trace params updated before execute, but `updateWorkTraceApproval` swallows errors — failed trace update means original params execute |
| C4  | Skill governance not wired               | **FIXED**           | `GovernanceHook` imported and instantiated in `skill-mode.ts`, called before every tool execution                                      |
| C5  | SSRF in website-scan                     | **FIXED**           | `assertSafeUrl()` enforced before fetch, HTTPS-only, private IP rejection                                                              |
| C6  | Side effects bypass governance spine     | **STILL EXISTS**    | `creative-pipeline.ts` and `ad-optimizer.ts` create tasks, send WhatsApp, emit Inngest directly without PlatformIngress                |

## High Issues (C7–C10)

| #   | Issue                               | Status           | Notes                                                                                                  |
| --- | ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| C7  | API key encryption inconsistency    | **STILL EXISTS** | `setup.ts` uses SHA-256 key derivation, `credentials.ts` uses scrypt; incompatible formats             |
| C8  | Approval completion partially wired | **STILL EXISTS** | Session resume best-effort, `approvalNotifier` accessed via unsafe cast that always yields `undefined` |
| C9  | Webhook storage non-durable         | **STILL EXISTS** | Still an in-memory `Map`                                                                               |
| C10 | Multiple runtimes live              | **STILL EXISTS** | `app.ts` boots both `LifecycleOrchestrator` and `PlatformIngress`/`PlatformLifecycle`                  |

## Medium Issues (D1–D10)

| #   | Issue                                     | Status              | Notes                                 |
| --- | ----------------------------------------- | ------------------- | ------------------------------------- |
| D1  | Legacy simulate path active               | **STILL EXISTS**    | Uses `app.orchestrator.simulate()`    |
| D2  | Approval reminder no-ops                  | **STILL EXISTS**    | `approvalNotifier` never decorated    |
| D3  | Chat ingress collapses errors             | **STILL EXISTS**    | All errors become `validation_failed` |
| D4  | Single-tenant chat uses in-memory runtime | **STILL EXISTS**    | Dual gateway split remains            |
| D5  | Meta webhook default secret               | **STILL EXISTS**    | Falls back to `"switchboard-verify"`  |
| D6  | Operator surface exposed but disabled     | **STILL EXISTS**    | 281 lines of dead route code          |
| D7  | Scheduler is a stub                       | **STILL EXISTS**    | `buildSchedulerDeps()` returns null   |
| D8  | Business logic in route handlers          | **STILL EXISTS**    |                                       |
| D9  | Core package too broad                    | **STILL EXISTS**    | ~28 concern areas in one package      |
| D10 | Tests miss convergence cases              | **NOT RE-VERIFIED** | Would need test execution             |

## Dead Code

| Item                               | Status                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `operator-deps.ts` / `operator.ts` | **STILL EXISTS** — null stub + 281 dead lines                 |
| `scheduler-deps.ts`                | **STILL EXISTS** — null stub                                  |
| `governance-hook.ts` orphaned      | **FIXED** — wired into executor                               |
| `pipeline-mode.ts` unregistered    | **STILL EXISTS** — has tests but never registered in `app.ts` |
| `simulate.ts` legacy               | **STILL EXISTS**                                              |
| Approval notifier decoration       | **STILL EXISTS**                                              |

## Remediation Tracking

### Completed

- Trust Spine Hardening plan (`docs/superpowers/plans/2026-04-21-trust-spine-hardening.md`) — fixed C1, C2, C3 (partial), C4, C5

### In Progress

- Runtime Convergence Foundation (`docs/superpowers/plans/2026-04-21-runtime-convergence-foundation.md`) — fixes C10
- Direct Side-Effect Containment — fixes C6, D5 (partial), D8

### Remaining (no plan yet)

- C3 partial: Make `updateWorkTraceApproval` non-swallowing
- C7: Unify encryption (SHA-256 vs scrypt)
- C8: Transactional approval completion + notifier wiring
- C9: Persist webhook registrations in Prisma
- D1: Migrate simulate into GovernanceGate
- D2: Wire approval notifier properly
- D3: Typed error classes in chat ingress
- D6: Remove dead operator surface
- D7: Remove scheduler stub
- D9: Split core package
- Dead code sweep: operator, scheduler, pipeline-mode, simulate
