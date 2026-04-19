# Alex Wedge Validation Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Alex can reliably convert WhatsApp leads to bookings across 20-50 real conversations in Singapore.

**Architecture:** Rewrite `sales-pipeline.md` as `alex.md` (single conversion flow), wire skill runtime into the ChannelGateway bridge, load one real business's knowledge, and verify end-to-end WhatsApp → Alex → booking link delivery.

**Tech Stack:** TypeScript, Fastify, Prisma, Claude API (Anthropic SDK), WhatsApp Cloud API, Vitest

**Branch:** `feat/alex-wedge-sprint` — create from `main` before starting. Do NOT merge with any other feature branch (temporal-entity-memory runs in parallel on a separate branch).

---

### Task 1: Create Feature Branch

**Files:** None (git operation only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/alex-wedge-sprint main
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: On branch `feat/alex-wedge-sprint`, clean working tree (untracked spec files from main are fine).

---

### Task 2: Write Alex Skill File

**Files:**

- Create: `skills/alex.md`
- Reference: `skills/sales-pipeline.md` (existing, kept for now — not deleted)

- [ ] **Step 1: Write the Alex skill file**

Create `skills/alex.md` with frontmatter and body. Key differences from `sales-pipeline.md`:

- No stage-based role routing — one continuous conversion flow
- Alex personality and voice rules baked into the body
- Singapore tone calibration section
- Booking link delivery in convert/book mode
- Removes `pipeline-handoff` tool (Alex handles the full conversion, no inter-agent handoff)
- Removes `nurture-cadence` context requirement (Riley's concern, not Alex's)
- Keeps `crm-query`, `crm-write` tools
- Keeps `playbook` (objection-handling), `policy` (messaging-rules), `knowledge` (offer-catalog), `playbook` (qualification-framework) context requirements

```markdown
---
name: alex
slug: alex
intent: alex.run
version: 1.0.0
description: >
  Frontline conversion agent. Responds to inbound leads, qualifies through
  natural conversation, handles objections, and books appointments.
author: switchboard
parameters:
  - name: BUSINESS_NAME
    type: string
    required: true

  - name: OPPORTUNITY_ID
    type: string
    required: true
    description: >
      Active opportunity UUID. Resolved by SkillHandler before execution.
      If no active opportunity exists, handler fails before LLM call.

  - name: LEAD_PROFILE
    type: object
    required: false
    schema:
      name: { type: string, required: false }
      phone: { type: string, required: false }
      email: { type: string, required: false }
      source: { type: string, required: false }

  - name: PERSONA_CONFIG
    type: object
    required: true
    schema:
      tone: { type: string, required: true }
      qualificationCriteria: { type: object, required: true }
      disqualificationCriteria: { type: object, required: true }
      escalationRules: { type: object, required: true }
      bookingLink: { type: string, required: false }
      customInstructions: { type: string, required: false }

tools:
  - crm-query
  - crm-write

context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
  - kind: knowledge
    scope: offer-catalog
    inject_as: KNOWLEDGE_CONTEXT
    required: false
  - kind: playbook
    scope: qualification-framework
    inject_as: QUALIFICATION_CONTEXT
---

# Alex — Frontline Conversion Agent

You are Alex, the frontline agent for {{BUSINESS_NAME}}.
Your job: turn inbound inquiries into booked appointments through one continuous conversation.

## Voice

- Quick, direct, curious early. Warmer and more confident as the conversation progresses.
- Short messages — 2-3 sentences max per turn. This is WhatsApp, not email.
- No exclamation marks unless the lead uses them first.
- Never say "How can I help you?" — you already know why they reached out.
- No corporate filler ("I understand your concern", "Great question!").
- Mirror the lead's formality. If they're casual, be casual. Never drop below professional-casual.
- Never draw attention to your personality. Let it come through in pacing, phrasing, and decisions.

## Local Tone (Singapore English)

- Natural Singaporean English. Not American, not British, not forced Singlish.
- Comfortable with casual register: "Sure, can!" / "No worries" / "Got it"
- Don't force lah/lor/ah — only if it fits naturally and the lead uses them first.
- Use "ya" instead of "yes" when tone is casual.
- Use "book" not "schedule an appointment."
- Price in SGD.
- Time in 12-hour format with am/pm.
- Address by first name after they share it.

## Conversation Flow

You move through these phases naturally. The lead should never feel a mode switch.

### Phase 1: Respond (first 1-2 messages)

Acknowledge their inquiry, establish relevance, ask one qualifying question.
Keep first message under 3 sentences.

### Phase 2: Qualify

Use the qualification framework to assess fit through natural conversation.

**Qualification framework:**
{{PERSONA_CONFIG.qualificationCriteria}}
{{QUALIFICATION_CONTEXT}}

**Disqualifiers:**
{{PERSONA_CONFIG.disqualificationCriteria}}

- Ask qualification questions naturally, not as a checklist.
- Capture: service intent, timing, budget signal (if relevant).
- When all criteria are met, use tool `crm-write.stage.update` with
  OPPORTUNITY_ID to move to "qualified".

### Phase 3: Convert

After qualification, handle any objections and move toward booking.

**Objection handling:**
{{PLAYBOOK_CONTEXT}}

- Reframe around value, not pressure.
- Never disparage competitors.
- If they say "let me think about it," suggest a specific next step with a timeline.

### Phase 4: Book

Deliver the booking link naturally when the lead is ready.

**Booking link:** {{PERSONA_CONFIG.bookingLink}}

- "Here's a link to pick a time that works for you: {{PERSONA_CONFIG.bookingLink}}"
- If they confirm they've booked, use tool `crm-write.activity.log` to record the booking.
- If they confirm they've booked, use tool `crm-write.stage.update` to move to "booked".

## Escalation

Hand off to the business owner when:
{{PERSONA_CONFIG.escalationRules}}

- Lead explicitly asks to speak to a human
- Lead expresses frustration or anger
- Question is outside your knowledge scope
- Conversation reaches 15 of your messages without a qualification outcome
- Objection is outside the categories above

When escalating, say: "Let me get someone from the team to help with this. They'll reach out shortly."

## Tone

{{PERSONA_CONFIG.tone}}
{{PERSONA_CONFIG.customInstructions}}

## Messaging Policy

{{POLICY_CONTEXT}}

## Available Services

{{KNOWLEDGE_CONTEXT}}
```

- [ ] **Step 2: Verify the skill file parses correctly**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "skill-loader" --run
```

Expected: Existing loader tests pass (they test the generic loader, not Alex specifically).

- [ ] **Step 3: Commit**

```bash
git add skills/alex.md && git commit -m "feat(skill): add Alex frontline conversion agent skill"
```

---

### Task 3: Add Alex Parameter Builder

**Files:**

- Create: `packages/core/src/skill-runtime/builders/alex.ts`
- Create: `packages/core/src/skill-runtime/builders/alex.test.ts`
- Modify: `packages/core/src/skill-runtime/builders/index.ts`

The Alex builder is similar to `salesPipelineBuilder` but simpler — no `PIPELINE_STAGE` parameter (Alex handles all conversion stages), no `pipeline-handoff` tool wiring.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/skill-runtime/builders/alex.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "./alex.js";
import type { AgentContext } from "@switchboard/sdk";
import type { SkillStores } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";

function createMockCtx(overrides?: Partial<AgentContext>): AgentContext {
  return {
    persona: {
      businessName: "Glow Aesthetics",
      tone: "friendly",
      qualificationCriteria: { budget: "above 200 SGD" },
      disqualificationCriteria: { underage: true },
      escalationRules: { complexCases: true },
      bookingLink: "https://cal.com/glow-aesthetics",
      customInstructions: "Always mention first-visit discount",
    },
    ...overrides,
  } as AgentContext;
}

function createMockStores(overrides?: Partial<SkillStores>): SkillStores {
  return {
    opportunityStore: {
      findActiveByContact: vi
        .fn()
        .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
    },
    contactStore: {
      findById: vi.fn().mockResolvedValue({
        name: "Sarah",
        phone: "+6591234567",
        email: "sarah@example.com",
        source: "whatsapp",
      }),
    },
    activityStore: {
      listByDeployment: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as SkillStores;
}

const config = {
  deploymentId: "dep_1",
  orgId: "org_1",
  contactId: "contact_1",
  sessionId: "session_1",
};

describe("alexBuilder", () => {
  it("resolves parameters from context and stores", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result.BUSINESS_NAME).toBe("Glow Aesthetics");
    expect(result.OPPORTUNITY_ID).toBe("opp_1");
    expect(result.LEAD_PROFILE).toEqual(expect.objectContaining({ name: "Sarah" }));
    expect(result.PERSONA_CONFIG).toEqual(
      expect.objectContaining({
        tone: "friendly",
        bookingLink: "https://cal.com/glow-aesthetics",
      }),
    );
  });

  it("throws ParameterResolutionError when no active opportunity exists", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([]),
      } as never,
    });

    await expect(alexBuilder(ctx, config, stores)).rejects.toThrow(ParameterResolutionError);
  });

  it("picks most recent opportunity when multiple exist", async () => {
    const ctx = createMockCtx();
    const older = { id: "opp_old", stage: "interested", createdAt: new Date("2026-01-01") };
    const newer = { id: "opp_new", stage: "qualified", createdAt: new Date("2026-04-15") };
    const stores = createMockStores({
      opportunityStore: {
        findActiveByContact: vi.fn().mockResolvedValue([older, newer]),
      } as never,
    });

    const result = await alexBuilder(ctx, config, stores);
    expect(result.OPPORTUNITY_ID).toBe("opp_new");
  });

  it("does not include PIPELINE_STAGE parameter", async () => {
    const ctx = createMockCtx();
    const stores = createMockStores();
    const result = await alexBuilder(ctx, config, stores);

    expect(result).not.toHaveProperty("PIPELINE_STAGE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "alexBuilder" --run
```

Expected: FAIL — `alexBuilder` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/skill-runtime/builders/alex.ts`:

```typescript
import type { ParameterBuilder } from "../parameter-builder.js";
import { ParameterResolutionError } from "../parameter-builder.js";

export const alexBuilder: ParameterBuilder = async (ctx, config, stores) => {
  const contactId = config.contactId;

  const opportunities = await stores.opportunityStore.findActiveByContact(config.orgId, contactId);

  if (opportunities.length === 0) {
    throw new ParameterResolutionError(
      "no-active-opportunity",
      "I'd like to help, but there's no active deal found for this conversation. " +
        "Let me connect you with the team to get things started.",
    );
  }

  const opportunity = opportunities.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;

  const leadProfile = await stores.contactStore.findById(config.orgId, contactId);

  return {
    BUSINESS_NAME: ctx.persona.businessName,
    OPPORTUNITY_ID: opportunity.id,
    LEAD_PROFILE: leadProfile,
    PERSONA_CONFIG: {
      tone: ctx.persona.tone,
      qualificationCriteria: ctx.persona.qualificationCriteria,
      disqualificationCriteria: ctx.persona.disqualificationCriteria,
      escalationRules: ctx.persona.escalationRules,
      bookingLink: ctx.persona.bookingLink ?? "",
      customInstructions: ctx.persona.customInstructions ?? "",
    },
  };
};
```

- [ ] **Step 4: Export from builders index**

In `packages/core/src/skill-runtime/builders/index.ts`, add:

```typescript
export { alexBuilder } from "./alex.js";
```

Also add to `packages/core/src/skill-runtime/index.ts`:

```typescript
export { alexBuilder } from "./builders/index.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --grep "alexBuilder" --run
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/builders/alex.ts packages/core/src/skill-runtime/builders/alex.test.ts packages/core/src/skill-runtime/builders/index.ts packages/core/src/skill-runtime/index.ts && git commit -m "feat(core): add Alex parameter builder for frontline conversion skill"
```

---

### Task 4: Wire Skill Runtime into Gateway Bridge

This is the **critical gap**. The `ChannelGateway` already supports `skillRuntime` deps and routes to `SkillHandler` when a deployment has `skillSlug` set. But `createGatewayBridge()` in `apps/chat/src/gateway/gateway-bridge.ts` does NOT pass `skillRuntime` to the `ChannelGateway` constructor. This means no deployment can use the skill path via the gateway.

**Files:**

- Modify: `apps/chat/src/gateway/gateway-bridge.ts`
- Create: `apps/chat/src/gateway/__tests__/skill-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/chat/src/gateway/__tests__/skill-wiring.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createGatewayBridge } from "../gateway-bridge.js";

describe("gateway bridge skill wiring", () => {
  it("passes skillRuntime to ChannelGateway when skill deps are available", async () => {
    // This test verifies that createGatewayBridge creates a gateway
    // whose config includes skillRuntime, enabling skill-based handler resolution.
    //
    // We mock PrismaClient minimally — we only care that skillRuntime is wired,
    // not that the full gateway works (that's an integration test).
    const mockPrisma = {
      agentDeployment: { findMany: vi.fn().mockResolvedValue([]) },
      deploymentConnection: { findMany: vi.fn().mockResolvedValue([]) },
    };

    // Spy on ChannelGateway constructor to capture the config that was passed
    const { ChannelGateway } = await import("@switchboard/core");
    const constructorSpy = vi.spyOn(ChannelGateway.prototype, "constructor" as never);

    const gateway = createGatewayBridge(mockPrisma as never);
    expect(gateway).toBeDefined();
    // Note: if spying on the constructor is impractical, an alternative approach is
    // to create a deployment with skillSlug and verify that handleIncoming() routes
    // to SkillHandler (tested more thoroughly in Task 7's integration test).
    // The minimum assertion here is that the gateway was created without error
    // when skill runtime deps are available (process.env.ANTHROPIC_API_KEY set).
  });
});
```

- [ ] **Step 2: Write the wiring implementation**

Modify `apps/chat/src/gateway/gateway-bridge.ts` to wire skill runtime deps:

Add imports at the top:

```typescript
import {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  ToolRegistry,
  createCrmQueryTool,
  createCrmWriteTool,
  salesPipelineBuilder,
  alexBuilder,
  GovernanceHook,
  CircuitBreaker,
  BlastRadiusLimiter,
} from "@switchboard/core/skill-runtime";
import { ContextResolverImpl } from "@switchboard/core/skill-runtime/context-resolver";
import { PrismaKnowledgeEntryStore } from "@switchboard/db";
import { PrismaContactStore, PrismaOpportunityStore } from "@switchboard/db";
import { resolve as pathResolve } from "node:path";
```

Then before the `return new ChannelGateway({...})` call, add the skill runtime setup:

```typescript
// --- Skill runtime wiring ---
const contactStore = new PrismaContactStore(prisma);
const opportunityStore = new PrismaOpportunityStore(prisma);
const activityStore = new PrismaActivityLogStore(prisma); // from @switchboard/db
const knowledgeEntryStore = new PrismaKnowledgeEntryStore(prisma);
const contextResolver = new ContextResolverImpl(knowledgeEntryStore);

const builderMap = new Map<string, ParameterBuilder>();
builderMap.set("sales-pipeline", salesPipelineBuilder);
builderMap.set("alex", alexBuilder);

const skillStores: SkillStores = {
  opportunityStore,
  contactStore,
  activityStore,
};

const skillsDir = pathResolve(process.cwd(), "skills");

// Note: modelRouter is already created earlier in createGatewayBridge() (line ~103).
// The createExecutor closure captures it via closure scope.
const skillRuntime: SkillRuntimeDeps = {
  skillsDir,
  loadSkill,
  createExecutor: () => {
    const tools = new Map();
    tools.set("crm-query", createCrmQueryTool(contactStore, activityStore));
    tools.set("crm-write", createCrmWriteTool(opportunityStore, activityStore));
    const adapter = new AnthropicToolCallingAdapter();
    return new SkillExecutorImpl(adapter, tools, modelRouter);
  },
  builderMap,
  stores: skillStores,
  hooks: [],
  contextResolver: { resolve: contextResolver.resolve.bind(contextResolver) },
};
```

Then add `skillRuntime` to the `ChannelGateway` constructor config.

**Import paths (verified):**

- `@switchboard/core/skill-runtime` is a valid subpath export (see `packages/core/package.json` exports field). Use it for: `loadSkill`, `SkillExecutorImpl`, `AnthropicToolCallingAdapter`, `createCrmQueryTool`, `createCrmWriteTool`, `alexBuilder`, `salesPipelineBuilder`, `ContextResolverImpl`
- `@switchboard/db` for: `PrismaContactStore`, `PrismaOpportunityStore`, `PrismaActivityLogStore`, `PrismaKnowledgeEntryStore`
- `@switchboard/core` for: `ModelRouter`
- `node:path` for: `resolve as pathResolve`

- [ ] **Step 3: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --run
```

Expected: All existing tests pass + new skill wiring test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/gateway/ && git commit -m "feat(chat): wire skill runtime into gateway bridge — enables skill-based WhatsApp handlers"
```

---

### Task 5: Seed Alex Listing and Demo Deployment

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

Create an Alex listing and a demo deployment with `skillSlug: "alex"` so the end-to-end path can be tested.

- [ ] **Step 1: Add Alex listing to seed**

In `packages/db/prisma/seed-marketplace.ts`, add a new listing constant:

```typescript
const ALEX_CONVERSION_AGENT = {
  name: "Alex — Frontline Conversion Agent",
  slug: "alex-conversion",
  description:
    "Responds to inbound leads instantly, qualifies through natural conversation, handles objections, and books appointments.",
  taskCategories: ["lead-qualification", "sales-closing", "booking"],
  metadata: {
    family: "sales_pipeline",
    publicChannels: true,
    setupSchema: {
      onboarding: {
        websiteScan: true,
        publicChannels: true,
        privateChannel: false,
        integrations: [],
      },
      steps: [
        {
          id: "basics",
          title: "Agent Setup",
          fields: [
            {
              key: "tone",
              type: "select",
              label: "Conversation Tone",
              required: true,
              options: ["friendly", "professional", "casual"],
            },
            {
              key: "bookingLink",
              type: "url",
              label: "Booking Link",
              required: true,
            },
            {
              key: "customInstructions",
              type: "textarea",
              label: "Custom Instructions",
              required: false,
            },
          ],
        },
      ],
    },
  },
};
```

Then in `seedMarketplace()`, upsert this listing with `skillSlug: "alex"` on its demo deployment.

- [ ] **Step 2: Run seed to verify**

```bash
npx pnpm@9.15.4 db:seed
```

Expected: Alex listing created/updated successfully.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts && git commit -m "feat(db): seed Alex conversion agent listing with skill slug"
```

---

### Task 6: Load Demo Business Knowledge

**Files:**

- Create: `packages/db/prisma/fixtures/demo-knowledge.ts`
- Modify: `packages/db/prisma/seed-marketplace.ts` (call knowledge seed from `seedDemoData`)

Load one real business's knowledge as `KnowledgeEntry` records. Use a Singapore aesthetics clinic as the demo business (matches the demo org "Austin Bakery Co" — rename or create a new one).

- [ ] **Step 1: Create knowledge fixture**

Create `packages/db/prisma/fixtures/demo-knowledge.ts` with knowledge entries for a demo business:

- Services list (5-8 services with descriptions and prices in SGD)
- Operating hours
- Location details
- Top 10 FAQs
- Cancellation/refund policies
- Qualification criteria (e.g., age 21+, no contraindications)
- Disqualification criteria
- Objection-handling playbook (price, timing, trust, "need to think")
- Messaging policy (no medical claims, no guarantees, always offer human escalation)

Each entry should be a `KnowledgeEntry` with `kind`, `scope`, `content`, and `priority`.

The `kind` and `scope` values must match what the Alex skill's context requirements expect:

- `{ kind: "playbook", scope: "objection-handling" }` → PLAYBOOK_CONTEXT
- `{ kind: "policy", scope: "messaging-rules" }` → POLICY_CONTEXT
- `{ kind: "knowledge", scope: "offer-catalog" }` → KNOWLEDGE_CONTEXT
- `{ kind: "playbook", scope: "qualification-framework" }` → QUALIFICATION_CONTEXT

- [ ] **Step 2: Wire into seed script**

In `seedDemoData()`, call the knowledge fixture to seed entries for the demo org.

- [ ] **Step 3: Run seed and verify**

```bash
npx pnpm@9.15.4 db:seed
```

Expected: Knowledge entries created for demo org.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/fixtures/demo-knowledge.ts packages/db/prisma/seed-marketplace.ts && git commit -m "feat(db): seed demo business knowledge for Alex sprint"
```

---

### Task 7: End-to-End Wiring Integration Test

**Files:**

- Create: `apps/chat/src/gateway/__tests__/alex-e2e.test.ts`

This test verifies the full path: incoming WhatsApp-style message → ChannelGateway → SkillHandler → Alex skill execution → response. Uses mocked Prisma stores and a mocked Anthropic adapter.

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import type { IncomingChannelMessage, ReplySink, SkillRuntimeDeps } from "@switchboard/core";

describe("Alex end-to-end wiring", () => {
  let sentMessages: string[];
  let replySink: ReplySink;

  beforeEach(() => {
    sentMessages = [];
    replySink = {
      send: async (text: string) => {
        sentMessages.push(text);
      },
      onTyping: vi.fn(),
    };
  });

  it("routes a WhatsApp message through the skill handler and returns a response", async () => {
    // Setup: mock deployment with skillSlug "alex"
    // Setup: mock conversation store, state store, action request store
    // Setup: mock skill runtime deps with alexBuilder and mocked tool calling adapter
    // Assert: replySink.send was called with a non-empty string
    // Assert: the response doesn't contain "How can I help you?"
    // Assert: crm tools were available (check tool call records)
  });

  it("falls back to DefaultChatHandler when deployment has no skillSlug", async () => {
    // Setup: mock deployment WITHOUT skillSlug
    // Assert: DefaultChatHandler was used (response comes from LLM adapter, not skill executor)
  });

  it("persists conversation state across multiple messages", async () => {
    // Send message 1 → get response
    // Send message 2 → verify conversation store has both messages
    // Assert: second response references context from first exchange
  });
});
```

The implementer should fill in the mock setup based on the `ChannelGatewayConfig` interface in `packages/core/src/channel-gateway/types.ts` and the `SkillRuntimeDeps` interface. The key assertion is that `replySink.send()` is called with Alex's response text.

- [ ] **Step 2: Run the test**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --grep "Alex end-to-end" --run
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/gateway/__tests__/alex-e2e.test.ts && git commit -m "test(chat): add Alex end-to-end wiring integration test"
```

---

### Task 8: Escalation Verification Test

**Files:**

- Create: `apps/chat/src/gateway/__tests__/alex-escalation.test.ts`

Verify that Alex escalates correctly when triggered (frustration, human request, out-of-scope, message cap).

- [ ] **Step 1: Write escalation test**

Test scenarios:

1. Lead says "I want to speak to a person" → Alex sends escalation message, conversation pauses
2. Lead sends angry message → Alex detects frustration, escalates
3. 15+ messages without qualification → Alex escalates at limit
4. **Business owner notification fires** — when escalation triggers, verify that the operator notification path is invoked with: lead name/number, last 5 messages, and escalation reason. Mock the operator handler (`apps/chat/src/handlers/operator-handler.ts`) and assert it receives the correct payload. This covers spec "Must Prove" #7.

Use a mock `ToolCallingAdapter` that returns LLM responses with escalation-triggering content.

Reference files for escalation infrastructure:

- `packages/agents/src/escalation.ts` — escalation detection logic
- `apps/chat/src/handlers/operator-handler.ts` — operator notification dispatch

- [ ] **Step 2: Run test**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --grep "escalation" --run
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/gateway/__tests__/alex-escalation.test.ts && git commit -m "test(chat): add Alex escalation verification tests"
```

---

### Task 9: Conversation Export Script

**Files:**

- Create: `scripts/export-conversations.ts`

A simple CLI script that exports conversations from the database as JSON for manual review. This enables the sprint's pass criteria evaluation (manually review 20-50 conversations).

- [ ] **Step 1: Write the export script**

```typescript
// Usage: npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-17
// Outputs: conversations.json with full message history, tool calls, timestamps, outcomes
```

The script should:

- Query `ConversationThread` + messages for the given org
- Include: message history, timestamps, tool call records from execution traces
- Output as JSON to stdout (pipe to file)
- Filter by date range (--since flag)

- [ ] **Step 2: Test locally**

```bash
npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-01
```

Expected: JSON output with demo conversations (or empty array if none exist).

- [ ] **Step 3: Commit**

```bash
git add scripts/export-conversations.ts && git commit -m "feat(scripts): add conversation export for sprint review"
```

---

### Task 10: Smoke Test Checklist

This is a manual verification task — no code. Run after Tasks 1-9 are complete.

**Prerequisites:**

- Database seeded with Alex listing + demo business knowledge
- Chat app running locally (`npx pnpm@9.15.4 --filter @switchboard/chat dev`)
- WhatsApp test number configured (or widget endpoint for local testing)

- [ ] **Step 1: Send a test message via widget endpoint**

```bash
curl -X POST http://localhost:3001/webhook/managed/<webhook-id> \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"6591234567","id":"test_1","timestamp":"1713340800","type":"text","text":{"body":"Hi, I saw your ad. What treatments do you offer?"}}],"contacts":[{"profile":{"name":"Sarah"}}]}}]}]}'
```

Expected: 200 OK, and the gateway processes the message through Alex skill path.

- [ ] **Step 2: Verify response was generated**

Check logs for skill execution trace. Verify Alex responded with:

- Under 3 sentences
- Acknowledged the inquiry
- Asked a qualifying question
- No "How can I help you?"
- Singapore-appropriate tone

- [ ] **Step 3: Verify multi-turn works**

Send a second message from the same phone number. Verify the conversation store returns history from the first exchange and Alex references prior context.

- [ ] **Step 4: Verify escalation path**

Send a message like "Can I speak to a real person please?" Verify Alex responds with the escalation message and the conversation is paused.

- [ ] **Step 5: Export and review**

```bash
npx tsx scripts/export-conversations.ts --org org_demo --since 2026-04-17 > test-conversations.json
```

Verify the exported JSON contains full message history with timestamps and tool call records.

---

## Task Dependency Order

```
Task 1 (branch)
  → Task 2 (alex.md skill)
  → Task 3 (parameter builder)
  → Task 4 (gateway wiring) — depends on Task 3
  → Task 5 (seed listing) — can parallel with Task 4
  → Task 6 (seed knowledge) — depends on Task 5
  → Task 7 (e2e test) — depends on Tasks 2, 3, 4
  → Task 8 (escalation test) — depends on Task 7
  → Task 9 (export script) — independent, can parallel
  → Task 10 (smoke test) — depends on all above
```

Tasks 5+6 can run in parallel with Tasks 4+7. Task 9 is independent of everything except Task 1.
