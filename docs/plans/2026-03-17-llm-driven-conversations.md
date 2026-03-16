# LLM-Driven Conversations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scripted template responses in the lead bot with LLM-generated natural conversation, while keeping the existing state machine for lifecycle control.

**Architecture:** The state machine decides _when_ to transition (qualifying -> booking -> escalation). A new `LLMConversationEngine` decides _what to say_ within each state, using Claude Haiku with a warm clinic persona prompt. The engine receives state goals, business profile, conversation history, and lead profile, and returns natural language. Existing safety filters (medical claims, banned phrases, prompt injection) run on the output unchanged.

**Tech Stack:** Claude Haiku via Anthropic Messages API, existing ModelRouter for budget tracking, existing safety filter chain in `sendFilteredReply`.

---

### Task 1: Add State Goal Descriptions to Lead State Machine

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/lead-state-machine.ts:56-72`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/lead-state-machine.test.ts` (existing)

**Step 1: Add STATE_GOALS map and getGoalForState export**

Add this after the existing `STATE_TO_MOVE` map at line 72:

```typescript
/** Human-readable goal descriptions per state, used as LLM prompt context. */
export const STATE_GOALS: Record<LeadConversationState, string> = {
  [LeadConversationState.IDLE]: "Build rapport, understand why they're reaching out",
  [LeadConversationState.GREETING]: "Build rapport, understand why they're reaching out",
  [LeadConversationState.CLARIFYING]:
    "Understand which service they need — ask about goals, not just treatments",
  [LeadConversationState.QUALIFYING]:
    "Assess readiness naturally — weave timeline/budget questions into conversation",
  [LeadConversationState.SLOWDOWN_MODE]: "Re-engage with light touch — 'Still thinking about it?'",
  [LeadConversationState.OBJECTION_HANDLING]:
    "Acknowledge concern genuinely, provide relevant info, don't be pushy",
  [LeadConversationState.BOOKING_PUSH]:
    "Guide toward booking — suggest times, explain what to expect, reduce friction",
  [LeadConversationState.AWAITING_BOOKING]: "Be available, answer last questions, don't pressure",
  [LeadConversationState.POST_BOOKING]: "Confirm booking details, set expectations for the visit",
  [LeadConversationState.FOLLOW_UP_SCHEDULED]: "Check in warmly, see if they still need help",
  [LeadConversationState.ESCALATING]:
    "Warm handoff — explain a team member will follow up, set timing expectations",
  [LeadConversationState.HUMAN_ACTIVE]: "A team member is handling this conversation directly",
  [LeadConversationState.CLOSED_BOOKED]: "Booking confirmed — conversation complete",
  [LeadConversationState.CLOSED_UNRESPONSIVE]: "Lead went quiet — conversation closed",
  [LeadConversationState.REACTIVATION]:
    "Welcome them back warmly, understand if their needs changed",
};

export function getGoalForState(state: LeadConversationState): string {
  return STATE_GOALS[state];
}
```

**Step 2: Add test for getGoalForState**

Add to the existing test file:

```typescript
import { getGoalForState, LeadConversationState } from "../lead-state-machine.js";

describe("getGoalForState", () => {
  it("returns a goal for every state", () => {
    for (const state of Object.values(LeadConversationState)) {
      const goal = getGoalForState(state);
      expect(goal).toBeTruthy();
      expect(typeof goal).toBe("string");
    }
  });

  it("returns qualifying goal for QUALIFYING state", () => {
    const goal = getGoalForState(LeadConversationState.QUALIFYING);
    expect(goal).toContain("readiness");
  });
});
```

**Step 3: Run tests**

Run: `node_modules/.bin/vitest run cartridges/customer-engagement/src/conversation/__tests__/lead-state-machine.test.ts`
Expected: PASS

**Step 4: Export from cartridge index**

Check `cartridges/customer-engagement/src/index.ts` and add `getGoalForState` and `STATE_GOALS` to the exports if not already re-exported.

**Step 5: Commit**

```bash
git commit -m "feat: add LLM goal descriptions per lead state"
```

---

### Task 2: Create LLM Conversation Engine

**Files:**

- Create: `apps/chat/src/conversation/llm-conversation-engine.ts`
- Create: `apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMConversationEngine } from "../llm-conversation-engine.js";
import type { LLMConversationContext } from "../llm-conversation-engine.js";

describe("LLMConversationEngine", () => {
  let engine: LLMConversationEngine;

  beforeEach(() => {
    engine = new LLMConversationEngine({
      apiKey: "test-key",
      model: "claude-3-5-haiku-20241022",
    });
  });

  describe("buildSystemPrompt", () => {
    it("includes persona name and business name", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: {
          businessName: "Glow Clinic",
          personaName: "Sarah",
          services: "Botox ($300), Fillers ($500)",
          hours: "Mon-Fri 9am-5pm",
          address: "123 Main St",
          bookingMethod: "Online at glowclinic.com/book",
          faqs: "Q: Does it hurt? A: Most patients feel minimal discomfort.",
        },
        conversationHistory: [],
        userMessage: "hi",
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Sarah");
      expect(prompt).toContain("Glow Clinic");
      expect(prompt).toContain("Botox");
    });

    it("includes state goal in the prompt", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Assess readiness naturally",
        businessProfile: {
          businessName: "Test Clinic",
          personaName: "Amy",
        },
        conversationHistory: [],
        userMessage: "I want botox",
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Assess readiness naturally");
    });

    it("includes lead profile when provided", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: {
          businessName: "Test Clinic",
          personaName: "Amy",
        },
        conversationHistory: [],
        userMessage: "hi",
        leadProfile: {
          serviceInterest: "Teeth Whitening",
          timeline: "immediate",
        },
      };
      const prompt = engine.buildSystemPrompt(ctx);
      expect(prompt).toContain("Teeth Whitening");
    });
  });

  describe("buildUserPrompt", () => {
    it("includes conversation history and user message", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [
          { role: "user" as const, text: "hey" },
          { role: "assistant" as const, text: "Hi there! How can I help?" },
        ],
        userMessage: "I want to book something",
      };
      const prompt = engine.buildUserPrompt(ctx);
      expect(prompt).toContain("hey");
      expect(prompt).toContain("Hi there!");
      expect(prompt).toContain("I want to book something");
    });

    it("includes objection context when provided", () => {
      const ctx: LLMConversationContext = {
        stateGoal: "Acknowledge concern",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: [],
        userMessage: "too expensive",
        objectionContext: "Price concern — acknowledge, mention financing options",
      };
      const prompt = engine.buildUserPrompt(ctx);
      expect(prompt).toContain("financing");
    });

    it("caps conversation history at 10 messages", () => {
      const history = Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Message ${i}`,
      }));
      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Test", personaName: "Amy" },
        conversationHistory: history,
        userMessage: "latest",
      };
      const prompt = engine.buildUserPrompt(ctx);
      expect(prompt).not.toContain("Message 0");
      expect(prompt).toContain("Message 14");
    });
  });

  describe("generate (mocked)", () => {
    it("calls Anthropic API and returns response text", async () => {
      vi.stubGlobal("fetch", async () => ({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hey! How can I help you today?" }],
          usage: { input_tokens: 100, output_tokens: 15 },
        }),
      }));

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await engine.generate(ctx);
      expect(result.text).toBe("Hey! How can I help you today?");
      expect(result.usage?.promptTokens).toBe(100);
      expect(result.usage?.completionTokens).toBe(15);

      vi.restoreAllMocks();
    });

    it("returns fallback on API failure", async () => {
      vi.stubGlobal("fetch", async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }));

      const ctx: LLMConversationContext = {
        stateGoal: "Build rapport",
        businessProfile: { businessName: "Glow Clinic", personaName: "Sarah" },
        conversationHistory: [],
        userMessage: "hi",
      };

      const result = await engine.generate(ctx);
      expect(result.text).toBeTruthy();
      expect(result.usedLLM).toBe(false);

      vi.restoreAllMocks();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the LLM Conversation Engine**

```typescript
// ---------------------------------------------------------------------------
// LLM Conversation Engine — generates natural responses using Claude Haiku
// ---------------------------------------------------------------------------

import type { ModelRouter } from "../clinic/model-router-types.js";
import { detectPromptInjectionInOutput } from "../interpreter/injection-detector.js";

export interface BusinessProfile {
  businessName: string;
  personaName: string;
  services?: string;
  hours?: string;
  address?: string;
  bookingMethod?: string;
  faqs?: string;
}

export interface LLMConversationContext {
  stateGoal: string;
  businessProfile: BusinessProfile;
  conversationHistory: Array<{ role: "user" | "assistant"; text: string }>;
  userMessage: string;
  leadProfile?: Record<string, unknown>;
  objectionContext?: string;
}

export interface LLMConversationResult {
  text: string;
  usedLLM: boolean;
  usage?: { promptTokens: number; completionTokens: number };
}

interface EngineConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
}

export class LLMConversationEngine {
  private config: EngineConfig;
  private modelRouter: ModelRouter | null;

  constructor(config: EngineConfig, modelRouter?: ModelRouter) {
    this.config = config;
    this.modelRouter = modelRouter ?? null;
  }

  buildSystemPrompt(ctx: LLMConversationContext): string {
    const bp = ctx.businessProfile;
    const parts: string[] = [];

    parts.push(
      `You are ${bp.personaName} at ${bp.businessName}. You're the friendly face`,
      `people first talk to — warm, helpful, and genuinely happy to help.`,
      ``,
      `You talk like a real person at a local clinic, not a chatbot. Short`,
      `sentences. Natural responses. If someone says "hi" you don't launch`,
      `into a pitch — you just say hi back and ask how you can help.`,
    );

    // What you know
    parts.push(``, `## What you know`);
    if (bp.services) parts.push(`- Services: ${bp.services}`);
    if (bp.hours) parts.push(`- Hours: ${bp.hours}`);
    if (bp.address) parts.push(`- Location: ${bp.address}`);
    if (bp.bookingMethod) parts.push(`- Booking: ${bp.bookingMethod}`);
    if (bp.faqs) parts.push(``, bp.faqs);

    // About this person
    parts.push(``, `## About this person`);
    if (ctx.leadProfile && Object.keys(ctx.leadProfile).length > 0) {
      for (const [key, value] of Object.entries(ctx.leadProfile)) {
        if (value !== undefined && value !== null) {
          parts.push(`- ${key}: ${String(value)}`);
        }
      }
    } else {
      parts.push(`This is a new conversation.`);
    }

    // Behavior rules
    parts.push(
      ``,
      `## How to behave`,
      `- Be brief. 1-2 sentences usually. 3 max if they asked something detailed.`,
      `- Match their energy. If they're casual, be casual. If they're formal, adjust.`,
      `- Don't sell. Help. If they're a good fit, the booking happens naturally.`,
      `- Say "let me check with the team" if you're unsure. Never guess.`,
      `- If they mention anything medical (medications, pregnancy, conditions),`,
      `  let them know a provider will follow up personally.`,
      `- Use their name sometimes, not every message.`,
    );

    // Current goal
    parts.push(``, `## Right now`, ctx.stateGoal);

    return parts.join("\n");
  }

  buildUserPrompt(ctx: LLMConversationContext): string {
    const parts: string[] = [];

    // Conversation history (last 10 messages)
    const history = ctx.conversationHistory.slice(-10);
    if (history.length > 0) {
      parts.push(`Conversation so far:`);
      for (const msg of history) {
        const label = msg.role === "user" ? "Them" : "You";
        parts.push(`${label}: ${msg.text}`);
      }
      parts.push(``);
    }

    parts.push(`Their latest message: "${ctx.userMessage}"`);

    if (ctx.objectionContext) {
      parts.push(``, `Context: ${ctx.objectionContext}`);
    }

    parts.push(``, `Respond naturally. Stay focused on: ${ctx.stateGoal}`);

    return parts.join("\n");
  }

  async generate(ctx: LLMConversationContext, orgId?: string): Promise<LLMConversationResult> {
    if (!this.config.apiKey) {
      return this.fallback(ctx);
    }

    // Check budget
    if (this.modelRouter) {
      const canUse = await this.modelRouter.shouldUseLLM(orgId);
      if (!canUse) {
        return this.fallback(ctx);
      }
    }

    try {
      const systemPrompt = this.buildSystemPrompt(ctx);
      const userPrompt = this.buildUserPrompt(ctx);
      const result = await this.callAnthropic(systemPrompt, userPrompt);

      // Output injection check
      const injectionCheck = detectPromptInjectionInOutput(result.text);
      if (injectionCheck.detected) {
        console.warn(
          `[LLMConversationEngine] Injection detected in output: ${injectionCheck.patterns.join(", ")}`,
        );
        return this.fallback(ctx);
      }

      // Record usage
      if (this.modelRouter && result.usage) {
        await this.modelRouter.recordUsage(
          result.usage.promptTokens,
          result.usage.completionTokens,
          orgId,
        );
      }

      return {
        text: result.text,
        usedLLM: true,
        usage: result.usage,
      };
    } catch (err) {
      console.warn("[LLMConversationEngine] LLM call failed, using fallback:", err);
      return this.fallback(ctx);
    }
  }

  private async callAnthropic(
    system: string,
    user: string,
  ): Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const baseUrl = this.config.baseUrl ?? "https://api.anthropic.com";
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 200,
          system,
          messages: [{ role: "user", content: user }],
          temperature: this.config.temperature ?? 0.6,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      const text = data.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");

      return {
        text,
        usage: data.usage
          ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
          : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fallback(ctx: LLMConversationContext): LLMConversationResult {
    const name = ctx.businessProfile.personaName;
    const biz = ctx.businessProfile.businessName;
    return {
      text: `Hi! This is ${name} from ${biz}. How can I help you today?`,
      usedLLM: false,
    };
  }
}
```

**Step 4: Run tests**

Run: `node_modules/.bin/vitest run apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add LLM conversation engine for natural lead responses"
```

---

### Task 3: Expose State Goal from Router

**Files:**

- Modify: `cartridges/customer-engagement/src/conversation/router.ts:36-58`
- Test: `cartridges/customer-engagement/src/conversation/__tests__/router.test.ts` (existing)

**Step 1: Add stateGoal to RouterResponse**

At line 57 in `router.ts`, add a new field to the `RouterResponse` interface:

```typescript
  /** LLM goal description for the current state (if state machine enabled). */
  stateGoal?: string;
```

**Step 2: Import getGoalForState and set stateGoal in handleMessage return**

Add `getGoalForState` to the import from `./lead-state-machine.js` at line 13.

Then in `handleMessage()`, set `stateGoal` on the return value at line 291. Change the return block (lines 281-292) to include `stateGoal`:

```typescript
return {
  handled: true,
  responses,
  actionRequired,
  escalated,
  completed,
  sessionId: session.id,
  variables: currentState.variables,
  leadProfileUpdate: Object.keys(leadProfileUpdate).length > 0 ? leadProfileUpdate : undefined,
  machineState: session.machineState,
  stateGoal: session.machineState
    ? getGoalForState(session.machineState as LeadConversationState)
    : undefined,
};
```

**Step 3: Add test for stateGoal in RouterResponse**

In the existing router test file, add a test case that verifies `stateGoal` is populated when `machineState` is set:

```typescript
it("includes stateGoal in response when machine state is set", async () => {
  // After a message that triggers state machine advancement,
  // the response should include a stateGoal string
  const response = await router.handleMessage(/* existing test message */);
  if (response.machineState) {
    expect(response.stateGoal).toBeTruthy();
    expect(typeof response.stateGoal).toBe("string");
  }
});
```

**Step 4: Run tests**

Run: `node_modules/.bin/vitest run cartridges/customer-engagement/src/conversation/__tests__/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: expose state goal description in RouterResponse"
```

---

### Task 4: Integrate LLM Engine into Lead Handler

**Files:**

- Modify: `apps/chat/src/handlers/lead-handler.ts:29-44,69-107`
- Modify: `apps/chat/src/bootstrap.ts` (wire up engine)
- Test: `apps/chat/src/handlers/__tests__/lead-handler.test.ts` (existing)

This is the core integration. The lead handler currently sends `routerResponse.responses` (scripted templates) directly. We replace those with LLM-generated responses when the engine is available.

**Step 1: Add LLMConversationEngine to LeadHandlerDeps**

In `lead-handler.ts`, add the import and dependency:

```typescript
import type {
  LLMConversationEngine,
  LLMConversationContext,
} from "../conversation/llm-conversation-engine.js";

export interface LeadHandlerDeps {
  handoffStore?: HandoffStore | null;
  handoffNotifier?: HandoffNotifier | null;
  outcomePipeline?: OutcomePipeline | null;
  conversionBus?: ConversionBus | null;
  crmProvider?: CrmProvider | null;
  llmEngine?: LLMConversationEngine | null;
  businessProfile?: import("../conversation/llm-conversation-engine.js").BusinessProfile | null;
}
```

**Step 2: Replace template responses with LLM-generated responses**

After the router returns at line 71, and after deriving `primaryMove` at line 81, add LLM generation before the response loop. Replace lines 83-107 with:

```typescript
// Generate LLM response if engine is available
let responsesToSend = routerResponse.responses;
if (deps?.llmEngine && deps.businessProfile && routerResponse.stateGoal) {
  const conversation = await getThread(threadId);
  const history = (conversation?.messages ?? []).map((m) => ({
    role: m.role,
    text: m.text,
  }));

  const llmCtx: LLMConversationContext = {
    stateGoal: routerResponse.stateGoal,
    businessProfile: deps.businessProfile,
    conversationHistory: history,
    userMessage: message.text,
    leadProfile: conversation?.leadProfile
      ? (conversation.leadProfile as Record<string, unknown>)
      : undefined,
    objectionContext:
      primaryMove === "handle_objection" ? buildObjectionContext(routerResponse) : undefined,
  };

  const llmResult = await deps.llmEngine.generate(llmCtx, message.organizationId ?? undefined);
  if (llmResult.usedLLM) {
    responsesToSend = [llmResult.text];
  }
  // If LLM failed, fall through to template responses
}

// Send each response message back through the adapter (with post-generation validation)
for (const text of responsesToSend) {
  let finalText = text;
  if (dialogueMiddleware) {
    const result = dialogueMiddleware.afterGenerate(text, primaryMove, threadId);
    finalText = result.text;
  }
  await ctx.sendFilteredReply(threadId, finalText);
  await ctx.recordAssistantMessage(threadId, finalText);

  // Log response variant for A/B testing signal (C2)
  if (deps?.outcomePipeline) {
    try {
      await deps.outcomePipeline.logResponseVariant({
        sessionId: threadId,
        organizationId: inbound.organizationId,
        primaryMove,
        responseText: finalText,
        conversationState: routerResponse.machineState ?? undefined,
      });
    } catch {
      // Non-critical — don't block the response
    }
  }
}
```

**Step 3: Add helper function for objection context**

At the bottom of `lead-handler.ts`:

```typescript
function buildObjectionContext(response: RouterResponse): string {
  const vars = response.variables ?? {};
  const parts: string[] = [];
  if (vars["lastMessage"]) {
    parts.push(`They said: "${String(vars["lastMessage"])}"`);
  }
  parts.push("Acknowledge their concern genuinely. Don't dismiss or argue.");
  return parts.join(" ");
}
```

**Step 4: Update lead-handler test**

In `apps/chat/src/handlers/__tests__/lead-handler.test.ts`, add a test that verifies LLM engine integration:

```typescript
it("uses LLM engine when available and falls back to templates when not", async () => {
  const mockEngine = {
    generate: vi.fn().mockResolvedValue({
      text: "Hey! How can I help?",
      usedLLM: true,
      usage: { promptTokens: 100, completionTokens: 15 },
    }),
  };
  // ... call handleLeadMessage with mockEngine in deps
  // ... verify sendFilteredReply was called with LLM text
});
```

**Step 5: Run tests**

Run: `node_modules/.bin/vitest run apps/chat/src/handlers/__tests__/lead-handler.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: integrate LLM conversation engine into lead handler"
```

---

### Task 5: Wire Up Engine in Bootstrap

**Files:**

- Modify: `apps/chat/src/bootstrap.ts:240-310`

**Step 1: Create LLMConversationEngine in bootstrap**

After the `ResponseGenerator` creation (around line 310), add:

```typescript
// Create LLM Conversation Engine for lead bot natural responses
let llmConversationEngine:
  | import("./conversation/llm-conversation-engine.js").LLMConversationEngine
  | null = null;
if (llmConfig.apiKey) {
  const { LLMConversationEngine } = await import("./conversation/llm-conversation-engine.js");
  llmConversationEngine = new LLMConversationEngine(
    { ...llmConfig, maxTokens: 200, temperature: 0.6 },
    modelRouter,
  );
  console.warn("[Chat] LLMConversationEngine initialized (natural lead conversations enabled)");
}
```

**Step 2: Build business profile from resolved profile/skin**

```typescript
// Build business profile for LLM conversation context
let llmBusinessProfile: import("./conversation/llm-conversation-engine.js").BusinessProfile | null =
  null;
if (resolvedProfile) {
  const biz = resolvedProfile.profile?.business;
  llmBusinessProfile = {
    businessName: biz?.name ?? process.env["CLINIC_NAME"] ?? "our clinic",
    personaName: resolvedProfile.llmContext?.persona ?? "the team",
    services: biz?.services
      ?.map((s: { name: string; price?: string }) => (s.price ? `${s.name} (${s.price})` : s.name))
      .join(", "),
    hours: biz?.hours,
    address: biz?.address,
    bookingMethod: biz?.bookingUrl ?? biz?.phone,
    faqs: resolvedProfile.profile?.faqs
      ?.map((f: { question: string; answer: string }) => `Q: ${f.question}\nA: ${f.answer}`)
      .join("\n"),
  };
}
```

**Step 3: Pass engine and profile to lead handler deps**

Find where `handleLeadMessage` is called (in `runtime.ts` or `message-pipeline.ts`) and ensure `llmEngine` and `businessProfile` are passed in the deps object. This likely means adding them to the `LeadHandlerDeps` construction in the runtime.

**Step 4: Run full test suite**

Run: `node_modules/.bin/vitest run apps/chat/`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: wire up LLM conversation engine in chat bootstrap"
```

---

### Task 6: Typecheck and Integration Test

**Step 1: Run typecheck**

Run: `node_modules/.bin/tsc --project apps/chat/tsconfig.json --noEmit`
Expected: No errors

**Step 2: Run full project typecheck**

Run: `node_modules/.bin/tsc --project tsconfig.json --noEmit` (or equivalent)
Expected: No errors

**Step 3: Run all tests**

Run: `node_modules/.bin/vitest run`
Expected: All pass

**Step 4: Final commit**

```bash
git commit -m "chore: verify LLM conversation engine typecheck and tests"
```

---

## Summary

| File                                                                    | Action | Purpose                                                        |
| ----------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `cartridges/customer-engagement/src/conversation/lead-state-machine.ts` | Modify | Add `STATE_GOALS` map + `getGoalForState()`                    |
| `cartridges/customer-engagement/src/conversation/router.ts`             | Modify | Add `stateGoal` to `RouterResponse`                            |
| `apps/chat/src/conversation/llm-conversation-engine.ts`                 | Create | Core engine: builds prompts, calls Haiku, returns natural text |
| `apps/chat/src/conversation/__tests__/llm-conversation-engine.test.ts`  | Create | Tests for prompt building, API call, fallback                  |
| `apps/chat/src/handlers/lead-handler.ts`                                | Modify | Use LLM engine output instead of template responses            |
| `apps/chat/src/bootstrap.ts`                                            | Modify | Wire up engine + business profile                              |

**Safety preserved:** All LLM output passes through the existing `sendFilteredReply` chain (banned phrases, medical claim filter, prompt injection detection). The LLM engine also runs its own output injection check before returning.

**Fallback:** If the LLM call fails, times out, or gets injection-blocked, the handler falls through to the existing template responses. Zero degradation in the failure path.

**Cost:** Claude Haiku at 200 max output tokens. ~$0.01/conversation. Budget enforced by existing `ModelRouter`.
