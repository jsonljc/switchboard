# OpenClaw Integration Audit — Switchboard Monorepo

**Auditor:** Senior staff engineer + security architect (Cursor AI)  
**Date:** 2025-02-23  
**Scope:** Code-level audit for correct, non-bypassable OpenClaw integration and generic runtime adapter architecture.

---

## 1) Executive summary

Switchboard has a **strong governance spine**: a single execution choke point via `GuardedCartridge` + `LifecycleOrchestrator.executeApproved()`, deterministic policy (Policy-as-Code) and risk scoring, approval binding with hash verification, and a hash-chained audit ledger. **Gaps for OpenClaw**: no runtime-adapter abstraction (OpenClaw would call the same HTTP API as any client), no single `/execute` endpoint that returns EXECUTED | PENDING_APPROVAL | DENIED in one call, no Governance Profiles (Observe/Guarded/Strict/Locked), and no per-org auth or replay protection. The chat app uses an **in-process orchestrator**; for a single deployment-wide choke point, runtimes should call the API rather than embedding the orchestrator. **Readiness score: 6.5/10** — spine is in place; integration surface and adapter pattern need to be added.

---

## 2) PASS/FAIL — Governance spine (A–E)

| Id | Requirement | Result | Evidence |
|----|-------------|--------|----------|
| **A** | Non-bypassable execution choke point | **PASS** | All side effects go through `GuardedCartridge.execute()` which throws unless `executionToken` is set; token is set only in `LifecycleOrchestrator.executeApproved()` (`packages/core/src/execution-guard.ts`, `packages/core/src/orchestrator/lifecycle.ts` L391–396, L545–619). Cartridges are registered as `GuardedCartridge(adsCartridge)` in `apps/api/src/app.ts` L141 and chat bootstrap. Vendor API calls (Meta Ads) exist only inside `cartridges/ads-spend`; no direct calls from API or chat. |
| **B** | Deterministic Policy-as-Code evaluation | **PASS** | Policy evaluation is in `evaluate()` in `packages/core/src/engine/policy-engine.ts` before any execution. Uses `evaluateRule()` from `rule-evaluator.ts` (deterministic conditions). Outcomes: `allow`, `deny`, `modify`, `require_approval`. No LLM in policy path. |
| **C** | Deterministic risk scoring | **PASS** | `computeRiskScore()` in `packages/core/src/engine/risk-scorer.ts` is pure (config + RiskInput → RiskScore). Used in policy engine and logged in `DecisionTrace.computedRiskScore`. Policy can depend on risk via identity risk tolerance and policy `riskCategoryOverride`. |
| **D** | Approvals as first-class blocking primitive | **PASS** | `REQUIRE_APPROVAL` / mandatory/elevated block execution until `respondToApproval()`. Binding: `computeBindingHash()` in `packages/core/src/approval/binding.ts` ties approval to envelopeId, version, actionId, parameters, decisionTraceHash, contextSnapshotHash; `respondToApproval()` validates `bindingHash` before approve/patch (`lifecycle.ts` L425–430). Replay: idempotency middleware supports `Idempotency-Key` header (`apps/api/src/middleware/idempotency.ts`). |
| **E** | Audit ledger + traceability | **PASS** | `AuditLedger.record()` used for proposed, denied, approved, rejected, executed, failed (`packages/core/src/audit/ledger.ts`). Entries have `envelopeId`, `organizationId`; correlation by envelopeId. Hash chain via `previousEntryHash`/`entryHash`; `verifyChain`/`deepVerify` in ledger. Redaction in `packages/core/src/audit/redaction.ts`. TraceId exists on envelope (`envelope.traceId`) but not on audit entry schema; correlation sufficient via envelopeId. |

---

## 3) PASS/FAIL — OpenClaw requirements (1–9)

| Id | Requirement | Result | Evidence / gap |
|----|-------------|--------|----------------|
| **1** | Inbound runtime adapter concept | **FAIL** | No `RuntimeAdapter` interface or `runtimeId`/actor/org/requestedAction/params/context/traceId abstraction. API routes (`apps/api/src/routes/actions.ts`) accept flat body (actionType, parameters, principalId, organizationId, …). **Gap:** Define adapter interface and optional `packages/core/src/runtime-adapters/` (or similar) with a canonical request shape. |
| **2** | Single `/execute` (or equivalent) endpoint | **FAIL** | Current flow: `POST /api/actions/propose` → then `POST /api/actions/:id/execute` when approved. No one-shot endpoint that returns EXECUTED | PENDING_APPROVAL | DENIED with executionId/approvalId/traceId. **Gap:** Add e.g. `POST /api/execute` that runs propose + conditional execute and returns unified outcome. |
| **3** | Tool-level granularity and action schema | **PARTIAL** | `ProposeBodySchema` in `apps/api/src/validation.ts` has actionType, parameters, principalId, organizationId, entityRefs, message. No typed `sideEffect` boolean or explicit `magnitude` (currency delta, count delta) in request schema; risk magnitude comes from cartridge `getRiskInput()` (e.g. `packages/schemas/src/risk.ts` RiskInput, `cartridges/ads-spend/src/risk/categories.ts`). **Gap:** Add canonical Action schema (Zod) with actionType, params, sideEffect, magnitude fields and use for validation. |
| **4** | Governance Profiles (Observe/Guarded/Strict/Locked) | **FAIL** | `SystemRiskPosture` is `normal` | `elevated` | `critical` (`packages/core/src/engine/risk-posture.ts`, `packages/schemas/src/risk.ts` L38); single global store, no per-org. No Observe/Guarded/Strict/Locked profiles or configurable thresholds. **Gap:** Introduce governance profile config (per org/team/env) mapping to posture + thresholds + approval strictness. |
| **5** | Cartridge executor isolation | **PASS** | Cartridges implement `Cartridge` from `packages/cartridge-sdk/src/cartridge.ts`; only `execute()` performs side effects. All production registration uses `GuardedCartridge`. Per-cartridge allowlists can be enforced via policy (cartridgeId filter) and identity forbidden/trust lists. |
| **6** | Approval flow integration points | **PASS** | Create: via `propose()` → envelope.status `pending_approval` and `approvalRequests`. Approve/deny: `POST /api/approvals/:id/respond` with action, respondedBy, bindingHash, patchValue (`apps/api/src/routes/approvals.ts`). Poll: `GET /api/approvals/pending`, `GET /api/approvals/:id`. Binding to action snapshot via bindingHash. OpenClaw can return approval URL (e.g. link to dashboard with approvalId) and poll then call execute. |
| **7** | Eventing / audit events | **PASS** | Event log: `AuditEntry` schema and `LedgerStorage` interface; persistence via Prisma or in-memory. Correlation: envelopeId on entries; query by envelopeId, organizationId, eventType, etc. (`apps/api/src/routes/audit.ts`: GET /, GET /verify, GET /:id). **Minor gap:** Audit entry schema has no explicit traceId field (only envelope has it); add to snapshot or optional field for client correlation. |
| **8** | Security for OpenClaw adapter | **FAIL** | Auth: `apps/api/src/middleware/auth.ts` validates Bearer against global `API_KEYS` env (comma-separated). No per-org API keys, no signed tokens, no request signing, no replay protection (nonce/timestamp). **Gap:** Per-org or per-runtime API keys, optional request signing, and replay protection (e.g. Idempotency-Key required for execute, or nonce+timestamp). |
| **9** | Performance requirements | **PARTIAL** | Policy evaluation: no policy cache in code (policies loaded per request from storage). Execution: async-capable via Redis queue (`apps/api/src/queue/execution-queue.ts`, worker calls `executeApproved`). Idempotency: middleware exists; optional `Idempotency-Key` header. **Gap:** Cache active policies per cartridge/org to avoid repeated DB reads. |

---

## 4) Bypass risk report

- **Chat app with in-process orchestrator:** If both `apps/api` and `apps/chat` are deployed, chat uses its own `LifecycleOrchestrator` and storage (see `createChatRuntime` in `apps/chat/src/runtime.ts`). Side effects still go through GuardedCartridge in that process, but there are two separate “choke points” (API and Chat). To enforce a single deployment-wide choke point, chat should call the Switchboard API for propose/execute instead of in-process orchestrator.
- **Direct cartridge registration:** If any code path registered a raw cartridge (e.g. `AdsSpendCartridge`) without `GuardedCartridge`, execution could be triggered without the token. Current code registers only `GuardedCartridge(adsCartridge)` in API and chat; no bypass found.
- **API without auth:** When `API_KEYS` is unset, auth is disabled (`auth.ts` L16–18). In production, API_KEYS must be set to avoid unauthenticated propose/execute.
- **Execute by ID without prior propose:** `POST /api/actions/:id/execute` requires envelope status `approved`. Status becomes approved only after `propose()` (auto-allow) or `respondToApproval()`. No way to approve without going through approval flow or auto-allow from propose; no bypass.
- **Simulate route:** `POST /api/simulate` only runs policy simulation and returns result; it does not execute. No bypass.

---

## 5) Concrete patch plan (≤12 steps, ordered, with file paths)

1. **Canonical Action schema (Zod)**  
   Add in `packages/schemas/src/action.ts` (or new `request-action.ts`): fields `actionType`, `parameters`, `sideEffect: z.boolean()`, optional `magnitude: z.object({ currencyDelta, countDelta, ... }).optional()`. Use for API validation and runtime adapter input.

2. **Runtime adapter interface**  
   Add `packages/core/src/runtime-adapters/types.ts`: interface `RuntimeExecuteRequest { runtimeId, actorId, organizationId?, requestedAction: Action, context?, traceId? }` and `RuntimeExecuteResponse { outcome: 'EXECUTED'|'PENDING_APPROVAL'|'DENIED', executionId?, approvalId?, envelopeId, traceId, ... }`.

3. **Single `/execute` endpoint**  
   In `apps/api/src/routes/`: add `execute.ts` (or extend `actions.ts`) with `POST /execute` that: (1) parses body against RuntimeExecuteRequest/Action schema, (2) calls `orchestrator.resolveAndPropose` (or propose), (3) if denied returns DENIED; if pending_approval returns PENDING_APPROVAL with approvalId/envelopeId; if approved calls `executeApproved` and returns EXECUTED with executionId. Register route in `app.ts`.

4. **Propose/execute use Action schema**  
   In `apps/api/src/validation.ts`: align propose body with canonical Action schema (actionType, parameters, sideEffect, magnitude if present). Keep principalId, organizationId, entityRefs, message as request-level fields.

5. **Governance Profiles**  
   Add `packages/schemas/src/governance-profile.ts`: enum or const for Observe / Guarded / Strict / Locked. Add store or config (e.g. in `packages/core` or DB) keyed by org/team/env. In `packages/core/src/engine/risk-posture.ts` (or new module): map profile to SystemRiskPosture and optional approval/risk thresholds. Wire into orchestrator config so policy/approval logic reads profile.

6. **Policy cache**  
   In `packages/core` (or API): add optional in-memory (or Redis) cache for `storage.policies.listActive({ cartridgeId })` keyed by cartridgeId (and org if present). Use in lifecycle propose path to avoid repeated DB reads.

7. **Audit entry traceId**  
   In `packages/schemas/src/audit.ts`: add optional `traceId` to AuditEntry (or ensure envelopeId + envelope.traceId is sufficient). If added, set in `ledger.record()` from envelope or request context in lifecycle.

8. **Auth: per-org or per-runtime keys**  
   In `apps/api/src/middleware/auth.ts`: extend to support key metadata (e.g. orgId, runtimeId) when validating Bearer token (e.g. key format or lookup table). Attach to request for use in routes and audit.

9. **Replay protection**  
   Require `Idempotency-Key` for `POST /api/actions/propose` and `POST /api/execute` when used by runtimes, or add optional nonce+timestamp validation in auth middleware. Document in OpenAPI.

10. **OpenClaw adapter package**  
    Add `packages/core/src/runtime-adapters/openclaw.ts` (or `apps/api` if API-specific): thin adapter that maps OpenClaw plugin tool payload to RuntimeExecuteRequest, calls internal ExecutionService or HTTP `/execute`, maps response to OpenClaw tool response (e.g. approval URL, status).

11. **ExecutionService abstraction**  
    In `packages/core`: add `ExecutionService` (or use orchestrator as-is) that accepts RuntimeExecuteRequest and returns RuntimeExecuteResponse. Single place for propose + conditional execute. Used by API route and adapters.

12. **Documentation and OpenAPI**  
    Update OpenAPI for new `/execute` and Action schema. Document Governance Profiles, auth, and idempotency for runtime adapters.

---

## 6) Future integration architecture recommendation

- **Adapter pattern:** Treat OpenClaw as one runtime adapter. Introduce a **RuntimeAdapter** interface that receives a canonical request (runtimeId, actor, org, requestedAction, params, context, traceId) and returns a canonical response (outcome, executionId, approvalId, traceId). The **ExecutionService** (orchestrator facade) is the single backend; adapters live in `packages/core/src/runtime-adapters/` or `apps/api/src/adapters/` and translate protocol-specific payloads (OpenClaw tool, future Claude Code, MCP) to/from that canonical shape.
- **MCP later:** Expose the same ExecutionService via an MCP server: one tool e.g. `switchboard_execute` that takes the same Action + context and returns the same outcome. No duplicate policy/approval/execution logic; only the transport (HTTP vs MCP) differs.
- **Single choke point across runtimes:** All runtimes (OpenClaw, chat, future MCP) should call the same execution API (or same in-process ExecutionService when co-hosted). Prefer routing chat through the API for propose/execute so one deployment has one orchestrator instance.

---

## 7) Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Security:** Shared API keys or no per-org isolation** | Introduce per-org or per-runtime API keys and attach org to request; scope audit and policies by organizationId. |
| **Security:** Replay or double execution** | Enforce Idempotency-Key for propose/execute for runtimes; keep bindingHash for approvals to prevent approval drift. |
| **Performance:** Policy load on every propose** | Add policy cache (per cartridge/org) with TTL; invalidate on policy CRUD. |
| **Product scope:** Governance Profiles creep** | Implement only Observe/Guarded/Strict/Locked as config that drives existing posture + thresholds; avoid new code paths per profile. |
| **Scope creep:** Workflow engine / carbon scheduling** | Explicitly out of scope for this integration; do not add workflow or scheduling to achieve OpenClaw integration. |

---

## Appendix: Repo map (summary)

| Area | Location | Notes |
|------|----------|--------|
| **API entrypoints** | `apps/api/src/app.ts`, `apps/api/src/routes/*.ts` | Fastify; routes: /api/actions (propose, get, execute, undo, batch), /api/approvals, /api/policies, /api/audit, /api/identity, /api/simulate, /api/health, /api/interpreters. |
| **Policy engine** | `packages/core/src/engine/policy-engine.ts`, `rule-evaluator.ts` | evaluate() builds DecisionTrace; rules from Policy. |
| **Risk scoring** | `packages/core/src/engine/risk-scorer.ts`, `risk-posture.ts` | computeRiskScore(); posture from RiskPostureStore. |
| **Approvals** | `packages/core/src/approval/router.ts`, `state-machine.ts`, `binding.ts`, `patching.ts`, `delegation.ts` | routeApproval, createApprovalState, transitionApproval, computeBindingHash, canApprove. |
| **Audit** | `packages/core/src/audit/ledger.ts`, `redaction.ts`, `canonical-hash.ts`, `evidence.ts` | AuditLedger.record(), query, verifyChain, deepVerify. |
| **Cartridge SDK** | `packages/cartridge-sdk/src/cartridge.ts`, `context.ts`, `connection.ts` | Cartridge interface; ExecuteResult, CartridgeContext. |
| **Cartridge impl** | `cartridges/ads-spend/src/index.ts`, `providers/meta-ads.ts` | AdsSpendCartridge; MetaAdsProvider (vendor API). |
| **Execution guard** | `packages/core/src/execution-guard.ts` | beginExecution/endExecution; GuardedCartridge wraps execute(). |
| **Orchestrator** | `packages/core/src/orchestrator/lifecycle.ts` | propose(), resolveAndPropose(), respondToApproval(), executeApproved(), requestUndo(), simulate(). |
| **Schemas (Zod)** | `packages/schemas/src/*.ts` | action.ts, envelope.ts, policy.ts, risk.ts, audit.ts, decision-trace.ts, chat.ts, identity-spec.ts. |
| **Auth** | `apps/api/src/middleware/auth.ts` | Bearer vs API_KEYS; skip if unset. |
| **Idempotency** | `apps/api/src/middleware/idempotency.ts` | Idempotency-Key header; Redis or memory backend. |
| **OpenClaw interpreter** | `apps/chat/src/interpreter/openclaw.ts` | LLM interpreter for chat; does not call Switchboard API (chat uses in-process orchestrator). |

**Existing execution choke point:**  
`POST /api/actions/propose` → `LifecycleOrchestrator.resolveAndPropose()` → `propose()` → policy + risk → envelope saved; then either auto-execute (trusted/low risk) or `pending_approval`. Execution only via `POST /api/actions/:id/execute` or `respondToApproval(approve)` → `executeApproved()` → `beginExecution()` → `GuardedCartridge.execute()` → cartridge. No other path triggers cartridge execution in production code.
