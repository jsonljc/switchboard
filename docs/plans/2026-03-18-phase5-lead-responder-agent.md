# Phase 5: Lead Responder Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Lead Responder — the first hireable AI agent — that receives `lead.received` events, scores/qualifies leads, handles objections, and escalates when needed.

**Architecture:** The Lead Responder implements `AgentHandler` from `packages/agents`. It accepts injected dependencies (scoring function, objection matcher) so it stays in Layer 3 without importing from cartridges. The app layer wires cartridge functions to these injection points. The handler produces `AgentResponse` with outbound events (`lead.qualified`, `lead.disqualified`, `conversation.escalated`) and action requests for cartridge execution.

**Tech Stack:** TypeScript, Vitest, existing `AgentPort`/`AgentHandler` interfaces, `createEventEnvelope`

**Key constraint:** `packages/agents` is Layer 3 — it CANNOT import from cartridges. The Lead Responder defines its own dependency interfaces; the app layer adapts cartridge implementations to match.

---

## Task 1: Lead Responder Port Declaration

Define the agent's identity — what events it accepts/emits, what tools it exposes, what config it needs.

**Files:**

- Create: `packages/agents/src/agents/lead-responder/port.ts`
- Create: `packages/agents/src/agents/lead-responder/__tests__/port.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/lead-responder/__tests__/port.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { LEAD_RESPONDER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Lead Responder Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(LEAD_RESPONDER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lead.received events", () => {
    expect(LEAD_RESPONDER_PORT.inboundEvents).toContain("lead.received");
  });

  it("emits qualification and escalation events", () => {
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("lead.qualified");
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("lead.disqualified");
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares qualify_lead and handle_objection tools", () => {
    const toolNames = LEAD_RESPONDER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("handle_objection");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/agents/lead-responder/port.ts`:

```typescript
// ---------------------------------------------------------------------------
// Lead Responder — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const LEAD_RESPONDER_PORT: AgentPort = {
  agentId: "lead-responder",
  version: "0.1.0",
  inboundEvents: ["lead.received"],
  outboundEvents: ["lead.qualified", "lead.disqualified", "conversation.escalated"],
  tools: [
    {
      name: "qualify_lead",
      description: "Score and qualify an inbound lead based on engagement signals",
      parameters: {
        contactId: "string",
        serviceValue: "number",
        urgencyLevel: "number (0-10)",
        source: "referral | organic | paid | walk_in | other",
        engagementScore: "number (0-10)",
        budgetIndicator: "number (0-10)",
      },
    },
    {
      name: "handle_objection",
      description: "Match an objection against known responses and provide a reply",
      parameters: {
        contactId: "string",
        objectionText: "string",
      },
    },
  ],
  configSchema: {
    qualificationThreshold: "number (default: 40)",
    autoQualify: "boolean (default: true)",
    maxTurnsBeforeEscalation: "number (default: 10)",
  },
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/lead-responder/port.ts packages/agents/src/agents/lead-responder/__tests__/port.test.ts
git commit -m "feat(agents): add Lead Responder port declaration"
```

---

## Task 2: Lead Responder Dependencies Interface

Define the injection points for cartridge functions. These are simple function types that the Lead Responder uses internally — the app layer provides implementations.

**Files:**

- Create: `packages/agents/src/agents/lead-responder/types.ts`

**Step 1: Write the types file**

Create `packages/agents/src/agents/lead-responder/types.ts`:

```typescript
// ---------------------------------------------------------------------------
// Lead Responder — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

/**
 * Lead scoring result. Mirrors the cartridge's LeadScoreResult
 * without creating a cross-layer import.
 */
export interface LeadScore {
  score: number;
  tier: "hot" | "warm" | "cool" | "cold";
  factors: Array<{ factor: string; contribution: number }>;
}

/**
 * Objection match result.
 */
export type ObjectionMatch =
  | { matched: true; category: string; response: string; followUp?: string }
  | { matched: false };

/**
 * Dependencies injected into the Lead Responder handler.
 * The app layer wires these from cartridge implementations.
 */
export interface LeadResponderDeps {
  /** Score a lead from event payload fields. Returns 0-100 score + tier. */
  scoreLead: (params: Record<string, unknown>) => LeadScore;

  /** Match objection text against known response trees. */
  matchObjection?: (text: string) => ObjectionMatch;
}
```

No test needed — these are pure type declarations with no runtime behavior.

**Step 2: Run typecheck to verify**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 3: Commit**

```bash
git add packages/agents/src/agents/lead-responder/types.ts
git commit -m "feat(agents): add Lead Responder dependency types"
```

---

## Task 3: Lead Responder Handler — Qualification Flow

The core handler: receives `lead.received`, scores the lead, emits `lead.qualified` or `lead.disqualified`.

**Files:**

- Create: `packages/agents/src/agents/lead-responder/handler.ts`
- Create: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LeadResponderHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";
import type { LeadResponderDeps } from "../types.js";

function makeDeps(overrides: Partial<LeadResponderDeps> = {}): LeadResponderDeps {
  return {
    scoreLead: vi.fn().mockReturnValue({
      score: 75,
      tier: "hot" as const,
      factors: [{ factor: "engagement", contribution: 15 }],
    }),
    ...overrides,
  };
}

function makeLeadEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.received",
    source: { type: "webhook", id: "telegram" },
    payload: {
      contactId: "c1",
      email: "john@example.com",
      firstName: "John",
      source: "paid",
      engagementScore: 8,
      ...payload,
    },
    attribution: {
      fbclid: "fb-abc",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring",
    },
  });
}

describe("LeadResponderHandler", () => {
  it("emits lead.qualified when score meets threshold", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(
      event,
      { autoQualify: true },
      {
        organizationId: "org-1",
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("lead.qualified");
    expect(response.events[0]!.organizationId).toBe("org-1");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        score: 75,
        tier: "hot",
      }),
    );
  });

  it("forwards attribution chain to outbound events", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("emits lead.disqualified when score below threshold", async () => {
    const deps = makeDeps({
      scoreLead: vi.fn().mockReturnValue({
        score: 20,
        tier: "cold" as const,
        factors: [],
      }),
    });
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("lead.disqualified");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        score: 20,
        tier: "cold",
        reason: "below_threshold",
      }),
    );
  });

  it("uses custom qualification threshold from config", async () => {
    const deps = makeDeps({
      scoreLead: vi.fn().mockReturnValue({
        score: 55,
        tier: "warm" as const,
        factors: [],
      }),
    });
    const handler = new LeadResponderHandler(deps);

    // Default threshold is 40, so score 55 qualifies
    const r1 = await handler.handle(makeLeadEvent(), {}, { organizationId: "org-1" });
    expect(r1.events[0]!.eventType).toBe("lead.qualified");

    // Raise threshold to 60, so score 55 disqualifies
    const r2 = await handler.handle(
      makeLeadEvent(),
      { qualificationThreshold: 60 },
      { organizationId: "org-1" },
    );
    expect(r2.events[0]!.eventType).toBe("lead.disqualified");
  });

  it("returns qualify_lead action request", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.lead.qualify",
        }),
      ]),
    );
  });

  it("passes event payload to scoreLead", async () => {
    const scoreFn = vi.fn().mockReturnValue({ score: 50, tier: "warm", factors: [] });
    const handler = new LeadResponderHandler({ scoreLead: scoreFn });

    const event = makeLeadEvent({ serviceValue: 200, urgencyLevel: 8 });
    await handler.handle(event, {}, { organizationId: "org-1" });

    expect(scoreFn).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceValue: 200,
        urgencyLevel: 8,
      }),
    );
  });

  it("sets causationId to the inbound event id", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = makeLeadEvent();
    const response = await handler.handle(event, {}, { organizationId: "org-1" });

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores non-lead.received events", async () => {
    const deps = makeDeps();
    const handler = new LeadResponderHandler(deps);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/agents/lead-responder/handler.ts`:

```typescript
// ---------------------------------------------------------------------------
// Lead Responder — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";
import type { LeadResponderDeps, ObjectionMatch } from "./types.js";

const DEFAULT_THRESHOLD = 40;

export class LeadResponderHandler implements AgentHandler {
  constructor(private deps: LeadResponderDeps) {}

  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.received") {
      return { events: [], actions: [] };
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const threshold = (config.qualificationThreshold as number) ?? DEFAULT_THRESHOLD;

    // Score the lead
    const scoreResult = this.deps.scoreLead(payload);
    const qualified = scoreResult.score >= threshold;

    // Build outbound event
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

    // Build action request for cartridge execution
    const actions = [
      {
        actionType: "customer-engagement.lead.qualify",
        parameters: {
          contactId,
          ...payload,
          sourceAdId: event.attribution?.sourceAdId,
          sourceCampaignId: event.attribution?.sourceCampaignId,
        },
      },
    ];

    // Handle objection if present
    const objectionText = payload.objectionText as string | undefined;
    const objectionResult = this.handleObjection(objectionText, contactId, actions);

    // Check for escalation
    const escalationEvent = this.checkEscalation(
      objectionResult,
      event,
      config,
      context,
      contactId,
    );

    const events = [outboundEvent];
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
      },
    };
  }

  private handleObjection(
    objectionText: string | undefined,
    contactId: string,
    actions: Array<{ actionType: string; parameters: Record<string, unknown> }>,
  ): ObjectionMatch | undefined {
    if (!objectionText || !this.deps.matchObjection) {
      return undefined;
    }

    const match = this.deps.matchObjection(objectionText);
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

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/lead-responder/handler.ts packages/agents/src/agents/lead-responder/__tests__/handler.test.ts
git commit -m "feat(agents): add Lead Responder handler with qualification flow"
```

---

## Task 4: Lead Responder Handler — Objection and Escalation Tests

Add tests for the objection handling and escalation paths that Task 3 implemented.

**Files:**

- Modify: `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts`

**Step 1: Add objection and escalation tests**

Append to the existing `describe("LeadResponderHandler", ...)` block in the test file:

```typescript
it("adds objection handling action when objectionText present", async () => {
  const deps = makeDeps({
    matchObjection: vi.fn().mockReturnValue({
      matched: true,
      category: "price",
      response: "We offer flexible payment plans",
      followUp: "Would you like to see our pricing?",
    }),
  });
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent({ objectionText: "too expensive" });
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  expect(response.actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actionType: "customer-engagement.conversation.handle_objection",
        parameters: expect.objectContaining({
          contactId: "c1",
          objectionText: "too expensive",
        }),
      }),
    ]),
  );
  // No escalation when objection matched
  expect(response.events.find((e) => e.eventType === "conversation.escalated")).toBeUndefined();
});

it("emits conversation.escalated when objection not matched", async () => {
  const deps = makeDeps({
    matchObjection: vi.fn().mockReturnValue({ matched: false }),
  });
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent({ objectionText: "I have an alien condition" });
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
  expect(escalation).toBeDefined();
  expect(escalation!.payload).toEqual(
    expect.objectContaining({
      contactId: "c1",
      reason: "unmatched_objection",
    }),
  );
});

it("emits conversation.escalated when max turns exceeded", async () => {
  const deps = makeDeps();
  const handler = new LeadResponderHandler(deps);

  const history = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));

  const event = makeLeadEvent();
  const response = await handler.handle(
    event,
    { maxTurnsBeforeEscalation: 10 },
    { organizationId: "org-1", conversationHistory: history },
  );

  const escalation = response.events.find((e) => e.eventType === "conversation.escalated");
  expect(escalation).toBeDefined();
  expect(escalation!.payload).toEqual(
    expect.objectContaining({
      reason: "max_turns_exceeded",
      turnCount: 12,
    }),
  );
});

it("does not escalate when under max turns and no objection", async () => {
  const deps = makeDeps();
  const handler = new LeadResponderHandler(deps);

  const history = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello!" },
  ];

  const event = makeLeadEvent();
  const response = await handler.handle(
    event,
    {},
    { organizationId: "org-1", conversationHistory: history },
  );

  expect(response.events.find((e) => e.eventType === "conversation.escalated")).toBeUndefined();
});

it("preserves handler state with score info", async () => {
  const deps = makeDeps();
  const handler = new LeadResponderHandler(deps);

  const event = makeLeadEvent();
  const response = await handler.handle(event, {}, { organizationId: "org-1" });

  expect(response.state).toEqual({
    lastScore: 75,
    lastTier: "hot",
    qualified: true,
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS (all 13 handler tests)

**Step 3: Commit**

```bash
git add packages/agents/src/agents/lead-responder/__tests__/handler.test.ts
git commit -m "test(agents): add objection handling and escalation tests for Lead Responder"
```

---

## Task 5: Barrel Exports + Final Build Verification

**Files:**

- Create: `packages/agents/src/agents/lead-responder/index.ts`
- Modify: `packages/agents/src/index.ts`

**Step 1: Create lead-responder barrel**

Create `packages/agents/src/agents/lead-responder/index.ts`:

```typescript
export { LEAD_RESPONDER_PORT } from "./port.js";
export { LeadResponderHandler } from "./handler.js";
export type { LeadResponderDeps, LeadScore, ObjectionMatch } from "./types.js";
```

**Step 2: Update main barrel**

Add to `packages/agents/src/index.ts`:

```typescript
export {
  LEAD_RESPONDER_PORT,
  LeadResponderHandler,
  type LeadResponderDeps,
  type LeadScore,
  type ObjectionMatch,
} from "./agents/lead-responder/index.js";
```

**Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 4: Run full agents tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 5: Run workspace build**

Run: `cd /Users/jasonljc/switchboard && npx pnpm build`
Expected: all packages build (dashboard may fail on Google Fonts — unrelated)

**Step 6: Run full workspace tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm test`
Expected: no regressions

**Step 7: Commit**

```bash
git add packages/agents/src/agents/lead-responder/index.ts packages/agents/src/index.ts
git commit -m "feat(agents): complete Lead Responder agent with barrel exports"
```

---

## Implementation Order

```
Task 1:  Port declaration                (standalone)
Task 2:  Dependency types                (standalone)
Task 3:  Handler — qualification flow    (depends on Task 1, 2)
Task 4:  Objection + escalation tests    (depends on Task 3)
Task 5:  Barrel exports + final build    (depends on all above)
```

Tasks 1, 2 are independent.
Task 3 depends on Tasks 1, 2.
Task 4 depends on Task 3.
Task 5 is the final gate.

## Files Summary

| Action | File                                                                  | Task   |
| ------ | --------------------------------------------------------------------- | ------ |
| CREATE | `packages/agents/src/agents/lead-responder/port.ts`                   | T1     |
| CREATE | `packages/agents/src/agents/lead-responder/__tests__/port.test.ts`    | T1     |
| CREATE | `packages/agents/src/agents/lead-responder/types.ts`                  | T2     |
| CREATE | `packages/agents/src/agents/lead-responder/handler.ts`                | T3     |
| CREATE | `packages/agents/src/agents/lead-responder/__tests__/handler.test.ts` | T3, T4 |
| CREATE | `packages/agents/src/agents/lead-responder/index.ts`                  | T5     |
| MODIFY | `packages/agents/src/index.ts`                                        | T5     |
