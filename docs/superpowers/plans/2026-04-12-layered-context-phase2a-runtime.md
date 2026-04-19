# Layered Context Discipline — Phase 2a: Runtime Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured context budget types and effort-based model routing to `packages/core` so LLM calls assemble context from typed layers instead of raw prompt strings.

**Architecture:** Four new files in `packages/core/src/`: `context-budget.ts` (types), `context-loader.ts` (L2 retrieval interface + NullContextLoader), `context-assembler.ts` (assembles layers into prompt string, enforces per-layer budgets), and effort routing added to `model-router.ts`. `LlmCallWrapper.CallOptions` gets an optional `budget` field — existing callers using raw `prompt: string` are unaffected. `SkillStore` does not exist yet; the `skills` slot in `ContextMemory` is supported by the type but left empty by `NullContextLoader` and the production loader until SkillStore ships.

**Tech Stack:** TypeScript, Vitest, existing `KnowledgeStore` interface (`packages/core/src/knowledge-store.ts`)

---

## File Map

- Create: `packages/core/src/context-budget.ts` — `Effort`, `ContextMemory`, `ContextTask`, `ContextBudget`, `ContextBudgetLimits`, `DEFAULT_CONTEXT_BUDGET_LIMITS`
- Create: `packages/core/src/context-loader.ts` — `ContextLoader` interface, `NullContextLoader`
- Create: `packages/core/src/context-assembler.ts` — `ContextAssembler` class
- Create: `packages/core/src/__tests__/context-assembler.test.ts`
- Create: `packages/core/src/__tests__/context-loader.test.ts`
- Modify: `packages/core/src/model-router.ts` — add `effortToSlotAndOptions`, `TASK_TYPE_EFFORT_MAP`
- Modify: `packages/core/src/__tests__/model-router.test.ts` — add effort routing tests
- Modify: `packages/core/src/llm-call-wrapper.ts` — add `budget?` and `limits?` to `CallOptions`, wire assembler
- Modify: `packages/core/src/index.ts` — export new types and classes

---

### Task 1: ContextBudget types

**Files:**

- Create: `packages/core/src/context-budget.ts`

- [ ] **Step 1: Create context-budget.ts**

```typescript
// packages/core/src/context-budget.ts

export type Effort = "low" | "medium" | "high";

export interface ContextMemory {
  /** Brand voice, guidelines — top-K retrieved from KnowledgeStore */
  brand?: string;
  /**
   * Learned patterns relevant to this task — top-K retrieved from SkillStore.
   * Populated once SkillStore is implemented (AI Workforce Platform spec).
   */
  skills?: string[];
  /** Recent approval patterns — summarised, not raw history */
  performance?: string;
}

export interface ContextTask {
  goal: string;
  scope: string[];
  constraints: string[];
  expectedOutput: string;
}

export interface ContextBudget {
  /** L1: stable doctrine — employee system prompt + core policies */
  doctrine: string;
  /** L2: retrieved memory — only what is relevant to this task */
  memory: ContextMemory;
  /** L3: task capsule */
  task: ContextTask;
  /**
   * Routing hint — derived from taskType via TASK_TYPE_EFFORT_MAP.
   * Set explicitly only to override the default mapping.
   */
  effort: Effort;
  /** Used for routing and logging. Not injected into the assembled prompt. */
  orgId: string;
  taskType: string;
}

/** Per-layer character limits for ContextAssembler. Configurable per employee. */
export interface ContextBudgetLimits {
  /** Max characters for L1 doctrine block. Default: 2000 */
  doctrineBudget: number;
  /** Max characters for L2 memory block (brand + skills + performance combined). Default: 1000 */
  memoryBudget: number;
  /** Max characters for L3 task capsule block. Default: 500 */
  taskBudget: number;
}

export const DEFAULT_CONTEXT_BUDGET_LIMITS: ContextBudgetLimits = {
  doctrineBudget: 2000,
  memoryBudget: 1000,
  taskBudget: 500,
};
```

- [ ] **Step 2: Run typecheck to verify no syntax errors**

```bash
cd /Users/jasonli/dev/switchboard && pnpm --filter @switchboard/core typecheck
```

Expected: passes with no errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/context-budget.ts
git commit -m "feat(core): add ContextBudget types and limits"
```

---

### Task 2: ContextLoader interface and NullContextLoader

**Files:**

- Create: `packages/core/src/context-loader.ts`
- Create: `packages/core/src/__tests__/context-loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/context-loader.test.ts
import { describe, it, expect } from "vitest";
import { NullContextLoader } from "../context-loader.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

describe("NullContextLoader", () => {
  const loader = new NullContextLoader();

  it("returns empty memory for any input", async () => {
    const memory = await loader.load({
      orgId: "org-1",
      employeeId: "emp-1",
      taskType: "content.draft",
      task: { goal: "draft post", scope: [], constraints: [], expectedOutput: "post" },
      limits: DEFAULT_CONTEXT_BUDGET_LIMITS,
    });

    expect(memory).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose context-loader
```

Expected: FAIL — `Cannot find module '../context-loader.js'`

- [ ] **Step 3: Create context-loader.ts**

```typescript
// packages/core/src/context-loader.ts
import type { ContextMemory, ContextTask, ContextBudgetLimits } from "./context-budget.js";

export interface ContextLoaderInput {
  orgId: string;
  employeeId: string;
  taskType: string;
  task: ContextTask;
  limits: ContextBudgetLimits;
}

export interface ContextLoader {
  load(input: ContextLoaderInput): Promise<ContextMemory>;
}

/** No-op loader for tests. Returns empty memory. */
export class NullContextLoader implements ContextLoader {
  async load(_input: ContextLoaderInput): Promise<ContextMemory> {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose context-loader
```

Expected: PASS — `NullContextLoader > returns empty memory for any input`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context-loader.ts packages/core/src/__tests__/context-loader.test.ts
git commit -m "feat(core): add ContextLoader interface and NullContextLoader"
```

---

### Task 3: ContextAssembler

**Files:**

- Create: `packages/core/src/context-assembler.ts`
- Create: `packages/core/src/__tests__/context-assembler.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/__tests__/context-assembler.test.ts
import { describe, it, expect } from "vitest";
import { ContextAssembler } from "../context-assembler.js";
import type { ContextBudget } from "../context-budget.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

const budget: ContextBudget = {
  doctrine: "You are a creative content specialist.",
  memory: {
    brand: "Brand voice: concise, friendly.",
    skills: ["Use storytelling hooks.", "Keep paragraphs short."],
    performance: "Posts with questions get 2x engagement.",
  },
  task: {
    goal: "Draft an Instagram post",
    scope: ["instagram"],
    constraints: ["under 150 words"],
    expectedOutput: "Draft text ready for approval",
  },
  effort: "medium",
  orgId: "org-1",
  taskType: "content.draft",
};

describe("ContextAssembler", () => {
  const assembler = new ContextAssembler();

  it("includes doctrine, memory, and task in output", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("You are a creative content specialist.");
    expect(prompt).toContain("Brand voice: concise, friendly.");
    expect(prompt).toContain("Draft an Instagram post");
  });

  it("includes skills from memory", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("Use storytelling hooks.");
    expect(prompt).toContain("Keep paragraphs short.");
  });

  it("does not include orgId or taskType in prompt", () => {
    const prompt = assembler.assemble(budget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).not.toContain("org-1");
    expect(prompt).not.toContain("content.draft");
  });

  it("truncates doctrine when it exceeds doctrineBudget", () => {
    const limits = { ...DEFAULT_CONTEXT_BUDGET_LIMITS, doctrineBudget: 10 };
    const prompt = assembler.assemble(budget, limits);
    expect(prompt).toContain("[truncated");
    expect(prompt).not.toContain("You are a creative content specialist.");
  });

  it("handles empty memory gracefully", () => {
    const emptyMemoryBudget: ContextBudget = { ...budget, memory: {} };
    const prompt = assembler.assemble(emptyMemoryBudget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("You are a creative content specialist.");
    expect(prompt).toContain("Draft an Instagram post");
  });

  it("handles missing optional memory fields", () => {
    const partialBudget: ContextBudget = {
      ...budget,
      memory: { brand: "Brand voice: direct." },
    };
    const prompt = assembler.assemble(partialBudget, DEFAULT_CONTEXT_BUDGET_LIMITS);
    expect(prompt).toContain("Brand voice: direct.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose context-assembler
```

Expected: FAIL — `Cannot find module '../context-assembler.js'`

- [ ] **Step 3: Create context-assembler.ts**

```typescript
// packages/core/src/context-assembler.ts
import type { ContextBudget, ContextBudgetLimits } from "./context-budget.js";

const TRUNCATION_NOTICE = "[truncated — see full context in memory store]";

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
}

export class ContextAssembler {
  assemble(budget: ContextBudget, limits: ContextBudgetLimits): string {
    const parts: string[] = [];

    // L1: Doctrine
    parts.push(truncate(budget.doctrine, limits.doctrineBudget));

    // L2: Memory
    const memoryParts: string[] = [];
    if (budget.memory.brand) memoryParts.push(`Brand context:\n${budget.memory.brand}`);
    if (budget.memory.skills?.length) {
      memoryParts.push(`Learned patterns:\n${budget.memory.skills.join("\n")}`);
    }
    if (budget.memory.performance) {
      memoryParts.push(`Performance context:\n${budget.memory.performance}`);
    }

    if (memoryParts.length > 0) {
      const memoryBlock = truncate(memoryParts.join("\n\n"), limits.memoryBudget);
      parts.push(memoryBlock);
    }

    // L3: Task capsule
    const taskBlock = [
      `Goal: ${budget.task.goal}`,
      budget.task.scope.length > 0 ? `Scope: ${budget.task.scope.join(", ")}` : null,
      budget.task.constraints.length > 0
        ? `Constraints: ${budget.task.constraints.join("; ")}`
        : null,
      `Expected output: ${budget.task.expectedOutput}`,
    ]
      .filter(Boolean)
      .join("\n");

    parts.push(truncate(taskBlock, limits.taskBudget));

    return parts.join("\n\n---\n\n");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose context-assembler
```

Expected: PASS — all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context-assembler.ts packages/core/src/__tests__/context-assembler.test.ts
git commit -m "feat(core): add ContextAssembler with per-layer budget enforcement"
```

---

### Task 4: Effort routing in ModelRouter

**Files:**

- Modify: `packages/core/src/model-router.ts`
- Modify: `packages/core/src/__tests__/model-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `packages/core/src/__tests__/model-router.test.ts`:

```typescript
import { effortToSlotAndOptions, TASK_TYPE_EFFORT_MAP } from "../model-router.js";

describe("effortToSlotAndOptions", () => {
  it("maps low effort to default slot", () => {
    const { slot, options } = effortToSlotAndOptions("low");
    expect(slot).toBe("default");
    expect(options.critical).toBe(false);
  });

  it("maps medium effort to default slot with critical=true", () => {
    const { slot, options } = effortToSlotAndOptions("medium");
    expect(slot).toBe("default");
    expect(options.critical).toBe(true);
  });

  it("maps high effort to premium slot", () => {
    const { slot, options } = effortToSlotAndOptions("high");
    expect(slot).toBe("premium");
    expect(options.critical).toBe(false);
  });

  it("medium effort resolves to Sonnet via critical upgrade", () => {
    const router = new ModelRouter();
    const { slot, options } = effortToSlotAndOptions("medium");
    const config = router.resolve(slot, options);
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("low effort resolves to Haiku", () => {
    const router = new ModelRouter();
    const { slot, options } = effortToSlotAndOptions("low");
    const config = router.resolve(slot, options);
    expect(config.modelId).toBe("claude-haiku-4-5-20251001");
  });
});

describe("TASK_TYPE_EFFORT_MAP", () => {
  it("maps content.draft to medium", () => {
    expect(TASK_TYPE_EFFORT_MAP["content.draft"]).toBe("medium");
  });

  it("maps content.publish to low", () => {
    expect(TASK_TYPE_EFFORT_MAP["content.publish"]).toBe("low");
  });

  it("maps summarisation to low", () => {
    expect(TASK_TYPE_EFFORT_MAP["summarisation"]).toBe("low");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose model-router
```

Expected: FAIL — `effortToSlotAndOptions is not a function` / `TASK_TYPE_EFFORT_MAP is not defined`

- [ ] **Step 3: Add effort routing to model-router.ts**

Add to the bottom of `packages/core/src/model-router.ts` (after the `ModelRouter` class):

```typescript
import type { Effort } from "./context-budget.js";

export function effortToSlotAndOptions(effort: Effort): {
  slot: ModelSlot;
  options: ResolveOptions;
} {
  switch (effort) {
    case "low":
      return { slot: "default", options: { critical: false } };
    case "medium":
      return { slot: "default", options: { critical: true } };
    case "high":
      return { slot: "premium", options: { critical: false } };
  }
}

export const TASK_TYPE_EFFORT_MAP: Record<string, Effort> = {
  "content.draft": "medium",
  "content.revise": "medium",
  "content.publish": "low",
  "calendar.plan": "medium",
  "calendar.schedule": "low",
  "competitor.analyze": "medium",
  "performance.report": "low",
  classification: "low",
  summarisation: "low",
  retrieval: "low",
};

/** Look up effort for a task type. Falls back to "medium" if not mapped. */
export function effortForTaskType(taskType: string): Effort {
  return TASK_TYPE_EFFORT_MAP[taskType] ?? "medium";
}
```

Note: The `import type { Effort }` must go at the top of the file with the other imports, not at the bottom. Move it to line 1 alongside the existing imports.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose model-router
```

Expected: PASS — all existing tests plus new effort routing tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model-router.ts packages/core/src/__tests__/model-router.test.ts
git commit -m "feat(core): add effort routing (effortToSlotAndOptions, TASK_TYPE_EFFORT_MAP)"
```

---

### Task 5: LlmCallWrapper budget support

**Files:**

- Modify: `packages/core/src/llm-call-wrapper.ts`

- [ ] **Step 1: Read the existing test file to understand the test pattern**

```bash
cat packages/core/src/__tests__/llm-call-wrapper.test.ts
```

Note the existing mock pattern for `callFn` — use the same approach.

- [ ] **Step 2: Write the failing tests**

Add to `packages/core/src/__tests__/llm-call-wrapper.test.ts`:

```typescript
import { ContextAssembler } from "../context-assembler.js";
import type { ContextBudget } from "../context-budget.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "../context-budget.js";

describe("LlmCallWrapper with ContextBudget", () => {
  it("assembles prompt from budget when budget is provided", async () => {
    let capturedInput: Record<string, unknown> = {};
    const callFn = async (
      _config: ModelConfig,
      input: Record<string, unknown>,
    ): Promise<LlmCallResult> => {
      capturedInput = input;
      return { reply: "ok", confidence: 1 };
    };

    const wrapper = new LlmCallWrapper({
      router: new ModelRouter(),
      callFn,
    });

    const budget: ContextBudget = {
      doctrine: "You are helpful.",
      memory: { brand: "Brand: direct." },
      task: { goal: "Draft post", scope: [], constraints: [], expectedOutput: "post" },
      effort: "medium",
      orgId: "org-1",
      taskType: "content.draft",
    };

    await wrapper.call("default", { prompt: "", budget, limits: DEFAULT_CONTEXT_BUDGET_LIMITS });

    expect(typeof capturedInput["prompt"]).toBe("string");
    expect(capturedInput["prompt"] as string).toContain("You are helpful.");
    expect(capturedInput["prompt"] as string).toContain("Brand: direct.");
    expect(capturedInput["prompt"] as string).toContain("Draft post");
  });

  it("uses raw prompt when no budget is provided", async () => {
    let capturedInput: Record<string, unknown> = {};
    const callFn = async (
      _config: ModelConfig,
      input: Record<string, unknown>,
    ): Promise<LlmCallResult> => {
      capturedInput = input;
      return { reply: "ok", confidence: 1 };
    };

    const wrapper = new LlmCallWrapper({
      router: new ModelRouter(),
      callFn,
    });

    await wrapper.call("default", { prompt: "raw prompt here" });
    expect(capturedInput["prompt"]).toBe("raw prompt here");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose llm-call-wrapper
```

Expected: FAIL — tests fail because `budget` field doesn't exist yet

- [ ] **Step 4: Update llm-call-wrapper.ts**

Replace the `CallOptions` interface and update the `call` method in `packages/core/src/llm-call-wrapper.ts`:

```typescript
import type { ModelRouter, ModelSlot, ModelConfig, ResolveOptions } from "./model-router.js";
import type { ContextBudget, ContextBudgetLimits } from "./context-budget.js";
import { ContextAssembler } from "./context-assembler.js";
import { DEFAULT_CONTEXT_BUDGET_LIMITS } from "./context-budget.js";

// ... (keep existing interfaces: LlmCallResult, LlmCallFn, UsageInfo, LlmCallWrapperConfig)

export interface CallOptions extends ResolveOptions {
  prompt: string;
  budget?: ContextBudget;
  limits?: ContextBudgetLimits;
  orgId?: string;
  taskType?: string;
  [key: string]: unknown;
}
```

In the `call` method, resolve the prompt before passing to `callWithTimeout`. Replace the line:

```typescript
const result = await this.callWithTimeout(modelConfig, options);
```

with:

```typescript
const resolvedPrompt = options.budget
  ? new ContextAssembler().assemble(options.budget, options.limits ?? DEFAULT_CONTEXT_BUDGET_LIMITS)
  : options.prompt;
const result = await this.callWithTimeout(modelConfig, { ...options, prompt: resolvedPrompt });
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @switchboard/core test -- --reporter=verbose llm-call-wrapper
```

Expected: PASS — all existing tests plus new budget tests pass

- [ ] **Step 6: Run full core test suite to check for regressions**

```bash
pnpm --filter @switchboard/core test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/llm-call-wrapper.ts packages/core/src/__tests__/llm-call-wrapper.test.ts
git commit -m "feat(core): add ContextBudget support to LlmCallWrapper"
```

---

### Task 6: Export from packages/core index

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports to index.ts**

Add these lines to `packages/core/src/index.ts` after the existing export blocks:

```typescript
// Context Budget (layered context discipline)
export type {
  Effort,
  ContextMemory,
  ContextTask,
  ContextBudget,
  ContextBudgetLimits,
} from "./context-budget.js";
export { DEFAULT_CONTEXT_BUDGET_LIMITS } from "./context-budget.js";
export type { ContextLoaderInput, ContextLoader } from "./context-loader.js";
export { NullContextLoader } from "./context-loader.js";
export { ContextAssembler } from "./context-assembler.js";
export { effortToSlotAndOptions, effortForTaskType, TASK_TYPE_EFFORT_MAP } from "./model-router.js";
```

- [ ] **Step 2: Run typecheck to verify exports are valid**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: passes with no errors

- [ ] **Step 3: Run full test suite one final time**

```bash
pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck
```

Expected: all tests pass, no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export context budget types and classes from core public API"
```

---

## Done

Phase 2a is complete when:

- `pnpm --filter @switchboard/core test` passes
- `pnpm --filter @switchboard/core typecheck` passes
- `ContextBudget`, `ContextAssembler`, `ContextLoader`, `NullContextLoader`, `effortToSlotAndOptions`, `effortForTaskType`, `TASK_TYPE_EFFORT_MAP` are all importable from `@switchboard/core`
- Passing `budget` to `LlmCallWrapper.call()` assembles a structured prompt; omitting it uses raw `prompt` as before

**Next:** Phase 2b (prompt caching via `cache_control` headers) is a separate spec. The Hermes skill extraction loop is also a separate spec.
