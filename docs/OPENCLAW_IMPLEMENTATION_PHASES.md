# OpenClaw Integration — Phased Implementation Plan

Best implementation approach in phases. Each phase is shippable and builds on the previous. Out of scope: workflow engine, carbon scheduling, net-new workflow authoring.

---

## Phase 0: Foundation (single execute surface)

**Goal:** Any client (including OpenClaw) can call one endpoint, get a deterministic outcome, and execute only through the governance spine.

**Deliverables:**

| # | Task | Location | Notes |
|---|------|----------|--------|
| 0.1 | **Canonical Action schema** | `packages/schemas/src/` | Add `ExecuteActionSchema`: `actionType`, `parameters`, `sideEffect: z.boolean()`, optional `magnitude` (e.g. `currencyDelta`, `countDelta`). Export and use for request validation. |
| 0.2 | **Runtime request/response types** | `packages/core/src/runtime-adapters/types.ts` (new) | `RuntimeExecuteRequest`: `actorId`, `organizationId?`, `requestedAction`, `entityRefs?`, `message?`, `traceId?`. `RuntimeExecuteResponse`: `outcome: 'EXECUTED' \| 'PENDING_APPROVAL' \| 'DENIED'`, `envelopeId`, `traceId`, `approvalId?`, `approvalRequest?`, `executionResult?`, `deniedExplanation?`. |
| 0.3 | **POST /api/execute** | `apps/api/src/routes/execute.ts` (new), register in `app.ts` | Body: actorId, organizationId?, action (actionType, parameters, sideEffect, magnitude?), entityRefs?, message?, traceId?. 1) Infer cartridgeId from actionType. 2) Call `orchestrator.resolveAndPropose()`. 3) If denied → return DENIED + explanation. 4) If pending_approval → return PENDING_APPROVAL + envelopeId, approvalId, approvalRequest (summary, bindingHash, etc.). 5) If approved → call `orchestrator.executeApproved(envelopeId)` (inline or enqueue), return EXECUTED + envelopeId, executionResult. Validate with ExecuteActionSchema. |
| 0.4 | **Validation and OpenAPI** | `apps/api/src/validation.ts`, Swagger in `app.ts` | Add ExecuteBodySchema using canonical action schema. Document POST /api/execute in OpenAPI (request/response, outcome enum). |

**Exit criteria:**  
- `POST /api/execute` returns EXECUTED | PENDING_APPROVAL | DENIED with envelopeId/traceId (and approvalId or executionResult as appropriate).  
- No new code paths for policy/approval/execution; reuses existing orchestrator.

**Do not:** Add workflow engine, scheduling, or new approval types.

---

## Phase 1: Governance profiles & performance

**Goal:** Per-org (or per-env) governance intensity and faster policy evaluation.

**Deliverables:**

| # | Task | Location | Notes |
|---|------|----------|--------|
| 1.1 | **Governance profile schema** | `packages/schemas/src/governance-profile.ts` (new) | Enum: `Observe \| Guarded \| Strict \| Locked`. Optional config type: thresholds, default approval level, or mapping to existing `SystemRiskPosture` (normal/elevated/critical). |
| 1.2 | **Profile → posture/thresholds** | `packages/core/src/engine/` or new `governance-profile.ts` | Map profile to posture and (optional) approval/risk overrides. Observe → more permissive; Locked → mandatory approval or deny. Config only, no forking of policy engine logic; e.g. override `effectiveRiskTolerance` or pass into existing policy/approval path. |
| 1.3 | **Profile store/config** | `packages/core` or `packages/db` | Store or config keyed by `organizationId` (and optionally team/env). Default profile (e.g. Guarded) when unset. Orchestrator (or policy context) reads profile for the request’s org and applies mapping. |
| 1.4 | **Policy cache** | `packages/core` (lifecycle or new cache module) | Cache `listActive({ cartridgeId })` (and org if policies are org-scoped). Key: cartridgeId + (organizationId ?? 'global'). TTL e.g. 60s. Invalidate on policy create/update/delete. Use in propose path in lifecycle. |
| 1.5 | **Audit traceId (optional)** | `packages/schemas/src/audit.ts`, `packages/core/src/audit/ledger.ts` | Add optional `traceId` to AuditEntry; set in `ledger.record()` when available from envelope or request context. Improves correlation for clients. |

**Exit criteria:**  
- Org-level profile (Observe/Guarded/Strict/Locked) influences approval strictness/posture.  
- Propose/execute path uses policy cache where configured.  
- Audit entries can carry traceId for correlation.

**Do not:** Add new approval UIs or workflow steps; keep existing approval flow.

---

## Phase 2: Adapter abstraction & security

**Goal:** Runtime-agnostic execution service and production-ready auth for runtimes.

**Deliverables:**

| # | Task | Location | Notes |
|---|------|----------|--------|
| 2.1 | **ExecutionService facade** | `packages/core/src/execution-service.ts` (new) or `runtime-adapters/execution-service.ts` | Single function or class: `execute(request: RuntimeExecuteRequest): Promise<RuntimeExecuteResponse>`. Internally: resolveAndPropose → then if approved, executeApproved. Same logic as Phase 0 route, so the route can call this facade. Keeps one place for “propose + conditional execute.” |
| 2.2 | **POST /api/execute uses ExecutionService** | `apps/api/src/routes/execute.ts` | Replace inline orchestrator calls with ExecutionService.execute(). Request/response stay the same. |
| 2.3 | **Auth: per-org or per-runtime keys** | `apps/api/src/middleware/auth.ts` | Extend key validation to support metadata (e.g. orgId, runtimeId). Options: key format (e.g. `sb_<org>_<secret>`), or lookup table (DB/env). Attach `request.organizationId` / `request.runtimeId` for routes and audit. |
| 2.4 | **Replay protection** | `apps/api/src/middleware/` or execute route | For POST /api/execute (and optionally POST /api/actions/propose): require `Idempotency-Key` header when a runtime identifier is present, or document that runtimes must send Idempotency-Key. Reuse existing idempotency middleware. |
| 2.5 | **RuntimeAdapter interface (optional)** | `packages/core/src/runtime-adapters/types.ts` | Formalize: `RuntimeAdapter { execute(request): Promise<RuntimeExecuteResponse> }`. ExecutionService is the default implementation. Prepares for OpenClaw/MCP adapters that translate protocol → RuntimeExecuteRequest → ExecutionService → RuntimeExecuteResponse. |

**Exit criteria:**  
- All execute traffic goes through ExecutionService.  
- Auth supports org/runtime-scoped keys; audit can attribute by org.  
- Runtimes are required or strongly encouraged to send Idempotency-Key for execute.

**Do not:** Add request signing in this phase unless trivial (can be Phase 3 or later).

---

## Phase 3: OpenClaw adapter & plugin contract

**Goal:** OpenClaw plugin can call Switchboard via a single tool; clear contract and high-level config.

**Deliverables:**

| # | Task | Location | Notes |
|---|------|----------|--------|
| 3.1 | **OpenClaw adapter** | `packages/core/src/runtime-adapters/openclaw.ts` or `apps/api/src/adapters/openclaw.ts` | Map OpenClaw tool payload (e.g. actionType, params, actor, org, traceId) → RuntimeExecuteRequest. Call ExecutionService (in-process) or HTTP POST /api/execute. Map RuntimeExecuteResponse → tool response: e.g. `{ outcome, envelopeId, traceId, approvalUrl?, approvalId?, executionResult?, error? }`. Approval URL can be a link to dashboard or approval API with approvalId. |
| 3.2 | **Tool contract doc** | `docs/` or OpenAPI | Document the OpenClaw tool: name (e.g. `switchboard_execute`), input schema (actionType, parameters, actorId, organizationId?, traceId?), output (outcome, envelopeId, approvalId, approvalUrl, executionResult, deniedExplanation). When PENDING_APPROVAL: plugin shows approvalUrl and can poll GET /api/approvals/:id, then call POST /api/approvals/:id/respond; after approve, plugin may call POST /api/actions/:id/execute or a dedicated “resume” if added. |
| 3.3 | **OpenClaw allow/deny config (high level)** | Docs or config schema | Document how to restrict which actions OpenClaw can request: use identity (forbiddenBehaviors, trustBehaviors), policies (deny/require_approval by actionType/cartridgeId), and Governance Profile. Example: “For SMB use Guarded; for MNC use Strict; lock down budget changes with require_approval policy.” No new engine; config only. |
| 3.4 | **Optional: Chat via API** | `apps/chat` | If single deployment-wide choke point is required: add config so Chat runtime calls POST /api/execute (and approval/execute APIs) instead of in-process orchestrator. Otherwise leave as-is and document that Chat has its own choke point. |

**Exit criteria:**  
- OpenClaw plugin can invoke one tool → Switchboard → EXECUTED | PENDING_APPROVAL | DENIED with clear follow-up (approval URL, poll, execute).  
- Contract and config for allow/deny are documented.

**Do not:** Build OpenClaw UI or plugin code in this repo; only adapter and contract.

---

## Summary

| Phase | Focus | Outcome |
|-------|--------|--------|
| **0** | Foundation | Single POST /api/execute, canonical Action schema, unified outcome. |
| **1** | Governance & perf | Profiles (Observe/Guarded/Strict/Locked), policy cache, audit traceId. |
| **2** | Abstraction & security | ExecutionService, per-org/runtime auth, idempotency for execute. |
| **3** | OpenClaw | Adapter, tool contract, allow/deny config; optional Chat→API. |

**Order:** 0 → 1 → 2 → 3. Phases 1 and 2 can overlap (e.g. profile store + policy cache in parallel), but 0 must complete before 2 (execute route uses ExecutionService), and 3 depends on 2 (adapter uses ExecutionService and auth).

**Out of scope (all phases):** Workflow engine, carbon/scheduling, new approval workflows, OpenClaw front-end or plugin implementation in this repo.
