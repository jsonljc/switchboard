# Switchboard — Architectural Doctrine

> Hard rules, not aspirational guidance. Every change must comply.
> Last updated: 2026-04-18.

Switchboard is a **governed operating system for revenue actions**, not a collection of smart agents. Agents are one execution layer. The operating spine — ingress, governance, lifecycle, persistence, recovery — is the architecture.

---

## Canonical Vocabulary

These are the only architectural nouns. If a concept doesn't map to one of these, it does not belong in `packages/core` or `packages/schemas`.

| Term            | Definition                                                                                                                                                                                              | Canonical type                          | Status              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------- |
| **Deployment**  | Runtime substrate. An organization's instance of a skill with trust level, persona, and policy overrides. All work executes within a deployment context.                                                | `DeploymentContext`                     | **Foundational**    |
| **Intent**      | A requested business action. The routing key from work request to execution mode. Registered in the IntentRegistry with mutation class, budget class, approval policy, and executor binding.            | `IntentRegistration`                    | **Foundational**    |
| **Governance**  | Permission, policy, and risk gate. Evaluates a WorkUnit against identity, policies, risk scoring, and guardrails. Produces a GovernanceDecision: execute, require_approval, or deny.                    | `GovernanceGate` / `GovernanceDecision` | **Foundational**    |
| **Mode**        | Execution path shape. How an intent is fulfilled. Currently: `skill` (LLM tool-calling), `pipeline` (async job), `cartridge` (legacy deterministic).                                                    | `ExecutionMode` / `ExecutionModeName`   | **Foundational**    |
| **Tool**        | Auditable side-effect surface. A deterministic, idempotent function exposed to skill execution. Tools are product surfaces, not utilities.                                                              | `ToolDeclaration`                       | **Foundational**    |
| **WorkUnit**    | The normalized representation of a single governed action. Created at ingress, immutable after normalization.                                                                                           | `WorkUnit`                              | **Foundational**    |
| **WorkTrace**   | The canonical persistence record for every governed action. One WorkTrace per WorkUnit. The sole operational truth.                                                                                     | `WorkTrace`                             | **Foundational**    |
| **Workflow**    | Durable multi-step execution with safety envelopes, approval checkpoints, and recovery semantics.                                                                                                       | `WorkflowExecution`                     | **Active**          |
| **Operator**    | Human escalation and control surface. Business owners who manage their AI workforce through chat.                                                                                                       | `OperatorCommand`                       | **Active**          |
| **Skill**       | Product-facing capability definition. A markdown file with YAML frontmatter defining LLM prompts + tool bindings. Skills are what the platform sells. They are not the architectural center of gravity. | Skill markdown files                    | **Active**          |
| **Agent**       | Product and UX metaphor only. The user-facing name for a deployed skill. Not an architectural concept. Do not create `Agent*` types in core for runtime purposes.                                       | Dashboard/marketplace only              | **Product surface** |
| **Cartridge**   | Legacy bridge only. No cartridge implementations exist. CartridgeMode is retained as one execution mode for backward compatibility. Do not build new cartridges.                                        | `CartridgeMode`                         | **Legacy bridge**   |
| **Marketplace** | Product discovery surface. How operators find and deploy skills. Not part of the governed runtime.                                                                                                      | Dashboard + API routes                  | **Product surface** |

### Retired Terms

These terms should not appear in new code:

- **Listing** — use "skill" or "deployment" depending on context
- **Agent roster** — use deployment + principal
- **Agent theater** — no replacement; this metaphor is retired
- **Data flow** — cross-cartridge orchestration; no longer applicable
- **Enrichment** — cross-cartridge context sharing; no longer applicable

---

## Non-Negotiable Invariants

### 1. One control plane

Every governed action enters through `PlatformIngress.submit()`. No route, adapter, or gateway may call orchestrator methods directly for new work submission. The ingress-boundary test (`apps/api/src/__tests__/ingress-boundary.test.ts`) enforces this.

**Migration target:** Approval response, post-approval execution, undo, simulate, and emergency halt must also flow through the platform layer. Until they do, the old orchestrator remains as a lifecycle bridge — not as an alternative control plane.

### 2. One lifecycle spine

Every action lifecycle — submission, governance, execution, approval, completion, undo, recovery — is managed by the platform layer. No subsystem may independently manage action state transitions.

**Current gap:** Approval lifecycle is still managed by `ApprovalManager` in the old orchestrator. This must be migrated.

### 3. One persistence truth

`WorkTrace` is the canonical durable record for every governed action. One WorkTrace per WorkUnit. No synthetic envelopes, no parallel persistence models.

**Current gap:** `actions.ts` creates synthetic `ActionEnvelope` records via `envelope-bridge.ts` for backward compatibility. This bridge must be removed once approval lifecycle migrates to the platform layer.

### 4. Governance runs once

Every action is evaluated by `GovernanceGate.evaluate()` exactly once. Execution modes must not re-evaluate governance. When CartridgeMode calls `orchestrator.executePreApproved()`, governance must not run again inside the orchestrator.

### 5. Deployment context is resolved once, at ingress

`DeploymentContext` is resolved by `DeploymentResolver` at the ingress boundary. Routes must not manually construct deployment context from request parameters. The `TODO(ingress-convergence)` markers in `execute.ts`, `actions.ts`, and `gateway-bridge.ts` track this migration.

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

**Current gap:** Single-tenant `ChatRuntime` in `apps/chat` uses the old orchestrator path. Must be migrated to PlatformIngress via the same adapter used by multi-tenant `ChannelGateway`.

---

## Legacy Bridge Registry

These components exist only to support the migration from the old runtime to the unified platform layer. Each has an exit condition.

| Component                       | Location                                                    | Exit Condition                                                                                      |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `LifecycleOrchestrator`         | `core/src/orchestrator/lifecycle.ts`                        | Remove when approval response, undo, simulate, and emergency halt are handled by the platform layer |
| `ExecutionService`              | `core/src/execution-service.ts`                             | Remove when MCP server uses PlatformIngress directly                                                |
| `CartridgeMode`                 | `core/src/platform/modes/cartridge-mode.ts`                 | Phase 4: no longer creates envelopes. Remove when no IntentRegistration uses `mode: "cartridge"`    |
| ~~`envelope-bridge.ts`~~        | ~~`apps/api/src/routes/`~~                                  | **Deleted in Phase 3**                                                                              |
| `ProposePipeline`               | `core/src/orchestrator/propose-pipeline.ts`                 | Remove with LifecycleOrchestrator                                                                   |
| `ApprovalManager`               | `core/src/orchestrator/approval-manager.ts`                 | Remove when platform layer owns approval lifecycle                                                  |
| `ExecutionManager`              | `core/src/orchestrator/execution-manager.ts`                | Remove with LifecycleOrchestrator                                                                   |
| `RuntimeOrchestrator` interface | `core/src/orchestrator/runtime-orchestrator.ts`             | Remove with LifecycleOrchestrator                                                                   |
| ~~`ApiOrchestratorAdapter`~~    | ~~`apps/chat/src/api-orchestrator-adapter.ts`~~             | **Dead code after Phase 6** — single-tenant uses ChannelGateway                                     |
| ~~`ChatRuntime`~~               | ~~`apps/chat/src/runtime.ts`~~                              | **Dead code after Phase 6** — all channels use ChannelGateway + PlatformIngress                     |
| `cartridge-sdk` package         | `packages/cartridge-sdk/`                                   | Remove when CartridgeMode is removed                                                                |
| `data-flow/`                    | `core/src/data-flow/`                                       | Delete now — no cartridges to flow between                                                          |
| `enrichment/`                   | `core/src/enrichment/`                                      | Delete now — no cartridges to enrich                                                                |
| `ApprovalRecord.envelopeId`     | `db/prisma/schema.prisma`, `core/src/storage/interfaces.ts` | Semantic debt: field stores workUnitId but is named envelopeId. Rename in a dedicated migration PR. |

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
