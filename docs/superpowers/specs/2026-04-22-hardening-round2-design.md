# Pre-Launch Hardening Round 2 — Design Spec

## Context

Audit on 2026-04-22 found 3 of 6 critical issues fixed (C2 approval persistence, C4 skill governance, C5 SSRF), 1 partially fixed (C1 idempotency), and the rest open. PR #241 landed `ApprovalLifecycleService` with revisions, binding hash, and dispatch admission — but the approval respond path in `approvals.ts` still uses the legacy `PlatformLifecycle.respondToApproval()`.

Creative-pipeline governance convergence is deferred to post-launch. Ad-optimizer is launch-critical.

## Priority Order

PR2 > PR1 > PR3 > PR4

PR2 reduces the most architectural confusion. PR1 is urgent but small. PR3 and PR4 are important but lower blast radius.

---

## PR1: Security & Correctness (Surgical)

Narrow, high-confidence fixes. No architectural change.

### C1 — Idempotency fingerprint scoping

**File:** `apps/api/src/middleware/idempotency.ts`

Add `orgId` and `actorId` to `computeFingerprint()`. Extract org from `request.organizationIdFromAuth` (or header), actor from `request.authenticatedPrincipalId` (or header). Fingerprint becomes `${method}:${route}:${orgId}:${actorId}:${bodyHash}`.

### C3 — Trace update must succeed before execution (temporary guard)

**File:** `packages/core/src/platform/platform-lifecycle.ts`

In `updateWorkTraceApproval()`, remove the silent `catch {}` block. Let the error propagate. If the trace update fails, `executeAfterApproval()` must not proceed with stale parameters.

**This is a temporary guard.** PR2 deletes `PlatformLifecycle.respondToApproval()` entirely once the approval respond path migrates to `ApprovalLifecycleService`.

### H7 — Encryption unification

**Files:** `apps/api/src/routes/setup.ts`, `apps/dashboard/src/lib/crypto.ts`

- Use one env var: `CREDENTIALS_ENCRYPTION_KEY`
- Use one derivation: `crypto.createHash("sha256").update(key).digest()`
- Both setup.ts (encrypt) and dashboard crypto.ts (decrypt) use the same derivation
- Add a test that encrypts via setup logic and decrypts via dashboard logic with the same secret

### M5 — Remove insecure default secret

**File:** `apps/api/src/routes/ad-optimizer.ts`

Remove `?? "switchboard-verify"` fallback. Require `META_WEBHOOK_VERIFY_TOKEN` in all non-test mutating environments. Fail startup (or fail the verification endpoint) if missing. Allow fallback only in explicitly marked test harnesses.

---

## PR2: Approval Migration + Aggressive Rip-and-Replace

The critical PR. Two parts — migration first, then deletion.

### Testable invariants (post-PR2)

- All mutating request entrypoints flow through `PlatformIngress`
- All approval responses flow through `ApprovalLifecycleService`
- No mutating route calls legacy orchestrator/lifecycle paths directly

### Part A — Migrate approval respond to ApprovalLifecycleService

**Files:** `apps/api/src/routes/approvals.ts`, `packages/core/src/approval/lifecycle-service.ts`

1. **Approve:** `approvals.ts` calls `lifecycleService.approveLifecycle()` (new method to add to `lifecycle-service.ts`) which transitions lifecycle status to `approved`, calls `validateDispatchAdmission()` (already exists), calls `buildMaterializationInput()` (already exists) to freeze the revision's `parametersSnapshot` as canonical payload, then dispatches via `ModeRegistry`. **`approveLifecycle()` must be the only place that can dispatch approved work for lifecycle-backed approvals.** No side-door dispatch paths.

2. **Patch:** `approvals.ts` calls `lifecycleService.createRevision()` (already exists) to create a new revision with patched parameters + new binding hash. Then calls approve on the new revision. Patched parameters are canonical because the revision's `parametersSnapshot` is what the materializer freezes.

3. **Reject:** `approvals.ts` calls `lifecycleService.rejectLifecycle()` (new method to add to `lifecycle-service.ts`) which transitions lifecycle status to `rejected`, updates the associated WorkTrace to a **terminal `rejected` outcome** (not left as `pending` with a detached approval state), and records an audit entry.

4. **Delete `/remind` endpoint** — notifier was never wired, no consumers.

5. **Remove `approvalNotifier` construction from `app.ts`** — no consumers remain after `/remind` deletion.

### Split guidance

PR2 is the largest PR. If the migration (Part A) and deletion (Part B) start entangling during implementation, split into PR2A (approval migration only) and PR2B (dead code removal). The design supports this — Part B's pre-delete gates depend on Part A being complete, so they are naturally sequential.

### Part B — Dead code and legacy runtime removal

**Pre-delete gate for each target:** Perform import/registration/caller sweep. If still referenced, rewire or fail compile. Never silently preserve a fallback.

| Target                                                        | Action                            | Pre-delete check                                                                                           |
| ------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PlatformLifecycle.respondToApproval()`                       | Delete method                     | Confirm `approvals.ts` no longer calls it                                                                  |
| `PlatformLifecycle.simulate()`                                | Delete method                     | Confirm `simulate.ts` is deleted first                                                                     |
| `operator-deps.ts` + `operator.ts` + dashboard operator proxy | Delete files                      | Sweep all imports of `buildOperatorDeps`, `OperatorDeps`, operator route registration                      |
| `scheduler-deps.ts`                                           | Delete file                       | Sweep all imports of `buildSchedulerDeps`                                                                  |
| `simulate.ts` + `simulate-chat.ts`                            | Delete files                      | Sweep route registration in `routes.ts`                                                                    |
| `pipeline-mode.ts` + test                                     | Delete files                      | Confirm no import in `app.ts` or mode registry (already confirmed: none)                                   |
| `ExecutionService`                                            | Delete class + file               | Sweep all `app.executionService` references, rewire any remaining callers to `PlatformIngress`             |
| `LifecycleOrchestrator` boot in `app.ts`                      | Remove construction + decoration  | Sweep all `app.orchestrator` references — must be zero after `simulate.ts` and `ExecutionService` deletion |
| MCP in-memory legacy mode                                     | Delete from `server.ts`/`main.ts` | Keep only API-backed mode via `api-execution-adapter.ts`                                                   |
| `/remind` endpoint in `approvals.ts`                          | Delete                            | No consumers                                                                                               |
| `approvalNotifier` in `app.ts`                                | Remove construction               | No consumers after `/remind` deletion                                                                      |

---

## PR3: Ad-Optimizer Governance Convergence

**File:** `apps/api/src/routes/ad-optimizer.ts`

Move the three side-effect categories behind PlatformIngress:

1. **Contact creation** — submit as a governed intent (e.g., `contacts.create`) with audit trail
2. **WhatsApp template sends** — submit as a governed intent (e.g., `whatsapp.send_template`) with trust-level gating
3. **Outbox event writes** — flow through the same trace/idempotency contract

All three go through `PlatformIngress.submit()`, but they should have **distinct trust policies**:

- **Contact creation** (`contacts.create`) — low risk, auto-approve at guided+ trust
- **WhatsApp template send** (`whatsapp.send_template`) — medium risk, requires supervised approval at low trust, auto-approve at autonomous
- **Outbox event write** (`outbox.write`) — low risk, auto-approve, but must have audit trail

The ad-optimizer route becomes a thin orchestration layer that submits intents rather than performing side effects directly.

---

## PR4: Webhook Persistence + Chat Cleanup

May split into two PRs if webhook persistence grows large.

### Webhook persistence

**Files:** `apps/api/src/routes/webhooks.ts`, `packages/db/prisma/schema.prisma`

- Add `WebhookRegistration` Prisma model (id, orgId, url, events, secret, createdAt)
- Replace in-memory `Map` with Prisma CRUD
- Add delivery state tracking (outbox pattern or simple status field)

### Chat ingress error typing

**File:** `apps/chat/src/gateway/http-platform-ingress-adapter.ts`

Preserve typed failure classes. Distinguish `validation_failed` from `upstream_error` and `network_error`. Add `retryable` flag.

### Chat single-tenant path removal

**File:** `apps/chat/src/main.ts`

Remove the `StaticDeploymentResolver` + `InMemoryGatewayConversationStore` path. Keep only the managed/DB-backed path.

---

## Scope Exclusions

- **M9 (core package split)** — large refactor, no bug-fix payoff, deferred indefinitely
- **C6 creative-pipeline governance** — deferred to post-launch
- **M10 (convergence tests)** — each PR adds tests for its own changes; a dedicated cross-entrypoint test suite is a separate effort

## Success Criteria

After all four PRs:

1. `app.ts` boots exactly one runtime stack (PlatformIngress + PlatformLifecycle + ModeRegistry)
2. All approval responses flow through `ApprovalLifecycleService` with revision-based parameter canonicalization
3. No dead routes, legacy mutating entrypoints, stubs returning null, or silent no-ops in production boot
4. Ad-optimizer side effects have governance audit trail
5. Idempotency keys are tenant-isolated
6. One encryption contract for API keys
