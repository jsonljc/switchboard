# Platform Ingress Caller Migration Design

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Migrate `POST /api/execute` to `PlatformIngress`; build `DefaultGovernanceGate`; freeze architecture boundary

---

## Context

Switchboard currently has five isolated execution paths:

1. **Orchestrator** (cartridge actions) — full governance, tracing, approval lifecycle
2. **Skill runtime** (markdown skills) — own governance hooks, own trace model
3. **Agent runtime** (handler bootstrap) — no governance, no tracing
4. **Creative pipeline** (Inngest jobs) — no governance, no tracing
5. **Chat runtime** (multi-channel) — conditional governance via orchestrator

Each path has its own entry point, its own governance rules (or none), and its own tracing (or none). New work entering the system must choose which path to use. New paths create new silos.

The platform convergence contract (PRs #201-#204) introduced `PlatformIngress` — a single entry point with a shared `WorkUnit` model, `GovernanceGate` interface, `ExecutionModeRegistry`, and `WorkTrace` model. The contract is defined but has never carried real traffic.

This spec designs the first real proof: migrate one caller end-to-end through `PlatformIngress`, then freeze the architecture boundary to prevent new bypass paths.

## Strategy

**Prove one real caller end-to-end first. Then make PlatformIngress mandatory for all new callers while existing routes migrate incrementally.**

- Use approach (1) — prove the contract against a real request flow — to validate the platform
- Use approach (2) — no new bypass paths — to stop architectural regression
- Do not attempt full cutover — the contract has not yet carried real caller traffic

## First Caller: `POST /api/execute`

**File:** `apps/api/src/routes/execute.ts`

**Why this route:**

- Simple enough to debug — single propose-then-execute flow, ~60 lines of real logic
- Important enough to matter — primary API entry point for external integrations and MCP
- Exercises all PlatformIngress steps — intent lookup, trigger validation, mode resolution, normalization, governance, cartridge mode dispatch, tracing
- Already has idempotency — enables side-by-side result comparison
- Not the weirdest edge case — unlike chat (stateful, multi-turn) or creative pipeline (async Inngest)
- Proves the contract against a real external entry point, not an internal demo path

## DefaultGovernanceGate

### Why not just wrap `PolicyEngine.evaluate()`

`PolicyEngine.evaluate()` is the final authority — it includes identity checks, risk scoring, policy rules, guardrail checks, spend limits, confidence scoring, and approval determination. But the governance decision depends on **context assembly**, not just evaluation. The orchestrator's propose-pipeline is responsible for:

1. Identity resolution (`resolveIdentity()` + `applyCompetenceAdjustments()`)
2. Loading cartridge context (`storage.cartridges.get()`)
3. Enrichment + risk input construction (`enrichAndGetRiskInput()`)
4. Guardrail loading + state hydration (`cartridge.getGuardrails()` + `hydrateGuardrailState()`)
5. Policy loading from storage (with optional cache)
6. System risk posture resolution (`governanceProfileStore.get()` + `profileToPosture()`)
7. Composite risk context + spend lookup assembly
8. `PolicyEngineContext` assembly from all of the above
9. Calling `evaluate()` with the assembled context

**Governance parity depends on context assembly parity.** The adapter must reconstruct the same effective decision context the old propose pipeline used, then return that decision in platform form.

### Shape

```
DefaultGovernanceGate.evaluate(workUnit: WorkUnit) → GovernanceDecision

  1. Derive cartridgeId     → inferCartridgeId() from intent (migration bridge, not permanent)
  2. Resolve identity       → resolveIdentity() + applyCompetenceAdjustments()
  3. Load cartridge context  → storage.cartridges.get(cartridgeId)
  4. Enrich + get risk input → enrichAndGetRiskInput()
  5. Load guardrails + state → cartridge.getGuardrails() + hydrateGuardrailState()
  6. Load policies           → storage.policies.listActive() (with cache)
  7. Resolve risk posture    → governanceProfileStore.get() + profileToPosture()
  8. Build composite context → buildCompositeContext() + buildSpendLookup()
  9. Assemble PolicyEngineContext
  10. Call evaluate()         → returns DecisionTrace
  11. Map DecisionTrace → GovernanceDecision (see below)
```

**Location:** `packages/core/src/platform/governance/default-governance-gate.ts`

### v1 scope: cartridge-parity only

In v1, `DefaultGovernanceGate` preserves parity for cartridge-mode intents by reusing the propose-pipeline's context assembly. Non-cartridge modes (skill, pipeline) may use a thinner context assembly path until their mode-specific governance inputs are defined.

### `inferCartridgeId()` is a migration bridge

For the first proof, deriving `cartridgeId` from the intent (via `inferCartridgeId()`) is acceptable. Long term, this binding should come from the intent registry's explicit executor binding, not inference logic.

### Decision mapping

`DecisionTrace` → `GovernanceDecision`:

| DecisionTrace state           | GovernanceDecision                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `finalDecision === "deny"`    | `{ outcome: "deny", reasonCode, riskScore, matchedPolicies }`                                        |
| `approvalRequired !== "none"` | `{ outcome: "require_approval", riskScore, approvalLevel, approvers, constraints, matchedPolicies }` |
| Otherwise                     | `{ outcome: "execute", riskScore, budgetProfile, constraints, matchedPolicies }`                     |

**Decision richness preserved:**

- `matchedPolicies` — extracted from `DecisionTrace.checks` where check resulted in allow/deny
- `riskScore` — from `DecisionTrace.computedRiskScore.rawScore`
- `reasonCode` — from the deny check's type (e.g., `"FORBIDDEN_BEHAVIOR"`, `"RATE_LIMIT"`, `"SPEND_LIMIT"`)
- `approvalLevel` / `approvers` — from `DecisionTrace.approvalRequired` + approval routing

**`GovernanceDecision` is the platform's canonical output, not a repackaged internals dump.** The gate resolves actual approvers and approval level into the platform decision shape — it does not just relay raw `DecisionTrace` fields.

### Extracted governance primitives

The following functions are currently private to `packages/core/src/orchestrator/propose-pipeline.ts`. They are pure or mostly pure, reused by both the propose pipeline and the new `DefaultGovernanceGate`, and conceptually governance/context assembly primitives:

- `resolveEffectiveIdentity()`
- `enrichAndGetRiskInput()`
- `buildCompositeContext()`
- `buildSpendLookup()`
- `hydrateGuardrailState()`

**Extract to:** `packages/core/src/platform/governance/governance-primitives.ts`

The propose pipeline imports from the new location. No behavior change.

### ExecutionConstraints for v1

- Named constant: `DEFAULT_CARTRIDGE_CONSTRAINTS`
- Versioned: `constraintProfile: "default-cartridge-v1"`
- Attached to the `GovernanceDecision` so it is visible in `WorkTrace`
- Values: conservative defaults matching current orchestrator behavior
- Cartridge mode does not use LLMs directly, so model/token/turn limits are set to their type-required values but are not operationally meaningful for this mode
- Constraints should support "not applicable" semantics cleanly — do not overfit the shared constraints model around skill-only assumptions

## Migration Wiring

### Current flow

```
execute.ts route
  → validate body + idempotency key
  → apply skin tool filter
  → ExecutionService.execute(requestPayload)
  → map result to HTTP response
```

### New flow

```
execute.ts route
  → validate body + idempotency key     (unchanged)
  → apply skin tool filter               (unchanged)
  → build SubmitWorkRequest
  → PlatformIngress.submit(request)
  → map SubmitWorkResponse to HTTP response
```

Only step 3 changes. Validation, skin filter, and response mapping stay stable. This isolates the variable and makes parity debugging straightforward.

### Request translation

`ExecuteBody` → `SubmitWorkRequest`:

| ExecuteBody field                                       | SubmitWorkRequest field                     |
| ------------------------------------------------------- | ------------------------------------------- |
| `body.action.actionType`                                | `intent`                                    |
| `body.action.parameters`                                | `parameters`                                |
| `body.actorId`                                          | `actor: { id: body.actorId, type: "user" }` |
| `request.organizationIdFromAuth ?? body.organizationId` | `organizationId`                            |
| `"api"`                                                 | `trigger`                                   |
| Idempotency-Key header                                  | `idempotencyKey`                            |
| `body.traceId`                                          | `traceId`                                   |

### Response translation

`SubmitWorkResponse` → HTTP response:

`PlatformIngress.submit()` returns a response that represents three distinct states:

1. **Ingress rejection** — `{ ok: false, error: IngressError }` — the request was rejected before governance (unknown intent, disallowed trigger)
2. **Approval pending** — `{ ok: true, approvalRequired: true, result, workUnit }` — governance requires approval before execution
3. **Execution result** — `{ ok: true, result, workUnit }` — governance allowed execution; result contains the outcome

HTTP mapping:

| SubmitWorkResponse state                                               | HTTP response                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ok: false`, error type `intent_not_found`                             | 404 with error message                                                                   |
| `ok: false`, error type `trigger_not_allowed`                          | 400 with error message                                                                   |
| `ok: true`, `approvalRequired: true`                                   | 200, `{ outcome: "PENDING_APPROVAL", envelopeId, traceId, approvalId, approvalRequest }` |
| `ok: true`, `result.outcome === "failed"` with governance deny code    | 200, `{ outcome: "DENIED", envelopeId, traceId, deniedExplanation }`                     |
| `ok: true`, `result.outcome === "failed"` without governance deny code | 200, `{ outcome: "FAILED", envelopeId, traceId, error }`                                 |
| `ok: true`, `result.outcome === "completed"`                           | 200, `{ outcome: "EXECUTED", envelopeId, traceId, executionResult }`                     |

**Ingress-time denial and execution-time failure are kept distinct.** The old system sometimes surfaced denials as failures. The new platform model separates them:

- `DENIED` — governance gate said no (ingress-time)
- `FAILED` — governance gate said yes, but execution failed (execution-time)

### CartridgeMode dispatch

`CartridgeMode` delegates to the orchestrator's existing cartridge execution path for v1 parity. This is a migration bridge — `CartridgeMode` does not permanently depend on the old top-level route contract.

Currently `CartridgeMode.dispatch()` calls `CartridgeOrchestrator.propose()` with action parameters derived from the `WorkUnit`. For the first proof, this delegation stays unchanged. The orchestrator continues to own the actual cartridge execution lifecycle (parameter resolution, entity enrichment, cartridge `execute()` call).

**Important:** Since `DefaultGovernanceGate` now handles governance, and `CartridgeMode` delegates to the orchestrator which also runs governance internally, there is a double-governance risk. For the first proof, the orchestrator's internal governance must be **bypassed or made passthrough** when called from `CartridgeMode`, since governance has already been evaluated at the ingress layer.

**Chosen approach:** `CartridgeMode` calls a lower-level orchestrator method that executes without re-evaluating governance. This avoids flag-driven control flow (`governancePreApproved: true`) and keeps the boundary between platform governance and orchestrator execution clean.

### Bootstrap wiring

`PlatformIngress` is constructed in `apps/api/src/bootstrap/services.ts` alongside `executionService`:

- `IntentRegistry` — populated from cartridge manifests at startup
- `ExecutionModeRegistry` — with `CartridgeMode` registered
- `DefaultGovernanceGate` — wrapping extracted governance primitives
- `WorkTraceStore` — Prisma-backed, persists to `work_traces` table (requires migration)

During migration, both `executionService` and `platformIngress` coexist. The `execute.ts` route switches to `platformIngress`. Other callers that haven't migrated continue using `executionService`.

### `NeedsClarificationError` and `NotFoundError`

These exceptions are currently thrown by the orchestrator during `resolveAndPropose()`. In the new flow, they surface inside `CartridgeMode.dispatch()` and bubble up through `PlatformIngress.submit()`. The route catches them the same way.

## Success Criteria

The first caller proof must demonstrate:

1. **Same governance outcome** — for any given action + actor + org, both paths produce the same allow/deny/approval decision
2. **Same side-effect result** — approved cartridge actions execute identically
3. **Same idempotency behavior** — duplicate requests are handled correctly
4. **Same or explainably different error shape** — any response shape differences are documented and intentional (e.g., `DENIED` vs `FAILED` distinction)
5. **WorkTrace persisted correctly** — every request produces a trace record with governance outcome, risk score, matched policies, execution result, timing, and constraint profile
6. **No bypass** — all work flows through governance gate and cartridge mode; no direct orchestrator call from the route

**Verification approach:** Integration tests that submit the same action through both paths and assert decision + result parity.

## Boundary Freeze

Takes effect once the first caller proof passes. Not before.

### Invariant

**After the first proof passes, app-layer code may not call `orchestrator.resolveAndPropose()` directly; it must call `PlatformIngress.submit()`.**

### Rules

- All **new** API routes, chat handlers, and pipeline entry points must use `PlatformIngress`
- Existing routes keep their current paths temporarily — they migrate incrementally
- No new direct `orchestrator.resolveAndPropose()` calls from the app layer
- Enforced by: ESLint restricted-imports rule (preferred) or code review convention

### What the freeze does not require

- Migrating chat, creative pipeline, or MCP callers (incremental, later)
- Removing `ExecutionService` (still used by unmigrated callers)
- Removing the orchestrator (still used internally by `CartridgeMode`)

## Scope Boundaries

This design explicitly does **not** include:

- **Skill-mode or pipeline-mode governance assembly** — v1 is cartridge-parity only
- **Chat, creative pipeline, or MCP caller migration** — incremental, after the first proof
- **Replacing `inferCartridgeId()` with explicit intent registry bindings** — migration bridge stays for now
- **Per-mode constraint views or "not applicable" constraint semantics** — v1 uses shared `ExecutionConstraints` with named defaults
- **Prisma schema for `work_traces` table** — needed but mechanical; part of implementation plan
- **WorkTrace query API or dashboard** — traces are written, not yet read
- **Approval flow wiring through PlatformIngress** — v1 returns `approvalRequired: true`; the approval execution path (approve/reject/execute-approved) remains on the old route for now

## File Inventory

| File                                                               | Action                                           |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `packages/core/src/platform/governance/default-governance-gate.ts` | New                                              |
| `packages/core/src/platform/governance/governance-primitives.ts`   | New (extracted from propose-pipeline)            |
| `packages/core/src/platform/governance/default-constraints.ts`     | New                                              |
| `packages/core/src/orchestrator/propose-pipeline.ts`               | Modified (imports from governance-primitives)    |
| `apps/api/src/routes/execute.ts`                                   | Modified (switches to PlatformIngress)           |
| `apps/api/src/bootstrap/services.ts`                               | Modified (constructs PlatformIngress)            |
| `packages/core/src/platform/modes/cartridge-mode.ts`               | Modified (calls lower-level orchestrator method) |
| `packages/db/prisma/schema.prisma`                                 | Modified (adds WorkTrace model)                  |
| `packages/db/src/stores/prisma-work-trace-store.ts`                | New                                              |
| Integration tests (parity assertions)                              | New                                              |
