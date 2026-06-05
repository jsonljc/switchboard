# Alex Router-Flip De-Risk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make flipping `ALEX_MODEL_ROUTER_ENABLED=true` safe and observable — wire per-conversation cost/latency/cache telemetry, re-key model tiering on conversation depth (so it stops dumping every reply to Haiku), add a router-ON eval that catches a bad downgrade, and stop the timeout token-burn leak — without flipping the flag and without activating the dormant governance gates.

**Architecture:** Three concerns in one branch (freeze-gate bullets 3–5), all in `packages/core` skill-runtime + the `apps/api` bootstrap + the `evals/alex-conversation` harness + the dual-prom metrics. Telemetry is wired via the existing isolated `qualificationEvaluationHook` template (a dedicated executor arg), **not** `runAfterSkillHooks` (which would activate four governance `afterSkill` gates that have never run live). Router/tier changes are inert with the flag OFF (model selection byte-identical). Telemetry + timeout/abort take effect on the live path immediately (intended).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, `@anthropic-ai/sdk@0.91.1` (supports per-request `{ signal, timeout, maxRetries }`), Prisma (JSON columns → no migration), prom-client (dual-prom api+chat).

**Spec:** `docs/superpowers/specs/2026-06-03-alex-router-flip-derisk-design.md`.

**Conventions (every task):** ESM `.js` extensions in relative imports; no `any`/`console.log`; co-located `*.test.ts`; Prettier (semi, double quotes, 2-space, trailing commas, 100 width); commitlint (lowercase subject, ≤100 chars; wrap `-m` body lines ≤100). Run `git branch --show-current` before each commit (must be `feat/alex-router-flip-derisk`). Core tests: `pnpm --filter @switchboard/core test`. Eval tests: `pnpm exec vitest run --config evals/vitest.config.ts`.

---

## Concern A — T2.6 Per-conversation cost/latency + cache telemetry (lead)

### Task A1: Capture cache tokens + actual model in the adapter

**Files:**

- Modify: `packages/core/src/skill-runtime/llm-types.ts` (`LLMUsage`, `LLMResponse`)
- Modify: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts:183-190` (usage block)
- Test: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.test.ts` (existing — add cases)

- [ ] **Step 1: Extend the types.** In `llm-types.ts`, replace the `LLMUsage` and `LLMResponse` interfaces (lines 39-48) with:

```ts
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from the prompt cache (Anthropic `cache_read_input_tokens`). Excluded from `inputTokens`. */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache (Anthropic `cache_creation_input_tokens`). Excluded from `inputTokens`. */
  cacheCreationTokens?: number;
}

export interface LLMResponse {
  content: LLMContentBlock[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
  /** The concrete model the adapter actually called (for telemetry; independent of the router flag). */
  model?: string;
}
```

- [ ] **Step 2: Write failing adapter test.** In `anthropic-tool-adapter.test.ts`, add a test that stubs `client.messages.create` to resolve with `usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }` and `stop_reason: "end_turn"`, content `[{type:"text",text:"hi"}]`, then asserts:

```ts
it("captures cache tokens and the model in the usage", async () => {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 0,
    },
  });
  const adapter = new AnthropicToolAdapter({ messages: { create } } as never);
  const res = await adapter.chatWithTools({
    system: "s",
    messages: [{ role: "user", content: "x" }],
    tools: [],
    profile: {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      temperature: 0.7,
      timeoutMs: 8000,
    },
  });
  expect(res.usage.cacheReadTokens).toBe(800);
  expect(res.usage.cacheCreationTokens).toBe(0);
  expect(res.model).toBe("claude-haiku-4-5-20251001");
});
```

- [ ] **Step 3: Run it — verify FAIL.** `pnpm --filter @switchboard/core test -- anthropic-tool-adapter` → FAIL (`cacheReadTokens` undefined / `model` undefined).

- [ ] **Step 4: Implement.** In `anthropic-tool-adapter.ts`, replace the return (lines 183-190) with:

```ts
return {
  content,
  stopReason: response.stop_reason as LLMStopReason,
  model: params.profile?.model ?? DEFAULT_MODEL,
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  },
};
```

- [ ] **Step 5: Run it — verify PASS.** `pnpm --filter @switchboard/core test -- anthropic-tool-adapter` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/skill-runtime/llm-types.ts packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.test.ts
git commit -m "feat(core): capture cache tokens + model in the anthropic adapter usage"
```

### Task A2: Accumulate cache tokens + model in the executor; keep the budget on full-price tokens

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts` (`SkillExecutionResult.tokenUsage`, `SkillExecutionTraceData`)
- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (accumulators ~210-211, budget check ~277-284, success return ~330-355)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts`

- [ ] **Step 1: Extend the result/trace types.** In `types.ts`, change `SkillExecutionResult.tokenUsage` (line 107) and `SkillExecutionTraceData` (lines 141-155):

```ts
  // SkillExecutionResult.tokenUsage:
  tokenUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
```

Add to `SkillExecutionTraceData` (alongside the existing fields) — only `model`; cost is computed in the A4 recorder (which owns the `llm-costs` dependency), so the executor never sets it:

```ts
  /** Concrete model that produced the final response (for telemetry). The recorder
   *  derives costUsd from this + the token breakdown — the executor does not compute cost. */
  model?: string;
```

- [ ] **Step 2: Write failing executor test.** In `skill-executor.test.ts`, add a test using a mock adapter whose `chatWithTools` returns `usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000, cacheCreationTokens: 0 }`, `model: "claude-sonnet-4-6"`, `stopReason:"end_turn"`. Drive one `execute()` and assert:

```ts
expect(result.tokenUsage.cacheRead).toBe(5000);
expect(result.trace.model).toBe("claude-sonnet-4-6");
// large cache_read must NOT trip the 64k budget (full-price input+output is only 120):
expect(result.trace.status).toBe("success");
```

- [ ] **Step 3: Run it — verify FAIL.** `pnpm --filter @switchboard/core test -- skill-executor` → FAIL.

- [ ] **Step 4: Implement.** In `skill-executor.ts`:
  - Add accumulators next to lines 210-211:
    ```ts
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let lastModel: string | undefined;
    ```
  - Replace the accumulation + budget block (lines 277-284) with (note the named `billableTokens` — the hard budget stays on full-price tokens; cache reads/creations are captured but excluded, matching the SDK which already excludes them from `input_tokens`):

    ```ts
    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    totalCacheReadTokens += response.usage.cacheReadTokens ?? 0;
    totalCacheCreationTokens += response.usage.cacheCreationTokens ?? 0;
    if (response.model) lastModel = response.model;

    // Hard budget gates on full-price (uncached) tokens only. Anthropic reports
    // cache reads/creations separately from input_tokens, so a large cached prefix
    // re-read every turn is near-free and must NOT exhaust the token budget.
    const billableTokens = totalInputTokens + totalOutputTokens;
    if (billableTokens > this.policy.maxTotalTokens) {
      throw new SkillExecutionBudgetError(
        `Exceeded token budget (${billableTokens} > ${this.policy.maxTotalTokens})`,
      );
    }
    ```

  - In the success return (lines 330-355), replace `tokenUsage` and extend `trace`:
    ```ts
          tokenUsage: {
            input: totalInputTokens,
            output: totalOutputTokens,
            cacheRead: totalCacheReadTokens,
            cacheCreation: totalCacheCreationTokens,
          },
          trace: {
            durationMs: Date.now() - startTime,
            turnCount,
            status: "success" as const,
            responseSummary: responseText.slice(0, 500),
            writeCount: /* unchanged existing writeCount block */,
            governanceDecisions: governanceHook?.getGovernanceLogs() ?? [],
            qualificationSignals: sidecar.persisted,
            ...(lastModel ? { model: lastModel } : {}),
          },
    ```
    (Leave the existing `writeCount` computation intact; only add `model`. `costUsd` is attached in Task A4's recorder, not here.)

- [ ] **Step 5: Run it — verify PASS.** `pnpm --filter @switchboard/core test -- skill-executor` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat(core): accumulate cache tokens + model in executor; budget stays full-price"
```

### Task A3: Cache-aware per-execution cost function

**Files:**

- Modify: `packages/core/src/telemetry/llm-costs.ts`
- Test: `packages/core/src/telemetry/llm-costs.test.ts` (create if absent)

- [ ] **Step 1: Write failing test.** Create/extend `llm-costs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeExecutionCostUSD } from "./llm-costs.js";

describe("computeExecutionCostUSD", () => {
  it("normalizes the router's full model ids to the price table", () => {
    const r = computeExecutionCostUSD({
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    // sonnet: 0.003 in + 0.015 out per 1k
    expect(r.totalCost).toBeCloseTo(0.018, 6);
  });
  it("prices cache reads at a discount and cache creation at a premium", () => {
    const r = computeExecutionCostUSD({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 10_000, // 10k * (0.001 * 0.1)/1k = 0.001
      cacheCreationTokens: 10_000, // 10k * (0.001 * 1.25)/1k = 0.0125
    });
    expect(r.totalCost).toBeCloseTo(0.001 + 0.0125, 6);
  });
});
```

- [ ] **Step 2: Run it — verify FAIL.** `pnpm --filter @switchboard/core test -- llm-costs` → FAIL (`computeExecutionCostUSD` not exported).

- [ ] **Step 3: Implement.** Append to `llm-costs.ts`:

```ts
/**
 * Map a concrete (possibly versioned) model id to a LLM_COST_TABLE key.
 * The router emits ids like "claude-sonnet-4-6" / "claude-haiku-4-5-20251001";
 * the table is keyed by family ("claude-sonnet-4"). Prefix-match the family.
 */
function normalizeModelId(modelId: string): string {
  if (modelId.includes("opus")) return "claude-opus-4";
  if (modelId.includes("sonnet")) return "claude-sonnet-4";
  if (modelId.includes("haiku")) return "claude-haiku-4";
  return modelId; // GPT ids and exact table keys pass through unchanged
}

// Anthropic cache-token pricing multipliers relative to base input price.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Compute the USD cost for a single skill execution, including prompt-cache tokens.
 * Cache reads are billed at 0.1x the base input rate; cache writes at 1.25x.
 */
export function computeExecutionCostUSD(input: {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): { totalCost: number; modelId: string } {
  const key = normalizeModelId(input.model ?? DEFAULT_MODEL_ID);
  const entry = LLM_COST_TABLE[key] ?? LLM_COST_TABLE[DEFAULT_MODEL_ID]!;
  const inPerTok = entry.inputCostPer1K / 1000;
  const outPerTok = entry.outputCostPer1K / 1000;
  const totalCost =
    input.inputTokens * inPerTok +
    input.outputTokens * outPerTok +
    (input.cacheReadTokens ?? 0) * inPerTok * CACHE_READ_MULTIPLIER +
    (input.cacheCreationTokens ?? 0) * inPerTok * CACHE_WRITE_MULTIPLIER;
  return { totalCost, modelId: input.model ?? DEFAULT_MODEL_ID };
}
```

- [ ] **Step 4: Run it — verify PASS.** `pnpm --filter @switchboard/core test -- llm-costs` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/telemetry/llm-costs.ts packages/core/src/telemetry/llm-costs.test.ts
git commit -m "feat(core): add cache-aware per-execution cost computation"
```

### Task A4: Telemetry recorder (refactor TracePersistenceHook) + trace/store types + metrics counter

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts` (`SkillHookContext`, `SkillExecutionTrace.tokenUsage`)
- Modify: `packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts`
- Modify: `packages/db/src/stores/prisma-execution-trace-store.ts` (`ExecutionTraceInput.tokenUsage`)
- Modify: `packages/core/src/telemetry/metrics.ts` (`SwitchboardMetrics` + `createInMemoryMetrics`)
- Modify: `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts` (dual-prom — keep in sync)
- Test: `packages/core/src/skill-runtime/hooks/trace-persistence-hook.test.ts`

- [ ] **Step 1: Extend `SkillHookContext` + trace `tokenUsage`.** In `types.ts`:
  - Add to `SkillHookContext` (after `trustScore`): `inputParametersHash?: string;`
  - Change `SkillExecutionTrace.tokenUsage` (line 168) to ride the JSON column (no migration):
    ```ts
    tokenUsage: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
      costUsd?: number;
      model?: string;
    };
    ```

- [ ] **Step 2: Mirror the store's local type.** In `prisma-execution-trace-store.ts`, change `ExecutionTraceInput.tokenUsage` (line 17) to the same widened shape:

```ts
  tokenUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
    costUsd?: number;
    model?: string;
  };
```

(No Prisma schema change — `tokenUsage` is a JSON column written `as never`.)

- [ ] **Step 3: Add the metrics counter (core).** In `metrics.ts`, add to `SwitchboardMetrics` (after `bookingCancel`): `skillLlmTokensTotal: Counter;` and to `createInMemoryMetrics()`: `skillLlmTokensTotal: new InMemoryCounter(),`.

- [ ] **Step 4: Add the counter to BOTH prom registries.** In `apps/api/src/metrics.ts` and `apps/chat/src/bootstrap/metrics.ts`, add (mirroring an existing `PromCounter` entry like `rawErrorFallback`):

```ts
    skillLlmTokensTotal: new PromCounter(
      "switchboard_skill_llm_tokens_total",
      "LLM tokens per skill execution, labeled by model and kind (input/output/cache_read/cache_creation)",
      ["model", "kind"],
    ),
```

- [ ] **Step 5: Write failing recorder tests.** Replace the body of `trace-persistence-hook.test.ts` to reflect the new behavior (per-call id; reads `ctx.inputParametersHash`; persists cache+cost+model; emits the counter). Key assertions:

```ts
it("mints a distinct trace id per execution", async () => {
  const created: any[] = [];
  const store = {
    create: async (t: any) => {
      created.push(t);
    },
  };
  const hook = new TracePersistenceHook(store, { trigger: "chat_message" });
  const ctx = baseCtx({ inputParametersHash: "h1" });
  await hook.afterSkill(
    ctx,
    resultWith({ input: 10, output: 5, cacheRead: 800, model: "claude-haiku-4-5-20251001" }),
  );
  await hook.afterSkill(ctx, resultWith({ input: 10, output: 5 }));
  expect(created[0].id).not.toEqual(created[1].id);
  expect(created[0].inputParametersHash).toBe("h1");
  expect(created[0].tokenUsage.cacheRead).toBe(800);
  expect(typeof created[0].tokenUsage.costUsd).toBe("number");
  expect(created[0].tokenUsage.model).toBe("claude-haiku-4-5-20251001");
});

it("emits the token counter labeled by model+kind", async () => {
  const metrics = createInMemoryMetrics();
  setMetrics(metrics);
  const hook = new TracePersistenceHook({ create: async () => {} }, { trigger: "chat_message" });
  await hook.afterSkill(
    baseCtx({}),
    resultWith({ input: 100, output: 20, cacheRead: 5000, model: "claude-sonnet-4-6" }),
  );
  // InMemoryCounter aggregates; assert it was incremented (value > 0)
  expect((metrics.skillLlmTokensTotal as any).get?.() ?? 1).toBeGreaterThan(0);
});

it("never throws when the store fails", async () => {
  const hook = new TracePersistenceHook(
    {
      create: async () => {
        throw new Error("db down");
      },
    },
    { trigger: "chat_message" },
  );
  await expect(
    hook.afterSkill(baseCtx({}), resultWith({ input: 1, output: 1 })),
  ).resolves.toBeUndefined();
});
```

(Define `baseCtx`/`resultWith` helpers inline. Note the constructor now takes `{ trigger }` only — no `inputParametersHash`.)

- [ ] **Step 6: Run it — verify FAIL.** `pnpm --filter @switchboard/core test -- trace-persistence-hook` → FAIL.

- [ ] **Step 7: Implement the refactor.** Replace `trace-persistence-hook.ts` with:

```ts
import type {
  SkillHook,
  SkillHookContext,
  SkillExecutionResult,
  SkillExecutionTrace,
} from "../types.js";
import { createId } from "@paralleldrive/cuid2";
import { computeExecutionCostUSD } from "../../telemetry/llm-costs.js";
import { getMetrics } from "../../telemetry/metrics.js";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

/**
 * Persists a per-execution telemetry row (tokens incl. cache, cost, model, latency,
 * turn count, status) and emits the per-model token counter. Invoked DIRECTLY by the
 * executor as a dedicated arg (the `qualificationEvaluationHook` template) — NOT via
 * `runAfterSkillHooks`, so it never activates the governance afterSkill gates.
 */
export class TracePersistenceHook implements Pick<SkillHook, "afterSkill" | "onError"> {
  readonly name = "trace-persistence";

  constructor(
    private traceStore: ExecutionTraceStore,
    private traceContext: { trigger: "chat_message" | "batch_job" },
  ) {}

  async afterSkill(ctx: SkillHookContext, result: SkillExecutionResult): Promise<void> {
    const model = result.trace.model;
    const cacheRead = result.tokenUsage.cacheRead ?? 0;
    const cacheCreation = result.tokenUsage.cacheCreation ?? 0;
    const { totalCost } = computeExecutionCostUSD({
      model,
      inputTokens: result.tokenUsage.input,
      outputTokens: result.tokenUsage.output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
    });
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: ctx.inputParametersHash ?? "",
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: {
        input: result.tokenUsage.input,
        output: result.tokenUsage.output,
        cacheRead,
        cacheCreation,
        costUsd: totalCost,
        ...(model ? { model } : {}),
      },
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };
    this.emitTokenCounters(model ?? "unknown", trace.tokenUsage);
    try {
      await this.traceStore.create(trace);
    } catch (err) {
      console.error("[trace-persistence] persist failed (swallowed):", err);
    }
  }

  async onError(ctx: SkillHookContext, error: Error): Promise<void> {
    const status = error.name === "SkillExecutionBudgetError" ? "budget_exceeded" : "error";
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: ctx.deploymentId,
      organizationId: ctx.orgId,
      skillSlug: ctx.skillSlug,
      skillVersion: ctx.skillVersion,
      trigger: this.traceContext.trigger,
      sessionId: ctx.sessionId,
      inputParametersHash: ctx.inputParametersHash ?? "",
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
      await this.traceStore.create(trace);
    } catch (err) {
      console.error("[trace-persistence] error-trace persist failed (swallowed):", err);
    }
  }

  private emitTokenCounters(
    model: string,
    usage: { input: number; output: number; cacheRead?: number; cacheCreation?: number },
  ): void {
    const m = getMetrics();
    m.skillLlmTokensTotal.inc({ model, kind: "input" }, usage.input);
    m.skillLlmTokensTotal.inc({ model, kind: "output" }, usage.output);
    if (usage.cacheRead) m.skillLlmTokensTotal.inc({ model, kind: "cache_read" }, usage.cacheRead);
    if (usage.cacheCreation)
      m.skillLlmTokensTotal.inc({ model, kind: "cache_creation" }, usage.cacheCreation);
  }
}
```

- [ ] **Step 8: Run it — verify PASS.** `pnpm --filter @switchboard/core test -- trace-persistence-hook` → PASS. Also run `pnpm --filter @switchboard/db test -- prisma-execution-trace-store` if a test exists (type-only change; should still pass under mocked Prisma).

- [ ] **Step 9: Commit.**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/hooks/trace-persistence-hook.ts packages/db/src/stores/prisma-execution-trace-store.ts packages/core/src/telemetry/metrics.ts apps/api/src/metrics.ts apps/chat/src/bootstrap/metrics.ts packages/core/src/skill-runtime/hooks/trace-persistence-hook.test.ts
git commit -m "feat(core): telemetry recorder persists cache/cost/model + emits token counter"
```

### Task A5: Wire the recorder into the executor (isolated, log-and-swallow, never breaks the response)

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (constructor + a new hookCtx + success/error invocation)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts`

- [ ] **Step 1: Write failing tests.** In `skill-executor.test.ts` add:

```ts
it("invokes the execution trace hook with the result on success", async () => {
  const calls: any[] = [];
  const traceHook = {
    afterSkill: async (_c: any, r: any) => {
      calls.push(r);
    },
    onError: async () => {},
  };
  const exec = new SkillExecutorImpl(
    okAdapter(),
    tools,
    undefined,
    [],
    undefined,
    new Map(),
    undefined,
    traceHook,
  );
  await exec.execute(baseParams());
  expect(calls).toHaveLength(1);
});

it("a throwing trace hook does NOT break the response", async () => {
  const traceHook = {
    afterSkill: async () => {
      throw new Error("telemetry down");
    },
    onError: async () => {},
  };
  const exec = new SkillExecutorImpl(
    okAdapter(),
    tools,
    undefined,
    [],
    undefined,
    new Map(),
    undefined,
    traceHook,
  );
  const result = await exec.execute(baseParams());
  expect(result.response).toBeDefined();
});

it("invokes onError when the turn throws", async () => {
  const errors: any[] = [];
  const traceHook = {
    afterSkill: async () => {},
    onError: async (_c: any, e: Error) => {
      errors.push(e);
    },
  };
  // adapter that always returns tool_use to exhaust maxToolCalls / budget → throws SkillExecutionBudgetError
  const exec = new SkillExecutorImpl(
    budgetBustingAdapter(),
    tools,
    undefined,
    [],
    { ...DEFAULT_SKILL_RUNTIME_POLICY, maxLlmTurns: 1, maxTotalTokens: 1 },
    new Map(),
    undefined,
    traceHook,
  );
  await expect(exec.execute(baseParams())).rejects.toThrow();
  expect(errors).toHaveLength(1);
});
```

(Reuse existing test helpers / mock adapters in the file; add `budgetBustingAdapter` if needed — an adapter returning `usage:{inputTokens:1000,outputTokens:1000}` so the `maxTotalTokens:1` budget throws.)

- [ ] **Step 2: Run — verify FAIL.** `pnpm --filter @switchboard/core test -- skill-executor` → FAIL (8th arg unknown / hook not invoked).

- [ ] **Step 3: Implement.** In `skill-executor.ts`:
  - Add the 8th constructor arg (after `qualificationEvaluationHook`):
    ```ts
    /**
     * Optional execution-trace recorder, invoked at the success-return and on a
     * thrown turn. Mirrors `qualificationEvaluationHook`: a SEPARATE arg (not in
     * the `hooks` array) so it cannot activate the governance afterSkill gates.
     * Failures are log-and-swallow — telemetry must never change the response.
     */
    private executionTraceHook?: Pick<SkillHook, "afterSkill" | "onError">,
    ```
  - Near the top of `execute()` (after `requestCtx` is built, ~line 201), build a hook context once:
    ```ts
    const hookCtx: SkillHookContext = {
      deploymentId: params.deploymentId,
      orgId: params.orgId,
      skillSlug: params.skill.slug,
      skillVersion: params.skill.version,
      sessionId: requestCtx.sessionId,
      trustLevel: params.trustLevel,
      trustScore: params.trustScore,
      inputParametersHash: stableParamsHash(params.parameters),
    };
    ```
    Add a small stable hash helper near the top of the file (check `packages/core/src/platform/work-trace-hash.ts` first; if it exports a suitable single-value hash, import + reuse it instead of defining this):
    ```ts
    function stableParamsHash(parameters: unknown): string {
      const s = JSON.stringify(parameters ?? {});
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(16);
    }
    ```
  - Wrap the `while` loop body in `try { … } catch (err) { … }`. Immediately before the success `return { … }` (line 330), insert:
    ```ts
    if (this.executionTraceHook) {
      await this.executionTraceHook
        .afterSkill?.(hookCtx /* the result object being returned */)
        ?.catch((e: unknown) =>
          console.warn("[SkillExecutor] trace hook afterSkill failed (swallowed):", e),
        );
    }
    ```
    To do this cleanly, assign the return object to a `const result: SkillExecutionResult = { … }` first, call the hook with `result`, then `return result;`.
  - In the `catch (err)` wrapping the loop, before re-throwing:
    ```ts
      } catch (err) {
        if (this.executionTraceHook?.onError) {
          await this.executionTraceHook
            .onError(hookCtx, err instanceof Error ? err : new Error(String(err)))
            .catch((e: unknown) =>
              console.warn("[SkillExecutor] trace hook onError failed (swallowed):", e),
            );
        }
        throw err;
      }
    ```
  - Ensure `SkillHookContext` is imported in `skill-executor.ts` (add to the `./types.js` import).

- [ ] **Step 4: Run — verify PASS.** `pnpm --filter @switchboard/core test -- skill-executor` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat(core): wire execution-trace recorder into executor (isolated, swallow-safe)"
```

### Task A6: Construct + register the recorder in the live bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts` (~line 572 executor construction)
- Test: the existing bootstrap guard test (mirror the `qualificationEvaluationHook`/router wiring test pattern in `apps/api`), or add `apps/api/src/bootstrap/skill-mode.trace-wiring.test.ts`

- [ ] **Step 1: Write failing wiring test.** Add a test that builds the skill mode (or calls a small exported factory) and asserts the live `SkillExecutorImpl` was constructed with a non-undefined 8th arg. If the bootstrap exposes no seam, assert indirectly via a spy on `SkillExecutorImpl`’s constructor (mirror the existing router-wiring guard test added in PR #783 — find it: `grep -rn "model-router-factory\|arg-3\|modelRouter" apps/api/src/bootstrap/*.test.ts`).

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement.** In `skill-mode.ts`, before the executor construction (line 572), construct the recorder (find the prisma client handle already used in the bootstrap — `grep -n "prisma" apps/api/src/bootstrap/skill-mode.ts`):

```ts
const { PrismaExecutionTraceStore } = await import("@switchboard/db");
const tracePersistenceHook = new TracePersistenceHook(new PrismaExecutionTraceStore(prisma), {
  trigger: "chat_message",
});
```

Then pass it as the 8th arg:

```ts
const skillExecutor = new SkillExecutorImpl(
  adapter,
  toolsMap,
  modelRouter,
  hooks,
  undefined,
  toolFactories,
  qualificationEvaluationHook,
  tracePersistenceHook,
);
```

Add the import: `import { TracePersistenceHook } from "@switchboard/core/skill-runtime";` (verify the barrel exports it; if not, export it from `packages/core/src/skill-runtime/index.ts`). Leave the **simulation** executor (line 707) without the 8th arg.

- [ ] **Step 4: Run — verify PASS + typecheck.** `pnpm --filter @switchboard/api test -- skill-mode` and `pnpm --filter @switchboard/api typecheck`.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/bootstrap/skill-mode.ts packages/core/src/skill-runtime/index.ts apps/api/src/bootstrap/skill-mode.trace-wiring.test.ts
git commit -m "feat(api): wire TracePersistenceHook into the live skill executor"
```

---

## Concern B — T2.9 Re-key tiering on conversation depth + router-ON eval

### Task B1: Re-key `TierContext`/`resolveTier` on conversation depth

**Files:**

- Modify: `packages/core/src/model-router.ts` (`TierContext`, `resolveTier`)
- Modify: `packages/core/src/skill-runtime/skill-tier-context-builder.ts` (`TierContextInput`, `buildTierContext`)
- Test: `packages/core/src/__tests__/model-router-tier.test.ts`

- [ ] **Step 1: Update the failing tests first.** In `model-router-tier.test.ts`, change `messageIndex` → `conversationDepth` with the new semantics, and ADD the bug-catching case:

```ts
it("routes a first-contact greeting to default (Haiku)", () => {
  expect(
    router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4, hasHighRiskTools: true })),
  ).toBe("default");
});
it("routes a deep engaged tool-bearing turn to premium (Sonnet), NOT default", () => {
  expect(
    router.resolveTier(ctx({ conversationDepth: 6, toolCount: 4, hasHighRiskTools: true })),
  ).toBe("premium");
});
it("a tool-less skill stays default even when deep", () => {
  expect(
    router.resolveTier(ctx({ conversationDepth: 6, toolCount: 0, hasHighRiskTools: false })),
  ).toBe("default");
});
it("escalation raises to critical at any depth", () => {
  expect(
    router.resolveTier(ctx({ conversationDepth: 6, toolCount: 4, previousTurnEscalated: true })),
  ).toBe("critical");
});
// keep the existing stage-never-lowers + floor cases, re-expressed in conversationDepth terms:
it("fear raises even a first-contact greeting to critical", () => {
  expect(
    router.resolveTier(ctx({ conversationDepth: 1, toolCount: 4, currentStage: "fear" })),
  ).toBe("critical");
});
```

(Update the `ctx()` helper default key from `messageIndex` to `conversationDepth`.)

- [ ] **Step 2: Run — verify FAIL.** `pnpm --filter @switchboard/core test -- model-router-tier` → FAIL.

- [ ] **Step 3: Implement.** In `model-router.ts`, rename `TierContext.messageIndex` → `conversationDepth` (line 30) and replace `resolveTier` (lines 108-130) with:

```ts
  resolveTier(context: TierContext): ModelSlot {
    let slot: ModelSlot;
    if (context.previousTurnEscalated)
      slot = "critical"; // escalation → strong, any depth
    else if (context.previousTurnUsedTools)
      slot = "premium"; // processing a tool result → strong
    else if (context.conversationDepth <= 1)
      slot = "default"; // first-contact greeting → cheap
    else if (context.toolCount === 0)
      slot = "default"; // tool-less skill → cheap even when deep
    else slot = "premium"; // engaged, tool-bearing conversation → strong

    // Stage-aware escalation (rank-max; only ever raises).
    const stageSlot = this.stageToSlot(context.currentStage);
    if (stageSlot) slot = this.maxSlot(slot, stageSlot);

    return this.applyFloor(slot, context.modelFloor);
  }
```

Update the `TierContext` doc comment for `conversationDepth`:

```ts
/** Total user+assistant messages in the conversation incl. the current turn
 *  (≈ how deep the back-and-forth is). The tier baseline keys on this — NOT the
 *  intra-invocation LLM-loop counter (T2.9 fix). */
conversationDepth: number;
```

- [ ] **Step 4: Update `buildTierContext`.** In `skill-tier-context-builder.ts`, rename `TierContextInput.turnCount` → `conversationDepth` and map it straight through:

```ts
  // TierContextInput:
  conversationDepth: number;
  // buildTierContext return:
  conversationDepth: input.conversationDepth,
```

(Drop the old `messageIndex: input.turnCount` line.)

- [ ] **Step 5: Run — verify PASS.** `pnpm --filter @switchboard/core test -- model-router-tier` → PASS. (`skill-executor.ts` will not compile yet — that's Task B2; if the suite builds the whole package, expect a known type error at the `buildTierContext({ turnCount … })` call site. Implement B2 next before running the full core suite.)

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/model-router.ts packages/core/src/skill-runtime/skill-tier-context-builder.ts packages/core/src/__tests__/model-router-tier.test.ts
git commit -m "feat(core): re-key model tier on conversation depth, not the loop counter"
```

### Task B2: Feed conversation depth from the executor

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (`resolveProfile` + `execute`)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts`

- [ ] **Step 1: Write failing test.** Add a router-ON executor test with a fake recording adapter that captures `profile?.model`:

```ts
it("routes a deep neutral turn to Sonnet (premium), not Haiku, when the router is ON", async () => {
  const seen: (string | undefined)[] = [];
  const adapter = recordingAdapter(seen); // returns end_turn; pushes params.profile?.model
  const exec = new SkillExecutorImpl(adapter, alexLikeTools(), new ModelRouter(), []);
  await exec.execute(
    baseParams({
      messages: deepNeutralMessages(8), // 8 alternating msgs, final user msg has no price/fear/etc keyword
    }),
  );
  expect(seen[0]).toBe("claude-sonnet-4-6");
});
```

(`alexLikeTools()` = a tool map with a `calendar-book`/`crm-write` op whose `effectCategory` is `external_mutation` so `hasHighRiskTools` is true and `toolCount > 0`; `params.skill.tools` must list those ids.)

- [ ] **Step 2: Run — verify FAIL.** FAIL (deep turn → Haiku today).

- [ ] **Step 3: Implement.** In `skill-executor.ts`:
  - In `execute()`, derive depth once (next to `currentStage`, ~line 218):
    ```ts
    const conversationDepth = params.messages.length;
    ```
  - Change `resolveProfile`'s signature to take `conversationDepth: number` (replace the `turnCount` param usage for tiering), and pass it from the loop call site (line 223-229). Inside `resolveProfile`, replace the `buildTierContext({ turnCount: turnCount - 1, … })` (line 149-159) with:
    ```ts
    const tierCtx = buildTierContext({
      conversationDepth,
      declaredToolIds: params.skill.tools,
      tools: this.tools,
      previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
      previousTurnEscalated: logs.some(
        (log) => log.decision === "require-approval" || log.decision === "deny",
      ),
      minimumModelTier: params.skill.minimumModelTier,
      currentStage,
    });
    ```
    Keep `turnCount` as a param too (it still feeds `previousTurnHadToolUse`). Update the call site:
    ```ts
    const profile = this.resolveProfile(
      params,
      turnCount,
      conversationDepth,
      toolCallRecords,
      currentStage,
      governanceHook,
    );
    ```
    and the method signature accordingly.

- [ ] **Step 4: Run — verify PASS.** `pnpm --filter @switchboard/core test -- skill-executor` → PASS. Run the full core suite: `pnpm --filter @switchboard/core test` → green.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat(core): derive conversation depth from params.messages for tiering"
```

### Task B3: Router-ON eval variant (catches a silent Haiku downgrade)

**Files:**

- Create: `evals/alex-conversation/__tests__/router-tier.test.ts`
- (No `ci.yml` change — imports only `@switchboard/core`, already built in all 4 eval jobs.)

- [ ] **Step 1: Write the test.** It drives the real `SkillExecutorImpl` keying via a fake recording adapter (offline, deterministic):

```ts
import { describe, it, expect } from "vitest";
import {
  SkillExecutorImpl,
  ModelRouter,
  loadSkill,
  defaultSkillsDir,
} from "@switchboard/core/skill-runtime";

function recordingAdapter(seen: (string | undefined)[]) {
  return {
    async chatWithTools(p: any) {
      seen.push(p.profile?.model);
      return {
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

async function alexExecutor(seen: (string | undefined)[]) {
  const skill = await loadSkill("alex", defaultSkillsDir()); // production shape: 4 tools, no minimumModelTier
  // build the tool map the same way the harness does (reuse mock-tools or a minimal map with effectCategory)
  return {
    skill,
    exec: new SkillExecutorImpl(recordingAdapter(seen) as any, alexTools(), new ModelRouter(), []),
  };
}

describe("router-ON tier (T2.9 visibility)", () => {
  it("does NOT silently downgrade a deep neutral sales turn to Haiku", async () => {
    const seen: (string | undefined)[] = [];
    const { skill, exec } = await alexExecutor(seen);
    await exec.execute({
      skill,
      parameters: {},
      deploymentId: "d",
      orgId: "o",
      trustScore: 100,
      trustLevel: "autonomous",
      sessionId: "s",
      messages: deepNeutral(8), // final user msg neutral-worded
    });
    expect(seen[0]).not.toBe("claude-haiku-4-5-20251001");
    expect(seen[0]).toBe("claude-sonnet-4-6");
  });
  it("routes an explicit fear turn to Opus and an objection to Sonnet", async () => {
    // … two more cases asserting claude-opus-4-6 (fear) and claude-sonnet-4-6 (objection)
  });
});
```

Reuse the harness's existing tool-map construction (`evals/alex-conversation/mock-tools.ts`) for `alexTools()` so `params.skill.tools` matches the real declared ids and `hasHighRiskTools` is true. If `loadSkill`/`defaultSkillsDir` are not exported from the barrel, import from the harness's existing skill-loading path (`grep -rn "loadSkill" evals/alex-conversation`).

- [ ] **Step 2: Run — verify it encodes the contract.** `pnpm exec vitest run --config evals/vitest.config.ts -- router-tier`. Because Tasks B1/B2 already landed, this should PASS. To prove it catches the bug, temporarily revert B1's `resolveTier` (or assert via a comment) — confirm it would FAIL on the old loop-counter keying, then restore. (Document this in the test header comment; do not leave the revert.)

- [ ] **Step 3: Typecheck the eval package.** `pnpm --filter @switchboard/eval-alex-conversation typecheck` → clean.

- [ ] **Step 4: Commit.**

```bash
git add evals/alex-conversation/__tests__/router-tier.test.ts
git commit -m "test(eval): router-ON variant catches a silent Haiku downgrade on deep turns"
```

---

## Concern C — T2.3 Timeout / abort / retries

### Task C1: Thread an AbortSignal + request options into the adapter

**Files:**

- Modify: `packages/core/src/skill-runtime/llm-types.ts` (`ToolCallingLLMAdapter.chatWithTools` param)
- Modify: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts` (method param + `messages.create` options)
- Test: `packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.test.ts`

- [ ] **Step 1: Extend the param types.** In `llm-types.ts`, add `signal?: AbortSignal;` to the `chatWithTools` param object (after `profile?`). Mirror the same addition in the adapter's method signature (`anthropic-tool-adapter.ts:116-122`).

- [ ] **Step 2: Write failing test.** Assert the adapter passes `{ signal, timeout, maxRetries }` as the SECOND arg to `messages.create`:

```ts
it("passes signal, per-request timeout and explicit maxRetries to the SDK", async () => {
  const create = vi
    .fn()
    .mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  const adapter = new AnthropicToolAdapter({ messages: { create } } as never);
  const ctrl = new AbortController();
  await adapter.chatWithTools({
    system: "s",
    messages: [{ role: "user", content: "x" }],
    tools: [],
    signal: ctrl.signal,
    profile: { model: "claude-sonnet-4-6", maxTokens: 2048, temperature: 0.5, timeoutMs: 25000 },
  });
  const opts = create.mock.calls[0][1];
  expect(opts.signal).toBe(ctrl.signal);
  expect(opts.timeout).toBe(25000);
  expect(opts.maxRetries).toBe(1);
});
```

- [ ] **Step 3: Run — verify FAIL.**

- [ ] **Step 4: Implement.** In `anthropic-tool-adapter.ts`, change the `messages.create` call (line 148) to pass a second options arg:

```ts
const response = await this.client.messages.create(
  {
    model: params.profile?.model ?? DEFAULT_MODEL,
    max_tokens: params.profile?.maxTokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    messages: anthropicMessages,
    tools: anthropicTools,
    temperature: params.profile?.temperature ?? DEFAULT_TEMPERATURE,
  },
  {
    ...(params.signal ? { signal: params.signal } : {}),
    ...(params.profile?.timeoutMs ? { timeout: params.profile.timeoutMs } : {}),
    maxRetries: 1,
  },
);
```

- [ ] **Step 5: Run — verify PASS.** `pnpm --filter @switchboard/core test -- anthropic-tool-adapter` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/skill-runtime/llm-types.ts packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.ts packages/core/src/skill-runtime/adapters/anthropic-tool-adapter.test.ts
git commit -m "feat(core): pass abort signal, per-request timeout, explicit retries to the SDK"
```

### Task C2: Policy + router timeout values

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts` (`SkillRuntimePolicy`, `DEFAULT_SKILL_RUNTIME_POLICY`)
- Modify: `packages/core/src/model-router.ts` (per-slot `timeoutMs`)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts` / `model-router` tests

- [ ] **Step 1: Write failing tests.** Assert the new defaults:

```ts
expect(DEFAULT_SKILL_RUNTIME_POLICY.maxRuntimeMs).toBe(120_000);
expect(DEFAULT_SKILL_RUNTIME_POLICY.maxLlmCallMs).toBe(30_000);
expect(new ModelRouter().resolve("premium").timeoutMs).toBe(25_000);
```

- [ ] **Step 2: Run — verify FAIL.**

- [ ] **Step 3: Implement.**
  - `types.ts`: add `maxLlmCallMs: number;` to `SkillRuntimePolicy`; set `maxLlmCallMs: 30_000` and change `maxRuntimeMs: 30_000` → `120_000` in `DEFAULT_SKILL_RUNTIME_POLICY`.
  - `model-router.ts`: give each slot a per-tier timeout. Add `timeoutMs` to each `SLOT_CONFIGS` entry (default 15_000, premium 25_000, critical 30_000, embedding 8_000) and change `resolve()` to use `timeoutMs: timeoutMs ?? base.timeoutMs ?? DEFAULT_TIMEOUT_MS` (so the per-slot value wins, the explicit option still overrides). Update the `SLOT_CONFIGS` type to include `timeoutMs`.
  - Update `BudgetEnforcementHook` only if it reads `maxRuntimeMs` for the per-call deadline — it does not (it checks elapsed vs `maxRuntimeMs`, which is now the whole-conversation budget; leave it).

- [ ] **Step 4: Run — verify PASS + full core suite.** `pnpm --filter @switchboard/core test` → green. (Check the existing `"enforces runtime timeout"` test, `skill-executor.test.ts:456`, still passes — its 35s mock now resolves under the 120s whole-conversation budget but is aborted by the 30s per-call deadline in Task C3; if C3 is not yet landed, this test may need its mock delay raised above 30s or its assertion kept against `maxLlmCallMs`. Land C3 before re-running the full suite.)

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/model-router.ts packages/core/src/skill-runtime/skill-executor.test.ts packages/core/src/__tests__/model-router-tier.test.ts
git commit -m "feat(core): split per-call vs whole-conversation budget; raise per-tier timeouts"
```

### Task C3: Abort the in-flight call on the per-call deadline

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (the Promise.race block ~244-275)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts`

- [ ] **Step 1: Write the failing live-path abort test.** Prove the in-flight call is actually aborted (not just that the race resolves):

```ts
it("aborts the in-flight LLM call when the per-call deadline fires", async () => {
  let receivedSignal: AbortSignal | undefined;
  const adapter = {
    async chatWithTools(p: any) {
      receivedSignal = p.signal;
      // never resolve on its own; only the abort/deadline should end the turn
      return new Promise((_res, rej) => {
        p.signal?.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    },
  };
  const policy = { ...DEFAULT_SKILL_RUNTIME_POLICY, maxLlmCallMs: 30, maxRuntimeMs: 60 };
  const exec = new SkillExecutorImpl(adapter as any, tools, undefined, [], policy);
  await expect(exec.execute(baseParams())).rejects.toThrow(SkillExecutionBudgetError);
  expect(receivedSignal?.aborted).toBe(true);
});
```

- [ ] **Step 2: Run — verify FAIL.** FAIL (signal never passed / never aborted).

- [ ] **Step 3: Implement.** Replace the remaining-time + Promise.race block (lines 248-275) with an AbortController-driven version (keep the race as a backstop so a non-cooperative adapter still unblocks):

```ts
const remainingMs = this.policy.maxRuntimeMs - (Date.now() - startTime);
if (remainingMs <= 0) {
  throw new SkillExecutionBudgetError(`Exceeded ${this.policy.maxRuntimeMs / 1000}s runtime limit`);
}
const perCallMs = Math.min(profile?.timeoutMs ?? this.policy.maxLlmCallMs, remainingMs);
const controller = new AbortController();
let timeoutId: ReturnType<typeof setTimeout>;
const response = await Promise.race([
  this.adapter.chatWithTools({
    system,
    messages,
    tools: toolDefinitions,
    profile,
    signal: controller.signal,
  }),
  new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(); // cancel the in-flight request — stop the token-burn leak
      reject(
        new SkillExecutionBudgetError(`Exceeded ${Math.round(perCallMs / 1000)}s per-call limit`),
      );
    }, perCallMs);
  }),
]).finally(() => {
  clearTimeout(timeoutId);
});
```

(`profile` is already in scope from `resolveProfile`. When the router is OFF, `profile` is `undefined` → `perCallMs = min(maxLlmCallMs, remainingMs)`, so the abort still works.)

- [ ] **Step 4: Run — verify PASS + full suite.** `pnpm --filter @switchboard/core test` → green (incl. the original `"enforces runtime timeout"` test — its 35s mock is now aborted by the 30s `maxLlmCallMs` deadline and still throws `SkillExecutionBudgetError`; adjust that test's mock delay to `40_000` if needed so it still represents an over-budget call).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "fix(core): abort the in-flight LLM call on the per-call deadline (stop token-burn leak)"
```

---

## Final verification (before review)

- [ ] **Full local gate from the worktree root:**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint
pnpm --filter @switchboard/eval-alex-conversation typecheck
pnpm exec vitest run --config evals/vitest.config.ts
```

- [ ] **Confirm prod-byte-identical-with-flag-off:** grep that all new tier logic stays behind `if (!this.router) return undefined` in `resolveProfile`; the telemetry recorder + abort apply regardless of the flag (intended).
- [ ] **Known pre-existing noise (NOT regressions):** apps/chat `gateway-bridge-attribution` flakes under full-suite load; db `pg_advisory`/ledger/greeting tests fail locally without Postgres (CI mocks Prisma). Note them, don't chase them.

## Spec coverage check

| Spec requirement                                                                                            | Task                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| Capture cache_read/cache_creation                                                                           | A1                       |
| Carry actual model up                                                                                       | A1, A2                   |
| Accumulate cache; budget stays full-price (`billableTokens`)                                                | A2                       |
| Cache-aware cost                                                                                            | A3                       |
| Wire `TracePersistenceHook` via isolated template; per-call traceId; persist cache+cost+model; Prom counter | A4, A5, A6               |
| Governance gates stay dormant (no `runAfterSkillHooks`)                                                     | A5 (separate arg)        |
| Re-key tier on conversation depth; compose with stage-raise                                                 | B1, B2                   |
| Router-ON eval variant (fails on a bad downgrade)                                                           | B3                       |
| Abort in-flight call; pass `profile.timeoutMs`; explicit retries                                            | C1, C3                   |
| Per-call vs whole-conversation budget; raise per-tier timeouts                                              | C2                       |
| Live-path abort test                                                                                        | C3                       |
| Dormant-gates finding surfaced (not fixed)                                                                  | spec §6 + PR description |
