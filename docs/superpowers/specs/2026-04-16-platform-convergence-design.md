# Platform Convergence — Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Converge five isolated execution paths into one platform with a shared execution contract, governance gate, and tracing model above multiple execution modes.

---

## Problem

Switchboard has five separate execution paths, each with its own governance (or none), tracing (or none), and entry points:

| Path                              | Governance          | Tracing    | ModelRouter | Hooks        |
| --------------------------------- | ------------------- | ---------- | ----------- | ------------ |
| Orchestrator (cartridge actions)  | Full (PolicyEngine) | OTEL       | No          | Interceptors |
| Skill runtime (markdown skills)   | Own layer (SP6)     | Own traces | Yes         | Yes (SP6)    |
| Agent runtime (handler bootstrap) | None                | None       | No          | No           |
| Creative pipeline (Inngest jobs)  | None                | None       | No          | No           |
| Chat runtime (multi-channel)      | Via orchestrator    | Limited    | Custom      | No           |

We do not have an execution-quality problem inside each subsystem. We have a platform-coherence problem across subsystems. The parts are strong. The whole is not.

## Goal

One shared execution contract above multiple execution modes.

Every unit of work enters the same contract, is classified the same way, is governed before execution, runs in one of a few bounded modes, and is traced end-to-end in one shared model.

## Non-Goals

- Monolithic executor (modes stay distinct)
- BizAI-style config DSL
- Runtime intent creation (intents register at boot)
- Intent versioning or composition
- Rewriting stable execution engines (skill executor, policy engine, Inngest runner, GuardedCartridge)

---

## Section 1: WorkUnit — What Needs to Happen

Two types: what callers send, and what the platform normalizes.

### SubmitWorkRequest (caller input)

```typescript
interface SubmitWorkRequest {
  organizationId: string;
  actor: {
    id: string;
    type: "user" | "agent" | "system" | "service";
  };

  intent: string; // validated against intent registry
  parameters: Record<string, unknown>;

  suggestedMode?: "skill" | "pipeline" | "cartridge";

  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  trigger: "chat" | "api" | "schedule" | "internal";
  priority?: "low" | "normal" | "high" | "critical";
}
```

### WorkUnit (normalized platform object)

```typescript
interface WorkUnit {
  id: string; // cuid2, generated at ingress
  requestedAt: string; // ISO timestamp

  organizationId: string;
  actor: {
    id: string;
    type: "user" | "agent" | "system" | "service";
  };

  intent: string;
  parameters: Record<string, unknown>;

  suggestedMode?: "skill" | "pipeline" | "cartridge";
  resolvedMode?: "skill" | "pipeline" | "cartridge";

  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId: string; // guaranteed after normalization
  trigger: "chat" | "api" | "schedule" | "internal";
  priority: "low" | "normal" | "high" | "critical";
}
```

### Design principles

- `intent` describes the requested outcome ("campaign.pause"), not the executor identity ("cartridgeId")
- `suggestedMode` is a hint, not a command — the platform confirms or overrides based on registry and policy
- `parentWorkUnitId` enables sub-work (pipeline stages spawning skills) to flow through the same contract
- `traceId` is optional from callers, guaranteed after normalization

### What this kills

- `cartridgeId` as a top-level ingress concept
- Direct `SkillExecutorImpl` invocation
- Direct Inngest event dispatch for creative jobs

---

## Section 2: Intent Registry — What the Platform Knows

Every intent the platform can execute must be registered. The registry makes `intent: string` a control surface, not a label.

```typescript
interface IntentRegistration {
  intent: string; // domain.verb or domain.object.verb

  // Execution binding
  defaultMode: "skill" | "pipeline" | "cartridge";
  allowedModes: Array<"skill" | "pipeline" | "cartridge">;
  executor:
    | { mode: "skill"; skillSlug: string }
    | { mode: "pipeline"; pipelineId: string }
    | { mode: "cartridge"; actionId: string };

  // Schema
  parameterSchema: Record<string, unknown>;

  // Policy classification (registry classifies, governance engine decides)
  mutationClass: "read" | "write" | "destructive";
  budgetClass: "cheap" | "standard" | "expensive";
  approvalPolicy: "none" | "threshold" | "always";

  // Behavior
  idempotent: boolean;
  allowedTriggers: Array<"chat" | "api" | "schedule" | "internal">;
  timeoutMs: number;
  retryable: boolean;
}
```

### How registrations are sourced

- **Skill files:** Loader reads `intent` from frontmatter, auto-registers at boot
- **Cartridge manifests:** Each action in the manifest auto-registers
- **Pipeline definitions:** Each pipeline type registers its intents
- Code-driven at bootstrap, not a runtime config DSL

### Flow

```
SubmitWorkRequest arrives
      ↓
Look up intent in registry
      ↓
Validate: parameters against schema, trigger against allowedTriggers
      ↓
Resolve mode: suggestedMode if in allowedModes, else defaultMode
      ↓
Tag: mutationClass, budgetClass, approvalPolicy flow into governance
      ↓
WorkUnit is fully normalized
```

### What this kills

- Implicit mapping between chat interpreter output and cartridge IDs
- Ad-hoc skill slug resolution to handlers
- Creative pipeline's unregistered, ungoverned entry point

---

## Section 3: Governance Gate — Whether Work May Begin

The single point where all work is evaluated before execution. Nothing executes without passing through the governance gate.

### What it does

```
WorkUnit (normalized, intent resolved)
      ↓
  Governance Gate
      ↓
  1. Identity resolution — actor permissions, role overlays
  2. Policy evaluation — org rules, action restrictions, trust level
  3. Risk scoring — mutationClass + parameters + actor history → 0-100
  4. Approval routing — score + approvalPolicy from registry:
       "none" → proceed
       "threshold" → compare score against deployment threshold
       "always" → require approval
  5. Budget resolution → ExecutionConstraints
      ↓
  GovernanceDecision
```

The governance gate does not decide _how_ work executes. It decides _whether_ work may execute, under what constraints, and whether human approval is required first.

### GovernanceDecision

```typescript
type GovernanceDecision =
  | {
      outcome: "execute";
      riskScore: number;
      budgetProfile: string;
      constraints: ExecutionConstraints;
      matchedPolicies: string[];
    }
  | {
      outcome: "require_approval";
      riskScore: number;
      approvalLevel: string;
      approvers: string[];
      constraints: ExecutionConstraints;
      matchedPolicies: string[];
    }
  | {
      outcome: "deny";
      reasonCode: string;
      riskScore: number;
      matchedPolicies: string[];
    };
```

### ExecutionConstraints (resolved by the gate, consumed by execution modes)

```typescript
interface ExecutionConstraints {
  allowedModelTiers: ModelSlot[];
  maxToolCalls: number;
  maxLlmTurns: number;
  maxTotalTokens: number;
  maxRuntimeMs: number;
  maxWritesPerExecution: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}
```

### What gets reused from the existing orchestrator

- `PolicyEngine.evaluate()` — 10-step rule evaluator (production-grade, not cartridge-specific)
- `RiskScorer` — composite risk scoring (dollars-at-risk, blast radius, irreversibility, velocity)
- `ApprovalRouter` — approval level, approvers, delegation chains
- Identity resolution — `IdentitySpec` merging with role overlays

### What gets extracted/generalized

- `ProposePipeline` currently takes `cartridgeId` and calls `cartridge.enrichContext()`. The governance gate does not do context enrichment — that is an execution-mode concern that happens after governance approves.
- `ActionEnvelope` is the orchestrator's record format. The governance gate produces a `GovernanceDecision`, not an envelope.

### Ingress-time vs execution-time governance

Two complementary layers, not duplicates:

```
WorkUnit submitted
      ↓
Governance Gate (ingress-time: should this work start?)
      ↓
Execution mode runs
      ↓
  └── SP6 hooks / CartridgeInterceptors (execution-time: should this tool call proceed?)
```

Ingress governance gates the work unit. Execution-time governance gates individual actions within a running execution.

### What this kills

- Skill runtime running without ingress governance
- Creative pipeline dispatching without policy evaluation
- The idea that "governance = the orchestrator." Governance is a shared primitive.

---

## Section 4: Execution Modes and Mode Selection

After the governance gate says "execute," the platform dispatches to the selected execution mode.

### Mode selection

Deliberately simple — a lookup, not a routing algorithm. The intent registry already decided the default mode and allowed modes. Normalization already resolved the final mode.

```
GovernanceDecision.outcome === "execute"
      ↓
  ModeRegistry.dispatch(resolvedMode, workUnit, constraints, context)
```

### The three execution modes

**Skill Mode** — Multi-turn LLM execution with tool calling

- Wraps `SkillExecutorImpl` + SP6 hooks + ModelRouter
- `ExecutionConstraints` map to `SkillRuntimePolicy`
- Skill executor is unchanged — it's a good engine

**Pipeline Mode** — Multi-stage async job execution

- Wraps Inngest dispatcher + stage runner + QA loops
- Governance already passed at ingress; Inngest dispatch happens inside the mode
- Pipeline stages that spawn sub-work submit child WorkUnits with `parentWorkUnitId`
- Inngest job runner is unchanged — it's a good engine

**Cartridge Mode** — Direct deterministic action execution

- Wraps `ExecutionManager` + `GuardedCartridge` + interceptor chain
- Context enrichment (`cartridge.enrichContext()`) happens here, inside the mode
- Receives pre-approved WorkUnit — no longer owns governance
- GuardedCartridge is unchanged — it's a good engine

### ModeRegistry

```typescript
interface ExecutionMode {
  name: "skill" | "pipeline" | "cartridge";
  execute(
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult>;
}

class ModeRegistry {
  private modes = new Map<string, ExecutionMode>();
  register(mode: ExecutionMode): void { ... }
  dispatch(modeName: string, ...): Promise<ExecutionResult> { ... }
}
```

### ExecutionResult (shared output)

```typescript
interface ExecutionResult {
  workUnitId: string;
  outcome: "completed" | "failed" | "pending_approval" | "queued" | "running";

  summary: string;
  outputs: Record<string, unknown>; // mode-specific structured output

  mode: "skill" | "pipeline" | "cartridge";
  durationMs: number;
  traceId: string;

  approvalId?: string; // if pending_approval
  jobId?: string; // if pipeline mode

  error?: {
    code: string;
    message: string;
    stage?: string; // where in the execution it failed
  };
}
```

### ExecutionContext (shared dependencies modes receive)

```typescript
interface ExecutionContext {
  traceId: string;
  governanceDecision: GovernanceDecision;
  resolvedActor: ResolvedActor;
  deploymentConfig: DeploymentConfig;
  stores: StorageContext;
}
```

### What this kills

- `LifecycleOrchestrator` as the platform identity. It becomes CartridgeMode's internal engine.
- Direct `SkillHandler` instantiation per deployment. SkillMode handles this internally.
- Direct Inngest event dispatch from API routes. PipelineMode handles dispatch internally.
- Chat runtime calling `orchestrator.propose()` directly. Chat submits WorkUnits.

Execution modes are engines behind the contract, not identities above it.

---

## Section 5: Shared Tracing

One canonical trace model and query interface for all work, regardless of execution mode.

### WorkTrace

```typescript
interface WorkTrace {
  // Identity
  workUnitId: string;
  traceId: string;
  parentWorkUnitId?: string;

  // What
  intent: string;
  mode: "skill" | "pipeline" | "cartridge";
  organizationId: string;
  actor: { id: string; type: string };
  trigger: "chat" | "api" | "schedule" | "internal";

  // Governance
  governanceOutcome: "execute" | "require_approval" | "deny";
  riskScore: number;
  matchedPolicies: string[];

  // Execution
  outcome: "completed" | "failed" | "queued" | "running" | "pending_approval";
  durationMs: number;
  approvalWaitMs?: number; // time parked waiting for approval, separate from execution

  error?: {
    code: string;
    message: string;
    stage?: string;
  };

  // Mode-specific metrics (opaque to platform, meaningful to mode)
  modeMetrics?: Record<string, unknown>;

  // Timestamps
  requestedAt: string;
  governanceCompletedAt: string;
  executionStartedAt?: string;
  completedAt?: string;
}
```

### modeMetrics by mode

- **Skill:** `{ turnCount, tokenUsage: { input, output }, toolCalls, writeCount }`
- **Pipeline:** `{ stagesCompleted, currentStage, jobId }`
- **Cartridge:** `{ externalRefs, rollbackAvailable }`

Shared fields for universal querying. modeMetrics for engine-specific detail.

### What this kills

- `SkillExecutionTrace` as a standalone model (fields migrate to WorkTrace + modeMetrics)
- Creative pipeline's tracing gap
- Separate audit paths across subsystems

---

## The Complete Flow

```
Caller (chat, API, scheduler, internal agent)
      ↓
  SubmitWorkRequest
      ↓
  Platform Ingress
    • Generate ID, traceId, requestedAt
    • Resolve actor
    • Validate intent against IntentRegistry
    • Resolve mode (suggestedMode if allowed, else defaultMode)
    • Normalize → WorkUnit
      ↓
  Governance Gate
    • Identity resolution (actor permissions, role overlays)
    • Policy evaluation (org rules, action restrictions)
    • Risk scoring (mutationClass + parameters + history)
    • Approval routing (approvalPolicy + score)
    • Budget resolution → ExecutionConstraints
    • Output: GovernanceDecision
      ↓
  [if require_approval → park, notify, wait for response]
  [if deny → return denial with reason]
  [if execute ↓]
      ↓
  Mode Registry dispatch
    • ModeRegistry.dispatch(resolvedMode, workUnit, constraints, context)
      ↓
  ┌─────────────────┬──────────────────┬───────────────────┐
  │   Skill Mode    │  Pipeline Mode   │  Cartridge Mode   │
  │                 │                  │                   │
  │ SkillExecutor   │ Inngest dispatch │ Context enrich    │
  │ + SP6 hooks     │ + stage runner   │ + GuardedCartridge│
  │ + ModelRouter   │ + QA loops       │ + interceptors    │
  │                 │                  │                   │
  │ ExecutionResult │ ExecutionResult  │ ExecutionResult   │
  └─────────────────┴──────────────────┴───────────────────┘
      ↓
  WorkTrace persisted (shared fields + modeMetrics)
      ↓
  ExecutionResult returned to caller
```

---

## Migration Sequence

Aggressive contract-first with selective rip-and-replace.

### Phase 1: Define the contract (week 1)

- All types in new `packages/core/src/platform/` module: `WorkUnit`, `SubmitWorkRequest`, `IntentRegistration`, `GovernanceDecision`, `ExecutionConstraints`, `ExecutionResult`, `WorkTrace`
- `IntentRegistry` implementation with boot-time registration
- `ModeRegistry` with dispatch interface
- No migration yet — types and registries exist alongside current code

### Phase 2: Wire the governance gate (week 2)

- Extract `PolicyEngine`, `RiskScorer`, `ApprovalRouter`, identity resolution from orchestrator into `platform/governance/`
- Build `GovernanceGate` that takes WorkUnit and returns GovernanceDecision
- Orchestrator still works — calls the same extracted primitives

### Phase 3: Migrate skill path (week 2-3)

- Skill intents register in intent registry at boot
- Skill execution enters through WorkUnit → GovernanceGate → SkillMode
- `SkillMode` wraps existing `SkillExecutorImpl` — maps WorkUnit to skill params, ExecutionConstraints to SkillRuntimePolicy
- Delete standalone skill handler invocation paths
- SP6 hooks remain for execution-time governance

### Phase 4: Migrate cartridge path (week 3)

- Cartridge actions register as intents
- `CartridgeMode` wraps existing `ExecutionManager`
- Context enrichment moves inside CartridgeMode
- Chat runtime submits WorkUnits instead of calling `orchestrator.propose()`
- `LifecycleOrchestrator.propose()` becomes a thin wrapper around the platform contract (backward compat)

### Phase 5: Migrate creative pipeline (week 3-4)

- Creative intents register in registry
- `PipelineMode` wraps Inngest dispatcher
- Creative API routes submit WorkUnits instead of dispatching Inngest events directly
- Pipeline stages that spawn sub-work submit child WorkUnits

### Phase 6: Shared tracing + cleanup (week 4)

- `WorkTrace` model replaces `SkillExecutionTrace`
- Single trace persistence across all modes
- Delete duplicate governance code, orphaned types, dead paths
- Delete `LifecycleOrchestrator` as platform identity (becomes CartridgeMode's internal engine)

### What survives intact

- `PolicyEngine`, `RiskScorer`, `ApprovalRouter` (extracted, not rewritten)
- `SkillExecutorImpl` + SP6 hooks (wrapped, not replaced)
- Creative pipeline Inngest runner (wrapped, not replaced)
- `GuardedCartridge` + interceptor chain (wrapped, not replaced)
- `ModelRouter` (consumed by SkillMode)

### What gets deleted

- `LifecycleOrchestrator` as the top-level entry point
- Skill runtime's standalone ingress governance (execution-time governance stays)
- Direct Inngest dispatch from API routes
- Chat runtime's direct orchestrator coupling
- `SkillExecutionTrace` as a separate model
- `ActionEnvelope` as the platform's work record (replaced by WorkUnit + WorkTrace)

---

## Architecture Narrative

"Thin harness, fat skills" was a useful wedge principle, not a durable architecture principle. The runtime IS control, and control for a governed agent marketplace is not thin.

What matters now:

- Business logic stays in skills and agents
- Control lives in the platform
- The platform provides one shared execution contract
- Execution modes are engines behind the contract, not identities above it

One-line summary: **Every unit of work enters the same contract, is classified the same way, is governed before execution, runs in one of a few bounded modes, and is traced end-to-end in one shared model.**
