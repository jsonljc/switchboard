# Platform Convergence Phase 1 — Define the Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the shared platform types and registries that all future execution paths will use. No migration — these exist alongside current code.

**Architecture:** New `packages/core/src/platform/` module containing: (1) all shared types (WorkUnit, IntentRegistration, GovernanceDecision, ExecutionConstraints, ExecutionResult, WorkTrace, IngressError), (2) IntentRegistry with boot-time registration and validation, (3) ExecutionModeRegistry with typed dispatch. Each file has one responsibility. Types are pure — no runtime logic. Registries are simple lookup + validation.

**Tech Stack:** TypeScript, Vitest, Zod (for parameter schema validation), cuid2 (for ID generation)

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Phase 1)

---

## File Map

| File                                                                   | Action | Responsibility                                                                        |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `packages/core/src/platform/types.ts`                                  | Create | All shared type definitions: ExecutionMode, ActorType, Trigger, Priority, WorkOutcome |
| `packages/core/src/platform/work-unit.ts`                              | Create | SubmitWorkRequest, WorkUnit, normalizeWorkUnit()                                      |
| `packages/core/src/platform/intent-registration.ts`                    | Create | IntentRegistration, ExecutorBinding types                                             |
| `packages/core/src/platform/governance-types.ts`                       | Create | GovernanceDecision, ExecutionConstraints                                              |
| `packages/core/src/platform/execution-result.ts`                       | Create | ExecutionResult, ExecutionError                                                       |
| `packages/core/src/platform/execution-context.ts`                      | Create | ExecutionContext, ExecutionMode interface                                             |
| `packages/core/src/platform/work-trace.ts`                             | Create | WorkTrace type                                                                        |
| `packages/core/src/platform/ingress-error.ts`                          | Create | IngressError type + isIngressError() type guard                                       |
| `packages/core/src/platform/intent-registry.ts`                        | Create | IntentRegistry class — register, lookup, validate, resolve mode                       |
| `packages/core/src/platform/execution-mode-registry.ts`                | Create | ExecutionModeRegistry class — register modes, dispatch                                |
| `packages/core/src/platform/index.ts`                                  | Create | Barrel exports                                                                        |
| `packages/core/src/platform/__tests__/intent-registry.test.ts`         | Create | Registry tests                                                                        |
| `packages/core/src/platform/__tests__/execution-mode-registry.test.ts` | Create | Mode registry tests                                                                   |
| `packages/core/src/platform/__tests__/work-unit.test.ts`               | Create | Normalization tests                                                                   |

---

## Task 1: Create shared type primitives

**Files:**

- Create: `packages/core/src/platform/types.ts`

- [ ] **Step 1: Create the platform directory**

```bash
mkdir -p packages/core/src/platform/__tests__
```

- [ ] **Step 2: Write the shared type primitives**

These are the building blocks reused across all other platform types.

```typescript
// packages/core/src/platform/types.ts

export type ExecutionModeName = "skill" | "pipeline" | "cartridge";

export type ActorType = "user" | "agent" | "system" | "service";

export type Trigger = "chat" | "api" | "schedule" | "internal";

export type Priority = "low" | "normal" | "high" | "critical";

export type WorkOutcome = "completed" | "failed" | "pending_approval" | "queued" | "running";

export type MutationClass = "read" | "write" | "destructive";

export type BudgetClass = "cheap" | "standard" | "expensive";

export type ApprovalPolicy = "none" | "threshold" | "always";

export interface Actor {
  id: string;
  type: ActorType;
}

export interface ExecutionError {
  code: string;
  message: string;
  stage?: string;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add platform shared type primitives"
```

---

## Task 2: Create WorkUnit and normalization

**Files:**

- Create: `packages/core/src/platform/work-unit.ts`
- Create: `packages/core/src/platform/__tests__/work-unit.test.ts`

- [ ] **Step 1: Write the work-unit test**

```typescript
import { describe, it, expect } from "vitest";
import { normalizeWorkUnit, type SubmitWorkRequest } from "../work-unit.js";

const baseRequest: SubmitWorkRequest = {
  organizationId: "org-1",
  actor: { id: "user-1", type: "user" },
  intent: "campaign.pause",
  parameters: { campaignId: "camp-123" },
  trigger: "chat",
};

describe("normalizeWorkUnit", () => {
  it("generates id, traceId, and requestedAt", () => {
    const unit = normalizeWorkUnit(baseRequest, "cartridge");
    expect(unit.id).toBeDefined();
    expect(unit.traceId).toBeDefined();
    expect(unit.requestedAt).toBeDefined();
    expect(new Date(unit.requestedAt).getTime()).not.toBeNaN();
  });

  it("preserves all request fields", () => {
    const unit = normalizeWorkUnit(baseRequest, "cartridge");
    expect(unit.organizationId).toBe("org-1");
    expect(unit.actor).toEqual({ id: "user-1", type: "user" });
    expect(unit.intent).toBe("campaign.pause");
    expect(unit.parameters).toEqual({ campaignId: "camp-123" });
    expect(unit.trigger).toBe("chat");
  });

  it("sets resolvedMode from argument", () => {
    const unit = normalizeWorkUnit(baseRequest, "skill");
    expect(unit.resolvedMode).toBe("skill");
  });

  it("preserves suggestedMode from request", () => {
    const req = { ...baseRequest, suggestedMode: "skill" as const };
    const unit = normalizeWorkUnit(req, "cartridge");
    expect(unit.suggestedMode).toBe("skill");
    expect(unit.resolvedMode).toBe("cartridge");
  });

  it("uses caller traceId when provided", () => {
    const req = { ...baseRequest, traceId: "trace-from-caller" };
    const unit = normalizeWorkUnit(req, "cartridge");
    expect(unit.traceId).toBe("trace-from-caller");
  });

  it("generates traceId when not provided", () => {
    const unit = normalizeWorkUnit(baseRequest, "cartridge");
    expect(unit.traceId).toBeDefined();
    expect(unit.traceId.length).toBeGreaterThan(0);
  });

  it("defaults priority to normal when not provided", () => {
    const unit = normalizeWorkUnit(baseRequest, "cartridge");
    expect(unit.priority).toBe("normal");
  });

  it("preserves priority when provided", () => {
    const req = { ...baseRequest, priority: "critical" as const };
    const unit = normalizeWorkUnit(req, "cartridge");
    expect(unit.priority).toBe("critical");
  });

  it("preserves parentWorkUnitId", () => {
    const req = { ...baseRequest, parentWorkUnitId: "parent-1" };
    const unit = normalizeWorkUnit(req, "cartridge");
    expect(unit.parentWorkUnitId).toBe("parent-1");
  });

  it("preserves idempotencyKey", () => {
    const req = { ...baseRequest, idempotencyKey: "idem-123" };
    const unit = normalizeWorkUnit(req, "cartridge");
    expect(unit.idempotencyKey).toBe("idem-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- work-unit`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/work-unit.ts
import { createId } from "@paralleldrive/cuid2";
import type { ExecutionModeName, Actor, Trigger, Priority } from "./types.js";

export interface SubmitWorkRequest {
  organizationId: string;
  actor: Actor;

  intent: string;
  parameters: Record<string, unknown>;

  suggestedMode?: ExecutionModeName;

  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  trigger: Trigger;
  priority?: Priority;
}

export interface WorkUnit {
  id: string;
  requestedAt: string;

  organizationId: string;
  actor: Actor;

  intent: string;
  parameters: Record<string, unknown>;

  suggestedMode?: ExecutionModeName;
  resolvedMode: ExecutionModeName;

  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId: string;
  trigger: Trigger;
  priority: Priority;
}

export function normalizeWorkUnit(
  request: SubmitWorkRequest,
  resolvedMode: ExecutionModeName,
): WorkUnit {
  return {
    id: createId(),
    requestedAt: new Date().toISOString(),

    organizationId: request.organizationId,
    actor: request.actor,

    intent: request.intent,
    parameters: request.parameters,

    suggestedMode: request.suggestedMode,
    resolvedMode,

    idempotencyKey: request.idempotencyKey,
    parentWorkUnitId: request.parentWorkUnitId,
    traceId: request.traceId ?? createId(),
    trigger: request.trigger,
    priority: request.priority ?? "normal",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- work-unit`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add WorkUnit, SubmitWorkRequest, and normalizeWorkUnit"
```

---

## Task 3: Create IntentRegistration types

**Files:**

- Create: `packages/core/src/platform/intent-registration.ts`

- [ ] **Step 1: Write the types**

```typescript
// packages/core/src/platform/intent-registration.ts
import type {
  ExecutionModeName,
  Trigger,
  MutationClass,
  BudgetClass,
  ApprovalPolicy,
} from "./types.js";

export type ExecutorBinding =
  | { mode: "skill"; skillSlug: string }
  | { mode: "pipeline"; pipelineId: string }
  | { mode: "cartridge"; actionId: string };

export interface IntentRegistration {
  intent: string;

  defaultMode: ExecutionModeName;
  allowedModes: ExecutionModeName[];
  executor: ExecutorBinding;

  parameterSchema: Record<string, unknown>;

  mutationClass: MutationClass;
  budgetClass: BudgetClass;
  approvalPolicy: ApprovalPolicy;

  idempotent: boolean;
  allowedTriggers: Trigger[];
  timeoutMs: number;
  retryable: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add IntentRegistration and ExecutorBinding types"
```

---

## Task 4: Create GovernanceDecision and ExecutionConstraints types

**Files:**

- Create: `packages/core/src/platform/governance-types.ts`

- [ ] **Step 1: Write the types**

```typescript
// packages/core/src/platform/governance-types.ts
import type { ModelSlot } from "../model-router.js";

/**
 * Per-execution resource limits set by the governance gate.
 * Intentionally a subset of SkillRuntimePolicy — Phase 3 maps
 * these into SkillRuntimePolicy for skill-mode execution.
 * Remaining SkillRuntimePolicy fields come from deployment config.
 */
export interface ExecutionConstraints {
  allowedModelTiers: ModelSlot[];
  maxToolCalls: number;
  maxLlmTurns: number;
  maxTotalTokens: number;
  maxRuntimeMs: number;
  maxWritesPerExecution: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export type GovernanceDecision =
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

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add GovernanceDecision and ExecutionConstraints types"
```

---

## Task 5: Create ExecutionResult, ExecutionContext, and ExecutionMode types

**Files:**

- Create: `packages/core/src/platform/execution-result.ts`
- Create: `packages/core/src/platform/execution-context.ts`

- [ ] **Step 1: Write ExecutionResult**

```typescript
// packages/core/src/platform/execution-result.ts
import type { ExecutionModeName, WorkOutcome, ExecutionError } from "./types.js";

export interface ExecutionResult {
  workUnitId: string;
  outcome: WorkOutcome;

  summary: string;
  outputs: Record<string, unknown>;

  mode: ExecutionModeName;
  durationMs: number;
  traceId: string;

  approvalId?: string;
  jobId?: string;

  error?: ExecutionError;
}
```

- [ ] **Step 2: Write ExecutionContext and ExecutionMode**

```typescript
// packages/core/src/platform/execution-context.ts
import type { GovernanceDecision, ExecutionConstraints } from "./governance-types.js";
import type { WorkUnit } from "./work-unit.js";
import type { ExecutionResult } from "./execution-result.js";
import type { ExecutionModeName } from "./types.js";

export interface ExecutionContext {
  traceId: string;
  governanceDecision: GovernanceDecision;
}

export interface ExecutionMode {
  name: ExecutionModeName;
  execute(
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add ExecutionResult, ExecutionContext, and ExecutionMode types"
```

---

## Task 6: Create WorkTrace and IngressError types

**Files:**

- Create: `packages/core/src/platform/work-trace.ts`
- Create: `packages/core/src/platform/ingress-error.ts`

- [ ] **Step 1: Write WorkTrace**

```typescript
// packages/core/src/platform/work-trace.ts
import type { ExecutionModeName, WorkOutcome, Trigger, ExecutionError, Actor } from "./types.js";

export interface WorkTrace {
  workUnitId: string;
  traceId: string;
  parentWorkUnitId?: string;

  intent: string;
  mode: ExecutionModeName;
  organizationId: string;
  actor: Actor;
  trigger: Trigger;

  governanceOutcome: "execute" | "require_approval" | "deny";
  riskScore: number;
  matchedPolicies: string[];

  outcome: WorkOutcome;
  durationMs: number;
  approvalWaitMs?: number;

  error?: ExecutionError;

  modeMetrics?: Record<string, unknown>;

  requestedAt: string;
  governanceCompletedAt: string;
  executionStartedAt?: string;
  completedAt?: string;
}
```

- [ ] **Step 2: Write IngressError**

```typescript
// packages/core/src/platform/ingress-error.ts

export interface IngressError {
  type: "intent_not_found" | "validation_failed" | "trigger_not_allowed";
  intent: string;
  message: string;
}

export function isIngressError(value: unknown): value is IngressError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "intent" in value &&
    "message" in value
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add WorkTrace and IngressError types"
```

---

## Task 7: Build IntentRegistry

**Files:**

- Create: `packages/core/src/platform/intent-registry.ts`
- Create: `packages/core/src/platform/__tests__/intent-registry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import type { IntentRegistration } from "../intent-registration.js";

const campaignPause: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" },
  parameterSchema: { type: "object", properties: { campaignId: { type: "string" } } },
  mutationClass: "write",
  budgetClass: "cheap",
  approvalPolicy: "threshold",
  idempotent: true,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 10_000,
  retryable: true,
};

const adOptimizer: IntentRegistration = {
  intent: "ad-optimizer.run",
  defaultMode: "skill",
  allowedModes: ["skill"],
  executor: { mode: "skill", skillSlug: "ad-optimizer" },
  parameterSchema: { type: "object" },
  mutationClass: "write",
  budgetClass: "expensive",
  approvalPolicy: "always",
  idempotent: false,
  allowedTriggers: ["api", "schedule"],
  timeoutMs: 30_000,
  retryable: false,
};

describe("IntentRegistry", () => {
  it("registers and looks up an intent", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause);
    expect(registry.lookup("campaign.pause")).toEqual(campaignPause);
  });

  it("returns undefined for unknown intent", () => {
    const registry = new IntentRegistry();
    expect(registry.lookup("unknown.intent")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause);
    expect(() => registry.register(campaignPause)).toThrow(
      "Intent already registered: campaign.pause",
    );
  });

  it("resolves mode from suggestedMode when allowed", () => {
    const reg: IntentRegistration = {
      ...campaignPause,
      allowedModes: ["cartridge", "skill"],
    };
    const registry = new IntentRegistry();
    registry.register(reg);
    expect(registry.resolveMode("campaign.pause", "skill")).toBe("skill");
  });

  it("falls back to defaultMode when suggestedMode is not allowed", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause); // allowedModes: ["cartridge"]
    expect(registry.resolveMode("campaign.pause", "pipeline")).toBe("cartridge");
  });

  it("returns defaultMode when no suggestedMode provided", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause);
    expect(registry.resolveMode("campaign.pause")).toBe("cartridge");
  });

  it("validates trigger against allowedTriggers", () => {
    const registry = new IntentRegistry();
    registry.register(adOptimizer); // allowedTriggers: ["api", "schedule"]
    expect(registry.validateTrigger("ad-optimizer.run", "api")).toBe(true);
    expect(registry.validateTrigger("ad-optimizer.run", "chat")).toBe(false);
  });

  it("lists all registered intents", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause);
    registry.register(adOptimizer);
    expect(registry.listIntents()).toEqual(["ad-optimizer.run", "campaign.pause"]);
  });

  it("returns count of registered intents", () => {
    const registry = new IntentRegistry();
    registry.register(campaignPause);
    registry.register(adOptimizer);
    expect(registry.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- intent-registry`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/intent-registry.ts
import type { IntentRegistration } from "./intent-registration.js";
import type { ExecutionModeName, Trigger } from "./types.js";

export class IntentRegistry {
  private registrations = new Map<string, IntentRegistration>();

  register(registration: IntentRegistration): void {
    if (this.registrations.has(registration.intent)) {
      throw new Error(`Intent already registered: ${registration.intent}`);
    }
    this.registrations.set(registration.intent, registration);
  }

  lookup(intent: string): IntentRegistration | undefined {
    return this.registrations.get(intent);
  }

  resolveMode(intent: string, suggestedMode?: ExecutionModeName): ExecutionModeName {
    const reg = this.registrations.get(intent);
    if (!reg) {
      throw new Error(`Intent not registered: ${intent}`);
    }
    if (suggestedMode && reg.allowedModes.includes(suggestedMode)) {
      return suggestedMode;
    }
    return reg.defaultMode;
  }

  validateTrigger(intent: string, trigger: Trigger): boolean {
    const reg = this.registrations.get(intent);
    if (!reg) return false;
    return reg.allowedTriggers.includes(trigger);
  }

  listIntents(): string[] {
    return [...this.registrations.keys()].sort();
  }

  get size(): number {
    return this.registrations.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- intent-registry`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add IntentRegistry with boot-time registration and mode resolution"
```

---

## Task 8: Build ExecutionModeRegistry

**Files:**

- Create: `packages/core/src/platform/execution-mode-registry.ts`
- Create: `packages/core/src/platform/__tests__/execution-mode-registry.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ExecutionModeRegistry } from "../execution-mode-registry.js";
import type { ExecutionMode } from "../execution-context.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { ExecutionModeName } from "../types.js";

function makeWorkUnit(overrides?: Partial<WorkUnit>): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "user-1", type: "user" },
    intent: "test.action",
    parameters: {},
    resolvedMode: "skill",
    traceId: "trace-1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  };
}

const defaultConstraints: ExecutionConstraints = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  trustLevel: "guided",
};

const successResult: ExecutionResult = {
  workUnitId: "wu-1",
  outcome: "completed",
  summary: "Done",
  outputs: {},
  mode: "skill",
  durationMs: 100,
  traceId: "trace-1",
};

describe("ExecutionModeRegistry", () => {
  it("registers and dispatches to a mode", async () => {
    const executeFn = vi.fn().mockResolvedValue(successResult);
    const mode: ExecutionMode = { name: "skill", execute: executeFn };
    const registry = new ExecutionModeRegistry();
    registry.register(mode);

    const workUnit = makeWorkUnit();
    const context = {
      traceId: "trace-1",
      governanceDecision: {
        outcome: "execute" as const,
        riskScore: 10,
        budgetProfile: "cheap",
        constraints: defaultConstraints,
        matchedPolicies: [],
      },
    };

    const result = await registry.dispatch("skill", workUnit, defaultConstraints, context);

    expect(executeFn).toHaveBeenCalledWith(workUnit, defaultConstraints, context);
    expect(result).toEqual(successResult);
  });

  it("throws on unknown mode", async () => {
    const registry = new ExecutionModeRegistry();

    await expect(
      registry.dispatch("unknown" as ExecutionModeName, makeWorkUnit(), defaultConstraints, {
        traceId: "t",
        governanceDecision: {
          outcome: "execute" as const,
          riskScore: 0,
          budgetProfile: "cheap",
          constraints: defaultConstraints,
          matchedPolicies: [],
        },
      }),
    ).rejects.toThrow("Unknown execution mode: unknown");
  });

  it("throws on duplicate registration", () => {
    const mode: ExecutionMode = {
      name: "skill",
      execute: vi.fn().mockResolvedValue(successResult),
    };
    const registry = new ExecutionModeRegistry();
    registry.register(mode);
    expect(() => registry.register(mode)).toThrow("Execution mode already registered: skill");
  });

  it("lists registered modes", () => {
    const registry = new ExecutionModeRegistry();
    registry.register({
      name: "skill",
      execute: vi.fn().mockResolvedValue(successResult),
    });
    registry.register({
      name: "cartridge",
      execute: vi.fn().mockResolvedValue(successResult),
    });
    expect(registry.listModes()).toEqual(["cartridge", "skill"]);
  });

  it("checks if a mode is registered", () => {
    const registry = new ExecutionModeRegistry();
    registry.register({
      name: "pipeline",
      execute: vi.fn().mockResolvedValue(successResult),
    });
    expect(registry.hasMode("pipeline")).toBe(true);
    expect(registry.hasMode("skill")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- execution-mode-registry`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/execution-mode-registry.ts
import type { ExecutionMode, ExecutionContext } from "./execution-context.js";
import type { ExecutionConstraints } from "./governance-types.js";
import type { ExecutionResult } from "./execution-result.js";
import type { WorkUnit } from "./work-unit.js";

export class ExecutionModeRegistry {
  private modes = new Map<string, ExecutionMode>();

  register(mode: ExecutionMode): void {
    if (this.modes.has(mode.name)) {
      throw new Error(`Execution mode already registered: ${mode.name}`);
    }
    this.modes.set(mode.name, mode);
  }

  async dispatch(
    modeName: string,
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const mode = this.modes.get(modeName);
    if (!mode) {
      throw new Error(`Unknown execution mode: ${modeName}`);
    }
    return mode.execute(workUnit, constraints, context);
  }

  hasMode(name: string): boolean {
    return this.modes.has(name);
  }

  listModes(): string[] {
    return [...this.modes.keys()].sort();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- execution-mode-registry`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add ExecutionModeRegistry with typed dispatch"
```

---

## Task 9: Create barrel exports and run full verification

**Files:**

- Create: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Write the barrel file**

```typescript
// packages/core/src/platform/index.ts

// Shared primitives
export type {
  ExecutionModeName,
  ActorType,
  Trigger,
  Priority,
  WorkOutcome,
  MutationClass,
  BudgetClass,
  ApprovalPolicy,
  Actor,
  ExecutionError,
} from "./types.js";

// WorkUnit
export type { SubmitWorkRequest, WorkUnit } from "./work-unit.js";
export { normalizeWorkUnit } from "./work-unit.js";

// Intent Registration
export type { IntentRegistration, ExecutorBinding } from "./intent-registration.js";

// Governance
export type { GovernanceDecision, ExecutionConstraints } from "./governance-types.js";

// Execution
export type { ExecutionResult } from "./execution-result.js";
export type { ExecutionContext, ExecutionMode } from "./execution-context.js";

// Tracing
export type { WorkTrace } from "./work-trace.js";

// Errors
export type { IngressError } from "./ingress-error.js";
export { isIngressError } from "./ingress-error.js";

// Registries
export { IntentRegistry } from "./intent-registry.js";
export { ExecutionModeRegistry } from "./execution-mode-registry.js";
```

- [ ] **Step 2: Run full core test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All tests pass (existing + new platform tests)

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS (check that platform module compiles cleanly)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add platform barrel exports for shared execution contract"
```

- [ ] **Step 5: Run full monorepo verification**

Run: `npx pnpm@9.15.4 test && npx pnpm@9.15.4 lint`
Expected: All pass. Platform module exists alongside current code with zero interference.

- [ ] **Step 6: Final commit if any lint fixes needed**

```bash
git commit -m "chore: fix lint issues from platform module"
```
