# Deploy Flow + Test Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-step deploy wizard with real AgentRuntime-powered test chat so founders go from marketplace browse to talking to their agent in under 5 minutes.

**Architecture:** Backend adds three core modules (SystemPromptAssembler, DefaultChatHandler, AnthropicAdapter) to `packages/core/src/agent-runtime/`. Frontend refactors the 2-step deploy wizard into a dynamic multi-step shell with scan, review, connection, and test chat steps. Test chat uses the real AgentRuntime from Sub-project A with stateless request/response.

**Tech Stack:** TypeScript, @anthropic-ai/sdk, Next.js 14, React, TanStack Query, Tailwind/shadcn, Vitest

**Spec:** `docs/superpowers/specs/2026-04-06-deploy-flow-test-chat-design.md`

---

### Task 1: SystemPromptAssembler

**Files:**

- Create: `packages/core/src/agent-runtime/system-prompt-assembler.ts`
- Test: `packages/core/src/agent-runtime/__tests__/system-prompt-assembler.test.ts`
- Modify: `packages/core/src/agent-runtime/index.ts`

**Context:** Pure function that converts an `AgentPersona` (from `packages/schemas/src/agent-persona.ts`) into a system prompt string. The `AgentPersona` type has these fields: `businessName`, `productService`, `valueProposition`, `tone` (enum: casual/professional/consultative), `qualificationCriteria` (generic `Record<string, unknown>`), `disqualificationCriteria`, `escalationRules` (generic `Record<string, unknown>`), `bookingLink` (nullable string), `customInstructions` (nullable string). The function must handle `qualificationCriteria` and `escalationRules` defensively since they're generic objects.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/agent-runtime/__tests__/system-prompt-assembler.test.ts
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "../system-prompt-assembler.js";
import type { AgentPersona } from "@switchboard/schemas";

function makePersona(overrides?: Partial<AgentPersona>): AgentPersona {
  return {
    id: "p_1",
    organizationId: "org_1",
    businessName: "Bloom Flowers",
    businessType: "small_business",
    productService: "Wedding and event floral arrangements",
    valueProposition: "Handcrafted artisan bouquets using locally-sourced flowers",
    tone: "professional",
    qualificationCriteria: { description: "Planning a wedding or event, budget over $300" },
    disqualificationCriteria: {},
    bookingLink: "https://cal.com/bloom",
    escalationRules: {
      frustrated: true,
      askForPerson: true,
      mentionCompetitor: false,
    },
    customInstructions: "Never promise same-day delivery",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("assembleSystemPrompt", () => {
  it("includes business name and product info", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("Bloom Flowers");
    expect(prompt).toContain("Wedding and event floral arrangements");
    expect(prompt).toContain("Handcrafted artisan bouquets");
  });

  it("includes tone", () => {
    const prompt = assembleSystemPrompt(makePersona({ tone: "casual" }));
    expect(prompt).toContain("casual");
  });

  it("includes custom instructions when present", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("Never promise same-day delivery");
  });

  it("omits custom instructions section when null", () => {
    const prompt = assembleSystemPrompt(makePersona({ customInstructions: null }));
    expect(prompt).not.toContain("Additional instructions");
  });

  it("includes booking link when present", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("https://cal.com/bloom");
  });

  it("omits booking section when null", () => {
    const prompt = assembleSystemPrompt(makePersona({ bookingLink: null }));
    expect(prompt).not.toContain("Booking");
  });

  it("serializes qualification criteria from object", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("budget over $300");
  });

  it("handles empty qualification criteria", () => {
    const prompt = assembleSystemPrompt(makePersona({ qualificationCriteria: {} }));
    expect(prompt).toContain("best judgment");
  });

  it("serializes escalation rules — only enabled ones", () => {
    const prompt = assembleSystemPrompt(makePersona());
    expect(prompt).toContain("frustrated");
    expect(prompt).toContain("askForPerson");
    expect(prompt).not.toContain("mentionCompetitor");
  });

  it("handles empty escalation rules", () => {
    const prompt = assembleSystemPrompt(makePersona({ escalationRules: {} }));
    expect(prompt).not.toContain("Hand off");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/system-prompt-assembler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement assembleSystemPrompt**

```ts
// packages/core/src/agent-runtime/system-prompt-assembler.ts
import type { AgentPersona } from "@switchboard/schemas";

function serializeCriteria(criteria: Record<string, unknown>): string | null {
  if (Object.keys(criteria).length === 0) return null;
  if (typeof criteria.description === "string") return criteria.description;
  return Object.entries(criteria)
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
}

function serializeEscalationRules(rules: Record<string, unknown>): string | null {
  const enabled = Object.entries(rules)
    .filter(([, value]) => value === true)
    .map(([key]) => `- ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  return enabled.length > 0 ? enabled.join("\n") : null;
}

export function assembleSystemPrompt(persona: AgentPersona): string {
  const sections: string[] = [];

  sections.push(`You are an AI assistant for ${persona.businessName}.`);

  // Role
  sections.push(
    `## Your Role\nYou help customers with ${persona.productService}.\n${persona.valueProposition}`,
  );

  // Communication style
  let style = `## Communication Style\nTone: ${persona.tone}`;
  if (persona.customInstructions) {
    style += `\nAdditional instructions: ${persona.customInstructions}`;
  }
  sections.push(style);

  // Lead qualification
  const criteria = serializeCriteria(persona.qualificationCriteria);
  sections.push(
    `## Lead Qualification\n${criteria ?? "Use your best judgment to identify good leads."}`,
  );

  // Escalation rules
  const escalation = serializeEscalationRules(persona.escalationRules);
  if (escalation) {
    sections.push(`## Escalation Rules\nHand off to a human when:\n${escalation}`);
  }

  // Booking
  if (persona.bookingLink) {
    sections.push(
      `## Booking\nWhen a lead is qualified, direct them to book: ${persona.bookingLink}`,
    );
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/system-prompt-assembler.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Export from barrel file**

Add to `packages/core/src/agent-runtime/index.ts`:

```ts
export { assembleSystemPrompt } from "./system-prompt-assembler.js";
```

- [ ] **Step 6: Run full core tests + typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run && npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent-runtime/system-prompt-assembler.ts packages/core/src/agent-runtime/__tests__/system-prompt-assembler.test.ts packages/core/src/agent-runtime/index.ts && git commit -m "feat(core): add SystemPromptAssembler for persona-to-prompt conversion"
```

---

### Task 2: DefaultChatHandler

**Files:**

- Create: `packages/core/src/agent-runtime/default-chat-handler.ts`
- Test: `packages/core/src/agent-runtime/__tests__/default-chat-handler.test.ts`
- Modify: `packages/core/src/agent-runtime/index.ts`

**Context:** Generic `AgentHandler` implementation (from `packages/sdk/src/handler.ts`) that: assembles system prompt from persona (using Task 1's `assembleSystemPrompt`), calls `ctx.llm.chat()` with filtered messages, and sends the response via `ctx.chat.send()`. The `AgentContext` type is defined in `packages/sdk/src/context.ts`. The `conversation.messages` array has `{ role: string; content: string }` — filter to only "user" and "assistant" roles.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/agent-runtime/__tests__/default-chat-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { DefaultChatHandler } from "../default-chat-handler.js";
import type { AgentContext } from "@switchboard/sdk";

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    state: { get: vi.fn(), set: vi.fn(), list: vi.fn(), delete: vi.fn() },
    chat: { send: vi.fn(), sendToThread: vi.fn() },
    files: {
      read: vi.fn(),
      write: vi.fn(),
    },
    browser: {
      navigate: vi.fn(),
      click: vi.fn(),
      extract: vi.fn(),
      screenshot: vi.fn(),
    },
    llm: {
      chat: vi.fn().mockResolvedValue({ text: "Hello! How can I help you today?" }),
    },
    notify: vi.fn(),
    handoff: vi.fn(),
    persona: {
      id: "p_1",
      organizationId: "org_1",
      businessName: "Bloom Flowers",
      businessType: "small_business",
      productService: "Wedding flowers",
      valueProposition: "Beautiful arrangements",
      tone: "professional",
      qualificationCriteria: {},
      disqualificationCriteria: {},
      bookingLink: null,
      escalationRules: {},
      customInstructions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    conversation: {
      id: "conv_1",
      messages: [{ role: "user", content: "I need flowers for my wedding" }],
    },
    trust: { score: 80, level: "autonomous" },
    ...overrides,
  } as AgentContext;
}

describe("DefaultChatHandler", () => {
  it("calls llm.chat with system prompt and filtered messages", async () => {
    const ctx = makeContext();
    await DefaultChatHandler.onMessage!(ctx);

    expect(ctx.llm.chat).toHaveBeenCalledTimes(1);
    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.system).toContain("Bloom Flowers");
    expect(callArgs.messages).toEqual([{ role: "user", content: "I need flowers for my wedding" }]);
  });

  it("sends the LLM response via chat.send", async () => {
    const ctx = makeContext();
    await DefaultChatHandler.onMessage!(ctx);

    expect(ctx.chat.send).toHaveBeenCalledWith("Hello! How can I help you today?");
  });

  it("filters out non-user/assistant messages", async () => {
    const ctx = makeContext({
      conversation: {
        id: "conv_1",
        messages: [
          { role: "system", content: "ignored" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
          { role: "tool", content: "also ignored" },
          { role: "user", content: "how are you?" },
        ],
      },
    });
    await DefaultChatHandler.onMessage!(ctx);

    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "how are you?" },
    ]);
  });

  it("handles missing conversation gracefully", async () => {
    const ctx = makeContext({ conversation: undefined });
    await DefaultChatHandler.onMessage!(ctx);

    const callArgs = (ctx.llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/default-chat-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DefaultChatHandler**

```ts
// packages/core/src/agent-runtime/default-chat-handler.ts
import type { AgentHandler } from "@switchboard/sdk";
import { assembleSystemPrompt } from "./system-prompt-assembler.js";

export const DefaultChatHandler: AgentHandler = {
  async onMessage(ctx) {
    const systemPrompt = assembleSystemPrompt(ctx.persona);
    const messages = (ctx.conversation?.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await ctx.llm.chat({
      system: systemPrompt,
      messages,
    });

    await ctx.chat.send(response.text);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/default-chat-handler.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Export from barrel file**

Add to `packages/core/src/agent-runtime/index.ts`:

```ts
export { DefaultChatHandler } from "./default-chat-handler.js";
```

- [ ] **Step 6: Run full core tests + typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run && npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent-runtime/default-chat-handler.ts packages/core/src/agent-runtime/__tests__/default-chat-handler.test.ts packages/core/src/agent-runtime/index.ts && git commit -m "feat(core): add DefaultChatHandler for persona-driven agent conversations"
```

---

### Task 3: Anthropic LLM Adapter Factory

**Files:**

- Create: `packages/core/src/agent-runtime/anthropic-adapter.ts`
- Test: `packages/core/src/agent-runtime/__tests__/anthropic-adapter.test.ts`
- Modify: `packages/core/src/agent-runtime/index.ts`
- Modify: `packages/core/package.json` (add `@anthropic-ai/sdk` dependency)

**Context:** Factory function that creates an `LLMAdapter` (from `packages/core/src/llm-adapter.ts`) wrapping `@anthropic-ai/sdk`. The `LLMAdapter` interface has one method: `generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply>`. `ConversationPrompt` has `systemPrompt: string`, `conversationHistory: Message[]` (with `direction: "inbound"|"outbound"`, `content`, `id`, `contactId`, `timestamp`, `channel`), `retrievedContext: RetrievedChunk[]`, `agentInstructions: string`. `LLMReply` has `reply: string`, `confidence: number`. There's an existing `ClaudeLLMAdapter` in `packages/agents/src/llm/claude-llm-adapter.ts` that follows this pattern — it takes a `complete` function and wraps it. Our adapter should be simpler: directly use the Anthropic SDK with no JSON confidence parsing (use a fixed confidence of 0.9 for test chat).

- [ ] **Step 1: Add `@anthropic-ai/sdk` to core**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add @anthropic-ai/sdk`

- [ ] **Step 2: Write the failing tests**

```ts
// packages/core/src/agent-runtime/__tests__/anthropic-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnthropicAdapter } from "../anthropic-adapter.js";
import type { ConversationPrompt } from "../../llm-adapter.js";

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  const createMock = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Hello! How can I help you?" }],
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
    __createMock: createMock,
  };
});

function makePrompt(overrides?: Partial<ConversationPrompt>): ConversationPrompt {
  return {
    systemPrompt: "You are a helpful assistant.",
    conversationHistory: [
      {
        id: "m_1",
        contactId: "c_1",
        direction: "inbound",
        content: "Hello",
        timestamp: new Date().toISOString(),
        channel: "dashboard",
      },
    ],
    retrievedContext: [],
    agentInstructions: "",
    ...overrides,
  };
}

describe("createAnthropicAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an adapter that implements generateReply", () => {
    const adapter = createAnthropicAdapter("test-key");
    expect(adapter.generateReply).toBeTypeOf("function");
  });

  it("translates ConversationPrompt to Anthropic API call", async () => {
    const adapter = createAnthropicAdapter("test-key");
    const prompt = makePrompt();
    const result = await adapter.generateReply(prompt);

    expect(result.reply).toBe("Hello! How can I help you?");
    expect(result.confidence).toBe(0.9);
  });

  it("maps inbound messages to user role and outbound to assistant", async () => {
    const { default: Anthropic, __createMock: createMock } = await import("@anthropic-ai/sdk");
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({
        conversationHistory: [
          {
            id: "m_1",
            contactId: "c_1",
            direction: "inbound",
            content: "Hi",
            timestamp: new Date().toISOString(),
            channel: "dashboard",
          },
          {
            id: "m_2",
            contactId: "c_1",
            direction: "outbound",
            content: "Hello!",
            timestamp: new Date().toISOString(),
            channel: "dashboard",
          },
        ],
      }),
    );

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ]);
  });

  it("includes system prompt with agent instructions and retrieved context", async () => {
    const { __createMock: createMock } = await import("@anthropic-ai/sdk");
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(
      makePrompt({
        systemPrompt: "You are Bloom's assistant.",
        agentInstructions: "Be concise.",
        retrievedContext: [{ content: "We sell roses.", sourceType: "document", similarity: 0.95 }],
      }),
    );

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.system).toContain("You are Bloom's assistant.");
    expect(callArgs.system).toContain("Be concise.");
    expect(callArgs.system).toContain("We sell roses.");
  });

  it("uses modelConfig when provided", async () => {
    const { __createMock: createMock } = await import("@anthropic-ai/sdk");
    const adapter = createAnthropicAdapter("test-key");
    await adapter.generateReply(makePrompt(), {
      slot: "premium",
      modelId: "claude-opus-4-6",
      maxTokens: 2048,
      temperature: 0.5,
      timeoutMs: 10000,
    });

    const callArgs = createMock.mock.calls[0]![0];
    expect(callArgs.model).toBe("claude-opus-4-6");
    expect(callArgs.max_tokens).toBe(2048);
    expect(callArgs.temperature).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/anthropic-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement createAnthropicAdapter**

```ts
// packages/core/src/agent-runtime/anthropic-adapter.ts
import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, ConversationPrompt, LLMReply, RetrievedChunk } from "../llm-adapter.js";
import type { ModelConfig } from "../model-router.js";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250514";
const DEFAULT_MAX_TOKENS = 1024;

function buildSystemContent(prompt: ConversationPrompt): string {
  let system = prompt.systemPrompt;

  if (prompt.retrievedContext.length > 0) {
    const contextLines = prompt.retrievedContext.map(
      (c: RetrievedChunk, i: number) =>
        `[Source ${i + 1} (${c.sourceType}, similarity: ${c.similarity.toFixed(2)})]:\n${c.content}`,
    );
    system += `\n\nRelevant context:\n${contextLines.join("\n\n")}`;
  }

  if (prompt.agentInstructions) {
    system += `\n\n${prompt.agentInstructions}`;
  }

  return system;
}

export function createAnthropicAdapter(apiKey?: string): LLMAdapter {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  return {
    async generateReply(prompt: ConversationPrompt, modelConfig?: ModelConfig): Promise<LLMReply> {
      const messages = prompt.conversationHistory.map((m) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      const response = await client.messages.create({
        model: modelConfig?.modelId ?? DEFAULT_MODEL,
        max_tokens: modelConfig?.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: modelConfig?.temperature,
        system: buildSystemContent(prompt),
        messages,
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";

      return { reply: text, confidence: 0.9 };
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/agent-runtime/__tests__/anthropic-adapter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Export from barrel file**

Add to `packages/core/src/agent-runtime/index.ts`:

```ts
export { createAnthropicAdapter } from "./anthropic-adapter.js";
```

- [ ] **Step 7: Run full core tests + typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run && npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent-runtime/anthropic-adapter.ts packages/core/src/agent-runtime/__tests__/anthropic-adapter.test.ts packages/core/src/agent-runtime/index.ts packages/core/package.json && git commit -m "feat(core): add createAnthropicAdapter factory for LLMAdapter"
```

---

### Task 4: DeployWizardShell

**Files:**

- Create: `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`

**Context:** Dynamic multi-step wizard shell. Receives an array of `WizardStep` configs and renders the current step's component. The shell owns the Back button and progress bar. Each step calls `onNext()` when ready. State accumulates in `WizardData` via `onUpdate`. The existing `deploy-wizard.tsx` (211 lines) will be replaced — but that happens in later tasks when the step components are built. For now, build the shell standalone.

The dashboard uses Next.js 14 with `"use client"` for interactive components, Tailwind CSS, and shadcn/ui components imported from `@/components/ui/`. Reference the existing `wizard-shell.tsx` at `apps/dashboard/src/components/onboarding/wizard-shell.tsx` for the progress bar pattern.

- [ ] **Step 1: Create DeployWizardShell**

```tsx
// apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx
"use client";

import { useState, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

export interface WizardStepProps {
  data: WizardData;
  onUpdate: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}

export interface WizardStep {
  id: string;
  label: string;
  component: React.ComponentType<WizardStepProps & Record<string, unknown>>;
  props?: Record<string, unknown>;
}

export interface PersonaInput {
  businessName: string;
  businessType: string;
  productService: string;
  valueProposition: string;
  tone: string;
  qualificationCriteria: Record<string, unknown>;
  disqualificationCriteria: Record<string, unknown>;
  escalationRules: Record<string, unknown>;
  bookingLink: string | null;
  customInstructions: string | null;
}

export interface ConnectionConfig {
  type: string;
  apiKey?: string;
  config?: Record<string, unknown>;
}

export interface WizardData {
  listingId: string;
  listingSlug: string;
  url?: string;
  persona?: PersonaInput;
  connections: Record<string, ConnectionConfig>;
  testChatVerified?: boolean;
}

interface DeployWizardShellProps {
  steps: WizardStep[];
  initialData: Pick<WizardData, "listingId" | "listingSlug">;
  header?: ReactNode;
  onDataChange?: (data: WizardData) => void;
}

export function DeployWizardShell({
  steps,
  initialData,
  header,
  onDataChange,
}: DeployWizardShellProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    ...initialData,
    connections: {},
  });

  const handleUpdate = useCallback(
    (patch: Partial<WizardData>) => {
      setData((prev) => {
        const next = { ...prev, ...patch };
        onDataChange?.(next);
        return next;
      });
    },
    [onDataChange],
  );

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const step = steps[currentStep];
  if (!step) return null;

  const StepComponent = step.component;

  return (
    <div className="max-w-xl mx-auto">
      {header}

      {/* Progress bar */}
      <div className="mb-8">
        <p className="text-[13px] text-muted-foreground mb-2">
          Step {currentStep + 1} of {steps.length}: {step.label}
        </p>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <StepComponent
        data={data}
        onUpdate={handleUpdate}
        onNext={handleNext}
        {...(step.props ?? {})}
      />

      {/* Back button */}
      {currentStep > 0 && (
        <div className="mt-6">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to deploy-wizard-shell

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx && git commit -m "feat(dashboard): add DeployWizardShell component with dynamic steps"
```

---

### Task 5: ScanStep

**Files:**

- Create: `apps/dashboard/src/components/marketplace/scan-step.tsx`

**Context:** Refactored from the scan logic in `apps/dashboard/src/components/marketplace/deploy-wizard.tsx:46-56`. The `scanWebsite` server action is at `apps/dashboard/src/app/(auth)/deploy/[slug]/actions.ts` — it fetches a URL, extracts text, calls Claude to parse business profile. The scan step shows a URL input, calls `scanWebsite`, stores result in `WizardData.persona` via `onUpdate`, then calls `onNext()`. Uses `WizardStepProps` from the shell (Task 4).

- [ ] **Step 1: Create ScanStep**

```tsx
// apps/dashboard/src/components/marketplace/scan-step.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scanWebsite } from "@/app/(auth)/deploy/[slug]/actions";
import type { WizardStepProps } from "./deploy-wizard-shell";

export function ScanStep({ onUpdate, onNext }: WizardStepProps) {
  const [url, setUrl] = useState("");
  const [isScanning, startScan] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleScan() {
    setError(null);
    startScan(async () => {
      try {
        const profile = await scanWebsite(url);
        onUpdate({
          url,
          persona: {
            businessName: profile.businessName,
            businessType: "small_business",
            productService: profile.whatTheySell,
            valueProposition: profile.valueProposition,
            tone: profile.tone === "warm" ? "casual" : "professional",
            qualificationCriteria: {},
            disqualificationCriteria: {},
            escalationRules: {
              frustrated: true,
              askForPerson: true,
              mentionCompetitor: false,
              outsideKnowledge: false,
            },
            bookingLink: null,
            customInstructions: null,
          },
        });
        onNext();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to scan website");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">First, your website — I'll study up.</p>
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://yourbusiness.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isScanning}
        />
        <Button onClick={handleScan} disabled={!url || isScanning}>
          {isScanning ? "Learning..." : "Learn my business"}
        </Button>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to scan-step

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/scan-step.tsx && git commit -m "feat(dashboard): add ScanStep component for deploy wizard"
```

---

### Task 6: ReviewPersonaStep

**Files:**

- Create: `apps/dashboard/src/components/marketplace/review-persona-step.tsx`

**Context:** Refactored from the review section in `apps/dashboard/src/components/marketplace/deploy-wizard.tsx:121-208`. Shows editable persona fields with the AI-extracted values pre-filled. Fields: businessName, productService, valueProposition, tone, qualificationCriteria (text input), escalationRules (checkboxes), bookingLink, customInstructions (as "never say"). Uses `WizardStepProps` from the shell. Calls `onUpdate` to save changes, `onNext()` via "Continue" button.

- [ ] **Step 1: Create ReviewPersonaStep**

```tsx
// apps/dashboard/src/components/marketplace/review-persona-step.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WizardStepProps, PersonaInput } from "./deploy-wizard-shell";

const ESCALATION_LABELS: Record<string, string> = {
  frustrated: "They're frustrated or upset",
  askForPerson: "They ask to speak to a person",
  mentionCompetitor: "They mention a competitor",
  outsideKnowledge: "Question outside my knowledge",
};

export function ReviewPersonaStep({ data, onUpdate, onNext }: WizardStepProps) {
  const persona = data.persona;
  if (!persona) return <p className="text-muted-foreground">No persona data. Go back and scan.</p>;

  const [qualificationCriteria, setQualificationCriteria] = useState(
    typeof persona.qualificationCriteria?.description === "string"
      ? persona.qualificationCriteria.description
      : "",
  );
  const [neverSay, setNeverSay] = useState(persona.customInstructions ?? "");
  const [bookingLink, setBookingLink] = useState(persona.bookingLink ?? "");
  const [escalationRules, setEscalationRules] = useState<Record<string, boolean>>(
    Object.fromEntries(
      Object.keys(ESCALATION_LABELS).map((key) => [key, persona.escalationRules[key] === true]),
    ),
  );

  function handleContinue() {
    const updated: PersonaInput = {
      ...persona,
      qualificationCriteria: qualificationCriteria ? { description: qualificationCriteria } : {},
      escalationRules,
      bookingLink: bookingLink || null,
      customInstructions: neverSay ? `Never say: ${neverSay}` : null,
    };
    onUpdate({ persona: updated });
    onNext();
  }

  return (
    <div className="space-y-6">
      {/* AI summary */}
      <div className="bg-surface-raised rounded-lg p-4">
        <p className="text-sm text-foreground">
          You're <strong>{persona.businessName}</strong>. You sell{" "}
          {persona.productService.toLowerCase()}. Your vibe is {persona.tone.toLowerCase()}.
        </p>
      </div>

      <div className="border-t border-border pt-6 space-y-5">
        <p className="text-sm font-medium text-foreground">
          A few things that'll help me do great work:
        </p>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            What makes someone a good lead for you?
          </label>
          <Input
            value={qualificationCriteria}
            onChange={(e) => setQualificationCriteria(e.target.value)}
            placeholder="Planning a wedding or event, budget over $300..."
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-2">
            When should I hand off to you?
          </label>
          <div className="space-y-2">
            {Object.entries(ESCALATION_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={escalationRules[key] ?? false}
                  onChange={(e) =>
                    setEscalationRules((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="rounded border-border"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            Anything I should never say?
          </label>
          <Input
            value={neverSay}
            onChange={(e) => setNeverSay(e.target.value)}
            placeholder="Never promise same-week delivery..."
          />
        </div>

        <div>
          <label className="text-sm text-muted-foreground block mb-1">Got a booking link?</label>
          <Input
            type="url"
            value={bookingLink}
            onChange={(e) => setBookingLink(e.target.value)}
            placeholder="https://cal.com/yourbusiness"
          />
        </div>
      </div>

      <Button onClick={handleContinue} size="lg" className="w-full">
        Continue
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to review-persona-step

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/review-persona-step.tsx && git commit -m "feat(dashboard): add ReviewPersonaStep for deploy wizard"
```

---

### Task 7: ConnectionStep

**Files:**

- Create: `apps/dashboard/src/components/marketplace/connection-step.tsx`

**Context:** Renders for each `manifest.connections.required` entry. Shows the connection type, the reason from the manifest, and a simple API key input. Stores config in `WizardData.connections` keyed by connection type. For now, all connections are simple text inputs — OAuth/rich config comes later. Most agents have zero required connections, so this step is rarely shown.

- [ ] **Step 1: Create ConnectionStep**

```tsx
// apps/dashboard/src/components/marketplace/connection-step.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WizardStepProps } from "./deploy-wizard-shell";

interface ConnectionStepProps extends WizardStepProps {
  connectionType: string;
  reason: string;
}

export function ConnectionStep({
  data,
  onUpdate,
  onNext,
  connectionType,
  reason,
}: ConnectionStepProps) {
  const existing = data.connections[connectionType];
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");

  function handleConnect() {
    onUpdate({
      connections: {
        ...data.connections,
        [connectionType]: { type: connectionType, apiKey },
      },
    });
    onNext();
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-medium text-foreground capitalize">{connectionType}</h3>
        <p className="text-sm text-muted-foreground mt-1">{reason}</p>
      </div>

      <div>
        <label className="text-sm text-muted-foreground block mb-1">API Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`Enter your ${connectionType} API key`}
        />
      </div>

      <Button onClick={handleConnect} disabled={!apiKey} className="w-full">
        Connect & Continue
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to connection-step

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/connection-step.tsx && git commit -m "feat(dashboard): add ConnectionStep for deploy wizard"
```

---

### Task 8: Test Chat API Route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/test-chat/route.ts`

**Context:** Stateless POST endpoint. Accepts `persona` (PersonaInput subset) + `messages` array. Creates an ephemeral `AgentRuntime` with `DefaultChatHandler`, `createAnthropicAdapter()`, surface `"test_chat"`, `trustLevel: "autonomous"`. Uses no-op stubs for `stateStore` and `actionRequestStore`. The `onChatExecute` callback captures the agent's reply. Returns `{ reply: string }`.

The `AgentRuntime` (from `packages/core/src/agent-runtime/agent-runtime.ts`) requires `AgentRuntimeConfig` with: `handler`, `deploymentId`, `surface`, `trustScore`, `trustLevel`, `persona` (full `AgentPersona`), `stateStore`, `actionRequestStore`, `llmAdapter`, `onChatExecute`. The persona from the wizard is a `PersonaInput` subset — construct a temporary `AgentPersona` with placeholder values for `id`, `organizationId`, `createdAt`, `updatedAt`.

The `AgentRuntime.handleMessage()` takes `MessageEvent` with `conversationId: string` and `messages: Array<{ role: string; content: string }>`.

Dashboard uses extensionless imports (no `.js` suffixes) per Next.js convention.

- [ ] **Step 1: Create the test-chat API route**

```ts
// apps/dashboard/src/app/api/dashboard/marketplace/test-chat/route.ts
import { NextResponse } from "next/server";
import {
  AgentRuntime,
  DefaultChatHandler,
  createAnthropicAdapter,
} from "@switchboard/core/agent-runtime";
import { z } from "zod";

const TestChatInput = z.object({
  persona: z.object({
    businessName: z.string().min(1),
    businessType: z.string().min(1),
    productService: z.string().min(1),
    valueProposition: z.string().min(1),
    tone: z.enum(["casual", "professional", "consultative"]),
    qualificationCriteria: z.record(z.unknown()).default({}),
    disqualificationCriteria: z.record(z.unknown()).default({}),
    escalationRules: z.record(z.unknown()).default({}),
    bookingLink: z.string().nullable().default(null),
    customInstructions: z.string().nullable().default(null),
  }),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    }),
  ),
});

const noopStateStore = {
  get: async () => null,
  set: async () => {},
  list: async () => [],
  delete: async () => {},
};

// Matches ActionRequestStore interface from packages/core/src/agent-runtime/action-request-pipeline.ts
const noopActionRequestStore = {
  create: async (_input: {
    deploymentId: string;
    type: string;
    surface: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; status: string }> => ({ id: "noop", status: "executed" }),
  updateStatus: async (
    _id: string,
    _status: string,
    _review?: { reviewedBy: string },
  ): Promise<unknown> => undefined,
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = TestChatInput.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { persona: personaInput, messages } = parsed.data;

    // Construct temporary AgentPersona with placeholder DB fields
    const persona = {
      ...personaInput,
      id: "test-chat-persona",
      organizationId: "test-chat-org",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let capturedReply = "";

    const runtime = new AgentRuntime({
      handler: DefaultChatHandler,
      deploymentId: "test-chat",
      surface: "test_chat",
      trustScore: 100,
      trustLevel: "autonomous",
      persona,
      stateStore: noopStateStore,
      actionRequestStore: noopActionRequestStore,
      llmAdapter: createAnthropicAdapter(),
      onChatExecute: (message: string) => {
        capturedReply = message;
      },
    });

    await runtime.handleMessage({
      conversationId: "test-chat-session",
      messages,
    });

    return NextResponse.json({ reply: capturedReply });
  } catch (err) {
    console.error("Test chat error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test chat failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify the import path works**

Check that `@switchboard/core/agent-runtime` is in core's `package.json` exports map. It was added in Sub-project A. Verify:

Run: `grep -A2 '"./agent-runtime"' packages/core/package.json`
Expected: Should show the export entry. If missing, add it.

- [ ] **Step 3: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to test-chat route

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/test-chat/route.ts && git commit -m "feat(dashboard): add test-chat API route with real AgentRuntime"
```

---

### Task 9: TestChatStep

**Files:**

- Create: `apps/dashboard/src/components/marketplace/test-chat-step.tsx`

**Context:** Chat UI component used as the final wizard step. Messages stored in React state. Each send POSTs the full conversation history to `/api/dashboard/marketplace/test-chat`. Shows agent persona name, message list, input box, loading indicator, and a "Deploy" button. Clicking Deploy calls the deploy action (see Task 11 for the actual deploy wiring).

For now, the Deploy button just calls `onNext()` (or `onDeploy` if passed as a prop). The actual deploy logic is wired in Task 11 when we update the deploy page.

- [ ] **Step 1: Create TestChatStep**

```tsx
// apps/dashboard/src/components/marketplace/test-chat-step.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Rocket, Loader2 } from "lucide-react";
import type { WizardStepProps } from "./deploy-wizard-shell";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface TestChatStepProps extends WizardStepProps {
  onDeploy: () => void;
}

export function TestChatStep({ data, onDeploy }: TestChatStepProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || isLoading || !data.persona) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/dashboard/marketplace/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: data.persona,
          messages: updatedMessages,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? `Request failed: ${res.status}`);
      }

      const { reply } = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get response");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Test your agent. This is a sandbox — nothing is sent to real customers.
      </div>

      {/* Chat messages */}
      <div className="border border-border rounded-lg h-80 overflow-y-auto p-4 space-y-3 bg-surface">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Say something to test your agent...
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isLoading}>
          Send
        </Button>
      </div>

      {/* Deploy button */}
      <div className="border-t border-border pt-4">
        <Button onClick={onDeploy} size="lg" className="w-full">
          <Rocket className="h-4 w-4 mr-2" />
          Deploy — I'm happy with this agent
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors related to test-chat-step

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/test-chat-step.tsx && git commit -m "feat(dashboard): add TestChatStep with real agent sandbox"
```

---

### Task 10: Extend Deploy API to Accept Persona

**Files:**

- Modify: `apps/api/src/routes/marketplace.ts:31-36` (DeployInput schema)
- Modify: `apps/api/src/routes/marketplace.ts:137-166` (deploy handler)

**Context:** The existing deploy route at `POST /listings/:id/deploy` creates an `AgentDeployment` using `PrismaDeploymentStore.create()`. Currently the `DeployInput` schema accepts `inputConfig`, `governanceSettings`, `outputDestination`, `connectionIds`. We need to add `persona` fields so the deploy wizard can send the persona data along with the deploy request. The API should store the persona in `inputConfig` (which is a `Json?` field on the `AgentDeployment` model) — this avoids needing a new Prisma model.

- [ ] **Step 1: Update DeployInput schema**

In `apps/api/src/routes/marketplace.ts`, modify the `DeployInput` schema at line 31:

```ts
const DeployInput = z.object({
  persona: z
    .object({
      businessName: z.string().min(1),
      businessType: z.string().min(1),
      productService: z.string().min(1),
      valueProposition: z.string().min(1),
      tone: z.string().min(1),
      qualificationCriteria: z.record(z.unknown()).default({}),
      disqualificationCriteria: z.record(z.unknown()).default({}),
      escalationRules: z.record(z.unknown()).default({}),
      bookingLink: z.string().nullable().default(null),
      customInstructions: z.string().nullable().default(null),
    })
    .optional(),
  inputConfig: z.record(z.unknown()).optional(),
  governanceSettings: z.record(z.unknown()).optional(),
  outputDestination: z.record(z.unknown()).optional(),
  connectionIds: z.array(z.string()).optional(),
});
```

- [ ] **Step 2: Update deploy handler to include persona in inputConfig**

In `apps/api/src/routes/marketplace.ts`, modify the deploy handler at ~line 156:

```ts
const deployment = await store.create({
  organizationId: orgId,
  listingId: id,
  inputConfig: {
    ...parsed.data.inputConfig,
    ...(parsed.data.persona ? { persona: parsed.data.persona } : {}),
  },
  governanceSettings: parsed.data.governanceSettings ?? {
    startingAutonomy: "supervised",
  },
  outputDestination: parsed.data.outputDestination,
  connectionIds: parsed.data.connectionIds,
});
```

- [ ] **Step 3: Run API tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run`
Expected: All pass (existing tests should still work since persona is optional)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/marketplace.ts && git commit -m "feat(api): extend deploy endpoint to accept persona fields"
```

---

### Task 11: Wire Up Deploy Page with New Wizard

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`
- Delete: `apps/dashboard/src/components/marketplace/deploy-wizard.tsx`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts`

**Context:** The deploy page at `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx` currently renders `<DeployWizard>` with hardcoded 2-step flow. Replace it with `<DeployWizardShell>` using the new step components. The page fetches the listing via `getListingBySlug` (from `apps/dashboard/src/lib/demo-data.ts`), extracts the manifest (or uses defaults if no manifest), builds the step array, and passes it to the shell.

The deploy action: when the user clicks Deploy in the test chat step, POST to `/api/dashboard/marketplace/listings/${listingId}/deploy` with persona + governance settings. The dashboard proxy route already exists at `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts` — it forwards to the API. Redirect to `/dashboard` on success.

Since the page is a server component and the wizard is a client component, we need a client wrapper component to handle the deploy action.

- [ ] **Step 1: Create the deploy page client wrapper**

```tsx
// apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, useCallback, useMemo } from "react";
import {
  DeployWizardShell,
  type WizardStep,
  type WizardData,
} from "@/components/marketplace/deploy-wizard-shell";
import { ScanStep } from "@/components/marketplace/scan-step";
import { ReviewPersonaStep } from "@/components/marketplace/review-persona-step";
import { ConnectionStep } from "@/components/marketplace/connection-step";
import { TestChatStep } from "@/components/marketplace/test-chat-step";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";

interface ConnectionRequirement {
  type: string;
  reason: string;
}

interface DeployWizardClientProps {
  listingId: string;
  listingSlug: string;
  agentName: string;
  roleFocus: RoleFocus;
  connections: ConnectionRequirement[];
}

export function DeployWizardClient({
  listingId,
  listingSlug,
  agentName,
  roleFocus,
  connections,
}: DeployWizardClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeploying, startDeploy] = useTransition();

  // Use a ref to always have the latest wizard data without causing re-renders
  const wizardDataRef = useRef<WizardData>({
    listingId,
    listingSlug,
    connections: {},
  });

  const handleDataChange = useCallback((data: WizardData) => {
    wizardDataRef.current = data;
  }, []);

  const handleDeploy = useCallback(() => {
    setError(null);
    startDeploy(async () => {
      try {
        const data = wizardDataRef.current;
        const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: data.persona,
            governanceSettings: { startingAutonomy: "supervised" },
          }),
        });

        if (!res.ok) throw new Error("Deploy failed");
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    });
  }, [listingId, router]);

  // Memoize steps so they don't recreate on every render.
  // onDeploy and isDeploying are passed as step props to TestChatStep.
  // Since isDeploying is a transition state, we pass it via a getter to avoid stale closures.
  const steps: WizardStep[] = useMemo(
    () => [
      { id: "scan", label: "Learn your business", component: ScanStep },
      { id: "review", label: "Review & customize", component: ReviewPersonaStep },
      ...connections.map((conn) => ({
        id: `connect-${conn.type}`,
        label: `Connect ${conn.type}`,
        component: ConnectionStep as WizardStep["component"],
        props: { connectionType: conn.type, reason: conn.reason },
      })),
      {
        id: "test-chat",
        label: "Test your agent",
        component: TestChatStep as WizardStep["component"],
        props: { onDeploy: handleDeploy },
      },
    ],
    [connections, handleDeploy],
  );

  const header = (
    <div className="flex items-center gap-4 mb-8">
      <div className="w-16 h-16 shrink-0">
        <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
      </div>
      <div>
        <h2 className="font-display text-xl text-foreground">Let's get {agentName} up to speed.</h2>
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );

  return (
    <DeployWizardShell
      steps={steps}
      initialData={{ listingId, listingSlug }}
      header={header}
      onDataChange={handleDataChange}
    />
  );
}
```

- [ ] **Step 2: Update the deploy page**

Replace `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`:

```tsx
// apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx
import { notFound } from "next/navigation";
import { getListingBySlug } from "@/lib/demo-data";
import { DeployWizardClient } from "./deploy-wizard-client";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "sales-pipeline-bundle": "leads",
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DeployPage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const displayName = listing.name.replace(" Bundle", "");

  // Extract connection requirements from metadata if available
  const metadata = listing.metadata as Record<string, unknown> | null;
  const connections = Array.isArray(metadata?.connections)
    ? (metadata.connections as Array<{ type: string; reason: string }>)
    : [];

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <DeployWizardClient
        listingId={listing.id}
        listingSlug={slug}
        agentName={displayName}
        roleFocus={ROLE_MAP[slug] ?? "default"}
        connections={connections}
      />
    </div>
  );
}
```

- [ ] **Step 3: Delete the old deploy wizard**

Delete `apps/dashboard/src/components/marketplace/deploy-wizard.tsx`.

- [ ] **Step 4: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors. If the old `deploy-wizard.tsx` is imported elsewhere, fix those imports.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/deploy/\[slug\]/page.tsx apps/dashboard/src/app/\(auth\)/deploy/\[slug\]/deploy-wizard-client.tsx apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx && git rm apps/dashboard/src/components/marketplace/deploy-wizard.tsx && git commit -m "feat(dashboard): wire up deploy page with multi-step wizard + test chat"
```

---

### Task 12: Integration Smoke Test

**Files:**

- No new files — manual verification

**Context:** Verify the full flow works end-to-end: marketplace → deploy → scan → review → test chat → deploy. This is a manual test because it requires a running dashboard with a database and Anthropic API key.

- [ ] **Step 1: Run full build**

Run: `npx pnpm@9.15.4 build`
Expected: All packages build successfully

- [ ] **Step 2: Run all tests**

Run: `npx pnpm@9.15.4 test -- --run`
Expected: All tests pass

- [ ] **Step 3: Run full typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: No type errors

- [ ] **Step 4: Commit any fixes if needed**

```bash
git add -A && git commit -m "fix: address integration issues from deploy flow smoke test"
```

---

### Task 13: Clean Up Old Persona Deploy Route

**Files:**

- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/persona/deploy/route.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

**Context:** The old `/api/dashboard/marketplace/persona/deploy` route and `deploySalesPipeline` method in `api-client.ts` are no longer needed — all deployments now go through `/api/dashboard/marketplace/listings/[id]/deploy`. Remove the old route and API client method. Check for any other references before deleting.

- [ ] **Step 1: Check for remaining references**

Run: `grep -r "persona/deploy\|deploySalesPipeline" apps/dashboard/src/ --include="*.ts" --include="*.tsx" -l`
Expected: Only the route and api-client files

- [ ] **Step 2: Remove the old persona deploy route**

Delete or empty `apps/dashboard/src/app/api/dashboard/marketplace/persona/deploy/route.ts`.

- [ ] **Step 3: Remove deploySalesPipeline from api-client**

Remove the `deploySalesPipeline` method from `apps/dashboard/src/lib/api-client.ts`.

- [ ] **Step 4: Remove the corresponding API route if it exists**

Check `apps/api/src/routes/marketplace-persona.ts` — if this is the backend for the old route, remove it.

- [ ] **Step 5: Verify it compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(dashboard): remove old persona deploy route (replaced by listings deploy)"
```
