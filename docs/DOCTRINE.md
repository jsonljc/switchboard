# Switchboard — Architectural Doctrine

> Hard rules, not aspirational guidance. Every change must comply.
> Last updated: 2026-05-24.

Switchboard is a **governed operating system for revenue actions**, not a collection of smart agents. Agents are one execution layer. The operating spine — ingress, governance, lifecycle, persistence, recovery — is the architecture.

---

## Canonical Vocabulary

These are the only architectural nouns. If a concept doesn't map to one of these, it does not belong in `packages/core` or `packages/schemas`.

| Term            | Definition                                                                                                                                                                                                                                                                                                                                                                                             | Canonical type                                                       | Status                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------- |
| **Deployment**  | Runtime substrate. An organization's instance of a skill with trust level, persona, and policy overrides. All work executes within a deployment context.                                                                                                                                                                                                                                               | `DeploymentContext`                                                  | **Foundational**        |
| **Intent**      | A requested business action. The routing key from work request to execution mode. Registered in the IntentRegistry with mutation class, budget class, approval policy, and executor binding.                                                                                                                                                                                                           | `IntentRegistration`                                                 | **Foundational**        |
| **Governance**  | Permission, policy, and risk gate. Evaluates a WorkUnit against identity, policies, risk scoring, and guardrails. Produces a GovernanceDecision: execute, require_approval, or deny.                                                                                                                                                                                                                   | `GovernanceGate` / `GovernanceDecision`                              | **Foundational**        |
| **Mode**        | Execution path shape. How an intent is fulfilled. Currently: `skill` (LLM tool-calling), `pipeline` (async job), `cartridge` (legacy deterministic).                                                                                                                                                                                                                                                   | `ExecutionMode` / `ExecutionModeName`                                | **Foundational**        |
| **Tool**        | Auditable side-effect surface. A deterministic, idempotent function exposed to skill execution. Tools are product surfaces, not utilities.                                                                                                                                                                                                                                                             | `ToolDeclaration`                                                    | **Foundational**        |
| **WorkUnit**    | The normalized representation of a single governed action. Created at ingress, immutable after normalization.                                                                                                                                                                                                                                                                                          | `WorkUnit`                                                           | **Foundational**        |
| **WorkTrace**   | The canonical persistence record for every governed action. One WorkTrace per WorkUnit. The sole operational truth.                                                                                                                                                                                                                                                                                    | `WorkTrace`                                                          | **Foundational**        |
| **Workflow**    | Durable multi-step execution with safety envelopes, approval checkpoints, and recovery semantics.                                                                                                                                                                                                                                                                                                      | `WorkflowExecution`                                                  | **Active**              |
| **Operator**    | Human escalation and control surface. Business owners who manage their AI workforce through chat.                                                                                                                                                                                                                                                                                                      | `OperatorCommand`                                                    | **Active**              |
| **Skill**       | Product-facing capability definition. A markdown file with YAML frontmatter defining LLM prompts + tool bindings. Skills are what the platform sells. They are not the architectural center of gravity.                                                                                                                                                                                                | Skill markdown files                                                 | **Active**              |
| **Agent**       | Product and UX metaphor only. The user-facing name for a deployed skill. Not an architectural concept. Do not create `Agent*` types in core for runtime purposes.                                                                                                                                                                                                                                      | Dashboard/marketplace only                                           | **Product surface**     |
| **Cartridge**   | Legacy bridge only. No cartridge implementations exist. CartridgeMode is retained as one execution mode for backward compatibility. Do not build new cartridges.                                                                                                                                                                                                                                       | `CartridgeMode`                                                      | **Legacy bridge**       |
| **Marketplace** | Historical namespace — **not** a deletable storefront surface. Originally a product-discovery metaphor; today the prefix for live provisioning/platform infrastructure: `AgentListing` records, deployment + trust-progression APIs, and the `core/src/marketplace` trust-score engine/adapter that feeds the orchestrator trust path. See the namespace note below before touching anything under it. | `core/src/marketplace` + `/api/marketplace` routes + dashboard proxy | **Live infrastructure** |

### Retired Terms

These terms should not appear in new code:

- **Listing** — prefer "skill" or "deployment" in new domain language. This is a vocabulary rule for new code, **not** a license to delete: the `AgentListing` Prisma model and the `/api/marketplace/listings` routes are live infrastructure (see the Marketplace namespace note below).
- **Agent roster** — use deployment + principal
- **Agent theater** — no replacement; this metaphor is retired
- **Data flow** — cross-cartridge orchestration; no longer applicable
- **Enrichment** — cross-cartridge context sharing; no longer applicable

### Marketplace namespace (historical, but live)

The `marketplace` namespace is historical. It is **not** a deletable storefront surface, and must not be treated as dead operator UX. It backs live provisioning/platform infrastructure across all three layers:

- **core** — `packages/core/src/marketplace/`: `TrustScoreEngine` + `TrustScoreAdapter`, consumed on the live orchestrator trust path (`orchestrator/propose-helpers.ts`, `orchestrator/lifecycle.ts`, `orchestrator/shared-context.ts`, `platform/platform-lifecycle.ts`).
- **api** — `/api/marketplace/*`: the provisioning backbone (`AgentListing` records, `/deployments`, `/tasks`, `/listings/:id/trust/progression`). Persona, creative-pipeline, onboard, deployment-memory, and ad-optimizer routes are also registered under this prefix.
- **dashboard** — `apps/dashboard/src/app/api/dashboard/marketplace/*`: the dashboard→api proxy namespace (deployments, connections incl. Telegram, creative-jobs, faq-drafts, …) plus `api-client/marketplace.ts` (re-exported from the api-client barrel).

Do not remove or rename this namespace opportunistically. A rename is an API-breaking, cross-layer migration — internal symbols → public route prefix (with back-compat) → schemas/seeds → Prisma models + migration history — and must be its own dedicated initiative, never a drive-by. (The distinct `/api/storefront` routes are the actual customer-facing surface; do not conflate them with this namespace.)

---

## Non-Negotiable Invariants

### 1. One control plane

Every governed action enters through `PlatformIngress.submit()`. No route, adapter, or gateway may call orchestrator methods directly for new work submission. The ingress-boundary test (`apps/api/src/__tests__/ingress-boundary.test.ts`) enforces this.

**Migration target:** Approval response, post-approval execution, undo, simulate, and emergency halt must also flow through the platform layer. Until they do, the old orchestrator remains as a lifecycle bridge — not as an alternative control plane.

### 2. One lifecycle spine

Every action lifecycle — submission, governance, execution, approval, completion, undo, recovery — is managed by the platform layer. No subsystem may independently manage action state transitions.

**Current state:** Approval lifecycle is owned by `PlatformLifecycle` (`packages/core/src/platform/platform-lifecycle.ts`). `respondToApproval()` is exported from `@switchboard/core` and called by the API approvals route. The legacy `ApprovalManager` was deleted 2026-04-19; `LifecycleOrchestrator.respondToApproval()` remains only as a throwing placeholder until the orchestrator interface itself is retired.

### 3. One persistence truth

`WorkTrace` is the canonical durable record for every governed action. One WorkTrace per WorkUnit. No synthetic envelopes, no parallel persistence models.

**Current state:** `envelope-bridge.ts` deleted in Phase 3. WorkTrace is written on every PlatformIngress submission. Envelopes remain only for the legacy approval-record shape (`ApprovalRecord.envelopeId` is semantic debt — the field stores `workUnitId` but retains the legacy name pending a dedicated rename migration).

### 4. Governance runs once

Every action is evaluated by `GovernanceGate.evaluate()` exactly once. Execution modes must not re-evaluate governance. When CartridgeMode calls `orchestrator.executePreApproved()`, governance must not run again inside the orchestrator.

### 5. Deployment context is resolved once, at ingress

`DeploymentContext` is resolved by `DeploymentResolver` at the ingress boundary. Routes must not manually construct deployment context from request parameters. All API routes use `resolveDeploymentForIntent()` which delegates to `DeploymentResolver`.

### 6. Idempotency at ingress

Idempotency is enforced at `PlatformIngress` via `idempotencyKey` on `SubmitWorkRequest`. Execution modes and tools do not manage their own idempotency — the platform guarantees it.

### 7. Dead-letter for every async path

Every async execution path (pipeline mode, workflow steps, channel messages) must have a dead-letter destination. `FailedMessage` (channels), `OutboxEvent` (events), and pipeline-level error handling must cover every case.

### 8. Human override is first-class

Approval, undo, and emergency halt are not edge cases. They are core lifecycle operations with the same persistence, tracing, and governance guarantees as normal execution.

### 9. Tools are strict, auditable, idempotent

Tools exposed to skill execution are product surfaces. Each tool must:

- Have a declared schema
- Be idempotent or explicitly marked as non-idempotent with justification
- Produce an auditable record via the WorkTrace
- Respect governance constraints (maxWritesPerExecution, allowedModelTiers, etc.)

### 10. Channel is ingress, not architecture

Chat channels (Telegram, WhatsApp, Slack, web widget) are ingress surfaces. They resolve a deployment context and submit work through `PlatformIngress`. They do not run alternative execution architectures.

**Current state:** Multi-tenant `ChannelGateway` and single-tenant path (with `SWITCHBOARD_API_URL`) both route through PlatformIngress. Chat local mode (no `SWITCHBOARD_API_URL`) still uses the old `ChatRuntime` + `LifecycleOrchestrator` path — contained to local development.

### 11. Cross-app types live in `@switchboard/schemas`

A type declared in `apps/api/`, `apps/chat/`, or `apps/dashboard/` that is also defined elsewhere — by name, by shape, or by structural duplication — is a contract violation. The single source of truth for any value type that crosses an app boundary is `@switchboard/schemas`.

**Why:** Local redeclarations drift. The same `interface ApprovalRecord` declared in three apps will, over time, develop three different shapes, and the seams between them become silent corruption sites. Centralising in `@switchboard/schemas` makes the contract the artifact that has to change, not the consumer.

**Enforcement:** `check-routes`'s cross-app-types advisory (`.agent/tools/cross-app-types-check.ts`) flags new local `export interface` / `export type` declarations whose name matches a `@switchboard/schemas` export. Inline suppression via `// route-governance: local-view-model` on the line above the declaration is permitted for deliberately narrower local shapes (e.g. a route handler's `ApprovalRecordForResponse` response view) — those are not violations, they are intentionally narrower views.

**Current state:** Warning mode (PR-2.5). PR-4 flips to error mode after the full `@route-class` backfill so the cross-app-types rule and the route-class matrix flip enforcement together.

### 12. Routes are classified; the class is enforced

Every route under `apps/api/src/routes/` and `apps/chat/src/routes/` declares its class via a first-line `// @route-class: <class>` header. Dashboard routes under `apps/dashboard/src/app/api/dashboard/**` are classified **dashboard-proxy** by directory convention (no explicit header required); dashboard routes outside `/dashboard/` — e.g. waitlist, auth callbacks — require an explicit header. Classification is permanent; promoting a route across classes carries the same migration discipline as the initial classification.

**The six classes:**

| Class              | One-line definition                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `operator-direct`  | Operator asks the system to change business state; flows through `PlatformIngress.submit()`                   |
| `lifecycle`        | Operates on an already-governed record (approval response, DLQ retry, escalation reply)                       |
| `control-plane`    | Owner-controlled platform configuration (policies, identity, connections, governance profile)                 |
| `ingress-receiver` | External inbound event handler (webhook, OAuth callback) before a canonical submit request can be constructed |
| `read-only`        | No business-state mutation; includes pure GETs, derived projections, and diagnostic-write surfaces            |
| `dashboard-proxy`  | Next.js forwarding proxies under `apps/dashboard/src/app/api/dashboard/**`; applied by directory convention   |

**Per-class obligations (condensed — see `docs/superpowers/specs/2026-05-16-route-governance-contract-v1.md` §3 for the full matrix):**

- **Auth guard:** `operator-direct` / `lifecycle` / `control-plane` use `requireOrgForMutation`; `ingress-receiver` uses signature/secret verification; `read-only` uses `requireOrg`.
- **Idempotency-Key header:** required (400 if absent) on `operator-direct` only.
- **WorkTrace persistence:** required on `operator-direct` (via `PlatformIngress.submit`); `lifecycle` is service-owned; `control-plane` audits via `auditLedger.record()` in-handler; `ingress-receiver` obligation falls on the downstream worker; `read-only` has no obligation.
- **Cross-app types:** all classes must source shared types from `@switchboard/schemas`; local declarations that collide with a schemas export are violations (suppressed via `// route-governance: local-view-model`).
- **Store mutations:** every Prisma mutation must include `organizationId` in the WHERE clause; `updateMany` is required for single-row updates (so `count === 0` is the security-correct conflation of missing-row and tenant-mismatch).

**CI enforcement — `check-routes --mode=error` blocks on:**

1. Missing or invalid `@route-class` header on any route-registering api/chat route, or on any non-`/dashboard/` dashboard route.
2. `operator-direct` and `read-only` per-class matrix cell violations.
3. Cross-app type duplicates (local type name collides with a `@switchboard/schemas` export, minus `// route-governance: local-view-model`).
4. Un-scoped store mutations (Prisma mutation whose WHERE lacks an org filter, minus directive-suppressed sites).
5. Empty schemas type enumeration (validator-malfunction guard).

**Tracked deferrals:** Four pre-existing `operator-direct` routes (`actions.ts`, `execute.ts`, `ingress.ts`, `revenue.ts`) carry `// route-governance: operator-direct-contract-deferred` pending decorator wiring / ingress migration — tracked in **#654**. `CreatorIdentity` (×5) and `storage/prisma-lifecycle-store.updateDispatchRecord` store tenant-scoping awaits a Prisma `@relation` migration (suppressed via `// route-governance: store-mutation-deferred`) — tracked in **#643**. Cat 3.15 (typed Graph API response wrapper) and Cat 3.16 (agentContext null guard) are tracked in **#655**. Stricter lifecycle / control-plane / ingress-receiver matrix cells are future tightening, not current enforcement.

---

## Legacy Bridge Registry

These components exist only to support the migration from the old runtime to the unified platform layer. Each has an exit condition.

| Component                          | Location                                                    | Exit Condition                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LifecycleOrchestrator`            | `core/src/orchestrator/lifecycle.ts`                        | Remove when approval response, undo, simulate, and emergency halt are handled by the platform layer                                                   |
| `ExecutionService`                 | `core/src/execution-service.ts`                             | Last runtime consumer (MCP server) removed 2026-05; retire after confirming no remaining runtime consumer                                             |
| `CartridgeMode`                    | `core/src/platform/modes/cartridge-mode.ts`                 | Phase 4: no longer creates envelopes. Remove when no IntentRegistration uses `mode: "cartridge"`                                                      |
| ~~`envelope-bridge.ts`~~           | ~~`apps/api/src/routes/`~~                                  | **Deleted in Phase 3**                                                                                                                                |
| `ProposePipeline`                  | `core/src/orchestrator/propose-pipeline.ts`                 | Remove with LifecycleOrchestrator                                                                                                                     |
| `ExecutionManager`                 | `core/src/orchestrator/execution-manager.ts`                | Remove with LifecycleOrchestrator                                                                                                                     |
| `RuntimeOrchestrator` interface    | `core/src/orchestrator/runtime-orchestrator.ts`             | Remove with LifecycleOrchestrator                                                                                                                     |
| `ApiOrchestratorAdapter`           | `apps/chat/src/api-orchestrator-adapter.ts`                 | Active — adapts chat orchestrator calls to API HTTP requests. Remove when chat local mode is retired                                                  |
| `ChatRuntime`                      | `apps/chat/src/runtime.ts`                                  | Active — used by chat local mode (no `SWITCHBOARD_API_URL`). Remove when local mode is retired                                                        |
| `cartridge-sdk` package            | `packages/cartridge-sdk/`                                   | Remove when CartridgeMode is removed                                                                                                                  |
| `data-flow/`                       | `core/src/data-flow/`                                       | Active — `DataFlowExecutor` consumed by ChatRuntime via core barrel. Delete after ChatRuntime retirement                                              |
| ~~`enrichment/`~~                  | ~~`core/src/enrichment/`~~                                  | **Deleted in Phase 5**                                                                                                                                |
| `ApprovalRecord.envelopeId`        | `db/prisma/schema.prisma`, `core/src/storage/interfaces.ts` | Semantic debt: field stores workUnitId but is named envelopeId. Rename in a dedicated migration PR.                                                   |
| Recommendation act direct mutation | `packages/core/src/recommendations/act.ts`                  | Migrate to `PlatformIngress.submit({ intent: "operator.respond_recommendation" })` when the executor lands (v2). Same migration as approval-response. |

---

## Convergence Phases

The following phases complete the operating spine. Order matters.

### Phase 1 — Doctrine (this document)

Canonical vocabulary. Invariants. Legacy markers.

### Phase 2 — Control plane convergence

Migrate to platform layer: approval response, approved execution, undo, simulate, emergency halt. PlatformIngress becomes the true lifecycle authority.

### Phase 3 — Persistence convergence

WorkTrace becomes the sole operational record. Remove envelope-bridge. Remove synthetic ActionEnvelope creation in actions.ts.

### Phase 4 — Substrate convergence

Resolve all `TODO(ingress-convergence)` markers. DeploymentResolver used everywhere. No manual context assembly.

### Phase 5 — Legacy deletion

Remove: cartridge-sdk, data-flow, enrichment, dead code verified unused.

### Phase 6 — Surface convergence

Unify chat single-tenant and multi-tenant paths. All channels flow through ChannelGateway + PlatformIngress.

### Phase 7 — Structural extraction

Extract skill-runtime from core. Split other domain-specific subsystems where boundaries are real and proven.

---

## What This Doctrine Does Not Cover

- Product decisions (marketplace shape, pricing, agent families)
- Skill authoring conventions
- Dashboard UX patterns
- Deployment / infrastructure / cloud topology
- External API contract versioning

These belong in their own documents.
