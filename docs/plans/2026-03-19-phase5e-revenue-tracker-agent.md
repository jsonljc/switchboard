# Phase 5e: Revenue Tracker Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Revenue Tracker — the fifth hireable agent — that receives `revenue.recorded` events to compute per-campaign attribution (which campaign/ad gets credit for revenue), and `stage.advanced` events to log pipeline progression. It emits `revenue.attributed` for dashboard reporting and produces `crm.activity.log` actions for pipeline tracking.

**Architecture:** The Revenue Tracker implements `AgentHandler`. It reads `profile.revenue` from `AgentContext` to determine attribution config (model, window). Unlike the Ad Optimizer (which sends conversion signals TO ad platforms), the Revenue Tracker computes attribution FOR internal reporting — enriching revenue events with campaign credit data. Like Sales Closer, Nurture, and Ad Optimizer, it uses no injected dependencies. It produces `crm.activity.log` action requests for pipeline tracking that the app layer executes.

**Tech Stack:** TypeScript, Vitest, existing `AgentPort`/`AgentHandler` interfaces, `createEventEnvelope`

---

## Task 1: Revenue Tracker Port Declaration

**Files:**

- Modify: `packages/agents/src/agents/revenue-tracker/port.ts`
- Modify: `packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts`

**Step 1: Write the port test**

Overwrite `packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { REVENUE_TRACKER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Revenue Tracker Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(REVENUE_TRACKER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts revenue.recorded and stage.advanced events", () => {
    expect(REVENUE_TRACKER_PORT.inboundEvents).toContain("revenue.recorded");
    expect(REVENUE_TRACKER_PORT.inboundEvents).toContain("stage.advanced");
  });

  it("emits revenue.attributed and conversation.escalated events", () => {
    expect(REVENUE_TRACKER_PORT.outboundEvents).toContain("revenue.attributed");
    expect(REVENUE_TRACKER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares attribute_revenue and log_pipeline tools", () => {
    const toolNames = REVENUE_TRACKER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("attribute_revenue");
    expect(toolNames).toContain("log_pipeline");
  });
});
```

**Step 2: Write the port**

Overwrite `packages/agents/src/agents/revenue-tracker/port.ts`:

```typescript
// ---------------------------------------------------------------------------
// Revenue Tracker — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const REVENUE_TRACKER_PORT: AgentPort = {
  agentId: "revenue-tracker",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced"],
  outboundEvents: ["revenue.attributed", "conversation.escalated"],
  tools: [
    {
      name: "attribute_revenue",
      description: "Compute per-campaign revenue attribution for reporting",
      parameters: {
        contactId: "string",
        amount: "number",
        campaignId: "string",
      },
    },
    {
      name: "log_pipeline",
      description: "Log a pipeline stage transition for revenue forecasting",
      parameters: {
        contactId: "string",
        stage: "string",
        estimatedValue: "number",
      },
    },
  ],
  configSchema: {
    attributionModel: "last_click | linear | time_decay (default: last_click)",
    attributionWindowDays: "number (default: 28)",
    trackPipeline: "boolean (default: true)",
  },
};
```

**Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: port tests PASS

**Step 4: Commit**

```bash
git add packages/agents/src/agents/revenue-tracker/port.ts packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts
git commit -m "feat(agents): rewrite Revenue Tracker port declaration"
```

---

## Task 2: Revenue Tracker Handler

The handler receives two event types:

- `revenue.recorded` → computes attribution (which campaign gets credit), emits `revenue.attributed` for dashboard reporting
- `stage.advanced` → logs pipeline progression via `crm.activity.log` action

It reads `profile.revenue` for config. Key fields:

- `profile.revenue.attributionModel` — which model to use (default: "last_click")
- `profile.revenue.trackPipeline` — whether to log pipeline stages (default: true)

**Distinction from Ad Optimizer:** The Ad Optimizer sends conversion signals TO ad platforms. The Revenue Tracker computes attribution FOR internal dashboards. They both listen to `revenue.recorded` but serve different purposes.

**Files:**

- Modify: `packages/agents/src/agents/revenue-tracker/handler.ts`
- Modify: `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`

**Step 1: Write the handler tests**

Overwrite `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RevenueTrackerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeRevenueEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "system", id: "payments" },
    payload: {
      contactId: "c1",
      amount: 500,
      currency: "USD",
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

function makeStageEvent(stage: string, payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "stage.advanced",
    source: { type: "agent", id: "sales-closer" },
    payload: {
      contactId: "c1",
      stage,
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

describe("RevenueTrackerHandler", () => {
  it("emits revenue.attributed on revenue.recorded", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { attributionModel: "last_click" } },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        amount: 500,
        currency: "USD",
        campaignId: "camp-1",
        adId: "ad-1",
        attributionModel: "last_click",
      }),
    );
  });

  it("uses default attribution model when not configured", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.attributionModel).toBe("last_click");
  });

  it("includes platform source in attribution payload", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.utmSource).toBe("meta");
    expect(payload.utmMedium).toBe("paid");
    expect(payload.utmCampaign).toBe("spring");
  });

  it("logs pipeline progression on stage.advanced", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("proposal_sent");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { trackPipeline: true } },
      },
    );

    expect(response.actions).toEqual([
      {
        actionType: "crm.activity.log",
        parameters: {
          contactId: "c1",
          activityType: "stage_transition",
          stage: "proposal_sent",
        },
      },
    ]);
  });

  it("skips pipeline logging when trackPipeline is false", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("proposal_sent");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: { trackPipeline: false } },
      },
    );

    expect(response.actions).toHaveLength(0);
    expect(response.events).toHaveLength(0);
  });

  it("defaults trackPipeline to true", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("booked");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0]!.actionType).toBe("crm.activity.log");
  });

  it("escalates when no revenue config in profile", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

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
        reason: "no_revenue_config",
      }),
    );
  });

  it("escalates stage.advanced when no revenue config", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeStageEvent("booked");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {},
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores unhandled event types", async () => {
    const handler = new RevenueTrackerHandler();

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

  it("handles revenue with no attribution gracefully", async () => {
    const handler = new RevenueTrackerHandler();

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "payments" },
      payload: { contactId: "c1", amount: 100 },
    });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("revenue.attributed");
    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.campaignId).toBeNull();
    expect(payload.adId).toBeNull();
  });

  it("uses currency from event payload", async () => {
    const handler = new RevenueTrackerHandler();
    const event = makeRevenueEvent({ currency: "EUR" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { revenue: {} },
      },
    );

    const payload = response.events[0]!.payload as Record<string, unknown>;
    expect(payload.currency).toBe("EUR");
  });
});
```

**Step 2: Write the handler**

Overwrite `packages/agents/src/agents/revenue-tracker/handler.ts`:

```typescript
// ---------------------------------------------------------------------------
// Revenue Tracker — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";

export class RevenueTrackerHandler implements AgentHandler {
  async handle(
    event: RoutedEventEnvelope,
    _config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse> {
    if (event.eventType === "revenue.recorded") {
      return this.handleRevenue(event, context);
    }

    if (event.eventType === "stage.advanced") {
      return this.handleStage(event, context);
    }

    return { events: [], actions: [] };
  }

  private handleRevenue(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const amount = payload.amount as number;
    const currency = (payload.currency as string) ?? "USD";
    const profile = context.profile ?? {};
    const revenue = profile.revenue as Record<string, unknown> | undefined;

    if (!revenue) {
      return this.escalate(event, context, contactId, "no_revenue_config");
    }

    const attributionModel = (revenue.attributionModel as string) ?? "last_click";

    const attributedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "revenue.attributed",
      source: { type: "agent", id: "revenue-tracker" },
      payload: {
        contactId,
        amount,
        currency,
        campaignId: event.attribution?.sourceCampaignId ?? null,
        adId: event.attribution?.sourceAdId ?? null,
        utmSource: event.attribution?.utmSource ?? null,
        utmMedium: event.attribution?.utmMedium ?? null,
        utmCampaign: event.attribution?.utmCampaign ?? null,
        attributionModel,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [attributedEvent],
      actions: [],
      state: {
        contactId,
        amount,
        campaignId: event.attribution?.sourceCampaignId ?? null,
        attributionModel,
      },
    };
  }

  private handleStage(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;
    const profile = context.profile ?? {};
    const revenue = profile.revenue as Record<string, unknown> | undefined;

    if (!revenue) {
      return { events: [], actions: [] };
    }

    const trackPipeline = revenue.trackPipeline !== false;

    if (!trackPipeline) {
      return { events: [], actions: [] };
    }

    return {
      events: [],
      actions: [
        {
          actionType: "crm.activity.log",
          parameters: {
            contactId,
            activityType: "stage_transition",
            stage,
          },
        },
      ],
      state: { contactId, stage, logged: true },
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
      source: { type: "agent", id: "revenue-tracker" },
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

**Step 3: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add packages/agents/src/agents/revenue-tracker/handler.ts packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts
git commit -m "feat(agents): rewrite Revenue Tracker handler with profile-driven attribution"
```

---

## Task 3: Barrel Exports + Final Build Verification

**Files:**

- Modify: `packages/agents/src/agents/revenue-tracker/index.ts`
- Modify: `packages/agents/src/index.ts`
- Delete: `packages/agents/src/agents/revenue-tracker/types.ts`

**Step 1: Clean up revenue-tracker barrel**

Overwrite `packages/agents/src/agents/revenue-tracker/index.ts`:

```typescript
export { REVENUE_TRACKER_PORT } from "./port.js";
export { RevenueTrackerHandler } from "./handler.js";
```

**Step 2: Delete types.ts**

```bash
rm packages/agents/src/agents/revenue-tracker/types.ts
```

**Step 3: Update main barrel**

In `packages/agents/src/index.ts`, replace the revenue-tracker export block:

```typescript
export { REVENUE_TRACKER_PORT, RevenueTrackerHandler } from "./agents/revenue-tracker/index.js";
```

**Step 4: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 5: Run full agents tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/agents/src/agents/revenue-tracker/index.ts packages/agents/src/agents/revenue-tracker/types.ts packages/agents/src/index.ts
git commit -m "feat(agents): complete Revenue Tracker agent with barrel exports"
```

---

## Implementation Order

```
Task 1:  Port declaration          (standalone)
Task 2:  Handler + tests           (depends on Task 1)
Task 3:  Barrel exports + build    (depends on all above)
```

## Files Summary

| Action | File                                                                   | Task |
| ------ | ---------------------------------------------------------------------- | ---- |
| MODIFY | `packages/agents/src/agents/revenue-tracker/port.ts`                   | T1   |
| MODIFY | `packages/agents/src/agents/revenue-tracker/__tests__/port.test.ts`    | T1   |
| MODIFY | `packages/agents/src/agents/revenue-tracker/handler.ts`                | T2   |
| MODIFY | `packages/agents/src/agents/revenue-tracker/__tests__/handler.test.ts` | T2   |
| MODIFY | `packages/agents/src/agents/revenue-tracker/index.ts`                  | T3   |
| DELETE | `packages/agents/src/agents/revenue-tracker/types.ts`                  | T3   |
| MODIFY | `packages/agents/src/index.ts`                                         | T3   |
