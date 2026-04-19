# Platform Convergence Phase 6 — Shared Tracing + Platform Ingress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform ingress (the single entry point) and shared WorkTrace persistence, completing the full platform contract flow.

**Architecture:** PlatformIngress is the single entry point for all work. It normalizes SubmitWorkRequest → WorkUnit, validates against IntentRegistry, runs the GovernanceGate, dispatches to the appropriate ExecutionMode, persists a WorkTrace, and returns the ExecutionResult. WorkTrace replaces per-mode tracing with one canonical model.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Section 5 + Complete Flow)

---

## File Map

| File                                                               | Action | Responsibility                                                       |
| ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------- |
| `packages/core/src/platform/work-trace-recorder.ts`                | Create | Builds and persists WorkTrace from execution lifecycle               |
| `packages/core/src/platform/platform-ingress.ts`                   | Create | Single entry point: normalize → validate → govern → dispatch → trace |
| `packages/core/src/platform/index.ts`                              | Modify | Add ingress + trace recorder exports                                 |
| `packages/core/src/platform/__tests__/work-trace-recorder.test.ts` | Create | Trace assembly tests                                                 |
| `packages/core/src/platform/__tests__/platform-ingress.test.ts`    | Create | Full flow integration tests                                          |

---

## Task 1: WorkTrace recorder

**Files:**

- Create: `packages/core/src/platform/work-trace-recorder.ts`
- Create: `packages/core/src/platform/__tests__/work-trace-recorder.test.ts`

- [ ] **Step 1: Read the WorkTrace type**

Read `packages/core/src/platform/work-trace.ts` to see the full shape.

- [ ] **Step 2: Write the test**

Test cases:

1. "builds trace from governance deny" — no execution, outcome matches governance
2. "builds trace from successful execution" — outcome "completed", durationMs set
3. "builds trace from failed execution" — outcome "failed", error populated
4. "builds trace from queued pipeline execution" — outcome "queued", jobId set
5. "includes modeMetrics when provided" — skill metrics flow through
6. "records all timestamps" — requestedAt, governanceCompletedAt, executionStartedAt, completedAt

The recorder is a pure function that assembles a WorkTrace from the execution lifecycle data:

```typescript
interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
}
```

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/work-trace-recorder.ts
import type { WorkTrace } from "./work-trace.js";
import type { WorkUnit } from "./work-unit.js";
import type { GovernanceDecision } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";

export interface TraceInput {
  workUnit: WorkUnit;
  governanceDecision: GovernanceDecision;
  governanceCompletedAt: string;
  executionResult?: ExecutionResult;
  executionStartedAt?: string;
  completedAt?: string;
  modeMetrics?: Record<string, unknown>;
}

export interface WorkTraceStore {
  persist(trace: WorkTrace): Promise<void>;
}

export function buildWorkTrace(input: TraceInput): WorkTrace {
  const { workUnit, governanceDecision, executionResult } = input;

  const outcome =
    executionResult?.outcome ??
    (governanceDecision.outcome === "deny" ? "failed" : "pending_approval");

  return {
    workUnitId: workUnit.id,
    traceId: workUnit.traceId,
    parentWorkUnitId: workUnit.parentWorkUnitId,
    intent: workUnit.intent,
    mode: workUnit.resolvedMode,
    organizationId: workUnit.organizationId,
    actor: workUnit.actor,
    trigger: workUnit.trigger,
    governanceOutcome: governanceDecision.outcome,
    riskScore: governanceDecision.riskScore,
    matchedPolicies: governanceDecision.matchedPolicies,
    outcome,
    durationMs: executionResult?.durationMs ?? 0,
    error: executionResult?.error,
    modeMetrics: input.modeMetrics,
    requestedAt: workUnit.requestedAt,
    governanceCompletedAt: input.governanceCompletedAt,
    executionStartedAt: input.executionStartedAt,
    completedAt: input.completedAt,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- work-trace-recorder`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add WorkTrace recorder for shared platform tracing"
```

---

## Task 2: PlatformIngress — the single entry point

**Files:**

- Create: `packages/core/src/platform/platform-ingress.ts`
- Create: `packages/core/src/platform/__tests__/platform-ingress.test.ts`

This is the culmination of the entire platform convergence. It implements the complete flow from the spec.

- [ ] **Step 1: Read dependencies**

Read:

- `packages/core/src/platform/work-unit.ts` — normalizeWorkUnit
- `packages/core/src/platform/intent-registry.ts` — IntentRegistry
- `packages/core/src/platform/execution-mode-registry.ts` — ExecutionModeRegistry
- `packages/core/src/platform/governance/governance-gate.ts` — GovernanceGate
- `packages/core/src/platform/ingress-error.ts` — IngressError
- `packages/core/src/platform/governance/constraint-resolver.ts` — resolveConstraints

- [ ] **Step 2: Write the test**

Test cases:

1. "returns IngressError for unknown intent" — submit with unregistered intent
2. "returns IngressError for disallowed trigger" — submit with trigger not in allowedTriggers
3. "returns deny result when governance denies" — mock gate to deny
4. "returns pending_approval when governance requires approval" — mock gate to require_approval
5. "dispatches to correct execution mode and returns result" — mock gate to execute, mock mode to return completed
6. "persists WorkTrace on successful execution" — verify trace store called
7. "persists WorkTrace on governance deny" — verify trace even without execution
8. "normalizes WorkUnit with generated id and traceId" — verify normalization happened

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/platform-ingress.ts
import type { SubmitWorkRequest, WorkUnit } from "./work-unit.js";
import { normalizeWorkUnit } from "./work-unit.js";
import type { IntentRegistry } from "./intent-registry.js";
import type { ExecutionModeRegistry } from "./execution-mode-registry.js";
import type { GovernanceGate } from "./governance/governance-gate.js";
import type { ExecutionResult } from "./execution-result.js";
import type { IngressError } from "./ingress-error.js";
import type { GovernanceDecision } from "./governance-types.js";
import { resolveConstraints } from "./governance/constraint-resolver.js";
import { buildWorkTrace } from "./work-trace-recorder.js";
import type { WorkTraceStore } from "./work-trace-recorder.js";

export type SubmitWorkResponse =
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit }
  | { ok: false; error: IngressError }
  | { ok: true; result: ExecutionResult; workUnit: WorkUnit; approvalRequired: true };

export interface PlatformIngressConfig {
  intentRegistry: IntentRegistry;
  modeRegistry: ExecutionModeRegistry;
  governanceGate: GovernanceGate;
  traceStore?: WorkTraceStore;
}

export class PlatformIngress {
  constructor(private config: PlatformIngressConfig) {}

  async submit(request: SubmitWorkRequest): Promise<SubmitWorkResponse> {
    // 1. Validate intent
    const registration = this.config.intentRegistry.lookup(request.intent);
    if (!registration) {
      return {
        ok: false,
        error: {
          type: "intent_not_found",
          intent: request.intent,
          message: `Unknown intent: ${request.intent}`,
        },
      };
    }

    // 2. Validate trigger
    if (!this.config.intentRegistry.validateTrigger(request.intent, request.trigger)) {
      return {
        ok: false,
        error: {
          type: "trigger_not_allowed",
          intent: request.intent,
          message: `Trigger "${request.trigger}" is not allowed for intent "${request.intent}"`,
        },
      };
    }

    // 3. Resolve mode and normalize
    const resolvedMode = this.config.intentRegistry.resolveMode(
      request.intent,
      request.suggestedMode,
    );
    const workUnit = normalizeWorkUnit(request, resolvedMode);

    // 4. Governance gate
    const governanceCompletedAt = new Date().toISOString();
    let governanceDecision: GovernanceDecision;
    try {
      governanceDecision = await this.config.governanceGate.evaluate(workUnit, registration);
    } catch {
      // If governance gate fails, treat as deny
      governanceDecision = {
        outcome: "deny",
        reasonCode: "GOVERNANCE_ERROR",
        riskScore: 100,
        matchedPolicies: [],
      };
    }

    // 5. Handle deny
    if (governanceDecision.outcome === "deny") {
      const result: ExecutionResult = {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: governanceDecision.reasonCode,
        outputs: {},
        mode: resolvedMode,
        durationMs: 0,
        traceId: workUnit.traceId,
        error: {
          code: "GOVERNANCE_DENIED",
          message: governanceDecision.reasonCode,
        },
      };

      await this.persistTrace({
        workUnit,
        governanceDecision,
        governanceCompletedAt,
      });

      return { ok: true, result, workUnit };
    }

    // 6. Handle require_approval
    if (governanceDecision.outcome === "require_approval") {
      const result: ExecutionResult = {
        workUnitId: workUnit.id,
        outcome: "pending_approval",
        summary: `Approval required (level: ${governanceDecision.approvalLevel})`,
        outputs: {},
        mode: resolvedMode,
        durationMs: 0,
        traceId: workUnit.traceId,
        approvalId: workUnit.id,
      };

      await this.persistTrace({
        workUnit,
        governanceDecision,
        governanceCompletedAt,
      });

      return { ok: true, result, workUnit, approvalRequired: true };
    }

    // 7. Execute
    const executionStartedAt = new Date().toISOString();
    const executionResult = await this.config.modeRegistry.dispatch(
      resolvedMode,
      workUnit,
      governanceDecision.constraints,
      {
        traceId: workUnit.traceId,
        governanceDecision,
      },
    );

    const completedAt = new Date().toISOString();

    // 8. Persist trace
    await this.persistTrace({
      workUnit,
      governanceDecision,
      governanceCompletedAt,
      executionResult,
      executionStartedAt,
      completedAt,
    });

    return { ok: true, result: executionResult, workUnit };
  }

  private async persistTrace(input: {
    workUnit: WorkUnit;
    governanceDecision: GovernanceDecision;
    governanceCompletedAt: string;
    executionResult?: ExecutionResult;
    executionStartedAt?: string;
    completedAt?: string;
  }): Promise<void> {
    if (!this.config.traceStore) return;

    const trace = buildWorkTrace(input);
    try {
      await this.config.traceStore.persist(trace);
    } catch (err) {
      console.error(`WorkTrace persistence failed for ${input.workUnit.id}:`, err);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- platform-ingress`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add PlatformIngress — single entry point for all platform work"
```

---

## Task 3: Barrel exports and final verification

**Files:**

- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Add exports**

Add to `packages/core/src/platform/index.ts`:

```typescript
// Platform Ingress
export { PlatformIngress } from "./platform-ingress.js";
export type { PlatformIngressConfig, SubmitWorkResponse } from "./platform-ingress.js";

// Tracing
export { buildWorkTrace } from "./work-trace-recorder.js";
export type { TraceInput, WorkTraceStore } from "./work-trace-recorder.js";
```

- [ ] **Step 2: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 --filter @switchboard/core lint`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add PlatformIngress and WorkTrace to platform exports"
```
