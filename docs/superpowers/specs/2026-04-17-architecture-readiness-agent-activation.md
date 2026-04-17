# Architecture Readiness & Agent Activation

**Date**: 2026-04-17
**Status**: Approved
**Branch**: `feat/alex-wedge-sprint`

## Context

Full architecture audit confirmed:

- Infrastructure is mature (schemas, governance, trust, marketplace, skill runtime, channel gateway)
- Alex is the only agent with a complete end-to-end execution path
- 6 other marketplace listings are seeded but not executable
- `packages/agents/` is a disconnected parallel runtime (30+ files, 26 tests, zero marketplace integration)
- Legacy references (empty cartridges dir, dead exports, null stubs) create noise

The next phase is not more platform invention — it is turning partial agents into real execution paths and deleting parallel dead systems.

---

## Phase 1: PlatformIngress Migration

**Goal**: All new proposal ingress flows through `PlatformIngress.submit()`. No route file calls `orchestrator.resolveAndPropose()` directly.

### What changes

**`apps/api/src/routes/actions.ts`**:

- `POST /api/actions/propose` (line 52): Replace `app.orchestrator.resolveAndPropose()` with `app.platformIngress.submit()`. Build a `SubmitWorkRequest` from the existing body fields, matching the pattern in `execute.ts` lines 69-77. Require `Idempotency-Key` header — this is a **new requirement** for this endpoint. Existing callers that do not send this header will receive a 400 error. This is intentional: replay protection is a prerequisite for ingress-level governance, and callers must adopt it. If a grace period is needed, accept a generated fallback key with a deprecation warning header for one release cycle, then enforce. Map the ingress response back to the existing 201 response shape (envelope, decisionTrace, approvalRequest, denied, explanation) for backward compatibility.

- `POST /api/actions/batch` (line 237): Replace the loop calling `app.orchestrator.resolveAndPropose()` with N independent `app.platformIngress.submit()` calls. Each proposal becomes its own `SubmitWorkRequest` with its own `Idempotency-Key` (derived from a batch-level key + index). No parent/child relationship — N independent WorkUnits. Optional: accept a `batchCorrelationId` field for later tracing, but do not build batch-level orchestration. Governance, tracing, and retries operate per-WorkUnit.

### What does NOT change

- `GET /api/actions/:id` — reads existing envelopes
- `POST /api/actions/:id/execute` — executes approved envelopes via `orchestrator.executeApproved()`
- `POST /api/actions/:id/undo` — creates undo proposals via `orchestrator.requestUndo()`
- `POST /api/simulate` — read-only simulation via `orchestrator.simulate()`
- `POST /api/approvals/:id/respond` — responds to existing approvals via `orchestrator.respondToApproval()`
- `apps/chat/src/message-pipeline.ts` line 600 — legacy ChatRuntime path. Flagged but not migrated; dies when legacy runtime is retired.

### Boundary enforcement test

Add a test asserting that no route file in `apps/api/src/routes/` imports or calls `resolveAndPropose`, except via explicit exemption list (currently: none). The existing `execute-platform-parity.test.ts:290` partially validates this — extend it to cover all route files.

### Backward compatibility

The `POST /api/actions/propose` endpoint keeps its existing response shape. Callers see no change. The internal path changes from `orchestrator.resolveAndPropose()` → `platformIngress.submit()`.

---

## Phase 2: Wire Dead Agents

### Phase 2A: Sales Pipeline Agents

**Problem**: Speed-to-Lead, Sales Closer, and Nurture Specialist have listings and demo deployments, but deployments lack `skillSlug`. The `salesPipelineBuilder` is already registered in `gateway-bridge.ts` builderMap. The `sales-pipeline.md` skill exists. The builder differentiates by `metadata.roleFocus` (`leads`, `growth`, `care`).

**Fix**: In `seed-marketplace.ts`, add `skillSlug: "sales-pipeline"` to each of the 3 demo deployments (lines 508-532). Zero code changes beyond the seed.

**Verification**: After seeding, each deployment must be reachable through the same ChannelGateway path as Alex. Specifically:

- `PrismaDeploymentLookup.findByChannelToken()` resolves the deployment
- `ChannelGateway.resolveHandler()` detects `skillSlug: "sales-pipeline"` and creates a `SkillHandler` (not `DefaultChatHandler`)
- `SkillHandler` invokes `salesPipelineBuilder`, which reads `roleFocus` from the listing metadata to customize system prompt and parameters per role
- Add an integration test (similar to `alex-e2e.test.ts`) that sends a message through the gateway for a sales pipeline deployment and verifies skill execution, not generic LLM fallback.

### Phase 2B: Website Profiler

**Problem**: `skills/website-profiler.md` and `websiteProfilerBuilder` exist but the builder is not in the `gateway-bridge.ts` builderMap, so it's unreachable.

**Changes**:

1. **builderMap** (`gateway-bridge.ts` line 130): Add `["website-profiler", websiteProfilerBuilder]` and import `websiteProfilerBuilder` from `@switchboard/core/skill-runtime`.

2. **Tool map** (`gateway-bridge.ts` `createExecutor()`): Add the web scanner tool. The tool must have explicit safety constraints:
   - Rate limit: max 3 external fetches per execution
   - Block internal targets: reject URLs matching `localhost`, `127.0.0.1`, `10.*`, `192.168.*`, `172.16-31.*`, `*.internal`, `*.local`
   - Timeout: 10s per fetch, 30s total per execution
   - Response size cap: 1MB per fetch (truncate, don't fail)
   - These constraints are declared in the tool definition, enforced by the tool implementation.

3. **Marketplace seed** (`seed-marketplace.ts`): Add a `website-profiler` listing and demo deployment with `skillSlug: "website-profiler"`.

### Phase 2C: Ad Optimizer (Chat-Triggered)

**Problem**: Skill .md, builder, and tools (`ads-analytics`, `ads-data`) exist. Has a `BatchSkillHandler` path but no trigger invokes it.

**Design**: Chat-triggered first surface. No scheduler, Redis, or service wiring.

**Changes**:

1. **builderMap** (`gateway-bridge.ts`): Add `["ad-optimizer", adOptimizerBuilder]`.

2. **Tool map** (`gateway-bridge.ts` `createExecutor()`): Add `ads-analytics` and `ads-data` tools. These are read-only (query ad account data) so they auto-approve under the governance policy matrix.

3. **Marketplace seed**: The listing already exists. Add a demo deployment with `skillSlug: "ad-optimizer"` and appropriate `inputConfig` (monthly budget, target CPA, audit frequency).

4. **Activation path**: User sends a message like "audit my campaigns" → ChannelGateway resolves deployment → `SkillHandler` → `adOptimizerBuilder` → `SkillExecutorImpl` runs the `ad-optimizer.md` skill with ad tools → returns structured analysis.

Scheduled/cron execution is a future second delivery mode, not part of this phase.

---

## Phase 3: Decommission Parallel Runtime

This is a controlled decommissioning, not a casual cleanup. Three staged sub-phases.

### Current state of `packages/agents/`

21 source files, 26 test files. A complete event-driven agent runtime with:

- Event loop, router, registry, handler registry (the "second universe" — superseded by ChannelGateway)
- Policy bridge, core policy adapter (superseded by `skill-runtime/governance.ts`)
- Action executor (superseded by `SkillExecutorImpl`)
- Delivery store, retry executor, dead letter alerter
- Scheduled runner, concurrency (contact-level mutex)
- Knowledge retrieval, chunker, ingestion pipeline
- LLM adapters (Claude, Voyage embedding)
- Memory compounding service, context builder

### What `gateway-bridge.ts` imports from `@switchboard/agents`

```typescript
import {
  ConversationCompoundingService,
  ContextBuilder,
  KnowledgeRetriever,
  VoyageEmbeddingAdapter,
} from "@switchboard/agents";
```

These 4 are the only live consumers. They are shared utilities, not event loop pieces.

### Phase 3A: Extract & Redirect

**Extract to `packages/core`** (these are core infrastructure, not agent-specific):

- `knowledge/retrieval.ts` → `packages/core/src/knowledge/retrieval.ts`
- `knowledge/chunker.ts` → `packages/core/src/knowledge/chunker.ts`
- `knowledge/ingestion-pipeline.ts` → `packages/core/src/knowledge/ingestion-pipeline.ts`
- `memory/compounding-service.ts` → `packages/core/src/memory/compounding-service.ts`
- `memory/context-builder.ts` → `packages/core/src/memory/context-builder.ts`
- `memory/extraction-prompts.ts` → `packages/core/src/memory/extraction-prompts.ts`
- `llm/voyage-embedding-adapter.ts` → `packages/core/src/llm/voyage-embedding-adapter.ts`

**Extract utilities worth keeping** (things ChannelGateway doesn't have but should):

- `concurrency.ts` (contact-level mutex) → `packages/core/src/channel-gateway/concurrency.ts`
- `dead-letter-alerter.ts` → `packages/core/src/notifications/dead-letter-alerter.ts`
- `scheduled-runner.ts` → `packages/core/src/scheduler/scheduled-runner.ts`

**Redirect imports**: Update `gateway-bridge.ts` and any other consumers to import from `@switchboard/core` instead of `@switchboard/agents`. Add re-exports from `@switchboard/core` barrel or subpath exports.

**Add re-export shim**: Temporarily keep `packages/agents/src/index.ts` re-exporting from `@switchboard/core` so any missed consumers don't break. This shim is removed in Phase 3C.

### Phase 3B: Prove No Live Consumers

- Run full test suite (`pnpm test`)
- Run `pnpm typecheck`
- Grep for any remaining `@switchboard/agents` imports outside of `packages/agents/` itself
- Grep for any remaining imports of event loop, router, registry, handler-registry, policy-bridge, action-executor, delivery-store, retry-executor from any consumer
- Verify the re-export shim has zero consumers (all imports redirected to `@switchboard/core`)

Gate: Phase 3C does not start until this passes clean.

### Phase 3C: Delete

- Delete all event loop / runtime files from `packages/agents/src/`: `event-loop.ts`, `router.ts`, `registry.ts`, `handler-registry.ts`, `policy-bridge.ts`, `core-policy-adapter.ts`, `action-executor.ts`, `delivery-store.ts`, `retry-executor.ts`, `escalation.ts`, `route-plan.ts`, `validate-payload.ts`, `events.ts`, `ports.ts`
- Delete their corresponding test files
- Delete the re-export shim from `packages/agents/src/index.ts`
- Delete `packages/agents/` entirely **only if** every remaining file has been moved to `packages/core`. If any meaningful file remains that was not part of the extraction plan, keep the package and rename it to reflect its actual purpose. Do not delete a package with remaining source files.
- Remove `@switchboard/agents` from workspace dependencies where it was only used for event loop pieces
- Update `turbo.json`, CI config, and arch-check as needed

---

## Phase 4: Clean Dead References

Mechanical cleanup. No architectural decisions.

| Item                                                 | Action                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cartridges/` empty dir                              | Delete directory. Remove from `.dependency-cruiser.cjs` rules, `.eslintrc.json` cross-cartridge overrides, `Dockerfile` COPY stages, `scripts/arch-check.ts` cartridge checks.                              |
| Dead exports in `packages/core/package.json`         | Remove `./skin`, `./smb`, `./profile` export entries (lines 69, 81, 85). Directories do not exist.                                                                                                          |
| `app.operatorDeps = null` in `apps/api/src/app.ts`   | Remove the null decoration (line 295). Remove operator route self-disabling logic. Either delete the operator routes entirely or gate them behind an explicit feature flag, not a null check.               |
| `_crmProvider: null` in `apps/chat/src/bootstrap.ts` | Remove the unused variable (line 101).                                                                                                                                                                      |
| UI-only Agent Roster (7 roles)                       | Keep. Document in CLAUDE.md that these are dashboard display only, not executable agents.                                                                                                                   |
| `TrustScoreAdapter` not invoked in live path         | Keep. Document the gap: skill runtime uses `GOVERNANCE_POLICY` matrix directly; adapter is for future orchestrator-path unification. Do not delete — the integration design is correct, just not wired yet. |

---

## Sequencing

```
Phase 1  (PlatformIngress)         → standalone, first
Phase 2A (Sales Pipeline seeds)    → immediately after P1, or parallel
Phase 2B (Website Profiler wiring) → after 2A
Phase 2C (Ad Optimizer chat)       → after 2B
Phase 4  (Dead references)         → anytime, parallel with P1-P2
Phase 3A (Extract + redirect)      → after P2 agents are working
Phase 3B (Prove no consumers)      → after 3A
Phase 3C (Delete)                  → after 3B passes clean
```

Phase 3 happens last because:

- It is the highest-risk consolidation step
- It should happen after activated agents prove the ChannelGateway path works for more than just Alex
- Import ownership must be clear before deletion

---

## Success Criteria

- [ ] No route in `apps/api/src/routes/` calls `orchestrator.resolveAndPropose()` — boundary test enforces
- [ ] 4 agents have complete end-to-end execution paths (Alex + Sales Pipeline + Website Profiler + Ad Optimizer)
- [ ] `packages/agents/` event loop code is deleted; shared utilities live in `packages/core`
- [ ] Zero references to empty `cartridges/` dir in tooling configs
- [ ] Zero dead exports in `packages/core/package.json`
- [ ] Zero null stubs for operator deps or CRM provider
- [ ] Zero imports from `@switchboard/agents` outside `packages/agents/` itself — verified by grep before Phase 3C delete
- [ ] All tests pass, typecheck clean, CI green
