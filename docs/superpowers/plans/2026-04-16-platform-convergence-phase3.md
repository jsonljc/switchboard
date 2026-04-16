# Platform Convergence Phase 3 — Migrate Skill Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skill execution enters through WorkUnit → GovernanceGate → SkillMode, using the shared platform contract from Phases 1-2.

**Architecture:** SkillMode wraps the existing SkillExecutorImpl. It maps WorkUnit parameters to skill params and ExecutionConstraints to SkillRuntimePolicy. Skills auto-register their intents at boot via a new `intent` field in frontmatter. SP6 hooks remain for execution-time governance. The channel-gateway gets an optional platform dispatch path.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-platform-convergence-design.md` (Phase 3)

---

## Key Design Decision

SkillMode is a thin adapter between the platform contract and the existing skill executor. It does NOT replace the executor — it wraps it. The executor, hooks, router, and policy resolver from SP6 all survive unchanged.

The mapping is:

- `WorkUnit.intent` → looks up skill slug via IntentRegistration.executor
- `WorkUnit.parameters` → passed through as skill parameters
- `ExecutionConstraints` → merged with deployment config into `SkillRuntimePolicy`
- `ExecutionResult` ← mapped from `SkillExecutionResult`

---

## File Map

| File                                                                  | Action | Responsibility                                          |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `packages/core/src/platform/modes/skill-mode.ts`                      | Create | ExecutionMode implementation wrapping SkillExecutorImpl |
| `packages/core/src/platform/modes/index.ts`                           | Create | Barrel for modes                                        |
| `packages/core/src/platform/skill-intent-registrar.ts`                | Create | Auto-register skill intents from skill files at boot    |
| `packages/core/src/skill-runtime/skill-loader.ts`                     | Modify | Parse optional `intent` field from frontmatter          |
| `packages/core/src/skill-runtime/types.ts`                            | Modify | Add `intent?` to SkillDefinition                        |
| `skills/sales-pipeline.md`                                            | Modify | Add `intent: sales-pipeline.run`                        |
| `skills/ad-optimizer.md`                                              | Modify | Add `intent: ad-optimizer.run`                          |
| `skills/website-profiler.md`                                          | Modify | Add `intent: website-profiler.run`                      |
| `packages/core/src/platform/index.ts`                                 | Modify | Add modes + registrar exports                           |
| `packages/core/src/platform/__tests__/skill-mode.test.ts`             | Create | SkillMode unit tests                                    |
| `packages/core/src/platform/__tests__/skill-intent-registrar.test.ts` | Create | Auto-registration tests                                 |

---

## Task 1: Add `intent` to skill frontmatter

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/skill-loader.ts`
- Modify: `skills/sales-pipeline.md`, `skills/ad-optimizer.md`, `skills/website-profiler.md`

- [ ] **Step 1: Add `intent?` to SkillDefinition**

In `packages/core/src/skill-runtime/types.ts`, add after `minimumModelTier`:

```typescript
intent?: string;
```

- [ ] **Step 2: Add `intent` to frontmatter schema in skill-loader.ts**

In `packages/core/src/skill-runtime/skill-loader.ts`, add to `SkillFrontmatterSchema`:

```typescript
intent: z.string().optional(),
```

And in the `loadSkill()` return, add:

```typescript
intent: frontmatter.intent,
```

- [ ] **Step 3: Add intents to all skill files**

In each skill's YAML frontmatter, add an `intent` line after `slug`:

- `skills/sales-pipeline.md`: `intent: sales-pipeline.run`
- `skills/ad-optimizer.md`: `intent: ad-optimizer.run`
- `skills/website-profiler.md`: `intent: website-profiler.run`

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass (new optional field doesn't break anything)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add intent field to skill frontmatter for platform registration"
```

---

## Task 2: Build SkillMode

**Files:**

- Create: `packages/core/src/platform/modes/skill-mode.ts`
- Create: `packages/core/src/platform/__tests__/skill-mode.test.ts`

- [ ] **Step 1: Write the test**

Read these files first to understand the interfaces:

- `packages/core/src/platform/execution-context.ts` — ExecutionMode interface
- `packages/core/src/skill-runtime/skill-executor.ts` — SkillExecutorImpl constructor
- `packages/core/src/skill-runtime/types.ts` — SkillExecutionParams, SkillExecutionResult, SkillRuntimePolicy, DEFAULT_SKILL_RUNTIME_POLICY
- `packages/core/src/platform/governance-types.ts` — ExecutionConstraints

Test cases:

1. "executes skill and returns ExecutionResult" — mock executor, verify WorkUnit maps to skill params correctly
2. "maps ExecutionConstraints to SkillRuntimePolicy" — verify constraints flow into policy fields
3. "resolves skill slug from executor binding" — verify intent registration's executor.skillSlug is used
4. "returns failed outcome when executor throws" — verify error handling
5. "maps skill execution trace to ExecutionResult" — verify durationMs, traceId, mode flow through

Use mock SkillExecutor (don't use the real one — no LLM):

```typescript
const mockExecutor: SkillExecutor = {
  execute: vi.fn().mockResolvedValue({
    response: "done",
    toolCalls: [],
    tokenUsage: { input: 100, output: 50 },
    trace: {
      durationMs: 500,
      turnCount: 1,
      status: "success",
      responseSummary: "done",
      writeCount: 0,
      governanceDecisions: [],
    },
  }),
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-mode`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/modes/skill-mode.ts
import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type {
  SkillExecutor,
  SkillDefinition,
  SkillRuntimePolicy,
} from "../../skill-runtime/types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "../../skill-runtime/types.js";

export interface SkillModeConfig {
  executor: SkillExecutor;
  skillsBySlug: Map<string, SkillDefinition>;
}

export class SkillMode implements ExecutionMode {
  name = "skill" as const;

  constructor(private config: SkillModeConfig) {}

  async execute(
    workUnit: WorkUnit,
    constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    // Resolve skill from intent registration (executor binding has skillSlug)
    const skillSlug = this.resolveSkillSlug(workUnit);
    const skill = this.config.skillsBySlug.get(skillSlug);
    if (!skill) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: `Skill not found: ${skillSlug}`,
        outputs: {},
        mode: "skill",
        durationMs: 0,
        traceId: workUnit.traceId,
        error: { code: "SKILL_NOT_FOUND", message: `Skill "${skillSlug}" not loaded` },
      };
    }

    // Map ExecutionConstraints → SkillRuntimePolicy
    const policy = this.toPolicy(constraints, skill);

    try {
      const result = await this.config.executor.execute({
        skill,
        parameters: workUnit.parameters,
        messages: [{ role: "user", content: JSON.stringify(workUnit.parameters) }],
        deploymentId: workUnit.id,
        orgId: workUnit.organizationId,
        trustScore: 50, // TODO: resolve from actor context in Phase 4+
        trustLevel: constraints.trustLevel,
      });

      return {
        workUnitId: workUnit.id,
        outcome: result.trace.status === "success" ? "completed" : "failed",
        summary: result.response.slice(0, 500),
        outputs: { response: result.response, toolCalls: result.toolCalls },
        mode: "skill",
        durationMs: result.trace.durationMs,
        traceId: workUnit.traceId,
        error: result.trace.error
          ? { code: "SKILL_ERROR", message: result.trace.error }
          : undefined,
      };
    } catch (err) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: err instanceof Error ? err.message : "Unknown error",
        outputs: {},
        mode: "skill",
        durationMs: 0,
        traceId: workUnit.traceId,
        error: {
          code: "SKILL_EXECUTION_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private resolveSkillSlug(workUnit: WorkUnit): string {
    // Intent format: "skill-name.run" → skill slug is the prefix
    // Or caller can pass skillSlug directly in parameters
    const fromParams = workUnit.parameters.skillSlug as string | undefined;
    if (fromParams) return fromParams;

    // Derive from intent: "sales-pipeline.run" → "sales-pipeline"
    const parts = workUnit.intent.split(".");
    parts.pop(); // remove the verb
    return parts.join(".");
  }

  private toPolicy(constraints: ExecutionConstraints, skill: SkillDefinition): SkillRuntimePolicy {
    return {
      ...DEFAULT_SKILL_RUNTIME_POLICY,
      allowedModelTiers: constraints.allowedModelTiers,
      maxToolCalls: constraints.maxToolCalls,
      maxLlmTurns: constraints.maxLlmTurns,
      maxTotalTokens: constraints.maxTotalTokens,
      maxRuntimeMs: constraints.maxRuntimeMs,
      maxWritesPerExecution: constraints.maxWritesPerExecution,
      trustLevel: constraints.trustLevel,
      minimumModelTier: skill.minimumModelTier,
    };
  }
}
```

Note: The `toPolicy()` method currently doesn't use the policy. The executor already has `policy` in its constructor from SP6. SkillMode may need to create a new executor per-call with the resolved policy, OR the executor can accept policy as a parameter to `execute()`. Read the current `SkillExecutorImpl.execute()` to decide which approach works. If policy is a constructor param and immutable, SkillMode should create the executor internally rather than receiving it.

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-mode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add SkillMode — ExecutionMode wrapping SkillExecutorImpl"
```

---

## Task 3: Build skill intent auto-registrar

**Files:**

- Create: `packages/core/src/platform/skill-intent-registrar.ts`
- Create: `packages/core/src/platform/__tests__/skill-intent-registrar.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { registerSkillIntents } from "../skill-intent-registrar.js";
import { IntentRegistry } from "../intent-registry.js";
import type { SkillDefinition } from "../../skill-runtime/types.js";

const salesPipeline: SkillDefinition = {
  name: "sales-pipeline",
  slug: "sales-pipeline",
  version: "1.0.0",
  description: "Sales pipeline management",
  author: "switchboard",
  parameters: [],
  tools: ["crm-query", "crm-write"],
  body: "test",
  context: [],
  intent: "sales-pipeline.run",
};

const adOptimizer: SkillDefinition = {
  name: "ad-optimizer",
  slug: "ad-optimizer",
  version: "1.0.0",
  description: "Ad optimization",
  author: "switchboard",
  parameters: [],
  tools: ["ads-analytics"],
  body: "test",
  context: [],
  intent: "ad-optimizer.run",
  minimumModelTier: "premium",
};

describe("registerSkillIntents", () => {
  it("registers intents for all skills with intent field", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [salesPipeline, adOptimizer]);
    expect(registry.size).toBe(2);
    expect(registry.lookup("sales-pipeline.run")).toBeDefined();
    expect(registry.lookup("ad-optimizer.run")).toBeDefined();
  });

  it("skips skills without intent field", () => {
    const noIntent: SkillDefinition = {
      ...salesPipeline,
      intent: undefined,
    };
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [noIntent]);
    expect(registry.size).toBe(0);
  });

  it("sets executor binding to skill mode with slug", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [salesPipeline]);
    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.executor).toEqual({ mode: "skill", skillSlug: "sales-pipeline" });
  });

  it("sets defaultMode to skill", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [salesPipeline]);
    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.defaultMode).toBe("skill");
  });

  it("derives mutationClass from tool governance tiers", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [salesPipeline]); // has crm-write → write
    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.mutationClass).toBe("write");
  });

  it("sets budgetClass based on minimumModelTier", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [adOptimizer]); // premium → standard
    const reg = registry.lookup("ad-optimizer.run");
    expect(reg?.budgetClass).toBe("standard");
  });

  it("allows all triggers by default", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, [salesPipeline]);
    const reg = registry.lookup("sales-pipeline.run");
    expect(reg?.allowedTriggers).toEqual(["chat", "api", "schedule", "internal"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-intent-registrar`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/platform/skill-intent-registrar.ts
import type { IntentRegistry } from "./intent-registry.js";
import type { IntentRegistration } from "./intent-registration.js";
import type { SkillDefinition } from "../skill-runtime/types.js";
import type { MutationClass, BudgetClass } from "./types.js";

function deriveMutationClass(skill: SkillDefinition): MutationClass {
  // Skills with "write" or "destructive" tools are write-class
  const toolNames = skill.tools;
  for (const name of toolNames) {
    if (name.includes("write") || name.includes("delete") || name.includes("mutate")) {
      return "write";
    }
  }
  return "read";
}

function deriveBudgetClass(skill: SkillDefinition): BudgetClass {
  if (skill.minimumModelTier === "critical") return "expensive";
  if (skill.minimumModelTier === "premium") return "standard";
  return "cheap";
}

export function registerSkillIntents(registry: IntentRegistry, skills: SkillDefinition[]): void {
  for (const skill of skills) {
    if (!skill.intent) continue;

    const registration: IntentRegistration = {
      intent: skill.intent,
      defaultMode: "skill",
      allowedModes: ["skill"],
      executor: { mode: "skill", skillSlug: skill.slug },
      parameterSchema: { type: "object" },
      mutationClass: deriveMutationClass(skill),
      budgetClass: deriveBudgetClass(skill),
      approvalPolicy: deriveMutationClass(skill) === "read" ? "none" : "threshold",
      idempotent: false,
      allowedTriggers: ["chat", "api", "schedule", "internal"],
      timeoutMs: 30_000,
      retryable: false,
    };

    registry.register(registration);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-intent-registrar`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add skill intent auto-registrar for boot-time registration"
```

---

## Task 4: Barrel exports and full verification

**Files:**

- Create: `packages/core/src/platform/modes/index.ts`
- Modify: `packages/core/src/platform/index.ts`

- [ ] **Step 1: Create modes barrel**

```typescript
// packages/core/src/platform/modes/index.ts
export { SkillMode } from "./skill-mode.js";
export type { SkillModeConfig } from "./skill-mode.js";
```

- [ ] **Step 2: Add to platform barrel**

Add to `packages/core/src/platform/index.ts`:

```typescript
// Modes
export { SkillMode } from "./modes/index.js";
export type { SkillModeConfig } from "./modes/index.js";

// Registrars
export { registerSkillIntents } from "./skill-intent-registrar.js";
```

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass

- [ ] **Step 4: Run typecheck for platform module**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck 2>&1 | grep platform`
Expected: No errors from platform/

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add platform modes barrel and skill intent registrar exports"
```
