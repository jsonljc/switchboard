# Ingress Convergence Design

**Date:** 2026-04-17
**Status:** Approved
**Scope:** Converge chat gateway and API/PlatformIngress into one shared execution path with deployment as the single source of truth.

---

## Problem

Two execution paths exist for agent work:

1. **Chat gateway** (Telegram/WhatsApp/Slack) — resolves deployment via `PrismaDeploymentLookup`, loads skill, runs builder, executes directly. Never touches PlatformIngress.
2. **PlatformIngress** (API/scheduler) — caller supplies intent string, `IntentRegistry` dispatches, no deployment lookup. Never checks if an org actually deployed the agent.

This means:

- An agent can be "deployed" in the dashboard but unreachable from the API.
- An agent can execute via API without an active deployment.
- Governance posture differs by entry point (chat uses deployment trust level, API uses intent registration defaults).
- There is no single answer to "is this agent live?"

## Strategic Context

This is not infrastructure cleanup. The wedge agents (Alex, sales-pipeline, website-profiler, ad-optimizer) must be genuinely executable through a unified production path before they can be called "live." The ingress convergence is what makes the wedge trustworthy.

The SMB research doc identifies "reliable orchestrated runtime" as a must-own capability. This design delivers the unified runtime path that capability requires.

## Target Architecture

```
Channel / API / Scheduler
  -> DeploymentResolver        (what deployment is active, what config)
  -> SubmitWorkRequest          (normalized, single-turn, deployment-aware)
  -> PlatformIngress            (governance, mode dispatch, tracing)
  -> SkillMode + builder        (parameter assembly + skill prep)
  -> SkillExecutor              (LLM loop, tools)
```

Four clean responsibilities:

- **DeploymentResolver** decides what is active and allowed
- **PlatformIngress** decides whether normalized work may run
- **SkillMode + builder** decides what execution needs
- **SkillExecutor** does the work

PlatformIngress stays stateless and single-turn. Conversation state is managed above it by the chat gateway layer. Each message becomes a single normalized work submission with conversation context passed in, not owned by the platform core.

---

## Section 1: DeploymentResolver

**Location:** `packages/core/src/platform/deployment-resolver.ts`

### Interface

```typescript
interface DeploymentResolverResult {
  deploymentId: string;
  listingId: string;
  organizationId: string;
  skillSlug: string; // v1: all deployments resolve to skills
  trustLevel: TrustLevel; // supervised | guided | autonomous
  trustScore: number;
  persona?: AgentPersona; // optional — not all deployments have one
  deploymentConfig: Record<string, unknown>;
  policyOverrides?: DeploymentPolicyOverrides;
}

interface DeploymentResolver {
  resolveByChannelToken(channel: string, token: string): Promise<DeploymentResolverResult>;
  resolveByDeploymentId(deploymentId: string): Promise<DeploymentResolverResult>;
  resolveByOrgAndSlug(organizationId: string, skillSlug: string): Promise<DeploymentResolverResult>;
}
```

### Resolution paths

Three methods because three ingress surfaces identify deployments differently:

- `resolveByChannelToken` — chat (Telegram bot token, WhatsApp number)
- `resolveByDeploymentId` — API/scheduler (explicit deployment reference, strongest identity)
- `resolveByOrgAndSlug` — API convenience (org + skill name, loosest identity)

`resolveByOrgAndSlug` is convenience only, not primary truth. It is not used in the convergence proof (Section 5 uses `resolveByDeploymentId` for API parity). It exists for developer ergonomics in API calls where the caller knows the org and skill but not the deployment ID. If the model ever allows multiple active deployments for the same slug, this method will need stronger disambiguation semantics. For v1, uniqueness is assumed.

### Extracted from

`PrismaDeploymentLookup` in `apps/chat`. Same queries, same caching, same trust computation — moved to `packages/core` so all surfaces share it.

### Activation gate

All three methods throw `DeploymentInactiveError` if the deployment is inactive or the listing is delisted. This is the single "is this agent turned on?" check. No other layer duplicates it.

### What it does NOT do

Parameter building, conversation state, channel message parsing, governance decisions.

### Assumptions

- v1 assumes deployment-backed agents resolve to skills. If non-skill runtime targets are introduced later, `skillSlug` may widen to a more general runtime target field.
- `deploymentConfig` contains org-specific execution inputs from the deployment record. It is consumed downstream by builders/execution, not by the resolver itself.

---

## Section 2: SubmitWorkRequest Extension

**Location:** `packages/core/src/platform/work-unit.ts`

### Current state

`SubmitWorkRequest` has `organizationId`, `actor`, `intent`, `parameters`, `trigger`, and optional fields. No deployment awareness.

### Extended contract

```typescript
interface SubmitWorkRequest {
  // execution identity
  organizationId: string;
  actor: Actor;
  intent: string; // semantic execution key
  parameters: Record<string, unknown>;
  trigger: Trigger;

  // optional execution controls
  suggestedMode?: string;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  priority?: "low" | "normal" | "high" | "critical";

  // deployment context — from DeploymentResolver
  deployment: {
    deploymentId: string;
    skillSlug: string; // v1: deployed runtime target
    trustLevel: TrustLevel;
    trustScore: number;
    persona?: AgentPersona;
    policyOverrides?: DeploymentPolicyOverrides;
  };
}
```

### Design decisions

1. **`deployment` is a required nested object.** Every work submission comes from a resolved deployment. Grouping deployment fields prevents sprawl across the contract.

2. **`intent` remains the semantic execution key** for governance classification, tracing, and execution semantics. `skillSlug` identifies the deployed runtime target. These are complementary, not competing.

3. **`deploymentId` is required.** No anonymous intent-string submissions that bypass deployment state.

4. **Trust fields flow through, not re-resolved.** PlatformIngress consumes deployment context produced by DeploymentResolver or another trusted internal resolver. It does not re-query deployment state. External callers should never mint their own trust fields.

5. **Conversation history, session state, and channel-specific metadata do NOT go in SubmitWorkRequest.** Those are packed into `parameters` by the calling layer if needed. PlatformIngress doesn't know or care about their shape.

6. **`suggestedMode` becomes redundant for skill deployments** since `skillSlug` implies skill mode, but keeping it avoids a breaking change and supports future non-skill modes. It can be deprecated later.

---

## Section 3: SkillMode Builder Hook

**Location:** `packages/core/src/platform/modes/skill-mode.ts`

### Current state

SkillMode receives a `WorkUnit`, resolves the skill slug, loads the skill `.md`, and calls `SkillExecutor.execute()` with `workUnit.parameters` passed through verbatim. No parameter-building step. The builder map lives only in chat gateway's `gateway-bridge.ts`.

### Design

SkillMode gains a `BuilderRegistry` — a map from skill slug to `ParameterBuilder`.

```typescript
interface ParameterBuilder {
  build(context: BuilderContext): Promise<Record<string, unknown>>;
}

interface BuilderContext {
  workUnit: WorkUnit;
  deployment: DeploymentContext; // from SubmitWorkRequest.deployment
  conversation?: {
    // optional — present for chat, absent for API
    messages: Message[];
    sessionId?: string;
  };
  stores: BuilderStores; // CRM, opportunities, contacts — typed, narrow
}

interface BuilderRegistry {
  get(skillSlug: string): ParameterBuilder | undefined;
  register(skillSlug: string, builder: ParameterBuilder): void;
}
```

### Execution flow inside SkillMode

```
SkillMode.execute(workUnit)
  1. read skillSlug from workUnit.deployment.skillSlug
  2. loadSkill(slug, skillsDir)                — same as today
  3. builderRegistry.get(slug)                 — NEW
  4. if builder exists:
       params = builder.build(context)         — domain-specific enrichment
     else:
       params = workUnit.parameters            — passthrough
  5. contextResolver.resolve(skill)            — knowledge entries, deployment memory
  6. executor.execute(skill, params, ...)       — same as today
```

### Design decisions

1. **Builder is optional.** Not every skill needs one. Simple skills or API-triggered skills with pre-formed parameters use passthrough. The registry returns `undefined` and SkillMode falls through.

2. **Deployment context reaches builders.** Builders can use `deployment.deploymentId` for deployment-scoped memory, `deployment.persona` for tone, `deployment.trustLevel` for behavior adjustments. This is how deployment awareness reaches execution without polluting PlatformIngress.

3. **Conversation context is optional and typed.** For chat-originated work, the calling layer packs conversation history. For API-originated work, this is absent. Builders may consume normalized conversation context if present but are not responsible for decoding arbitrary transport payloads.

4. **Stores are injected and typed narrowly.** Builders need domain stores (CRM, contacts, opportunities). These are injected into SkillMode at app startup. Keep `BuilderStores` explicitly typed and builder-relevant only — not a bag of all services.

5. **`BuilderRegistry` replaces the hardcoded map.** Same concept as today's `builderMap` with a `register()` method so apps can wire builders at startup. The registry abstraction lives in `packages/core`; registrations happen at app startup in `apps/chat` and `apps/api`. Core does not discover builders dynamically — no plugin system, no auto-registration.

### Scope of builders

Builders are execution-preparation components. They may enrich or reshape parameters using domain store lookups and deployment context. They do not perform governance decisions or own skill execution.

### What moves

- Builder implementations (sales-pipeline, website-profiler, ad-optimizer, alex) stay in `packages/core/src/skill-runtime/builders/`.
- Builder registration moves from `apps/chat/src/gateway/gateway-bridge.ts` to app-level startup in both `apps/chat` and `apps/api`.
- The `builderMap` in gateway-bridge is deleted after cutover.

---

## Section 4: Chat Gateway Rewiring

**Location:** `apps/chat/src/gateway/gateway-bridge.ts` and `packages/core/src/channel-gateway/channel-gateway.ts`

### Current state

ChannelGateway does everything itself — deployment lookup, handler resolution (skill vs legacy), skill loading, builder dispatch, executor invocation. It never touches PlatformIngress.

### Target state

ChannelGateway becomes a thin channel adapter. It handles channel-specific concerns and delegates execution through the converged path.

### Rewired flow

```
Incoming channel message
  1. ChannelGateway.handleIncoming()
       - parse channel message (same as today)
       - manage conversation session (same as today)

  2. DeploymentResolver.resolveByChannelToken(channel, token)
       - replaces inline PrismaDeploymentLookup call
       - returns DeploymentResolverResult
       - throws DeploymentInactiveError if not active

  3. Build SubmitWorkRequest
       - intent: derived from resolved skill slug via canonical chat
         intent convention ({skillSlug}.respond for v1)
       - parameters: raw user message + optional normalized conversation context
       - deployment: from DeploymentResolverResult
       - trigger: canonical type (e.g., "channel")
       - actor: resolved from channel identity
       - conversation context packed into parameters if present

  4. PlatformIngress.submit(request)
       - governance gate (uses trustLevel from deployment context)
       - mode dispatch -> SkillMode
       - SkillMode runs builder, loads skill, executes
       - returns WorkResult

  5. ChannelGateway formats response for channel
       - converts WorkResult back to channel-specific reply
       - sends via channel adapter
```

### Design decisions

1. **No chat-specific wrapper.** The chat gateway calls `DeploymentResolver` then `PlatformIngress.submit()` directly. No `ChatIngress` or `ChannelPlatformBridge`. Adding a chat-specific intermediary would recreate the divergence.

2. **Conversation context is the chat gateway's job to shape.** Before calling `PlatformIngress.submit()`, the chat gateway packs conversation history into parameters or a typed conversation field. PlatformIngress passes it through. This is the seam: chat owns conversation, platform owns execution.

3. **Intent convention for v1.** For v1, chat-originated skill work uses the canonical intent `{skillSlug}.respond`.

4. **Trigger stays canonical.** Channel-specific metadata (channel name, session ID) goes into source context or parameters, not into the trigger type itself. This prevents the trigger model from becoming transport-specific.

5. **ChannelGateway does not decide which execution mode to use.** It resolves deployment and submits normalized work. PlatformIngress remains the single owner of mode dispatch.

6. **Envelope bridge stays temporarily.** The envelope bridge continues to create backward-compatible `ActionEnvelope` records. It can be removed when the legacy envelope model is fully retired (out of this scope).

### What stays in ChannelGateway

- Channel message parsing (Telegram markup, WhatsApp media, Slack blocks)
- Conversation session management (history, session continuity)
- Response formatting per channel
- Channel-specific error handling (rate limits, webhook verification)

### What moves out

- Deployment lookup -> DeploymentResolver (core)
- Skill loading -> SkillMode
- Builder dispatch -> SkillMode via BuilderRegistry
- Handler resolution (skill vs legacy fork) -> PlatformIngress mode dispatch
- Direct SkillExecutor invocation -> SkillMode

---

## Section 5: Agent Proof — End-to-End Verification

### Purpose

After convergence (Sections 1-4), prove that each agent actually works on the unified path. This is the "is it real?" test.

### Agents to prove

alex, sales-pipeline, website-profiler, ad-optimizer.

### What "proven" means

Per agent, all of these pass:

1. **Deployment exists** — an `AgentDeployment` record with `skillSlug` set, linked to an active `AgentListing`, with at least one `DeploymentConnection` (for chat) or accessible via deployment ID (for API).

2. **DeploymentResolver resolves it** — the appropriate resolve method returns a complete `DeploymentResolverResult` with correct skill slug, trust level, persona, and config. Calling it for an inactive deployment throws `DeploymentInactiveError`.

3. **PlatformIngress accepts and dispatches** — submitting a `SubmitWorkRequest` with the resolved deployment context passes governance, dispatches to SkillMode, and produces a `WorkResult`. The governance gate uses deployment trust level, not a hardcoded default.

4. **SkillMode runs the right builder** — `BuilderRegistry` resolves the correct `ParameterBuilder` for the skill slug. The builder queries domain stores and produces enriched parameters.

5. **SkillExecutor produces a correct response** — the skill's markdown prompt is interpolated with builder parameters, context is resolved, tools are available, and the LLM loop produces a coherent response.

6. **Tracing is complete** — a `WorkTrace` record exists with `deploymentId` and can be retrieved through the persistence layer in tests.

7. **No fallback masks missing wiring** — no `DefaultChatHandler` fallback, no silent parameter passthrough hiding a missing builder, no hardcoded intent bypassing deployment lookup.

### Test matrix

**Tier 1 — primary converged path (4 tests):**

| Agent            | Path | Resolution method     |
| ---------------- | ---- | --------------------- |
| alex             | chat | resolveByChannelToken |
| sales-pipeline   | chat | resolveByChannelToken |
| website-profiler | chat | resolveByChannelToken |
| ad-optimizer     | chat | resolveByChannelToken |

**Tier 2 — secondary ingress parity (4 tests):**

| Agent            | Path | Resolution method     |
| ---------------- | ---- | --------------------- |
| alex             | API  | resolveByDeploymentId |
| sales-pipeline   | API  | resolveByDeploymentId |
| website-profiler | API  | resolveByDeploymentId |
| ad-optimizer     | API  | resolveByDeploymentId |

Tier 1 first. Tier 2 after Tier 1 passes. This staging makes diagnosis cleaner if failures occur.

### Cross-surface truth assertion

For the same deployment, chat-path resolution and API-path resolution must produce the same `deploymentId`, `skillSlug`, `trustLevel`, and activation result. This is an explicit test, not just an implicit consequence of shared code.

### Test approach

Integration tests. Each test:

- Seeds a deployment + listing + connection
- Sends a request through the full path (DeploymentResolver -> PlatformIngress -> SkillMode -> executor)
- Asserts on the complete chain: deployment resolved, governance passed, builder ran, skill executed, trace written
- Uses mock LLM (consistent with existing test patterns) but real stores and real resolution logic

### What this does NOT test

- LLM response quality (eval harness territory)
- Channel adapter parsing (unit-tested separately)
- Dashboard/marketplace deployment UX (later A work)
- Load or performance

### Success criterion

All 8 integration tests pass, and no agent relies on any path that bypasses DeploymentResolver or PlatformIngress.

---

## Section 6: Cleanup — Deletion Manifest

After the convergence is proven (Section 5 passes), these are removed in the same change set. No soft deprecation.

### Deleted from `packages/core/src/channel-gateway/`

- `resolveHandler()` method — the skill-vs-legacy fork point. Replaced by PlatformIngress mode dispatch.
- `SkillHandler` class — direct skill execution from the gateway. Replaced by SkillMode. Delete only after verifying no live consumer remains outside the chat path.
- `DefaultChatHandler` class — legacy cartridge execution path. Cartridges are already empty.

### Deleted from `apps/chat/src/gateway/`

- `PrismaDeploymentLookup` — replaced by `DeploymentResolver` in core.
- `builderMap` wiring in `gateway-bridge.ts` — replaced by `BuilderRegistry` in core, registered at app startup.
- Direct `SkillExecutorImpl` instantiation in gateway-bridge — execution now goes through PlatformIngress -> SkillMode.

### What happens to IntentRegistry

IntentRegistry is not deleted and is not demoted. What changes is that deployment resolution becomes the source of truth for whether an org has an agent active and which deployed skill target applies. IntentRegistry continues to provide semantic execution identity, governance classification, and tracing labels.

### NOT deleted

- `ChannelGateway` itself — stays as the thin channel adapter.
- `SkillLoader`, `SkillExecutor`, builder implementations — reused, not replaced.
- `IntentRegistry` — still used for governance and tracing semantics.
- Envelope bridge — stays until the legacy `ActionEnvelope` model is fully retired (out of scope).
- Cartridge SDK + schemas — framework code, no active implementations, can be cleaned up separately.

### Deletion rule

If Section 5's tests pass without a component being in the execution path, that component is dead code. Delete it in the same change set as the test proof, not in a follow-up. Since this is pre-deployment, preserving old chat-path logic "just in case" is how ghost seams survive.

---

## Diff Sequence

1. **Extend SubmitWorkRequest + build DeploymentResolver in core** (co-designed, with tests)
2. **Add BuilderRegistry and builder hook to SkillMode** (with tests)
3. **Rewire chat gateway: DeploymentResolver -> PlatformIngress** (with tests)
4. **Prove agents end-to-end** (Tier 1: chat path, then Tier 2: API path, then cross-surface assertion)
5. **Delete old path** (same change set as proof)
