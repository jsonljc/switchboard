# Phase 5b: Sales Closer Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Sales Closer — the second hireable agent — that receives `lead.qualified` events, determines the conversion action (book appointment, send booking link, or escalate), emits `stage.advanced`, and returns action requests for the booking cartridge.

**Architecture:** The Sales Closer implements `AgentHandler`. It reads `profile.booking` from `AgentContext` to determine the conversion strategy. Unlike Lead Responder, it doesn't need injected dependencies — the profile config drives all decisions. It produces action requests for `customer-engagement.appointment.book` that the app layer executes.

**Tech Stack:** TypeScript, Vitest, existing `AgentPort`/`AgentHandler` interfaces, `createEventEnvelope`

---

## Task 1: Sales Closer Port Declaration

**Files:**

- Create: `packages/agents/src/agents/sales-closer/port.ts`
- Create: `packages/agents/src/agents/sales-closer/__tests__/port.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/sales-closer/__tests__/port.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SALES_CLOSER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Sales Closer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(SALES_CLOSER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lead.qualified events", () => {
    expect(SALES_CLOSER_PORT.inboundEvents).toContain("lead.qualified");
  });

  it("emits stage.advanced and escalation events", () => {
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("stage.advanced");
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("revenue.recorded");
    expect(SALES_CLOSER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares book_appointment and send_booking_link tools", () => {
    const toolNames = SALES_CLOSER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("book_appointment");
    expect(toolNames).toContain("send_booking_link");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/agents/sales-closer/port.ts`:

```typescript
// ---------------------------------------------------------------------------
// Sales Closer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const SALES_CLOSER_PORT: AgentPort = {
  agentId: "sales-closer",
  version: "0.1.0",
  inboundEvents: ["lead.qualified"],
  outboundEvents: ["stage.advanced", "revenue.recorded", "conversation.escalated"],
  tools: [
    {
      name: "book_appointment",
      description: "Book an appointment for a qualified lead via calendar provider",
      parameters: {
        contactId: "string",
        serviceType: "string",
        startTime: "ISO 8601 datetime",
        durationMinutes: "number (default: 60)",
      },
    },
    {
      name: "send_booking_link",
      description: "Send a self-service booking link to the lead",
      parameters: {
        contactId: "string",
        serviceType: "string",
      },
    },
  ],
  configSchema: {
    defaultServiceType: "string (default: consultation)",
    defaultDurationMinutes: "number (default: 60)",
    maxFollowUpAttempts: "number (default: 3)",
  },
  conversionActionTypes: ["booking", "checkout_link"],
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/sales-closer/port.ts packages/agents/src/agents/sales-closer/__tests__/port.test.ts
git commit -m "feat(agents): add Sales Closer port declaration"
```

---

## Task 2: Sales Closer Handler

The handler receives `lead.qualified` events, reads the profile's booking config to decide the conversion strategy, emits `stage.advanced`, and returns action requests.

**Files:**

- Create: `packages/agents/src/agents/sales-closer/handler.ts`
- Create: `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SalesCloserHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeQualifiedEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "lead.qualified",
    source: { type: "agent", id: "lead-responder" },
    payload: {
      contactId: "c1",
      score: 75,
      tier: "hot",
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

describe("SalesCloserHandler", () => {
  it("emits stage.advanced with booking action when bookingUrl configured", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          booking: { bookingUrl: "https://cal.com/clinic/book" },
        },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("stage.advanced");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        stage: "booking_initiated",
        conversionAction: "booking_link",
      }),
    );
  });

  it("returns send_booking_link action when bookingUrl configured", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          booking: { bookingUrl: "https://cal.com/clinic/book" },
        },
      },
    );

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.appointment.book",
          parameters: expect.objectContaining({
            contactId: "c1",
            bookingUrl: "https://cal.com/clinic/book",
          }),
        }),
      ]),
    );
  });

  it("returns book_appointment action when no bookingUrl (direct calendar)", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {
        defaultServiceType: "teeth-whitening",
        defaultDurationMinutes: 30,
      },
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        conversionAction: "direct_booking",
      }),
    );

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "customer-engagement.appointment.book",
          parameters: expect.objectContaining({
            contactId: "c1",
            serviceType: "teeth-whitening",
            durationMinutes: 30,
          }),
        }),
      ]),
    );
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("escalates when no booking config in profile", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        reason: "no_booking_config",
      }),
    );
  });

  it("escalates when no profile provided", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
      },
    );

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
  });

  it("ignores non-lead.qualified events", async () => {
    const handler = new SalesCloserHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const response = await handler.handle(event, {}, { organizationId: "org-1" });
    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("includes lead score and tier in stage.advanced payload", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent({ score: 85, tier: "hot" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        score: 85,
        tier: "hot",
      }),
    );
  });

  it("passes attribution fields to booking action parameters", async () => {
    const handler = new SalesCloserHandler();
    const event = makeQualifiedEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { booking: {} },
      },
    );

    const bookAction = response.actions.find(
      (a) => a.actionType === "customer-engagement.appointment.book",
    );
    expect(bookAction).toBeDefined();
    expect(bookAction!.parameters.sourceAdId).toBe("ad-1");
    expect(bookAction!.parameters.sourceCampaignId).toBe("camp-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/agents/sales-closer/handler.ts`:

```typescript
// ---------------------------------------------------------------------------
// Sales Closer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";

export class SalesCloserHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType !== "lead.qualified") {
      return { events: [], actions: [] };
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const profile = context.profile ?? {};
    const booking = profile.booking as Record<string, unknown> | undefined;

    // If no booking config, escalate — needs human to configure
    if (!booking) {
      return this.escalate(event, context, contactId, "no_booking_config");
    }

    const bookingUrl = booking.bookingUrl as string | undefined;
    const serviceType = (config.defaultServiceType as string) ?? "consultation";
    const durationMinutes = (config.defaultDurationMinutes as number) ?? 60;

    const conversionAction = bookingUrl ? "booking_link" : "direct_booking";

    // Emit stage.advanced
    const stageEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "stage.advanced",
      source: { type: "agent", id: "sales-closer" },
      payload: {
        contactId,
        stage: "booking_initiated",
        conversionAction,
        score: payload.score,
        tier: payload.tier,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    // Build booking action request
    const bookingParams: Record<string, unknown> = {
      contactId,
      serviceType,
      durationMinutes,
      sourceAdId: event.attribution?.sourceAdId,
      sourceCampaignId: event.attribution?.sourceCampaignId,
    };

    if (bookingUrl) {
      bookingParams.bookingUrl = bookingUrl;
    }

    const actions = [
      {
        actionType: "customer-engagement.appointment.book",
        parameters: bookingParams,
      },
    ];

    return {
      events: [stageEvent],
      actions,
      state: {
        contactId,
        conversionAction,
        stage: "booking_initiated",
      },
    };
  }

  private escalate(
    event: RoutedEventEnvelope,
    context: AgentContext,
    contactId: string,
    reason: string,
  ): AgentResponse {
    const escalationEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "conversation.escalated",
      source: { type: "agent", id: "sales-closer" },
      payload: {
        contactId,
        reason,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [escalationEvent],
      actions: [],
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/sales-closer/handler.ts packages/agents/src/agents/sales-closer/__tests__/handler.test.ts
git commit -m "feat(agents): add Sales Closer handler with booking conversion flow"
```

---

## Task 3: Barrel Exports + Final Build Verification

**Files:**

- Create: `packages/agents/src/agents/sales-closer/index.ts`
- Modify: `packages/agents/src/index.ts`

**Step 1: Create sales-closer barrel**

Create `packages/agents/src/agents/sales-closer/index.ts`:

```typescript
export { SALES_CLOSER_PORT } from "./port.js";
export { SalesCloserHandler } from "./handler.js";
```

**Step 2: Update main barrel**

Add to `packages/agents/src/index.ts`:

```typescript
export { SALES_CLOSER_PORT, SalesCloserHandler } from "./agents/sales-closer/index.js";
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

**Step 6: Commit**

```bash
git add packages/agents/src/agents/sales-closer/index.ts packages/agents/src/index.ts
git commit -m "feat(agents): complete Sales Closer agent with barrel exports"
```

---

## Implementation Order

```
Task 1:  Port declaration          (standalone)
Task 2:  Handler + tests           (depends on Task 1)
Task 3:  Barrel exports + build    (depends on all above)
```

Task 1 is standalone. Task 2 depends on Task 1. Task 3 is the final gate.

## Files Summary

| Action | File                                                                | Task |
| ------ | ------------------------------------------------------------------- | ---- |
| CREATE | `packages/agents/src/agents/sales-closer/port.ts`                   | T1   |
| CREATE | `packages/agents/src/agents/sales-closer/__tests__/port.test.ts`    | T1   |
| CREATE | `packages/agents/src/agents/sales-closer/handler.ts`                | T2   |
| CREATE | `packages/agents/src/agents/sales-closer/__tests__/handler.test.ts` | T2   |
| CREATE | `packages/agents/src/agents/sales-closer/index.ts`                  | T3   |
| MODIFY | `packages/agents/src/index.ts`                                      | T3   |
