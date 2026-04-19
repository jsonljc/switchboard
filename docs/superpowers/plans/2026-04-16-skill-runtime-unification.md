# Skill Runtime Unification (SP6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge existing runtime primitives (ModelRouter, lifecycle hooks, deployment config) into skill execution so skills obey the same control plane as agent/orchestrator execution.

**Architecture:** Three phases, each bridging an existing primitive. Phase 1 wires ModelRouter into the skill executor via a new SkillTierContextBuilder and ResolvedModelProfile. Phase 2 extracts inline concerns (governance, budget, tracing) into a SkillHook interface with 6 concrete implementations. Phase 3 replaces hardcoded constants with a SkillRuntimePolicy resolved from deployment DB fields.

**Tech Stack:** TypeScript, Vitest, Zod, Prisma, Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-04-16-skill-runtime-unification-design.md`

---

## File Map

### Phase 1: Router Bridge

| File                                                                           | Action | Responsibility                                                          |
| ------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/types.ts`                                     | Modify | Add `ResolvedModelProfile`, add `minimumModelTier` to `SkillDefinition` |
| `packages/core/src/skill-runtime/skill-tier-context-builder.ts`                | Create | Map execution facts → `TierContext` for ModelRouter                     |
| `packages/core/src/skill-runtime/tool-calling-adapter.ts`                      | Modify | Accept optional `ResolvedModelProfile` in `chatWithTools`               |
| `packages/core/src/skill-runtime/skill-executor.ts`                            | Modify | Accept `ModelRouter`, resolve model per turn                            |
| `packages/core/src/skill-runtime/skill-loader.ts`                              | Modify | Parse optional `minimumModelTier` from frontmatter                      |
| `packages/core/src/skill-runtime/__tests__/skill-tier-context-builder.test.ts` | Create | Unit tests for context builder                                          |
| `packages/core/src/skill-runtime/__tests__/tool-calling-adapter.test.ts`       | Create | Tests for profile-based model selection                                 |
| `packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts`     | Create | Integration tests for router in executor                                |

### Phase 2: Lifecycle Hooks

| File                                                               | Action | Responsibility                                                |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `packages/core/src/skill-runtime/types.ts`                         | Modify | Add `SkillHook`, `HookResult`, `LlmHookResult`, context types |
| `packages/core/src/skill-runtime/hook-runner.ts`                   | Create | Sequential hook execution with short-circuit                  |
| `packages/core/src/skill-runtime/hooks/circuit-breaker-hook.ts`    | Create | Extract from handler → `beforeSkill`                          |
| `packages/core/src/skill-runtime/hooks/blast-radius-hook.ts`       | Create | Extract from handler → `beforeSkill`                          |
| `packages/core/src/skill-runtime/hooks/budget-enforcement-hook.ts` | Create | Extract from executor → `beforeLlmCall`                       |
| `packages/core/src/skill-runtime/hooks/governance-hook.ts`         | Create | Extract from executor → `beforeToolCall` / `afterToolCall`    |
| `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts`  | Create | Extract from handler → `afterSkill` / `onError`               |
| `packages/core/src/skill-runtime/hooks/outcome-linking-hook.ts`    | Create | Extract from handler → `afterSkill`                           |
| `packages/core/src/skill-runtime/skill-executor.ts`                | Modify | Replace inline logic with hook calls, reduce to ~40 lines     |
| `packages/core/src/skill-runtime/skill-handler.ts`                 | Modify | Accept hooks, remove inline safety/trace logic                |
| `packages/core/src/skill-runtime/batch-skill-handler.ts`           | Modify | Accept hooks, share with chat handler                         |
| `packages/core/src/skill-runtime/__tests__/hook-runner.test.ts`    | Create | Unit tests for hook sequencing/short-circuit                  |
| `packages/core/src/skill-runtime/__tests__/hooks/*.test.ts`        | Create | Per-hook unit tests                                           |

### Phase 3: Runtime Policy

| File                                                                              | Action | Responsibility                               |
| --------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| `packages/core/src/skill-runtime/types.ts`                                        | Modify | Add `SkillRuntimePolicy` type                |
| `packages/core/src/skill-runtime/skill-runtime-policy-resolver.ts`                | Create | Deployment + skill → frozen policy           |
| `packages/core/src/skill-runtime/skill-executor.ts`                               | Modify | Accept policy, remove hardcoded constants    |
| `packages/core/src/skill-runtime/hooks/budget-enforcement-hook.ts`                | Modify | Read from policy                             |
| `packages/core/src/skill-runtime/hooks/circuit-breaker-hook.ts`                   | Modify | Read from policy                             |
| `packages/core/src/skill-runtime/hooks/blast-radius-hook.ts`                      | Modify | Read from policy                             |
| `packages/db/prisma/schema.prisma`                                                | Modify | Add `allowedModelTiers` to `AgentDeployment` |
| `packages/core/src/skill-runtime/__tests__/skill-runtime-policy-resolver.test.ts` | Create | Merge order, validation, defaults            |

---

## Phase 1: Router Bridge

### Task 1: Add `ResolvedModelProfile` and `minimumModelTier` to types

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`

- [ ] **Step 1: Write the type additions**

Add at the top of the types file, after the existing imports:

```typescript
import type { ModelSlot } from "../model-router.js";

// ---------------------------------------------------------------------------
// Model Routing (SP6 Phase 1)
// ---------------------------------------------------------------------------

/** Concrete model selection resolved by ModelRouter — skills never see this directly. */
export interface ResolvedModelProfile {
  /** Concrete model ID from ModelConfig.modelId */
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}
```

Add `minimumModelTier` to `SkillDefinition`:

```typescript
export interface SkillDefinition {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: string;
  parameters: ParameterDeclaration[];
  tools: string[];
  body: string;
  output?: { fields: OutputFieldDeclaration[] };
  context: ContextRequirement[];
  minimumModelTier?: ModelSlot;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS (no consumers reference `minimumModelTier` yet)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add ResolvedModelProfile and minimumModelTier to skill types"
```

---

### Task 2: Build `SkillTierContextBuilder`

**Files:**

- Create: `packages/core/src/skill-runtime/skill-tier-context-builder.ts`
- Create: `packages/core/src/skill-runtime/__tests__/skill-tier-context-builder.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { buildTierContext } from "../skill-tier-context-builder.js";
import type { SkillTool } from "../types.js";

describe("buildTierContext", () => {
  const readOnlyTools = new Map<string, SkillTool>([
    [
      "crm-query",
      {
        id: "crm-query",
        operations: {
          "contact.get": {
            description: "Get contact",
            inputSchema: { type: "object", properties: {} },
            governanceTier: "read" as const,
            execute: async () => ({}),
          },
        },
      },
    ],
  ]);

  const riskyTools = new Map<string, SkillTool>([
    [
      "crm-write",
      {
        id: "crm-write",
        operations: {
          "stage.update": {
            description: "Update stage",
            inputSchema: { type: "object", properties: {} },
            governanceTier: "external_write" as const,
            execute: async () => ({}),
          },
        },
      },
    ],
  ]);

  it("returns default tier for first turn with read-only tools", () => {
    const ctx = buildTierContext({
      turnCount: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });
    expect(ctx.messageIndex).toBe(0);
    expect(ctx.hasHighRiskTools).toBe(false);
    expect(ctx.previousTurnUsedTools).toBe(false);
    expect(ctx.previousTurnEscalated).toBe(false);
  });

  it("flags hasHighRiskTools when external_write tool is declared", () => {
    const ctx = buildTierContext({
      turnCount: 1,
      declaredToolIds: ["crm-write"],
      tools: riskyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });
    expect(ctx.hasHighRiskTools).toBe(true);
  });

  it("flags hasHighRiskTools when destructive tool is declared", () => {
    const destructiveTools = new Map<string, SkillTool>([
      [
        "danger",
        {
          id: "danger",
          operations: {
            delete: {
              description: "Delete",
              inputSchema: { type: "object", properties: {} },
              governanceTier: "destructive" as const,
              execute: async () => ({}),
            },
          },
        },
      ],
    ]);
    const ctx = buildTierContext({
      turnCount: 0,
      declaredToolIds: ["danger"],
      tools: destructiveTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });
    expect(ctx.hasHighRiskTools).toBe(true);
  });

  it("passes previousTurnUsedTools through", () => {
    const ctx = buildTierContext({
      turnCount: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: true,
      previousTurnEscalated: false,
    });
    expect(ctx.previousTurnUsedTools).toBe(true);
  });

  it("passes previousTurnEscalated through", () => {
    const ctx = buildTierContext({
      turnCount: 2,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: true,
    });
    expect(ctx.previousTurnEscalated).toBe(true);
  });

  it("sets modelFloor from minimumModelTier", () => {
    const ctx = buildTierContext({
      turnCount: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
      minimumModelTier: "premium",
    });
    expect(ctx.modelFloor).toBe("premium");
  });

  it("counts tools from declared IDs only", () => {
    const ctx = buildTierContext({
      turnCount: 0,
      declaredToolIds: ["crm-query"],
      tools: readOnlyTools,
      previousTurnHadToolUse: false,
      previousTurnEscalated: false,
    });
    expect(ctx.toolCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-tier-context-builder`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
import type { TierContext, ModelSlot } from "../model-router.js";
import type { SkillTool } from "./types.js";

export interface TierContextInput {
  turnCount: number;
  declaredToolIds: string[];
  tools: Map<string, SkillTool>;
  previousTurnHadToolUse: boolean;
  previousTurnEscalated: boolean;
  minimumModelTier?: ModelSlot;
}

export function buildTierContext(input: TierContextInput): TierContext {
  const hasHighRiskTools = input.declaredToolIds.some((toolId) => {
    const tool = input.tools.get(toolId);
    if (!tool) return false;
    return Object.values(tool.operations).some(
      (op) => op.governanceTier === "external_write" || op.governanceTier === "destructive",
    );
  });

  return {
    messageIndex: input.turnCount,
    toolCount: input.declaredToolIds.length,
    hasHighRiskTools,
    previousTurnUsedTools: input.previousTurnHadToolUse,
    previousTurnEscalated: input.previousTurnEscalated,
    modelFloor: input.minimumModelTier,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-tier-context-builder`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add SkillTierContextBuilder for model routing context"
```

---

### Task 3: Extend `ToolCallingAdapter` to accept `ResolvedModelProfile`

**Files:**

- Modify: `packages/core/src/skill-runtime/tool-calling-adapter.ts`
- Create: `packages/core/src/skill-runtime/__tests__/tool-calling-adapter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { AnthropicToolCallingAdapter } from "../tool-calling-adapter.js";
import type { ResolvedModelProfile } from "../types.js";

describe("AnthropicToolCallingAdapter", () => {
  it("uses default model when no profile provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;
    const adapter = new AnthropicToolCallingAdapter(client);

    await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-5-20250514" }),
    );
  });

  it("uses profile model when provided", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;
    const adapter = new AnthropicToolCallingAdapter(client);

    const profile: ResolvedModelProfile = {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 512,
      temperature: 0.3,
      timeoutMs: 5000,
    };

    await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      profile,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        temperature: 0.3,
      }),
    );
  });

  it("uses profile maxTokens over default", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = { messages: { create: mockCreate } } as any;
    const adapter = new AnthropicToolCallingAdapter(client);

    const profile: ResolvedModelProfile = {
      model: "claude-opus-4-6",
      maxTokens: 4096,
      temperature: 0.3,
      timeoutMs: 15000,
    };

    await adapter.chatWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      profile,
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 4096 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- tool-calling-adapter`
Expected: FAIL — `profile` not accepted

- [ ] **Step 3: Modify the adapter**

In `tool-calling-adapter.ts`, update the interface and implementation:

```typescript
import type { ResolvedModelProfile } from "./types.js";

export interface ToolCallingAdapter {
  chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
    profile?: ResolvedModelProfile;
  }): Promise<ToolCallingAdapterResponse>;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicToolCallingAdapter implements ToolCallingAdapter {
  constructor(private client: Anthropic) {}

  async chatWithTools(params: {
    system: string;
    messages: Array<Anthropic.MessageParam>;
    tools: Array<Anthropic.Tool>;
    maxTokens?: number;
    profile?: ResolvedModelProfile;
  }): Promise<ToolCallingAdapterResponse> {
    const model = params.profile?.model ?? DEFAULT_MODEL;
    const maxTokens = params.profile?.maxTokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = params.profile?.temperature;

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools.length > 0 ? params.tools : undefined,
      ...(temperature !== undefined ? { temperature } : {}),
    });

    return {
      content: response.content as Array<Anthropic.TextBlock | Anthropic.ToolUseBlock>,
      stopReason: response.stop_reason as "end_turn" | "tool_use" | "max_tokens",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- tool-calling-adapter`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All existing tests pass (adapter is backward-compatible)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(core): extend ToolCallingAdapter to accept ResolvedModelProfile"
```

---

### Task 4: Wire `ModelRouter` into `SkillExecutorImpl`

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Create: `packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts`

- [ ] **Step 1: Write routing integration test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl } from "../skill-executor.js";
import { ModelRouter } from "../../model-router.js";
import type { ToolCallingAdapter, ToolCallingAdapterResponse } from "../tool-calling-adapter.js";
import type { SkillDefinition, SkillTool, SkillExecutionParams } from "../types.js";
import type Anthropic from "@anthropic-ai/sdk";

function makeEndTurnResponse(text: string): ToolCallingAdapterResponse {
  return {
    content: [{ type: "text", text } as Anthropic.TextBlock],
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

const minimalSkill: SkillDefinition = {
  name: "test",
  slug: "test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [],
  tools: [],
  body: "You are a test skill.",
  context: [],
};

describe("SkillExecutorImpl with ModelRouter", () => {
  it("resolves model via router when provided", async () => {
    const chatWithTools = vi.fn().mockResolvedValue(makeEndTurnResponse("done"));
    const adapter: ToolCallingAdapter = { chatWithTools };
    const router = new ModelRouter();
    const executor = new SkillExecutorImpl(adapter, new Map(), router);

    await executor.execute({
      skill: minimalSkill,
      parameters: {},
      messages: [{ role: "user", content: "hello" }],
      deploymentId: "d1",
      orgId: "o1",
      trustScore: 50,
      trustLevel: "guided",
    });

    // Should have been called with a profile (model resolved by router)
    const callArgs = chatWithTools.mock.calls[0][0];
    expect(callArgs.profile).toBeDefined();
    expect(callArgs.profile.model).toBe("claude-haiku-4-5-20251001"); // default tier → haiku
  });

  it("uses premium model when skill has minimumModelTier: premium", async () => {
    const chatWithTools = vi.fn().mockResolvedValue(makeEndTurnResponse("done"));
    const adapter: ToolCallingAdapter = { chatWithTools };
    const router = new ModelRouter();
    const executor = new SkillExecutorImpl(adapter, new Map(), router);

    const premiumSkill: SkillDefinition = {
      ...minimalSkill,
      minimumModelTier: "premium",
    };

    await executor.execute({
      skill: premiumSkill,
      parameters: {},
      messages: [{ role: "user", content: "hello" }],
      deploymentId: "d1",
      orgId: "o1",
      trustScore: 50,
      trustLevel: "guided",
    });

    const callArgs = chatWithTools.mock.calls[0][0];
    expect(callArgs.profile.model).toBe("claude-sonnet-4-6"); // premium floor → sonnet
  });

  it("falls back to hardcoded behavior when no router provided", async () => {
    const chatWithTools = vi.fn().mockResolvedValue(makeEndTurnResponse("done"));
    const adapter: ToolCallingAdapter = { chatWithTools };
    const executor = new SkillExecutorImpl(adapter, new Map()); // no router

    await executor.execute({
      skill: minimalSkill,
      parameters: {},
      messages: [{ role: "user", content: "hello" }],
      deploymentId: "d1",
      orgId: "o1",
      trustScore: 50,
      trustLevel: "guided",
    });

    const callArgs = chatWithTools.mock.calls[0][0];
    expect(callArgs.profile).toBeUndefined(); // no profile, adapter uses its default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-executor-routing`
Expected: FAIL — constructor doesn't accept router

- [ ] **Step 3: Modify executor to accept and use router**

In `skill-executor.ts`, update the constructor and the loop:

```typescript
import type { ModelRouter } from "../model-router.js";
import { buildTierContext } from "./skill-tier-context-builder.js";
import type { ResolvedModelProfile } from "./types.js";

export class SkillExecutorImpl implements SkillExecutor {
  constructor(
    private adapter: ToolCallingAdapter,
    private tools: Map<string, SkillTool>,
    private router?: ModelRouter,
  ) {}
```

Inside the `while` loop, before the `this.adapter.chatWithTools()` call, add model resolution:

```typescript
// Resolve model profile for this turn
let profile: ResolvedModelProfile | undefined;
if (this.router) {
  const tierCtx = buildTierContext({
    turnCount: turnCount - 1,
    declaredToolIds: params.skill.tools,
    tools: this.tools,
    previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
    previousTurnEscalated: governanceLogs.some(
      (log) => log.decision === "require-approval" || log.decision === "deny",
    ),
    minimumModelTier: params.skill.minimumModelTier,
  });
  const slot = this.router.resolveTier(tierCtx);
  const modelConfig = this.router.resolve(slot);
  profile = {
    model: modelConfig.modelId,
    maxTokens: modelConfig.maxTokens,
    temperature: modelConfig.temperature,
    timeoutMs: modelConfig.timeoutMs,
  };
}
```

Then pass `profile` to the adapter call:

```typescript
const response = await Promise.race([
  this.adapter.chatWithTools({
    system,
    messages,
    tools: anthropicTools,
    profile,
  }),
  // ... existing timeout race
]);
```

- [ ] **Step 4: Run routing test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-executor-routing`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full test suite including eval suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All existing tests pass. The eval suite creates `SkillExecutorImpl(adapter, tools)` (no router) and should work unchanged.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(core): wire ModelRouter into SkillExecutorImpl for per-turn model resolution"
```

---

### Task 5: Parse `minimumModelTier` in skill loader

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-loader.ts`

- [ ] **Step 1: Write a test in the eval suite that uses minimumModelTier**

Add a test to verify the loader accepts and exposes `minimumModelTier`. Create a fixture in the eval suite or write a direct unit test:

```typescript
// In a new file or appended to an existing test:
import { describe, it, expect } from "vitest";
import { loadSkill } from "../skill-loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../..");

describe("skill-loader minimumModelTier", () => {
  it("loads skill without minimumModelTier as undefined", () => {
    const skill = loadSkill("sales-pipeline", join(REPO_ROOT, "skills"));
    expect(skill.minimumModelTier).toBeUndefined();
  });

  it("loads ad-optimizer with minimumModelTier: premium", () => {
    const skill = loadSkill("ad-optimizer", join(REPO_ROOT, "skills"));
    expect(skill.minimumModelTier).toBe("premium");
  });
});
```

- [ ] **Step 2: Add `minimumModelTier` to the frontmatter schema**

In `skill-loader.ts`, update `SkillFrontmatterSchema`:

```typescript
const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  parameters: z.array(ParameterDeclarationSchema),
  tools: z.array(z.string()),
  minimumModelTier: z.enum(["default", "premium", "critical"]).optional(),
  output: z
    .object({
      fields: z.array(OutputFieldSchema),
    })
    .optional(),
  context: z.array(/* ... existing ... */).default([]),
});
```

Update the return in `loadSkill()`:

```typescript
return {
  name: frontmatter.name,
  slug: frontmatter.slug,
  version: frontmatter.version,
  description: frontmatter.description,
  author: frontmatter.author,
  parameters: frontmatter.parameters,
  tools: frontmatter.tools,
  body: body.trim(),
  output: frontmatter.output,
  context,
  minimumModelTier: frontmatter.minimumModelTier,
};
```

- [ ] **Step 3: Add `minimumModelTier: premium` to `skills/ad-optimizer.md` frontmatter**

This is the first skill that should declare a model floor. Add after the `tools:` field in the YAML frontmatter:

```yaml
minimumModelTier: premium
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass. Existing skills load fine without the field. Ad-optimizer loads with `minimumModelTier: "premium"`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): parse minimumModelTier from skill frontmatter, set premium for ad-optimizer"
```

---

## Phase 2: Lifecycle Hooks

### Task 6: Define hook types

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`

- [ ] **Step 1: Add hook-related types**

Add after the existing `SkillExecutor` interface:

```typescript
// ---------------------------------------------------------------------------
// Skill Hooks (SP6 Phase 2)
// ---------------------------------------------------------------------------

export interface SkillHookContext {
  deploymentId: string;
  orgId: string;
  skillSlug: string;
  skillVersion: string;
  sessionId: string;
  trustLevel: "supervised" | "guided" | "autonomous";
  trustScore: number;
}

export interface LlmCallContext {
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  elapsedMs: number;
  profile?: ResolvedModelProfile;
}

export interface LlmResponse {
  content: unknown[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallContext {
  toolId: string;
  operation: string;
  params: unknown;
  governanceTier: GovernanceTier;
  trustLevel: "supervised" | "guided" | "autonomous";
}

export interface HookResult {
  proceed: boolean;
  reason?: string;
  /** When a hook blocks a tool call, this distinguishes deny from pending_approval. */
  decision?: "denied" | "pending_approval";
}

export interface LlmHookResult extends HookResult {
  ctx?: LlmCallContext;
}

export interface SkillHook {
  name: string;
  beforeSkill?(ctx: SkillHookContext): Promise<HookResult>;
  afterSkill?(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void>;
  beforeLlmCall?(ctx: LlmCallContext): Promise<LlmHookResult>;
  afterLlmCall?(ctx: LlmCallContext, response: LlmResponse): Promise<void>;
  beforeToolCall?(ctx: ToolCallContext): Promise<HookResult>;
  afterToolCall?(ctx: ToolCallContext, result: unknown): Promise<void>;
  onError?(ctx: SkillHookContext, error: Error): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add SkillHook interface and lifecycle context types"
```

---

### Task 7: Build hook runner

**Files:**

- Create: `packages/core/src/skill-runtime/hook-runner.ts`
- Create: `packages/core/src/skill-runtime/__tests__/hook-runner.test.ts`

- [ ] **Step 1: Write hook runner tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  runBeforeSkillHooks,
  runBeforeLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterSkillHooks,
  runAfterLlmCallHooks,
  runAfterToolCallHooks,
  runOnErrorHooks,
} from "../hook-runner.js";
import type { SkillHook, SkillHookContext, LlmCallContext, ToolCallContext } from "../types.js";

const baseCtx: SkillHookContext = {
  deploymentId: "d1",
  orgId: "o1",
  skillSlug: "test",
  skillVersion: "1.0.0",
  sessionId: "s1",
  trustLevel: "guided",
  trustScore: 50,
};

const llmCtx: LlmCallContext = {
  turnCount: 1,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  elapsedMs: 0,
};

const toolCtx: ToolCallContext = {
  toolId: "crm-write",
  operation: "stage.update",
  params: {},
  governanceTier: "internal_write",
  trustLevel: "guided",
};

describe("hook-runner", () => {
  describe("runBeforeSkillHooks", () => {
    it("returns proceed=true when no hooks", async () => {
      const result = await runBeforeSkillHooks([], baseCtx);
      expect(result.proceed).toBe(true);
    });

    it("short-circuits on first proceed=false", async () => {
      const hook1: SkillHook = {
        name: "blocker",
        beforeSkill: async () => ({ proceed: false, reason: "blocked" }),
      };
      const hook2: SkillHook = {
        name: "never-reached",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const result = await runBeforeSkillHooks([hook1, hook2], baseCtx);
      expect(result.proceed).toBe(false);
      expect(result.reason).toBe("blocked");
      expect(hook2.beforeSkill).not.toHaveBeenCalled();
    });

    it("runs all hooks when all proceed", async () => {
      const hook1: SkillHook = {
        name: "a",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const hook2: SkillHook = {
        name: "b",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const result = await runBeforeSkillHooks([hook1, hook2], baseCtx);
      expect(result.proceed).toBe(true);
      expect(hook1.beforeSkill).toHaveBeenCalled();
      expect(hook2.beforeSkill).toHaveBeenCalled();
    });

    it("skips hooks without beforeSkill", async () => {
      const hook: SkillHook = { name: "no-op" };
      const result = await runBeforeSkillHooks([hook], baseCtx);
      expect(result.proceed).toBe(true);
    });
  });

  describe("runBeforeLlmCallHooks", () => {
    it("returns proceed=true and original context when no hooks", async () => {
      const result = await runBeforeLlmCallHooks([], llmCtx);
      expect(result.proceed).toBe(true);
      expect(result.ctx).toEqual(llmCtx);
    });

    it("short-circuits on proceed=false", async () => {
      const hook: SkillHook = {
        name: "budget",
        beforeLlmCall: async () => ({ proceed: false, reason: "over budget" }),
      };
      const result = await runBeforeLlmCallHooks([hook], llmCtx);
      expect(result.proceed).toBe(false);
    });

    it("threads context mutations through hooks", async () => {
      const hook: SkillHook = {
        name: "mutator",
        beforeLlmCall: async (ctx) => ({
          proceed: true,
          ctx: { ...ctx, turnCount: ctx.turnCount + 100 },
        }),
      };
      const result = await runBeforeLlmCallHooks([hook], llmCtx);
      expect(result.ctx?.turnCount).toBe(101);
    });
  });

  describe("runBeforeToolCallHooks", () => {
    it("short-circuits on proceed=false", async () => {
      const hook: SkillHook = {
        name: "gov",
        beforeToolCall: async () => ({ proceed: false, reason: "denied" }),
      };
      const result = await runBeforeToolCallHooks([hook], toolCtx);
      expect(result.proceed).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- hook-runner`
Expected: FAIL — module not found

- [ ] **Step 3: Write the hook runner**

```typescript
import type {
  SkillHook,
  SkillHookContext,
  LlmCallContext,
  LlmResponse,
  ToolCallContext,
  HookResult,
  LlmHookResult,
  SkillExecutionResult,
} from "./types.js";

export async function runBeforeSkillHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
): Promise<HookResult> {
  for (const hook of hooks) {
    if (hook.beforeSkill) {
      const result = await hook.beforeSkill(ctx);
      if (!result.proceed) return result;
    }
  }
  return { proceed: true };
}

export async function runBeforeLlmCallHooks(
  hooks: SkillHook[],
  ctx: LlmCallContext,
): Promise<LlmHookResult> {
  let current = ctx;
  for (const hook of hooks) {
    if (hook.beforeLlmCall) {
      const result = await hook.beforeLlmCall(current);
      if (!result.proceed) return result;
      if (result.ctx) current = result.ctx;
    }
  }
  return { proceed: true, ctx: current };
}

export async function runAfterLlmCallHooks(
  hooks: SkillHook[],
  ctx: LlmCallContext,
  response: LlmResponse,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterLlmCall) {
      await hook.afterLlmCall(ctx, response);
    }
  }
}

export async function runBeforeToolCallHooks(
  hooks: SkillHook[],
  ctx: ToolCallContext,
): Promise<HookResult> {
  for (const hook of hooks) {
    if (hook.beforeToolCall) {
      const result = await hook.beforeToolCall(ctx);
      if (!result.proceed) return result;
    }
  }
  return { proceed: true };
}

export async function runAfterToolCallHooks(
  hooks: SkillHook[],
  ctx: ToolCallContext,
  result: unknown,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterToolCall) {
      await hook.afterToolCall(ctx, result);
    }
  }
}

export async function runAfterSkillHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
  result: SkillExecutionResult,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterSkill) {
      await hook.afterSkill(ctx, result);
    }
  }
}

export async function runOnErrorHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
  error: Error,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.onError) {
      try {
        await hook.onError(ctx, error);
      } catch (hookErr) {
        console.error(`Hook ${hook.name} onError failed:`, hookErr);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- hook-runner`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): add hook runner with sequential execution and short-circuit"
```

---

### Task 8: Extract governance hook

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/governance-hook.ts`

This is the most important hook — it gates tool calls based on trust level.

- [ ] **Step 1: Write the hook**

```typescript
import type { SkillHook, ToolCallContext, HookResult } from "../types.js";
import { getToolGovernanceDecision, mapDecisionToOutcome } from "../governance.js";
import type { GovernanceLogEntry, GovernanceDecision } from "../governance.js";
import type { SkillTool } from "../types.js";

export class GovernanceHook implements SkillHook {
  name = "governance";

  private logs: GovernanceLogEntry[] = [];

  constructor(private tools: Map<string, SkillTool>) {}

  async beforeToolCall(ctx: ToolCallContext): Promise<HookResult> {
    const tool = this.tools.get(ctx.toolId);
    const op = tool?.operations[ctx.operation];

    const decision: GovernanceDecision = op
      ? getToolGovernanceDecision(op, ctx.trustLevel)
      : "auto-approve";

    if (op) {
      this.logs.push({
        operationId: `${ctx.toolId}.${ctx.operation}`,
        tier: op.governanceTier,
        trustLevel: ctx.trustLevel,
        decision,
        overridden: !!op.governanceOverride?.[ctx.trustLevel],
        timestamp: new Date().toISOString(),
      });
    }

    if (decision === "deny") {
      return {
        proceed: false,
        reason: "This action is not permitted at your current trust level.",
        decision: "denied",
      };
    }
    if (decision === "require-approval") {
      return {
        proceed: false,
        reason: "This action requires human approval.",
        decision: "pending_approval",
      };
    }
    return { proceed: true };
  }

  /** Called by the executor to retrieve accumulated governance logs for the trace. */
  getGovernanceLogs(): GovernanceLogEntry[] {
    return this.logs;
  }
}
```

- [ ] **Step 2: Write governance hook test**

Create `packages/core/src/skill-runtime/__tests__/hooks/governance-hook.test.ts`:

Test cases:

- `auto-approve` for read-tier tool at guided trust → `proceed: true`
- `deny` for destructive tool at supervised trust → `proceed: false, decision: "denied"`
- `require-approval` for external_write at guided trust → `proceed: false, decision: "pending_approval"`
- `getGovernanceLogs()` returns accumulated entries after multiple calls

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- governance-hook`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): extract GovernanceHook from executor inline logic"
```

---

### Task 9: Extract budget enforcement hook

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/budget-enforcement-hook.ts`

- [ ] **Step 1: Write the hook**

```typescript
import type { SkillHook, LlmCallContext, LlmHookResult } from "../types.js";

const DEFAULT_MAX_LLM_TURNS = 6;
const DEFAULT_MAX_TOTAL_TOKENS = 64_000;
const DEFAULT_MAX_RUNTIME_MS = 30_000;

export class BudgetEnforcementHook implements SkillHook {
  name = "budget-enforcement";

  private maxLlmTurns: number;
  private maxTotalTokens: number;
  private maxRuntimeMs: number;

  constructor(config?: { maxLlmTurns?: number; maxTotalTokens?: number; maxRuntimeMs?: number }) {
    this.maxLlmTurns = config?.maxLlmTurns ?? DEFAULT_MAX_LLM_TURNS;
    this.maxTotalTokens = config?.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
    this.maxRuntimeMs = config?.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  }

  async beforeLlmCall(ctx: LlmCallContext): Promise<LlmHookResult> {
    if (ctx.turnCount >= this.maxLlmTurns) {
      return { proceed: false, reason: `Exceeded maximum LLM turns (${this.maxLlmTurns})` };
    }

    const totalTokens = ctx.totalInputTokens + ctx.totalOutputTokens;
    if (totalTokens > this.maxTotalTokens) {
      return {
        proceed: false,
        reason: `Exceeded token budget (${totalTokens} > ${this.maxTotalTokens})`,
      };
    }

    if (ctx.elapsedMs >= this.maxRuntimeMs) {
      return { proceed: false, reason: `Exceeded ${this.maxRuntimeMs / 1000}s runtime limit` };
    }

    return { proceed: true, ctx };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(core): extract BudgetEnforcementHook from executor inline logic"
```

---

### Task 10: Extract circuit breaker and blast radius hooks

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/circuit-breaker-hook.ts`
- Create: `packages/core/src/skill-runtime/hooks/blast-radius-hook.ts`

- [ ] **Step 1: Write circuit breaker hook**

```typescript
import type { SkillHook, SkillHookContext, HookResult } from "../types.js";
import type { CircuitBreaker } from "../circuit-breaker.js";

export class CircuitBreakerHook implements SkillHook {
  name = "circuit-breaker";

  constructor(private circuitBreaker: CircuitBreaker) {}

  async beforeSkill(ctx: SkillHookContext): Promise<HookResult> {
    const result = await this.circuitBreaker.check(ctx.deploymentId);
    if (!result.allowed) {
      return { proceed: false, reason: result.reason };
    }
    return { proceed: true };
  }
}
```

- [ ] **Step 2: Write blast radius hook**

```typescript
import type { SkillHook, SkillHookContext, HookResult } from "../types.js";
import type { BlastRadiusLimiter } from "../blast-radius-limiter.js";

export class BlastRadiusHook implements SkillHook {
  name = "blast-radius";

  constructor(private limiter: BlastRadiusLimiter) {}

  async beforeSkill(ctx: SkillHookContext): Promise<HookResult> {
    const result = await this.limiter.check(ctx.deploymentId);
    if (!result.allowed) {
      return { proceed: false, reason: result.reason };
    }
    return { proceed: true };
  }
}
```

- [ ] **Step 3: Write tests for both hooks**

Create `packages/core/src/skill-runtime/__tests__/hooks/circuit-breaker-hook.test.ts` and `blast-radius-hook.test.ts`:

Test cases for each:

- delegates to underlying checker, returns `proceed: true` when allowed
- returns `proceed: false` with reason when checker denies

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- circuit-breaker-hook && npx pnpm@9.15.4 --filter @switchboard/core test -- blast-radius-hook`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): extract CircuitBreakerHook and BlastRadiusHook from handler"
```

---

### Task 11: Extract trace persistence and outcome linking hooks

**Files:**

- Create: `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts`
- Create: `packages/core/src/skill-runtime/hooks/outcome-linking-hook.ts`

- [ ] **Step 1: Write trace persistence hook**

```typescript
import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
  SkillExecutionTrace,
} from "../types.js";
import { createId } from "@paralleldrive/cuid2";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

export class TracePersistenceHook implements SkillHook {
  name = "trace-persistence";

  private traceId: string = "";

  constructor(
    private traceStore: ExecutionTraceStore,
    private traceContext: {
      trigger: "chat_message" | "batch_job";
      inputParametersHash: string;
    },
  ) {
    this.traceId = createId();
  }

  getTraceId(): string {
    return this.traceId;
  }

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const trace: SkillExecutionTrace = {
      id: this.traceId,
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: this.traceContext.inputParametersHash,
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: result.tokenUsage,
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error(`Trace persistence failed for ${this.traceId}:`, err);
    }
  }

  async onError(ctx: SkillHookContext, error: Error): Promise<void> {
    const status = error.name === "SkillExecutionBudgetError" ? "budget_exceeded" : "error";
    const errorTrace: SkillExecutionTrace = {
      id: this.traceId,
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: this.traceContext.inputParametersHash,
      toolCalls: [],
      governanceDecisions: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      turnCount: 0,
      status,
      error: error.message,
      responseSummary: "",
      writeCount: 0,
      createdAt: new Date(),
    };
    try {
      await this.traceStore.create(errorTrace);
    } catch (traceErr) {
      console.error(`Error trace persistence failed for ${this.traceId}:`, traceErr);
    }
  }
}
```

- [ ] **Step 2: Write outcome linking hook**

```typescript
import type { SkillHook, SkillHookContext, SkillExecutionResult } from "../types.js";
import type { OutcomeLinker } from "../outcome-linker.js";

export class OutcomeLinkingHook implements SkillHook {
  name = "outcome-linking";

  constructor(
    private outcomeLinker: OutcomeLinker,
    private getTraceId: () => string,
  ) {}

  async afterSkill(_ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    try {
      await this.outcomeLinker.linkFromToolCalls(this.getTraceId(), result.toolCalls);
    } catch (err) {
      console.error(`Outcome linking failed:`, err);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): extract TracePersistenceHook and OutcomeLinkingHook from handler"
```

---

### Task 12: Refactor executor to use hooks (the big refactor)

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`

This is the critical task that replaces inline logic with hook calls.

- [ ] **Step 1: Rewrite the executor**

The new executor should look approximately like this:

```typescript
import type { ToolCallingAdapter } from "./tool-calling-adapter.js";
import type {
  SkillExecutionParams,
  SkillExecutionResult,
  SkillExecutor,
  ToolCallRecord,
  SkillTool,
  SkillHook,
  ResolvedModelProfile,
} from "./types.js";
import { SkillExecutionBudgetError } from "./types.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";
import {
  runBeforeLlmCallHooks,
  runAfterLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterToolCallHooks,
} from "./hook-runner.js";
import type { ModelRouter } from "../model-router.js";
import { buildTierContext } from "./skill-tier-context-builder.js";
import type { GovernanceLogEntry } from "./governance.js";
import type Anthropic from "@anthropic-ai/sdk";

const MAX_TOOL_CALLS = 5;
const MAX_LLM_TURNS = 6;

export class SkillExecutorImpl implements SkillExecutor {
  constructor(
    private adapter: ToolCallingAdapter,
    private tools: Map<string, SkillTool>,
    private router?: ModelRouter,
    private hooks: SkillHook[] = [],
  ) {}

  async execute(params: SkillExecutionParams): Promise<SkillExecutionResult> {
    const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);
    const system = `${interpolated}\n\n${getGovernanceConstraints()}`;
    const anthropicTools = this.buildAnthropicTools(params.skill.tools);
    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const toolCallRecords: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turnCount = 0;
    const startTime = Date.now();

    // Find the governance hook to retrieve logs for the trace
    const governanceHook = this.hooks.find((h): h is GovernanceHook => h.name === "governance") as
      | GovernanceHook
      | undefined;

    while (turnCount < MAX_LLM_TURNS) {
      turnCount++;
      const elapsedMs = Date.now() - startTime;

      // Run beforeLlmCall hooks (budget enforcement, etc.)
      const llmCtx = {
        turnCount,
        totalInputTokens,
        totalOutputTokens,
        elapsedMs,
        profile: this.resolveProfile(params, turnCount, toolCallRecords, governanceHook),
      };
      const hookResult = await runBeforeLlmCallHooks(this.hooks, llmCtx);
      if (!hookResult.proceed) {
        throw new SkillExecutionBudgetError(hookResult.reason ?? "Aborted by hook");
      }
      const resolvedCtx = hookResult.ctx ?? llmCtx;

      // LLM call
      const response = await this.adapter.chatWithTools({
        system,
        messages,
        tools: anthropicTools,
        profile: resolvedCtx.profile,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // Run afterLlmCall hooks
      await runAfterLlmCallHooks(this.hooks, resolvedCtx, {
        content: response.content,
        stopReason: response.stopReason,
        usage: response.usage,
      });

      // End turn
      if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
        const responseText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        return {
          response: responseText,
          toolCalls: toolCallRecords,
          tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
          trace: {
            durationMs: Date.now() - startTime,
            turnCount,
            status: "success" as const,
            responseSummary: responseText.slice(0, 500),
            writeCount: toolCallRecords.filter((tc) => {
              const tool = this.tools.get(tc.toolId);
              const opDef = tool?.operations[tc.operation];
              return (
                opDef?.governanceTier === "internal_write" ||
                opDef?.governanceTier === "external_write"
              );
            }).length,
            governanceDecisions: governanceHook?.getGovernanceLogs() ?? [],
          },
        };
      }

      // Tool calls
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (toolCallRecords.length >= MAX_TOOL_CALLS) {
          throw new SkillExecutionBudgetError(`Exceeded maximum tool calls (${MAX_TOOL_CALLS})`);
        }

        const start = Date.now();
        const [toolId, ...opParts] = toolUse.name.split(".");
        const operation = opParts.join(".");
        const tool = this.tools.get(toolId!);
        const op = tool?.operations[operation];

        // Run beforeToolCall hooks (governance)
        const toolCtx = {
          toolId: toolId!,
          operation,
          params: toolUse.input,
          governanceTier: op?.governanceTier ?? ("read" as const),
          trustLevel: params.trustLevel,
        };
        const toolHookResult = await runBeforeToolCallHooks(this.hooks, toolCtx);

        let result: unknown;
        let governanceOutcome: string;

        if (!toolHookResult.proceed) {
          // Preserve pending_approval vs denied distinction from GovernanceHook
          const status =
            toolHookResult.decision === "pending_approval" ? "pending_approval" : "denied";
          result = { status, message: toolHookResult.reason };
          governanceOutcome = status === "pending_approval" ? "require-approval" : "denied";
        } else if (op) {
          result = await op.execute(toolUse.input);
          governanceOutcome = "auto-approved";
        } else {
          result = { error: `Unknown tool: ${toolUse.name}` };
          governanceOutcome = "auto-approved";
        }

        // Run afterToolCall hooks
        await runAfterToolCallHooks(this.hooks, toolCtx, result);

        toolCallRecords.push({
          toolId: toolId!,
          operation,
          params: toolUse.input,
          result,
          durationMs: Date.now() - start,
          governanceDecision: governanceOutcome as "auto-approved" | "require-approval" | "denied",
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new SkillExecutionBudgetError(`Exceeded maximum LLM turns (${MAX_LLM_TURNS})`);
  }

  private resolveProfile(
    params: SkillExecutionParams,
    turnCount: number,
    toolCallRecords: ToolCallRecord[],
    governanceHook?: GovernanceHook,
  ): ResolvedModelProfile | undefined {
    if (!this.router) return undefined;

    const logs = governanceHook?.getGovernanceLogs() ?? [];
    const tierCtx = buildTierContext({
      turnCount: turnCount - 1,
      declaredToolIds: params.skill.tools,
      tools: this.tools,
      previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
      previousTurnEscalated: logs.some(
        (log) => log.decision === "require-approval" || log.decision === "deny",
      ),
      minimumModelTier: params.skill.minimumModelTier,
    });
    const slot = this.router.resolveTier(tierCtx);
    const modelConfig = this.router.resolve(slot);
    return {
      model: modelConfig.modelId,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
      timeoutMs: modelConfig.timeoutMs,
    };
  }

  private buildAnthropicTools(toolIds: string[]): Anthropic.Tool[] {
    const result: Anthropic.Tool[] = [];
    for (const toolId of toolIds) {
      const tool = this.tools.get(toolId);
      if (!tool) continue;
      for (const [opName, op] of Object.entries(tool.operations)) {
        result.push({
          name: `${toolId}.${opName}`,
          description: op.description,
          input_schema: op.inputSchema as Anthropic.Tool.InputSchema,
        });
      }
    }
    return result;
  }
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All tests pass. The eval suite creates `SkillExecutorImpl(adapter, tools)` without hooks or router — defaults to `[]` and `undefined`. The routing test passes. Hook runner tests pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(core): replace inline executor logic with hook calls"
```

---

### Task 13: Refactor `SkillHandler` to use hooks

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-handler.ts`

- [ ] **Step 1: Simplify handler to delegate to hooks**

Remove inline circuit breaker, blast radius, trace persistence, outcome linking. Accept `hooks: SkillHook[]` in constructor. Use `runBeforeSkillHooks` and `runAfterSkillHooks`.

The handler should become approximately:

```typescript
export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
    private hooks: SkillHook[],
    private contextResolver: { resolve: ContextResolverImpl["resolve"] },
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    const hookCtx: SkillHookContext = {
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      skillSlug: this.skill.slug,
      skillVersion: this.skill.version,
      sessionId: this.config.sessionId,
      trustLevel: ctx.trust.level,
      trustScore: ctx.trust.score,
    };

    // Run beforeSkill hooks (circuit breaker, blast radius)
    const beforeResult = await runBeforeSkillHooks(this.hooks, hookCtx);
    if (!beforeResult.proceed) {
      await ctx.chat.send(
        "I'm having some trouble right now. Let me connect you with the team directly.",
      );
      console.error(`Skill blocked: ${beforeResult.reason}`);
      return;
    }

    // Parameter building
    const builder = this.builderMap.get(this.skill.slug);
    if (!builder) {
      throw new Error(`No parameter builder registered for skill: ${this.skill.slug}`);
    }
    let parameters: Record<string, unknown>;
    try {
      parameters = await builder(ctx, this.config, this.stores);
    } catch (err) {
      if (err instanceof ParameterResolutionError) {
        await ctx.chat.send(err.userMessage);
        return;
      }
      throw err;
    }

    // Context resolution
    let contextVariables: Record<string, string> = {};
    try {
      const resolved = await this.contextResolver.resolve(this.config.orgId, this.skill.context);
      contextVariables = resolved.variables;
    } catch (err) {
      if (err instanceof ContextResolutionError) {
        await ctx.chat.send(
          "I'm missing some required setup. Please contact your admin to configure knowledge entries.",
        );
        console.error(`Context resolution failed: ${err.message}`);
        return;
      }
      throw err;
    }

    const mergedParameters = { ...parameters, ...contextVariables };
    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Execute
    let result: SkillExecutionResult;
    try {
      result = await this.executor.execute({
        skill: this.skill,
        parameters: mergedParameters,
        messages,
        deploymentId: this.config.deploymentId,
        orgId: this.config.orgId,
        trustScore: ctx.trust.score,
        trustLevel: ctx.trust.level,
      });
    } catch (err) {
      await runOnErrorHooks(
        this.hooks,
        hookCtx,
        err instanceof Error ? err : new Error(String(err)),
      );
      await ctx.chat.send(
        "I ran into an issue processing your request. Let me connect you with the team.",
      );
      return;
    }

    // Run afterSkill hooks (trace persistence, outcome linking)
    await runAfterSkillHooks(this.hooks, hookCtx, result);

    await ctx.chat.send(result.response);
  }
}
```

- [ ] **Step 2: Update all call sites of `SkillHandler` constructor**

Search for `new SkillHandler(` across the codebase. Update each to pass the new `hooks` parameter. If no call sites exist in `apps/` yet (skill handlers aren't wired into the API bootstrap), only test fixtures need updating.

Run: `grep -r "new SkillHandler(" packages/ apps/`

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(core): simplify SkillHandler to delegate to hooks"
```

---

### Task 14: Wire hooks into `BatchSkillHandler`

**Files:**

- Modify: `packages/core/src/skill-runtime/batch-skill-handler.ts`

- [ ] **Step 1: Add `hooks: SkillHook[]` to `BatchSkillHandlerConfig`**

Add the field and use `runBeforeSkillHooks` for the safety gate checks at the top of `execute()`. Use `runAfterSkillHooks` and `runOnErrorHooks` for trace persistence. Keep the post-execution write routing inline (batch-specific concern).

- [ ] **Step 2: Run typecheck and tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck && npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(core): wire shared hooks into BatchSkillHandler"
```

---

## Phase 3: Runtime Policy

### Task 15: Add `SkillRuntimePolicy` type

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`

- [ ] **Step 1: Add the type**

```typescript
// ---------------------------------------------------------------------------
// Runtime Policy (SP6 Phase 3)
// ---------------------------------------------------------------------------

export interface SkillRuntimePolicy {
  allowedModelTiers: ModelSlot[];
  minimumModelTier?: ModelSlot;
  maxToolCalls: number;
  maxLlmTurns: number;
  maxTotalTokens: number;
  maxRuntimeMs: number;
  maxWritesPerExecution: number;
  maxWritesPerHour: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  writeApprovalRequired: boolean;
  circuitBreakerThreshold: number;
  maxConcurrentExecutions: number;
}

export const DEFAULT_SKILL_RUNTIME_POLICY: SkillRuntimePolicy = {
  allowedModelTiers: ["default", "premium", "critical"],
  maxToolCalls: 5,
  maxLlmTurns: 6,
  maxTotalTokens: 64_000,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 5,
  maxWritesPerHour: 20,
  trustLevel: "guided",
  writeApprovalRequired: false,
  circuitBreakerThreshold: 5,
  maxConcurrentExecutions: 3,
};
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(core): add SkillRuntimePolicy type with defaults"
```

---

### Task 16: Build `SkillRuntimePolicyResolver`

**Files:**

- Create: `packages/core/src/skill-runtime/skill-runtime-policy-resolver.ts`
- Create: `packages/core/src/skill-runtime/__tests__/skill-runtime-policy-resolver.test.ts`

- [ ] **Step 1: Write tests**

Test cases: default policy when no deployment overrides, deployment tightens limits, trust level mapping (`observe`→`autonomous`, `guarded`→`guided`, `strict`→`supervised`, `locked`→`supervised`), `minimumModelTier` floor validation (fail if not in `allowedModelTiers`), `allowedModelTiers` empty array → all tiers, deployment cannot exceed system defaults.

- [ ] **Step 2: Write the resolver**

```typescript
import type { SkillRuntimePolicy, SkillDefinition } from "./types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "./types.js";
import type { ModelSlot } from "../model-router.js";
import type { TrustLevel } from "./governance.js";

interface DeploymentRecord {
  trustLevel: string;
  circuitBreakerThreshold?: number | null;
  maxWritesPerHour?: number | null;
  allowedModelTiers?: string[];
  governanceSettings?: Record<string, unknown>;
}

const TRUST_LEVEL_MAP: Record<string, TrustLevel> = {
  observe: "autonomous",
  guarded: "guided",
  strict: "supervised",
  locked: "supervised",
};

export class SkillRuntimePolicyResolver {
  resolve(deployment: DeploymentRecord, skill: SkillDefinition): SkillRuntimePolicy {
    const trustLevel = TRUST_LEVEL_MAP[deployment.trustLevel] ?? "guided";

    const allowedModelTiers: ModelSlot[] =
      deployment.allowedModelTiers && deployment.allowedModelTiers.length > 0
        ? (deployment.allowedModelTiers as ModelSlot[])
        : [...DEFAULT_SKILL_RUNTIME_POLICY.allowedModelTiers];

    // Validate minimumModelTier is within allowed tiers
    if (skill.minimumModelTier && !allowedModelTiers.includes(skill.minimumModelTier)) {
      throw new Error(
        `Skill "${skill.slug}" requires minimumModelTier "${skill.minimumModelTier}" ` +
          `but deployment only allows [${allowedModelTiers.join(", ")}]`,
      );
    }

    const policy: SkillRuntimePolicy = {
      ...DEFAULT_SKILL_RUNTIME_POLICY,
      trustLevel,
      allowedModelTiers,
      minimumModelTier: skill.minimumModelTier,
      circuitBreakerThreshold:
        deployment.circuitBreakerThreshold ?? DEFAULT_SKILL_RUNTIME_POLICY.circuitBreakerThreshold,
      maxWritesPerHour:
        deployment.maxWritesPerHour ?? DEFAULT_SKILL_RUNTIME_POLICY.maxWritesPerHour,
    };

    return Object.freeze(policy);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- skill-runtime-policy-resolver`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): add SkillRuntimePolicyResolver with trust level mapping"
```

---

### Task 17: Wire policy into executor and hooks

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/hooks/budget-enforcement-hook.ts`

- [ ] **Step 1: Accept policy in executor, replace hardcoded constants**

Replace `MAX_TOOL_CALLS` and `MAX_LLM_TURNS` with `policy.maxToolCalls` and `policy.maxLlmTurns`. Accept `policy: SkillRuntimePolicy` as a required constructor parameter (with a default to `DEFAULT_SKILL_RUNTIME_POLICY` for backward compat in tests).

- [ ] **Step 2: Update BudgetEnforcementHook to accept policy**

Replace the hardcoded defaults with policy fields. The hook constructor accepts `SkillRuntimePolicy` instead of individual config values.

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test`
Expected: All pass — eval suite uses defaults, routing tests use defaults.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): wire SkillRuntimePolicy into executor and budget hook"
```

---

### Task 18: Add `allowedModelTiers` to Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the column**

Add after `maxWritesPerHour` in the `AgentDeployment` model:

```prisma
allowedModelTiers  String[] @default([])
```

- [ ] **Step 2: Generate migration**

Run: `cd packages/db && npx pnpm@9.15.4 prisma migrate dev --name add-allowed-model-tiers`
Expected: Migration created successfully

- [ ] **Step 3: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client regenerated

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(db): add allowedModelTiers to AgentDeployment schema"
```

---

### Task 19: Bootstrap wiring (when app integration exists)

**Files:**

- Modify: `apps/api/src/bootstrap/` (or wherever `SkillHandler`/`BatchSkillHandler` are first constructed)

Note: As of this plan, skill handlers are not yet wired into `apps/api`. This task applies when that wiring is added. The pattern should be:

- [ ] **Step 1: Construct hook array at bootstrap**

```typescript
import { CircuitBreakerHook } from "@switchboard/core/skill-runtime/hooks/circuit-breaker-hook";
import { BlastRadiusHook } from "@switchboard/core/skill-runtime/hooks/blast-radius-hook";
import { BudgetEnforcementHook } from "@switchboard/core/skill-runtime/hooks/budget-enforcement-hook";
import { GovernanceHook } from "@switchboard/core/skill-runtime/hooks/governance-hook";
import { TracePersistenceHook } from "@switchboard/core/skill-runtime/hooks/trace-persistence-hook";
import { OutcomeLinkingHook } from "@switchboard/core/skill-runtime/hooks/outcome-linking-hook";
import { SkillRuntimePolicyResolver } from "@switchboard/core/skill-runtime/skill-runtime-policy-resolver";

// For each deployment:
const policyResolver = new SkillRuntimePolicyResolver();
const policy = policyResolver.resolve(deployment, skill);
const router = new ModelRouter();

const traceHook = new TracePersistenceHook(traceStore, {
  trigger: "chat_message",
  inputParametersHash: "...",
});
const hooks: SkillHook[] = [
  new CircuitBreakerHook(circuitBreaker),
  new BlastRadiusHook(blastRadiusLimiter),
  new BudgetEnforcementHook(policy),
  new GovernanceHook(tools),
  traceHook,
  new OutcomeLinkingHook(outcomeLinker, () => traceHook.getTraceId()),
];

const executor = new SkillExecutorImpl(adapter, tools, router, hooks, policy);
const handler = new SkillHandler(
  skill,
  executor,
  builderMap,
  stores,
  config,
  hooks,
  contextResolver,
);
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(api): wire SP6 hooks, router, and policy into skill handler bootstrap"
```

---

### Task 20: Final verification

- [ ] **Step 1: Run full monorepo test suite**

Run: `npx pnpm@9.15.4 test`
Expected: All packages pass

- [ ] **Step 2: Run typecheck across all packages**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 4: Commit any remaining fixes**

```bash
git commit -m "chore: fix lint/type issues from SP6 implementation"
```
