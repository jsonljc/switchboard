# Phase 4: Lead Responder End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phases 1-3 together for the first complete LLM-powered conversational agent flow, validating the entire architecture before building 4 more agents.

**Architecture:** Rewrite LeadResponderHandler to support multi-turn LLM conversations on `message.received` events while preserving existing `lead.received` scoring flow. New dependencies (LLMAdapter, KnowledgeRetriever, ConversationStore) are injected via the existing `LeadResponderDeps` pattern. Tone presets and language directives are config-driven system prompt templates. Owner test chat mode uses the `dashboard` channel with correction ingestion.

**Tech Stack:** TypeScript/ESM, Vitest, @switchboard/core interfaces (LLMAdapter, ConversationStore, KnowledgeStore, EmbeddingAdapter)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/agents/src/agents/lead-responder/tone-presets.ts` | Create | 3 tone preset system prompt templates + type |
| `packages/agents/src/agents/lead-responder/language-directives.ts` | Create | 4 language directive strings + type |
| `packages/agents/src/agents/lead-responder/prompt-builder.ts` | Create | Assembles `ConversationPrompt` from tone, language, KB chunks, history |
| `packages/agents/src/agents/lead-responder/types.ts` | Modify | Add LLM/RAG/conversation deps to `LeadResponderDeps` |
| `packages/agents/src/agents/lead-responder/handler.ts` | Modify | Rewrite to support LLM-powered `message.received` flow |
| `packages/agents/src/agents/lead-responder/port.ts` | Modify | Add new config fields (tonePreset, language, confidenceThreshold, bookingLink) |
| `packages/agents/src/agents/lead-responder/index.ts` | Modify | Re-export new types |
| `packages/agents/src/agents/lead-responder/__tests__/tone-presets.test.ts` | Create | Tests for tone preset resolution |
| `packages/agents/src/agents/lead-responder/__tests__/language-directives.test.ts` | Create | Tests for language directive resolution |
| `packages/agents/src/agents/lead-responder/__tests__/prompt-builder.test.ts` | Create | Tests for prompt assembly |
| `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts` | Modify | Add LLM conversation flow tests, test mode tests |
| `packages/agents/src/index.ts` | Modify | Re-export new types (TonePreset, SupportedLanguage) |

---

### Task 1: Tone Presets

**Files:**
- Create: `packages/agents/src/agents/lead-responder/tone-presets.ts`
- Test: `packages/agents/src/agents/lead-responder/__tests__/tone-presets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/agents/lead-responder/__tests__/tone-presets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getTonePreset, TONE_PRESETS, type TonePreset } from "../tone-presets.js";

describe("tone presets", () => {
  it("returns warm-professional preset by default", () => {
    const preset = getTonePreset(undefined);
    expect(preset).toContain("friendly");
    expect(preset).toContain("receptionist");
  });

  it("returns warm-professional preset when specified", () => {
    const preset = getTonePreset("warm-professional");
    expect(preset).toContain("friendly");
    expect(preset).toContain("receptionist");
  });

  it("returns casual-conversational preset", () => {
    const preset = getTonePreset("casual-conversational");
    expect(preset).toContain("friend");
    expect(preset).toContain("texting");
  });

  it("returns direct-efficient preset", () => {
    const preset = getTonePreset("direct-efficient");
    expect(preset).toContain("concise");
    expect(preset).toContain("point");
  });

  it("falls back to warm-professional for unknown preset", () => {
    const preset = getTonePreset("nonexistent" as TonePreset);
    expect(preset).toBe(TONE_PRESETS["warm-professional"]);
  });

  it("exports all 3 preset keys", () => {
    expect(Object.keys(TONE_PRESETS)).toHaveLength(3);
    expect(Object.keys(TONE_PRESETS)).toEqual(
      expect.arrayContaining(["warm-professional", "casual-conversational", "direct-efficient"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/tone-presets.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/agents/src/agents/lead-responder/tone-presets.ts`:

```typescript
// ---------------------------------------------------------------------------
// Tone Presets — system prompt personality templates for Lead Responder
// ---------------------------------------------------------------------------

export type TonePreset = "warm-professional" | "casual-conversational" | "direct-efficient";

export const TONE_PRESETS: Record<TonePreset, string> = {
  "warm-professional": `You are a friendly, polished front desk receptionist at a premium med spa. You are warm, professional, and knowledgeable about all treatments and services. You put clients at ease while being informative. You never pressure — you guide. You use proper grammar and a welcoming tone.`,

  "casual-conversational": `You are a warm, knowledgeable friend texting back about a med spa you love. You're enthusiastic but genuine — you speak naturally, use casual language, and make people feel comfortable asking anything. You share info like you're chatting with a friend, not selling.`,

  "direct-efficient": `You are concise and helpful. Get to the point quickly while remaining friendly. You answer questions directly, provide specific information, and don't pad responses with unnecessary pleasantries. You respect the client's time.`,
};

const DEFAULT_PRESET: TonePreset = "warm-professional";

export function getTonePreset(preset: TonePreset | undefined): string {
  if (!preset) return TONE_PRESETS[DEFAULT_PRESET];
  return TONE_PRESETS[preset] ?? TONE_PRESETS[DEFAULT_PRESET];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/tone-presets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(agents): add tone preset templates for Lead Responder" --reason "add tone presets for Phase 4 | sl help commit"
```

---

### Task 2: Language Directives

**Files:**
- Create: `packages/agents/src/agents/lead-responder/language-directives.ts`
- Test: `packages/agents/src/agents/lead-responder/__tests__/language-directives.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/agents/lead-responder/__tests__/language-directives.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getLanguageDirective,
  LANGUAGE_DIRECTIVES,
  type SupportedLanguage,
} from "../language-directives.js";

describe("language directives", () => {
  it("returns English directive by default", () => {
    const directive = getLanguageDirective(undefined);
    expect(directive).toContain("English");
  });

  it("returns Malay directive for ms", () => {
    const directive = getLanguageDirective("ms");
    expect(directive).toContain("Malay");
  });

  it("returns Mandarin directive for zh", () => {
    const directive = getLanguageDirective("zh");
    expect(directive).toContain("Mandarin");
  });

  it("returns Singlish directive for en-sg", () => {
    const directive = getLanguageDirective("en-sg");
    expect(directive).toContain("Singlish");
  });

  it("falls back to English for unknown language", () => {
    const directive = getLanguageDirective("fr" as SupportedLanguage);
    expect(directive).toBe(LANGUAGE_DIRECTIVES.en);
  });

  it("exports all 4 language keys", () => {
    expect(Object.keys(LANGUAGE_DIRECTIVES)).toHaveLength(4);
    expect(Object.keys(LANGUAGE_DIRECTIVES)).toEqual(
      expect.arrayContaining(["en", "ms", "zh", "en-sg"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/language-directives.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/agents/src/agents/lead-responder/language-directives.ts`:

```typescript
// ---------------------------------------------------------------------------
// Language Directives — system prompt language instructions
// ---------------------------------------------------------------------------

export type SupportedLanguage = "en" | "ms" | "zh" | "en-sg";

export const LANGUAGE_DIRECTIVES: Record<SupportedLanguage, string> = {
  en: "Respond in English. Use clear, natural English appropriate for the chosen tone.",

  ms: "Respond in Malay (Bahasa Melayu). Use natural, conversational Malay. If the client writes in English, you may respond in the language they used.",

  zh: "Respond in Mandarin Chinese (简体中文). Use natural, conversational Mandarin. If the client writes in English, you may respond in the language they used.",

  "en-sg": "Respond in Singlish (Singapore English). Use natural Singlish expressions, particles (lah, leh, lor, meh), and local phrasing. Keep it authentic but understandable. If the client writes in formal English, match their register.",
};

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export function getLanguageDirective(language: SupportedLanguage | undefined): string {
  if (!language) return LANGUAGE_DIRECTIVES[DEFAULT_LANGUAGE];
  return LANGUAGE_DIRECTIVES[language] ?? LANGUAGE_DIRECTIVES[DEFAULT_LANGUAGE];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/language-directives.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(agents): add language directive templates for Lead Responder" --reason "add language directives for Phase 4 | sl help commit"
```

---

### Task 3: Prompt Builder

**Files:**
- Create: `packages/agents/src/agents/lead-responder/prompt-builder.ts`
- Test: `packages/agents/src/agents/lead-responder/__tests__/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/agents/lead-responder/__tests__/prompt-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildConversationPrompt } from "../prompt-builder.js";
import type { Message } from "@switchboard/core";
import type { RetrievedChunk } from "@switchboard/core";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    contactId: "c1",
    direction: "inbound",
    content: "Hello",
    timestamp: new Date().toISOString(),
    channel: "whatsapp",
    ...overrides,
  };
}

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    content: "We offer Botox treatments starting at $200",
    sourceType: "document",
    similarity: 0.85,
    ...overrides,
  };
}

describe("buildConversationPrompt", () => {
  it("builds prompt with default tone and language", () => {
    const prompt = buildConversationPrompt({
      history: [makeMessage()],
      chunks: [makeChunk()],
      tonePreset: undefined,
      language: undefined,
    });

    expect(prompt.systemPrompt).toContain("receptionist"); // warm-professional default
    expect(prompt.systemPrompt).toContain("English"); // en default
    expect(prompt.conversationHistory).toHaveLength(1);
    expect(prompt.retrievedContext).toHaveLength(1);
    expect(prompt.agentInstructions).toContain("Lead Responder");
  });

  it("uses specified tone preset", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: "casual-conversational",
      language: undefined,
    });

    expect(prompt.systemPrompt).toContain("friend");
    expect(prompt.systemPrompt).toContain("texting");
  });

  it("uses specified language", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: "zh",
    });

    expect(prompt.systemPrompt).toContain("Mandarin");
  });

  it("includes agent instructions about qualification signals", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
    });

    expect(prompt.agentInstructions).toContain("qualification");
    expect(prompt.agentInstructions).toContain("escalate");
  });

  it("includes booking link in instructions when provided", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      bookingLink: "https://calendly.com/medspa",
    });

    expect(prompt.agentInstructions).toContain("https://calendly.com/medspa");
  });

  it("includes test mode instructions when testMode is true", () => {
    const prompt = buildConversationPrompt({
      history: [],
      chunks: [],
      tonePreset: undefined,
      language: undefined,
      testMode: true,
    });

    expect(prompt.agentInstructions).toContain("test mode");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/prompt-builder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `packages/agents/src/agents/lead-responder/prompt-builder.ts`:

```typescript
// ---------------------------------------------------------------------------
// Prompt Builder — assembles ConversationPrompt for Lead Responder LLM calls
// ---------------------------------------------------------------------------

import type { ConversationPrompt, Message, RetrievedChunk } from "@switchboard/core";
import { getTonePreset, type TonePreset } from "./tone-presets.js";
import { getLanguageDirective, type SupportedLanguage } from "./language-directives.js";

export interface PromptBuildInput {
  history: Message[];
  chunks: RetrievedChunk[];
  tonePreset: TonePreset | undefined;
  language: SupportedLanguage | undefined;
  bookingLink?: string;
  testMode?: boolean;
}

const AGENT_INSTRUCTIONS = `You are the Lead Responder agent for a med spa business. Your job is to:
1. Answer questions about services, pricing, availability, and the business using ONLY the knowledge base context provided.
2. Watch for qualification signals: interest in specific treatments, budget mentions, urgency, booking intent.
3. If you detect qualification signals, mention them naturally in your response (the system will score separately).
4. If asked something outside your knowledge base context, say you'll check with the team — do NOT guess.
5. If the conversation becomes sensitive (medical advice, pricing exceptions, complaints), escalate immediately.
6. Never pressure the client. Guide them naturally toward booking.`;

const TEST_MODE_ADDENDUM = `\n\nYou are currently in test mode. The business owner is testing your responses. Answer exactly as you would with a real client. The owner may flag incorrect answers for correction.`;

export function buildConversationPrompt(input: PromptBuildInput): ConversationPrompt {
  const tone = getTonePreset(input.tonePreset);
  const language = getLanguageDirective(input.language);

  const systemPrompt = `${tone}\n\n${language}`;

  let instructions = AGENT_INSTRUCTIONS;

  if (input.bookingLink) {
    instructions += `\n\nBooking link: ${input.bookingLink} — share this when the client is ready to book.`;
  }

  if (input.testMode) {
    instructions += TEST_MODE_ADDENDUM;
  }

  return {
    systemPrompt,
    conversationHistory: input.history,
    retrievedContext: input.chunks,
    agentInstructions: instructions,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/prompt-builder.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(agents): add prompt builder for Lead Responder LLM calls" --reason "add prompt builder for Phase 4 | sl help commit"
```

---

### Task 4: Update LeadResponderDeps and Port

**Files:**
- Modify: `packages/agents/src/agents/lead-responder/types.ts`
- Modify: `packages/agents/src/agents/lead-responder/port.ts`
- Modify: `packages/agents/src/agents/lead-responder/index.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Update `types.ts` — add LLM/RAG/conversation dependencies**

Modify `packages/agents/src/agents/lead-responder/types.ts` to add the new optional dependencies for LLM-powered conversation mode. The existing `scoreLead`, `matchObjection`, `matchFAQ` deps remain unchanged — they are used for `lead.received` events. The new deps are used for `message.received` events.

```typescript
// ADD these imports at the top:
import type { LLMAdapter, ConversationStore, Message } from "@switchboard/core";
import type { KnowledgeRetriever } from "../../knowledge/retrieval.js";
import type { IngestionPipeline } from "../../knowledge/ingestion-pipeline.js";
import type { TonePreset } from "./tone-presets.js";
import type { SupportedLanguage } from "./language-directives.js";

// ADD this new interface after FAQMatch:

/**
 * Dependencies for LLM-powered conversation mode (message.received).
 * All optional — if not provided, message.received falls back to scoring-only mode.
 */
export interface LeadResponderConversationDeps {
  llm: LLMAdapter;
  retriever: KnowledgeRetriever;
  conversationStore: ConversationStore;
  ingestionPipeline?: IngestionPipeline;
}

// MODIFY LeadResponderDeps to add:
//   conversation?: LeadResponderConversationDeps;
```

The full updated `LeadResponderDeps` should look like:

```typescript
export interface LeadResponderDeps {
  scoreLead: (params: Record<string, unknown>) => LeadScore;
  matchObjection?: (text: string) => ObjectionMatch;
  matchFAQ?: (text: string) => FAQMatch;
  conversation?: LeadResponderConversationDeps;
}
```

- [ ] **Step 2: Update `port.ts` — add new config fields**

Modify `packages/agents/src/agents/lead-responder/port.ts` to add new config schema fields:

```typescript
configSchema: {
  qualificationThreshold: "number (default: 40)",
  maxTurnsBeforeEscalation: "number (default: 10)",
  tonePreset: "warm-professional | casual-conversational | direct-efficient (default: warm-professional)",
  language: "en | ms | zh | en-sg (default: en)",
  confidenceThreshold: "number 0-1 (default: 0.6)",
  bookingLink: "string (optional)",
  mode: "active | draft | test (default: active)",
},
```

- [ ] **Step 3: Update `index.ts` barrel — re-export new types**

Modify `packages/agents/src/agents/lead-responder/index.ts`:

```typescript
export { LEAD_RESPONDER_PORT } from "./port.js";
export { LeadResponderHandler } from "./handler.js";
export type {
  LeadResponderDeps,
  LeadResponderConversationDeps,
  LeadScore,
  ObjectionMatch,
  FAQMatch,
} from "./types.js";
export { getTonePreset, TONE_PRESETS, type TonePreset } from "./tone-presets.js";
export { getLanguageDirective, LANGUAGE_DIRECTIVES, type SupportedLanguage } from "./language-directives.js";
export { buildConversationPrompt, type PromptBuildInput } from "./prompt-builder.js";
```

- [ ] **Step 4: Update top-level `packages/agents/src/index.ts` barrel**

Add to the lead-responder re-export block:

```typescript
export {
  LEAD_RESPONDER_PORT,
  LeadResponderHandler,
  type LeadResponderDeps,
  type LeadResponderConversationDeps,
  type FAQMatch,
  type LeadScore,
  type ObjectionMatch,
  type TonePreset,
  type SupportedLanguage,
} from "./agents/lead-responder/index.js";
```

- [ ] **Step 5: Run typecheck to verify**

Run: `pnpm --filter @switchboard/agents typecheck`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
sl commit -m "feat(agents): add LLM conversation deps and config to Lead Responder" --reason "update Lead Responder types for Phase 4 | sl help commit"
```

---

### Task 5: Rewrite Lead Responder Handler

**Files:**
- Modify: `packages/agents/src/agents/lead-responder/handler.ts`
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

This is the core task. The handler must support two flows:

1. **`lead.received`** — existing scoring-only flow (unchanged)
2. **`message.received`** — new LLM-powered conversation flow:
   - Retrieve history from ConversationStore
   - Retrieve KB chunks via KnowledgeRetriever
   - Build ConversationPrompt with tone/language
   - Generate LLM reply
   - Compute dual-signal confidence
   - If confidence < threshold -> escalate (don't reply)
   - If qualification signals detected -> run scoreLead()
   - Emit messaging.whatsapp.send (or skip in test mode)
   - Append messages to conversation history

- [ ] **Step 1: Write failing tests for the LLM conversation flow**

Add the following tests to `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`. Add a new `describe("LLM conversation flow", ...)` block after the existing tests:

```typescript
// ADD these imports at the top:
import type { LLMAdapter, ConversationPrompt, LLMReply, ConversationStore, Message } from "@switchboard/core";
import type { KnowledgeRetriever, RetrieveOptions } from "../../../knowledge/retrieval.js";
import type { RetrievedChunk } from "@switchboard/core";
import type { LeadResponderConversationDeps } from "../types.js";

// ADD this helper after existing helpers:
function makeConversationDeps(
  overrides: Partial<LeadResponderConversationDeps> = {},
): LeadResponderConversationDeps {
  const mockStore: ConversationStore = {
    getHistory: vi.fn().mockResolvedValue([]),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    getStage: vi.fn().mockResolvedValue("lead"),
    setStage: vi.fn().mockResolvedValue(undefined),
    isOptedOut: vi.fn().mockResolvedValue(false),
    setOptOut: vi.fn().mockResolvedValue(undefined),
  };

  const mockLLM: LLMAdapter = {
    generateReply: vi.fn().mockResolvedValue({
      reply: "Thanks for your interest! We offer a range of treatments. What are you looking for?",
      confidence: 0.85,
    }),
  };

  const mockRetriever = {
    retrieve: vi.fn().mockResolvedValue([
      {
        content: "We offer Botox, fillers, and facials.",
        sourceType: "document" as const,
        similarity: 0.9,
      },
    ]),
  } as unknown as KnowledgeRetriever;

  return {
    llm: mockLLM,
    retriever: mockRetriever,
    conversationStore: mockStore,
    ...overrides,
  };
}

function makeMessageReceivedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "message.received",
    source: { type: "webhook", id: "whatsapp" },
    payload: {
      contactId: "c1",
      messageText: "What treatments do you offer?",
      ...payload,
    },
  });
}

// ADD this describe block:
describe("LLM conversation flow", () => {
  it("generates LLM reply for message.received when conversation deps present", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    // Should emit a messaging.whatsapp.send action
    const sendAction = result.actions.find(
      (a) => a.actionType === "messaging.whatsapp.send",
    );
    expect(sendAction).toBeDefined();
    expect(sendAction!.parameters.content).toContain("Thanks for your interest");

    // Should call LLM
    expect(convDeps.llm.generateReply).toHaveBeenCalledOnce();

    // Should retrieve knowledge chunks
    expect(convDeps.retriever.retrieve).toHaveBeenCalledWith(
      "What treatments do you offer?",
      expect.objectContaining({ organizationId: "org-1", agentId: "lead-responder" }),
    );
  });

  it("retrieves conversation history from store", async () => {
    const existingHistory: Message[] = [
      {
        id: "m1",
        contactId: "c1",
        direction: "inbound",
        content: "Hi",
        timestamp: "2026-03-21T00:00:00Z",
        channel: "whatsapp",
      },
      {
        id: "m2",
        contactId: "c1",
        direction: "outbound",
        content: "Hello!",
        timestamp: "2026-03-21T00:00:01Z",
        channel: "whatsapp",
      },
    ];

    const convDeps = makeConversationDeps({
      conversationStore: {
        getHistory: vi.fn().mockResolvedValue(existingHistory),
        appendMessage: vi.fn().mockResolvedValue(undefined),
        getStage: vi.fn().mockResolvedValue("lead"),
        setStage: vi.fn().mockResolvedValue(undefined),
        isOptedOut: vi.fn().mockResolvedValue(false),
        setOptOut: vi.fn().mockResolvedValue(undefined),
      },
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    // LLM should receive conversation history
    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: expect.arrayContaining([
          expect.objectContaining({ content: "Hi" }),
          expect.objectContaining({ content: "Hello!" }),
        ]),
      }),
    );
  });

  it("appends inbound and outbound messages to conversation store", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    // Should append 2 messages: inbound + outbound reply
    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledTimes(2);

    // First call: inbound message
    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ direction: "inbound", content: "What treatments do you offer?" }),
    );

    // Second call: outbound reply
    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ direction: "outbound" }),
    );
  });

  it("escalates when confidence below threshold", async () => {
    const convDeps = makeConversationDeps({
      llm: {
        generateReply: vi.fn().mockResolvedValue({ reply: "I'm not sure...", confidence: 0.3 }),
      },
      retriever: {
        retrieve: vi.fn().mockResolvedValue([
          { content: "Some info", sourceType: "document" as const, similarity: 0.5 },
        ]),
      } as unknown as KnowledgeRetriever,
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, { confidenceThreshold: 0.6 }, { organizationId: "org-1" });

    // Should escalate, not send reply
    const escalation = result.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(
      expect.objectContaining({ reason: "low_confidence" }),
    );

    // Should NOT send a WhatsApp message
    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("runs scoreLead and emits lead.qualified when score >= threshold", async () => {
    const scoreFn = vi.fn().mockReturnValue({ score: 75, tier: "hot", factors: [] });
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: scoreFn,
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent({
      messageText: "I really want Botox, what's the cost? I can come in this week.",
    });
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    // scoreLead always called for message.received to check qualification
    expect(scoreFn).toHaveBeenCalled();

    // High score -> lead.qualified event
    const qualified = result.events.find((e) => e.eventType === "lead.qualified");
    expect(qualified).toBeDefined();
  });

  it("transitions contact to qualified stage on qualification", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 75, tier: "hot", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.conversationStore.setStage).toHaveBeenCalledWith("c1", "qualified");
  });

  it("does not transition stage when score below threshold", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 20, tier: "cold", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(convDeps.conversationStore.setStage).not.toHaveBeenCalled();
  });

  it("uses tone preset and language from config", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(
      event,
      { tonePreset: "casual-conversational", language: "en-sg" },
      { organizationId: "org-1" },
    );

    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("friend"),
      }),
    );
    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Singlish"),
      }),
    );
  });

  it("escalates when max turns exceeded in conversation", async () => {
    const longHistory: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      contactId: "c1",
      direction: (i % 2 === 0 ? "inbound" : "outbound") as "inbound" | "outbound",
      content: `message ${i}`,
      timestamp: new Date().toISOString(),
      channel: "whatsapp" as const,
    }));

    const convDeps = makeConversationDeps({
      conversationStore: {
        getHistory: vi.fn().mockResolvedValue(longHistory),
        appendMessage: vi.fn().mockResolvedValue(undefined),
        getStage: vi.fn().mockResolvedValue("lead"),
        setStage: vi.fn().mockResolvedValue(undefined),
        isOptedOut: vi.fn().mockResolvedValue(false),
        setOptOut: vi.fn().mockResolvedValue(undefined),
      },
    });

    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { maxTurnsBeforeEscalation: 10 },
      { organizationId: "org-1" },
    );

    const escalation = result.events.find((e) => e.eventType === "conversation.escalated");
    expect(escalation).toBeDefined();
    expect(escalation!.payload).toEqual(
      expect.objectContaining({ reason: "max_turns_exceeded" }),
    );
  });

  it("falls back to scoring-only for message.received when no conversation deps", async () => {
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 80, tier: "hot", factors: [] }),
      // no conversation deps
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(event, {}, { organizationId: "org-1" });

    // Should still score and emit qualified/disqualified
    expect(result.events[0]!.eventType).toBe("lead.qualified");
    // No messaging action (no LLM)
    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/handler.test.ts`
Expected: FAIL — new tests fail (missing conversation flow logic)

- [ ] **Step 3: Rewrite handler to support LLM conversation flow**

Modify `packages/agents/src/agents/lead-responder/handler.ts`. The key changes:

1. Import new deps and prompt builder
2. Add a `handleMessageReceived` private method for the LLM flow
3. Keep existing `lead.received` path unchanged
4. On `message.received` with conversation deps: retrieve history -> retrieve chunks -> build prompt -> generate reply -> confidence check -> score -> emit actions

```typescript
// ---------------------------------------------------------------------------
// Lead Responder — Handler Implementation
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse, ActionRequest } from "../../ports.js";
import { validatePayload } from "../../validate-payload.js";
import { computeConfidence } from "../../knowledge/retrieval.js";
import { buildConversationPrompt } from "./prompt-builder.js";
import type { TonePreset } from "./tone-presets.js";
import type { SupportedLanguage } from "./language-directives.js";
import type { LeadResponderDeps, ObjectionMatch } from "./types.js";

const DEFAULT_THRESHOLD = 40;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export class LeadResponderHandler implements AgentHandler {
  constructor(private deps: LeadResponderDeps) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.received" && event.eventType !== "message.received") {
      return { events: [], actions: [] };
    }

    // message.received with conversation deps -> LLM conversation flow
    if (event.eventType === "message.received" && this.deps.conversation) {
      return this.handleMessageReceived(event, config, context);
    }

    // lead.received (or message.received without conversation deps) -> scoring-only flow
    return this.handleLeadScoring(event, config, context);
  }

  private async handleMessageReceived(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    const conv = this.deps.conversation!;
    const payload = validatePayload(
      event.payload,
      { contactId: "string", messageText: "string?" },
      "lead-responder",
    );
    const contactId = payload.contactId as string;
    const messageText = (payload.messageText as string) ?? "";
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;
    const confidenceThreshold =
      (config.confidenceThreshold as number) ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const maxTurns = (config.maxTurnsBeforeEscalation as number) ?? 10;
    const tonePreset = config.tonePreset as TonePreset | undefined;
    const language = config.language as SupportedLanguage | undefined;
    const bookingLink = config.bookingLink as string | undefined;
    const mode = (config.mode as string) ?? "active";
    const testMode = mode === "test" || mode === "draft";
    const channel = testMode ? "dashboard" : "whatsapp";

    // 1. Retrieve conversation history
    const history = await conv.conversationStore.getHistory(contactId);

    // 2. Check max turns
    if (history.length >= maxTurns) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "lead-responder" },
            payload: {
              contactId,
              reason: "max_turns_exceeded",
              turnCount: history.length,
            },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
      };
    }

    // 3. Append inbound message to history
    const inboundMessage = {
      id: randomUUID(),
      contactId,
      direction: "inbound" as const,
      content: messageText,
      timestamp: new Date().toISOString(),
      channel: channel as "whatsapp" | "dashboard",
    };
    await conv.conversationStore.appendMessage(contactId, inboundMessage);

    // 4. Retrieve relevant knowledge chunks
    const chunks = await conv.retriever.retrieve(messageText, {
      organizationId: context.organizationId,
      agentId: "lead-responder",
    });

    // 5. Build ConversationPrompt
    const prompt = buildConversationPrompt({
      history: [...history, inboundMessage],
      chunks,
      tonePreset,
      language,
      bookingLink,
      testMode,
    });

    // 6. Generate LLM reply
    const llmReply = await conv.llm.generateReply(prompt);

    // 7. Compute dual-signal confidence
    const bestSimilarity = chunks.length > 0 ? chunks[0]!.similarity : 0;
    const confidence = computeConfidence({
      bestSimilarity,
      llmSelfReport: llmReply.confidence,
    });

    const events: RoutedEventEnvelope[] = [];
    const actions: ActionRequest[] = [];

    // 8. Confidence check — escalate if below threshold
    if (confidence < confidenceThreshold) {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "conversation.escalated",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            reason: "low_confidence",
            confidence,
            bestSimilarity,
            llmSelfReport: llmReply.confidence,
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );

      return { events, actions };
    }

    // 9. Score lead for qualification signals
    const scoreResult = this.deps.scoreLead(payload as Record<string, unknown>);
    const qualified = scoreResult.score >= threshold;

    if (qualified) {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "lead.qualified",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            score: scoreResult.score,
            tier: scoreResult.tier,
            factors: scoreResult.factors,
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );

      // Transition stage
      await conv.conversationStore.setStage(contactId, "qualified");
    } else {
      events.push(
        createEventEnvelope({
          organizationId: context.organizationId,
          eventType: "lead.disqualified",
          source: { type: "agent", id: "lead-responder" },
          payload: {
            contactId,
            score: scoreResult.score,
            tier: scoreResult.tier,
            factors: scoreResult.factors,
            reason: "below_threshold",
          },
          correlationId: event.correlationId,
          causationId: event.eventId,
          attribution: event.attribution,
        }),
      );
    }

    // 10. Send reply (skip in test mode — dashboard shows it directly)
    if (!testMode) {
      actions.push({
        actionType: "messaging.whatsapp.send",
        parameters: {
          contactId,
          content: llmReply.reply,
          channel: "whatsapp",
        },
      });
    }

    // 11. Append outbound reply to history
    const outboundMessage = {
      id: randomUUID(),
      contactId,
      direction: "outbound" as const,
      content: llmReply.reply,
      timestamp: new Date().toISOString(),
      channel: channel as "whatsapp" | "dashboard",
    };
    await conv.conversationStore.appendMessage(contactId, outboundMessage);

    return {
      events,
      actions,
      state: {
        lastScore: scoreResult.score,
        lastTier: scoreResult.tier,
        qualified,
        confidence,
        reply: llmReply.reply,
      },
    };
  }

  private handleLeadScoring(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): AgentResponse {
    const payload = validatePayload(
      event.payload,
      { contactId: "string", objectionText: "string?", messageText: "string?" },
      "lead-responder",
    );
    const contactId = payload.contactId as string;
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;

    let scoreResult;
    try {
      scoreResult = this.deps.scoreLead(payload);
    } catch (err) {
      return {
        events: [
          createEventEnvelope({
            organizationId: context.organizationId,
            eventType: "conversation.escalated",
            source: { type: "agent", id: "lead-responder" },
            payload: {
              contactId,
              reason: "scoring_error",
              error: err instanceof Error ? err.message : String(err),
            },
            correlationId: event.correlationId,
            causationId: event.eventId,
            attribution: event.attribution,
          }),
        ],
        actions: [],
      };
    }
    const qualified = scoreResult.score >= threshold;

    const outboundEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: qualified ? "lead.qualified" : "lead.disqualified",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId,
        score: scoreResult.score,
        tier: scoreResult.tier,
        factors: scoreResult.factors,
        ...(qualified ? {} : { reason: "below_threshold" }),
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    const actions: ActionRequest[] = [];

    const objectionText = payload.objectionText as string | undefined;
    const objectionResult = this.handleObjection(objectionText, contactId, actions);

    const escalationEvent = this.checkEscalation(
      objectionResult,
      event,
      config,
      context,
      contactId,
    );

    const messageText = payload.messageText as string | undefined;
    let faqResponse: string | undefined;
    if (messageText && this.deps.matchFAQ) {
      try {
        const faqResult = this.deps.matchFAQ(messageText);
        if (faqResult.matched) {
          faqResponse = faqResult.answer;
        }
      } catch {
        // skip FAQ matching on error — non-critical
      }
    }

    const events: RoutedEventEnvelope[] = [outboundEvent];
    if (escalationEvent) {
      events.push(escalationEvent);
    }

    return {
      events,
      actions,
      state: {
        lastScore: scoreResult.score,
        lastTier: scoreResult.tier,
        qualified,
        ...(faqResponse ? { faqResponse } : {}),
      },
    };
  }

  private handleObjection(
    objectionText: string | undefined,
    contactId: string,
    actions: ActionRequest[],
  ): ObjectionMatch | undefined {
    if (!objectionText || !this.deps.matchObjection) {
      return undefined;
    }

    let match: ObjectionMatch;
    try {
      match = this.deps.matchObjection(objectionText);
    } catch {
      return undefined;
    }
    actions.push({
      actionType: "customer-engagement.conversation.handle_objection",
      parameters: { contactId, objectionText },
    });

    return match;
  }

  private checkEscalation(
    objectionResult: ObjectionMatch | undefined,
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
    contactId: string,
  ): RoutedEventEnvelope | undefined {
    const shouldEscalate = objectionResult !== undefined && !objectionResult.matched;

    const turnCount = context.conversationHistory?.length ?? 0;
    const maxTurns = (config.maxTurnsBeforeEscalation as number) ?? 10;
    const tooManyTurns = turnCount >= maxTurns;

    if (!shouldEscalate && !tooManyTurns) {
      return undefined;
    }

    return createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "conversation.escalated",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId,
        reason: shouldEscalate ? "unmatched_objection" : "max_turns_exceeded",
        turnCount,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });
  }
}
```

- [ ] **Step 4: Run all handler tests to verify they pass**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/handler.test.ts`
Expected: ALL PASS (existing + new tests)

- [ ] **Step 5: Commit**

```bash
sl commit -m "feat(agents): rewrite Lead Responder handler with LLM conversation flow" --reason "rewrite handler for Phase 4 | sl help commit"
```

---

### Task 6: Test Mode and Correction Ingestion Tests

**Files:**
- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

These tests validate the owner test chat mode (Phase 4 deliverable).

- [ ] **Step 1: Add test mode tests to handler.test.ts**

Add a new `describe("test mode", ...)` block:

```typescript
describe("test mode", () => {
  it("does not emit messaging.whatsapp.send in test mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { mode: "test" },
      { organizationId: "org-1" },
    );

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("does not emit messaging.whatsapp.send in draft mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { mode: "draft" },
      { organizationId: "org-1" },
    );

    const sendAction = result.actions.find((a) => a.actionType === "messaging.whatsapp.send");
    expect(sendAction).toBeUndefined();
  });

  it("stores messages with dashboard channel in test mode", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    // Inbound message should use dashboard channel
    expect(convDeps.conversationStore.appendMessage).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ channel: "dashboard" }),
    );
  });

  it("still returns reply in state for dashboard display", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    const result = await handler.handle(
      event,
      { mode: "test" },
      { organizationId: "org-1" },
    );

    expect(result.state?.reply).toBeDefined();
    expect(result.state?.reply).toContain("Thanks for your interest");
  });

  it("passes testMode flag to prompt builder", async () => {
    const convDeps = makeConversationDeps();
    const handler = new LeadResponderHandler({
      scoreLead: vi.fn().mockReturnValue({ score: 30, tier: "cool", factors: [] }),
      conversation: convDeps,
    });

    const event = makeMessageReceivedEvent();
    await handler.handle(event, { mode: "test" }, { organizationId: "org-1" });

    // The LLM should receive instructions mentioning test mode
    expect(convDeps.llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        agentInstructions: expect.stringContaining("test mode"),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/agents test -- --run src/agents/lead-responder/__tests__/handler.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
sl commit -m "test(agents): add test mode coverage for Lead Responder" --reason "add test mode tests for Phase 4 | sl help commit"
```

---

### Task 7: Full Verification

- [ ] **Step 1: Run all package tests**

Run: `pnpm --filter @switchboard/agents test`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors)

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (no lint errors)

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
sl commit -m "chore(agents): fix lint/type issues from Phase 4" --reason "cleanup Phase 4 | sl help commit"
```
