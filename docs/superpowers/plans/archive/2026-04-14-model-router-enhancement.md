# Model Router Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `critical` slot and `resolveTier()` to ModelRouter, then wire tier resolution into the chat pipeline so each LLM call uses the cheapest appropriate model.

**Architecture:** Extend `ModelRouter` with a `TierContext` interface and 6 deterministic rules for tier selection. The two chat LLM call sites (`ResponseGenerator` and `LLMConversationEngine`) both use raw `fetch()` — they stay as-is for now but accept a model override parameter so the runtime can pass the resolved tier's model config. Full migration to `LlmCallWrapper` is deferred to a follow-up.

**Tech Stack:** TypeScript, Vitest, existing ModelRouter + LlmCallWrapper

**Spec:** Prompt 1 from user + `/Users/jasonljc/Library/CloudStorage/GoogleDrive-jasonljc@meta.com/My Drive/Second Brain/docs/superpowers/plans/2026-04-13-model-router.md`

---

### Task 1: Add critical slot + resolveTier() to ModelRouter

**Files:**

- Modify: `packages/core/src/model-router.ts`
- Create: `packages/core/src/__tests__/model-router-tier.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/model-router-tier.test.ts
import { describe, it, expect } from "vitest";
import { ModelRouter } from "../model-router.js";
import type { TierContext } from "../model-router.js";

describe("ModelRouter.resolveTier", () => {
  const router = new ModelRouter();

  function ctx(overrides: Partial<TierContext> = {}): TierContext {
    return {
      messageIndex: 5,
      toolCount: 1,
      hasHighRiskTools: false,
      previousTurnUsedTools: false,
      previousTurnEscalated: false,
      modelFloor: undefined,
      ...overrides,
    };
  }

  it("Rule 1: first message → default (greetings are cheap)", () => {
    expect(router.resolveTier(ctx({ messageIndex: 0 }))).toBe("default");
  });

  it("Rule 2: no tools → default (pure conversational)", () => {
    expect(router.resolveTier(ctx({ toolCount: 0 }))).toBe("default");
  });

  it("Rule 3: previous turn escalated → critical", () => {
    expect(router.resolveTier(ctx({ previousTurnEscalated: true }))).toBe("critical");
  });

  it("Rule 4: previous turn used tools → premium", () => {
    expect(router.resolveTier(ctx({ previousTurnUsedTools: true }))).toBe("premium");
  });

  it("Rule 5: has high risk tools → premium", () => {
    expect(router.resolveTier(ctx({ hasHighRiskTools: true }))).toBe("premium");
  });

  it("Rule 6: default for everything else", () => {
    expect(router.resolveTier(ctx())).toBe("default");
  });

  it("modelFloor overrides when resolved tier is lower", () => {
    expect(router.resolveTier(ctx({ messageIndex: 0, modelFloor: "premium" }))).toBe("premium");
  });

  it("modelFloor does not downgrade", () => {
    expect(router.resolveTier(ctx({ previousTurnEscalated: true, modelFloor: "default" }))).toBe(
      "critical",
    );
  });

  it("resolve('critical') returns opus config", () => {
    const config = router.resolve("critical");
    expect(config.modelId).toBe("claude-opus-4-6");
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run model-router-tier`
Expected: FAIL — `resolveTier` does not exist

- [ ] **Step 3: Implement**

Update `packages/core/src/model-router.ts`:

```typescript
export type ModelSlot = "default" | "premium" | "critical" | "embedding";

export interface ModelConfig {
  slot: ModelSlot;
  modelId: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  fallbackSlot?: ModelSlot;
}

export interface ResolveOptions {
  critical?: boolean;
  degradable?: boolean;
  timeoutMs?: number;
}

export interface TierContext {
  messageIndex: number;
  toolCount: number;
  hasHighRiskTools: boolean;
  previousTurnUsedTools: boolean;
  previousTurnEscalated: boolean;
  modelFloor?: ModelSlot;
}

const DEFAULT_TIMEOUT_MS = 8000;

const SLOT_CONFIGS: Record<ModelSlot, Omit<ModelConfig, "fallbackSlot" | "timeoutMs">> = {
  default: {
    slot: "default",
    modelId: "claude-haiku-4-5-20251001",
    maxTokens: 1024,
    temperature: 0.7,
  },
  premium: {
    slot: "premium",
    modelId: "claude-sonnet-4-6",
    maxTokens: 2048,
    temperature: 0.5,
  },
  critical: {
    slot: "critical",
    modelId: "claude-opus-4-6",
    maxTokens: 4096,
    temperature: 0.3,
  },
  embedding: {
    slot: "embedding",
    modelId: "voyage-3-large",
    maxTokens: 0,
    temperature: 0,
  },
};

const SLOT_RANK: Record<ModelSlot, number> = {
  default: 0,
  premium: 1,
  critical: 2,
  embedding: -1,
};

export class ModelRouter {
  resolve(slot: ModelSlot, options: ResolveOptions = {}): ModelConfig {
    const { critical = false, degradable, timeoutMs } = options;

    const effectiveSlot: ModelSlot = critical && slot === "default" ? "premium" : slot;

    const base = SLOT_CONFIGS[effectiveSlot];
    if (!base) {
      return { ...SLOT_CONFIGS.default, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS };
    }

    let fallbackSlot: ModelSlot | undefined;
    if (effectiveSlot === "default") {
      fallbackSlot = "premium";
    } else if (effectiveSlot === "premium" && degradable === true) {
      fallbackSlot = "default";
    }

    return {
      ...base,
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fallbackSlot,
    };
  }

  resolveTier(context: TierContext): ModelSlot {
    let slot: ModelSlot;

    // Rule 1: first message → default (greetings are cheap)
    if (context.messageIndex === 0) {
      slot = "default";
    }
    // Rule 2: no tools → default (pure conversational)
    else if (context.toolCount === 0) {
      slot = "default";
    }
    // Rule 3: previous turn escalated → critical
    else if (context.previousTurnEscalated) {
      slot = "critical";
    }
    // Rule 4: previous turn used tools → premium
    else if (context.previousTurnUsedTools) {
      slot = "premium";
    }
    // Rule 5: has high risk tools → premium
    else if (context.hasHighRiskTools) {
      slot = "premium";
    }
    // Rule 6: default for everything else
    else {
      slot = "default";
    }

    return this.applyFloor(slot, context.modelFloor);
  }

  private applyFloor(slot: ModelSlot, floor?: ModelSlot): ModelSlot {
    if (!floor) return slot;
    return (SLOT_RANK[floor] ?? 0) > (SLOT_RANK[slot] ?? 0) ? floor : slot;
  }
}
```

- [ ] **Step 4: Export TierContext from core index**

Add to `packages/core/src/index.ts` in the "Model Router" section:

```typescript
export type { TierContext } from "./model-router.js";
```

- [ ] **Step 5: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run model-router`
Expected: All tests PASS (both existing model-router.test.ts and new model-router-tier.test.ts)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/model-router.ts packages/core/src/__tests__/model-router-tier.test.ts packages/core/src/index.ts && git commit -m "feat(core): add critical slot + resolveTier() to ModelRouter"
```

---

### Task 2: Add model override to chat LLM call sites

**Files:**

- Modify: `apps/chat/src/conversation/llm-conversation-engine.ts`
- Modify: `apps/chat/src/composer/response-generator.ts`

- [ ] **Step 1: Add modelOverride parameter to LLMConversationEngine.generate()**

In `apps/chat/src/conversation/llm-conversation-engine.ts`, change the `generate` method signature and `callAnthropic` to use override values:

```typescript
async generate(
  ctx: LLMConversationContext,
  orgId?: string,
  modelOverride?: { model: string; maxTokens?: number; temperature?: number },
): Promise<LLMConversationResult> {
```

In the `callAnthropic` method, use the override when provided:

```typescript
private async callAnthropic(
  system: string,
  user: string,
  modelOverride?: { model: string; maxTokens?: number; temperature?: number },
): Promise<...> {
  // ...
  body: JSON.stringify({
    model: modelOverride?.model ?? this.config.model,
    max_tokens: modelOverride?.maxTokens ?? this.config.maxTokens ?? 200,
    // ...
    temperature: modelOverride?.temperature ?? this.config.temperature ?? 0.6,
  }),
```

Pass `modelOverride` through from `generate()` to `callAnthropic()`.

- [ ] **Step 2: Add modelOverride parameter to ResponseGenerator.generate()**

In `apps/chat/src/composer/response-generator.ts`, same pattern:

```typescript
async generate(
  context: ResponseContext,
  orgId?: string,
  modelOverride?: { model: string; maxTokens?: number; temperature?: number },
): Promise<GeneratedResponse> {
```

Pass through to `callLLM()` → `callAnthropic()` / `callOpenAI()`.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run`
Expected: All existing tests PASS (model override is optional, so callers that don't pass it are unaffected)

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/conversation/llm-conversation-engine.ts apps/chat/src/composer/response-generator.ts && git commit -m "feat(chat): add modelOverride parameter to LLM call sites"
```

---

### Task 3: Wire tier resolution into ChannelGateway

**Files:**

- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify: `packages/core/src/channel-gateway/types.ts`

- [ ] **Step 1: Add modelRouter to ChannelGatewayConfig**

In `packages/core/src/channel-gateway/types.ts`, add optional `modelRouter`:

```typescript
import type { ModelRouter, TierContext } from "../model-router.js";

export interface ChannelGatewayConfig {
  // ... existing fields ...
  modelRouter?: ModelRouter;
}
```

- [ ] **Step 2: Build TierContext and resolve tier in handleIncoming()**

In `packages/core/src/channel-gateway/channel-gateway.ts`, before creating the AgentRuntime, build context and resolve:

```typescript
// 5.6 Resolve model tier for cost optimization
const modelSlot =
  this.config.modelRouter?.resolveTier({
    messageIndex: allMessages.length - 1,
    toolCount: 0, // v1: default, will derive from handler capabilities later
    hasHighRiskTools: false, // v1: default
    previousTurnUsedTools: false, // v1: default
    previousTurnEscalated: false, // v1: default
    modelFloor: undefined,
  }) ?? "default";
const modelConfig = this.config.modelRouter?.resolve(modelSlot);
```

Then pass `modelConfig` to the llmAdapterFactory or directly to the runtime.

- [ ] **Step 3: Wire ModelRouter in gateway-bridge.ts**

In `apps/chat/src/gateway/gateway-bridge.ts`, pass the existing `modelRouter` instance to the ChannelGateway config:

```typescript
return new ChannelGateway({
  // ... existing config ...
  modelRouter,
});
```

The `modelRouter` is already instantiated in gateway-bridge.ts from the foundation gaps work.

- [ ] **Step 4: Verify tests pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core --filter @switchboard/chat test -- --run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/ apps/chat/src/gateway/gateway-bridge.ts && git commit -m "feat: wire ModelRouter tier resolution into ChannelGateway"
```
