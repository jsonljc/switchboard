# P0 Convergence Sprint — Design Spec

> Eliminate dual approval ownership, block auth bypass in production, delete dead single-tenant chat path.

**Date:** 2026-04-19
**Status:** Design approved, pending implementation plan

---

## Motivation

Switchboard's architecture is in controlled migration from the old orchestrator to the platform layer. The API ingress path is converged. But three issues block launch readiness:

1. **Dual approval ownership** — `PlatformLifecycle` handles API approval routes, but the old `ApprovalManager` holds safety behaviors (patched re-evaluation) that the new path lacks. This is a real safety gap: patched approval parameters bypass governance in the new path.
2. **Dashboard auth bypass** — `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` bypasses authentication in `session.ts` with no `NODE_ENV` guard. If this leaks into production, all dashboard requests authenticate as a hardcoded dev user.
3. **Dead single-tenant chat code** — `ChatRuntime`, `ApiOrchestratorAdapter`, `bootstrap.ts`, and `managed-runtime.ts` have zero production callers. `main.ts` already routes all chat through `ChannelGateway` + `HttpPlatformIngressAdapter`. The old code is misleading architecture.

## Execution Order

```
P0b (auth bypass fix) → P0a-PR1 (approval parity) → P0a-PR2 (execution ownership) → P0a-PR3 (deletion) → P0c (chat cleanup)
```

Each PR is independently safe and reviewable. Each must pass CI before the next begins.

---

## P0b — Auth Bypass Production Guard

**Scope:** One file, one fix, standalone PR.

### Change

`apps/dashboard/src/lib/session.ts:20` — add `NODE_ENV` guard:

```ts
if (process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production") {
  return DEV_SESSION;
}
```

This matches the existing guard in `apps/dashboard/src/lib/get-api-client.ts:29`.

### Tests

| Test                                                        | Expectation                                            |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` + `NODE_ENV=production`  | `getServerSession()` returns `null`, not `DEV_SESSION` |
| `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` + `NODE_ENV=development` | `getServerSession()` returns `DEV_SESSION`             |

---

## P0a — Approval Consolidation

### Governing rule

> `PlatformLifecycle` is the sole target for all new approval behavior. `ApprovalManager` is frozen legacy. Each PR must reduce old-path surface area. PR3 must end with one approval owner.

### What was evaluated and excluded

Before designing PR1, we verified which old `ApprovalManager` behaviors are actually live:

| Old behavior                            | Callers in `apps/`                                                                                                                    | Wired in production? | Decision      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------- |
| Patched re-evaluation                   | API approval route calls `platformLifecycle.respondToApproval()` with `action: "patch"`, but new path does NOT re-evaluate governance | Yes — safety gap     | **Must port** |
| Plan approval (`respondToPlanApproval`) | Zero callers in any app                                                                                                               | No                   | **Delete**    |
| Queue execution mode (`onEnqueue`)      | `queue/index.ts` exists but is never imported by `app.ts`; worker is never started                                                    | No                   | **Delete**    |

### PR1 — Feature parity + cleanup

**Goal:** Port the one safety behavior that matters. Delete dead behaviors. Freeze old path.

#### Port: patched re-evaluation

The old `ApprovalManager.reEvaluatePatchedProposal()` (lines 408-509 of `approval-manager.ts`) re-runs governance when an approver patches parameters before approving. The current `PlatformLifecycle` applies patches and executes without re-checking governance. This is a safety regression.

Port the inline re-evaluation logic as-is into `PlatformLifecycle.respondToApproval()` for the `"patch"` action case. This uses the same approach as the old code: load cartridge, call `enrichContext()`, `getRiskInput()`, `getGuardrails()`, load policies, call `evaluate()`. If re-evaluation denies, update the WorkTrace and return denial.

> **Note:** This is a temporary parity shim (approach 2A-i). The inline governance reimplementation does not follow the "governance runs once" invariant spirit. Post-PR3, evaluate whether to collapse this behind `GovernanceGateInterface.reEvaluate()`. No new call sites may depend on the inline governance path beyond this parity preservation.

#### Delete: plan approval

- Delete `packages/core/src/orchestrator/plan-approval-manager.ts`
- Delete `packages/core/src/orchestrator/__tests__/plan-approval-manager.test.ts`
- Remove `respondToPlanApproval()` from `ApprovalManager`

#### Delete: queue execution mode

- Remove `executionMode === "queue"` branches from `ApprovalManager` (lines 289-291, 400-402)
- Remove `onEnqueue` from `SharedContext` and `LifecycleOrchestrator` config
- Delete `apps/api/src/queue/index.ts` (never imported)

#### Freeze old path

Add deprecation block at top of `approval-manager.ts`:

```
// DEPRECATED: All new approval logic must go in PlatformLifecycle.
// Changes to this file must strictly reduce surface area or support deletion.
```

Extend `ingress-boundary.test.ts`: verify no route file imports `ApprovalManager`.

#### Tests

Two buckets in a new `packages/core/src/platform/__tests__/platform-lifecycle.test.ts`:

**Parity tests** (proving old behavior is preserved):

| Test                           | Verifies                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| Patch with re-evaluation deny  | Patched parameters that violate policy → deny, trace updated |
| Patch with re-evaluation allow | Patched parameters that pass policy → execute, trace updated |

**Lifecycle correctness tests** (proving base PlatformLifecycle works — currently untested):

| Test                                                        | Verifies                             |
| ----------------------------------------------------------- | ------------------------------------ |
| Approve → execute → trace updated                           | Happy path post-approval execution   |
| Reject → trace shows "failed" + approvalOutcome: "rejected" | Rejection trace                      |
| Expired approval → envelope "expired" → trace updated       | Expiry handling                      |
| Self-approval prevention                                    | Originator cannot approve own action |
| Binding hash mismatch                                       | Stale approval detected              |
| Rate limiting                                               | Approval rate limit enforced         |

### PR2 — Execution ownership

**Goal:** Remove remaining orchestrator tendrils. After PR2, old orchestrator is not called for any approval-related work.

#### Move routingConfig

- Add `routingConfig` field to `PlatformLifecycleConfig` with `DEFAULT_ROUTING_CONFIG` fallback
- `PlatformLifecycle` exposes `routingConfig` getter
- `actions.ts:107` reads `app.platformLifecycle.routingConfig` instead of `app.orchestrator.routingConfig`
- During transition, `app.ts` passes same config to both; after PR3, only to `PlatformLifecycle`

#### Move notifier

- `approvals.ts:176-179` casts `app.orchestrator` to access `approvalNotifier`
- Move notifier to `app.approvalNotifier` (standalone app-level service) or `PlatformLifecycleConfig`
- Approval remind route reads from the new location

#### Tests

| Test                                                                      | Verifies               |
| ------------------------------------------------------------------------- | ---------------------- |
| `routingConfig` accessible from `PlatformLifecycle`                       | Config ownership moved |
| Approval creation uses `platformLifecycle.routingConfig`                  | No orchestrator read   |
| Integration: full approval creation without orchestrator                  | Route-level proof      |
| Boundary: `orchestrator.routingConfig` blocked in route files             | Prevents regression    |
| Boundary: `orchestrator.executeApproved` blocked in route and queue files | Prevents regression    |

#### Post-PR2 invariant

> No approval-related runtime behavior may call `LifecycleOrchestrator` directly. The only allowed remaining old-orchestrator usage is `simulate()` in `simulate.ts`.

### PR3 — Deletion

**Goal:** One approval owner. Old approval machinery removed.

#### Delete

| Target                                                      | Action                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/core/src/orchestrator/approval-manager.ts`        | Delete                                                                       |
| `packages/core/src/orchestrator/plan-approval-manager.ts`   | Already deleted in PR1                                                       |
| Approval methods in `lifecycle.ts`                          | Remove `respondToApproval()`, `respondToPlanApproval()`, `executeApproved()` |
| `packages/core/src/orchestrator/shared-context.ts`          | Remove approval-related fields                                               |
| `packages/core/src/__tests__/orchestrator-approval.test.ts` | Delete (replaced by `platform-lifecycle.test.ts`)                            |
| Approval sections in `orchestrator-auth.test.ts`            | Delete or migrate                                                            |
| `ApiOrchestratorAdapter.respondToApproval()`                | Remove method                                                                |

#### Keep (for now)

- `LifecycleOrchestrator` — stripped of approval methods, still needed for `simulate()` until Phase 7
- `cartridge-sdk` — P1 scope (move `ExecuteResult` type)
- `RuntimeOrchestrator` interface — P0c / P1 territory

#### Regression guard (required acceptance criteria)

CI must fail if:

- Any file imports `ApprovalManager` class
- Any file imports from `orchestrator/approval-manager.ts`
- Any route or queue file references `orchestrator.respondToApproval`, `orchestrator.executeApproved`, or `orchestrator.routingConfig`

---

## P0c — Single-Tenant Chat Legacy Deletion

**Discovery:** This is a deletion task, not a migration task. `main.ts` already routes all chat through `ChannelGateway` + `HttpPlatformIngressAdapter`. The old `ChatRuntime` family has zero production callers.

### Reachability verification (completed)

| Module                                      | Imported by production code?                                                                                                                                                                              | Verdict                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `runtime.ts` (ChatRuntime)                  | No — only test files                                                                                                                                                                                      | Delete                                                         |
| `bootstrap.ts` (createChatRuntime)          | No — only test files                                                                                                                                                                                      | Delete                                                         |
| `managed-runtime.ts` (createManagedRuntime) | No — only re-exported by bootstrap.ts                                                                                                                                                                     | Delete                                                         |
| `api-orchestrator-adapter.ts`               | No — only bootstrap.ts and managed-runtime.ts                                                                                                                                                             | Delete                                                         |
| `message-pipeline.ts`                       | No — only runtime.ts                                                                                                                                                                                      | Delete                                                         |
| `runtime-helpers.ts`                        | No — only runtime.ts and message-pipeline.ts                                                                                                                                                              | Delete                                                         |
| `handlers/` directory (6 files)             | No — only message-pipeline.ts and runtime.ts                                                                                                                                                              | Delete                                                         |
| `middleware/dialogue-middleware.ts`         | No — only runtime.ts                                                                                                                                                                                      | Delete                                                         |
| `composer/` directory (5 files)             | No — only reachable through dead tree. `llm-conversation-engine.ts` imports `response-generator.ts` but has zero importers itself                                                                         | Delete                                                         |
| `conversation/llm-conversation-engine.ts`   | No — only its own test file                                                                                                                                                                               | Delete                                                         |
| `interpreter/` directory                    | Yes — `conversation/llm-conversation-engine.ts` is dead, but `composer/response-generator.ts` uses `injection-detector.js`. However, composer is dead too. Check if any other live file uses interpreter. | **Keep** — used by test infrastructure; verify before deleting |

> **Precondition:** Do not delete any file until imports are proven unreachable from `ChannelGateway`, `gateway-bridge.ts`, `main.ts`, or any live gateway path. When in doubt, keep the file and flag it for follow-up.

### Delete list

| File / Directory                                        | Lines | Reason                                                   |
| ------------------------------------------------------- | ----- | -------------------------------------------------------- |
| `apps/chat/src/runtime.ts`                              | 411   | Dead — zero production callers                           |
| `apps/chat/src/bootstrap.ts`                            | 257   | Dead — zero production callers                           |
| `apps/chat/src/managed-runtime.ts`                      | 63    | Dead — zero production callers                           |
| `apps/chat/src/api-orchestrator-adapter.ts`             | 403   | Dead — zero production callers                           |
| `apps/chat/src/message-pipeline.ts`                     | ~300  | Dead — only called by runtime.ts                         |
| `apps/chat/src/runtime-helpers.ts`                      | ~50   | Dead — only called by runtime.ts and message-pipeline.ts |
| `apps/chat/src/handlers/` (6 files)                     | ~400  | Dead — only called by message-pipeline.ts                |
| `apps/chat/src/middleware/dialogue-middleware.ts`       | ~50   | Dead — only called by runtime.ts                         |
| `apps/chat/src/composer/` (5 files)                     | ~300  | Dead — import chain traced; all importers are dead       |
| `apps/chat/src/conversation/llm-conversation-engine.ts` | ~100  | Dead — zero importers outside own test                   |

**Estimated deletion: ~2,300 lines of dead code.**

### Test disposition

Each deleted test is classified as either permanently deleted (behavior no longer exists) or requiring replacement (behavior still exists at another layer).

| Test file                        | Behavior tested                                              | Classification                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime-integration.test.ts`    | Full vertical: message → propose → approve → execute → audit | **Replace** — this vertical exists in the API path; covered by `convergence-e2e.test.ts` and `api-execute.test.ts`. No new test needed. |
| `kill-switch.test.ts`            | Emergency halt via chat command                              | **Delete permanently** — kill-switch is a ChatRuntime cockpit command, not a gateway behavior                                           |
| `crm-auto-create.test.ts`        | CRM contact auto-linking on first conversation               | **Delete permanently** — CRM linking was a ChatRuntime-specific pipeline step                                                           |
| `whatsapp-compliance.test.ts`    | WhatsApp 24h messaging window enforcement                    | **Replace** — rewrite against `ChannelGateway` or the WhatsApp adapter directly. This is a real channel safety rule.                    |
| `cockpit-commands.test.ts`       | Operator cockpit commands (pause/resume/status)              | **Delete permanently** — cockpit commands were ChatRuntime handler-context dependent                                                    |
| `api-orchestrator-retry.test.ts` | HTTP retry logic in ApiOrchestratorAdapter                   | **Delete permanently** — adapter being deleted                                                                                          |
| `humanize.test.ts`               | ResponseHumanizer text transforms                            | **Delete permanently** — composer being deleted                                                                                         |

### Regression guard (required acceptance criteria)

CI must fail if any file in `apps/chat/src/` imports from:

- `./runtime.js` or `./runtime`
- `./bootstrap.js` or `./bootstrap`
- `./api-orchestrator-adapter.js`
- `./managed-runtime.js`
- `./message-pipeline.js`

---

## Post-P0 State

```
Approval:       PlatformLifecycle (sole owner)
Work submission: PlatformIngress.submit() (sole entry)
Chat runtime:   ChannelGateway + adapters (sole path)
Dashboard auth: Dev bypass blocked in production
Old orchestrator: simulate() only (Phase 7 exit condition)
```

## Acceptance Criteria Summary

All of these are required, not optional:

1. `getServerSession()` returns `null` when bypass is enabled in production
2. Patched approval parameters are re-evaluated by governance before execution
3. Plan approval code is deleted
4. Queue execution mode code is deleted
5. `PlatformLifecycle` has comprehensive test coverage (parity + correctness)
6. No route/queue file calls orchestrator for approval-related behavior
7. `routingConfig` is owned by `PlatformLifecycle`
8. `ApprovalManager` class does not exist
9. `ChatRuntime`, `ApiOrchestratorAdapter`, `bootstrap.ts`, `managed-runtime.ts` do not exist
10. WhatsApp 24h compliance is tested at the adapter/gateway layer
11. CI regression guards prevent reintroduction of deleted modules
