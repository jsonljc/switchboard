# Phase 5d: Ad Optimizer Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Ad Optimizer — the fourth hireable agent — that receives `revenue.recorded` events to dispatch conversion signals back to ad platforms, and `stage.advanced` events to track funnel performance. It emits `ad.optimized` when actions are taken and escalates when platform config is missing.

**Architecture:** The Ad Optimizer implements `AgentHandler`. It reads `profile.ads` from `AgentContext` to determine which ad platforms are connected and what conversion events to send. Like Sales Closer and Nurture Agent, it doesn't need injected dependencies — the profile config drives all decisions. It produces action requests for `digital-ads.conversion.send` (CAPI/offline conversion dispatch) and `digital-ads.funnel.diagnose` (diagnostic runs) that the app layer executes.

**Tech Stack:** TypeScript, Vitest, existing `AgentPort`/`AgentHandler` interfaces, `createEventEnvelope`

---

## Task 1: Ad Optimizer Port Declaration

**Files:**

- Create: `packages/agents/src/agents/ad-optimizer/port.ts`
- Create: `packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AD_OPTIMIZER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Ad Optimizer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(AD_OPTIMIZER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts revenue.recorded and stage.advanced events", () => {
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("revenue.recorded");
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("stage.advanced");
  });

  it("emits ad.optimized and conversation.escalated events", () => {
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("ad.optimized");
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares send_conversion and diagnose_funnel tools", () => {
    const toolNames = AD_OPTIMIZER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("send_conversion");
    expect(toolNames).toContain("diagnose_funnel");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/agents/ad-optimizer/port.ts`:

```typescript
// ---------------------------------------------------------------------------
// Ad Optimizer — Port Declaration
// ---------------------------------------------------------------------------

import type { AgentPort } from "../../ports.js";

export const AD_OPTIMIZER_PORT: AgentPort = {
  agentId: "ad-optimizer",
  version: "0.1.0",
  inboundEvents: ["revenue.recorded", "stage.advanced"],
  outboundEvents: ["ad.optimized", "conversation.escalated"],
  tools: [
    {
      name: "send_conversion",
      description: "Send a conversion event to an ad platform (Meta CAPI, Google, TikTok)",
      parameters: {
        platform: "meta | google | tiktok",
        eventName: "string (e.g. Purchase, Lead, CompleteRegistration)",
        contactId: "string",
        value: "number (revenue amount)",
        currency: "string (default: USD)",
      },
    },
    {
      name: "diagnose_funnel",
      description: "Run funnel diagnostics across connected ad platforms",
      parameters: {
        platform: "meta | google | tiktok | all",
        lookbackDays: "number (default: 7)",
      },
    },
  ],
  configSchema: {
    connectedPlatforms: "string[] (platforms to send conversions to)",
    defaultCurrency: "string (default: USD)",
    conversionEventMap: "Record<string, string> (stage -> platform event name mapping)",
  },
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/agents/ad-optimizer/port.ts packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts
git commit -m "feat(agents): add Ad Optimizer port declaration"
```

---

## Task 2: Ad Optimizer Handler

The handler receives two event types:

- `revenue.recorded` → sends conversion signal to connected ad platforms (closes the loop)
- `stage.advanced` → maps stage to conversion event name and sends to platforms

It reads `profile.ads` for platform config. Key fields:

- `profile.ads.connectedPlatforms` — which platforms to send to (e.g., ["meta", "google"])
- `profile.ads.conversionEventMap` — maps stages to platform event names (e.g., `{ "booking_initiated": "Lead", "service_completed": "Purchase" }`)

**Files:**

- Create: `packages/agents/src/agents/ad-optimizer/handler.ts`
- Create: `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AdOptimizerHandler } from "../handler.js";
import { createEventEnvelope } from "../../../events.js";

function makeRevenueEvent(payload: Record<string, unknown> = {}) {
  return createEventEnvelope({
    organizationId: "org-1",
    eventType: "revenue.recorded",
    source: { type: "system", id: "payments" },
    payload: {
      contactId: "c1",
      amount: 250,
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

describe("AdOptimizerHandler", () => {
  it("sends conversion to connected platforms on revenue.recorded", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta", "google"] },
        },
      },
    );

    expect(response.actions).toHaveLength(2);
    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "meta",
            eventName: "Purchase",
            contactId: "c1",
            value: 250,
          }),
        }),
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "google",
            eventName: "Purchase",
          }),
        }),
      ]),
    );
  });

  it("emits ad.optimized event on revenue.recorded", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta"] },
        },
      },
    );

    expect(response.events).toHaveLength(1);
    expect(response.events[0]!.eventType).toBe("ad.optimized");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        contactId: "c1",
        action: "conversion_sent",
        platforms: ["meta"],
        eventName: "Purchase",
        value: 250,
      }),
    );
  });

  it("sends stage conversion when conversionEventMap configured", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: {
            connectedPlatforms: ["meta"],
            conversionEventMap: { booking_initiated: "Lead" },
          },
        },
      },
    );

    expect(response.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "digital-ads.conversion.send",
          parameters: expect.objectContaining({
            platform: "meta",
            eventName: "Lead",
            contactId: "c1",
          }),
        }),
      ]),
    );
  });

  it("skips stage.advanced when stage not in conversionEventMap", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("nurture_started");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: {
            connectedPlatforms: ["meta"],
            conversionEventMap: { booking_initiated: "Lead" },
          },
        },
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("skips stage.advanced when no conversionEventMap", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeStageEvent("booking_initiated");

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: ["meta"] },
        },
      },
    );

    expect(response.events).toHaveLength(0);
    expect(response.actions).toHaveLength(0);
  });

  it("escalates when no ads config in profile", async () => {
    const handler = new AdOptimizerHandler();
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
        reason: "no_ads_config",
      }),
    );
  });

  it("escalates when no connected platforms", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: {
          ads: { connectedPlatforms: [] },
        },
      },
    );

    expect(response.events[0]!.eventType).toBe("conversation.escalated");
    expect(response.events[0]!.payload).toEqual(
      expect.objectContaining({
        reason: "no_connected_platforms",
      }),
    );
  });

  it("forwards attribution chain to outbound events", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.events[0]!.attribution).toBeDefined();
    expect(response.events[0]!.attribution!.sourceCampaignId).toBe("camp-1");
    expect(response.events[0]!.attribution!.fbclid).toBe("fb-abc");
  });

  it("sets causationId to the inbound event id", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.events[0]!.causationId).toBe(event.eventId);
    expect(response.events[0]!.correlationId).toBe(event.correlationId);
  });

  it("ignores unhandled event types", async () => {
    const handler = new AdOptimizerHandler();

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

  it("includes attribution in conversion action parameters", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent();

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    const action = response.actions[0]!;
    expect(action.parameters.fbclid).toBe("fb-abc");
    expect(action.parameters.sourceCampaignId).toBe("camp-1");
    expect(action.parameters.sourceAdId).toBe("ad-1");
  });

  it("uses currency from event payload when available", async () => {
    const handler = new AdOptimizerHandler();
    const event = makeRevenueEvent({ currency: "EUR" });

    const response = await handler.handle(
      event,
      {},
      {
        organizationId: "org-1",
        profile: { ads: { connectedPlatforms: ["meta"] } },
      },
    );

    expect(response.actions[0]!.parameters.currency).toBe("EUR");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/agents/ad-optimizer/handler.ts`:

```typescript
// ---------------------------------------------------------------------------
// Ad Optimizer — Handler Implementation
// ---------------------------------------------------------------------------

import { createEventEnvelope } from "../../events.js";
import type { RoutedEventEnvelope } from "../../events.js";
import type { AgentContext, AgentHandler, AgentResponse } from "../../ports.js";

export class AdOptimizerHandler implements AgentHandler {
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
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return this.escalate(event, context, contactId, "no_ads_config");
    }

    const platforms = ads.connectedPlatforms as string[] | undefined;
    if (!platforms || platforms.length === 0) {
      return this.escalate(event, context, contactId, "no_connected_platforms");
    }

    const actions = platforms.map((platform) => ({
      actionType: "digital-ads.conversion.send",
      parameters: {
        platform,
        eventName: "Purchase",
        contactId,
        value: amount,
        currency,
        fbclid: event.attribution?.fbclid,
        gclid: event.attribution?.gclid,
        ttclid: event.attribution?.ttclid,
        sourceCampaignId: event.attribution?.sourceCampaignId,
        sourceAdId: event.attribution?.sourceAdId,
      },
    }));

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        contactId,
        action: "conversion_sent",
        platforms,
        eventName: "Purchase",
        value: amount,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions,
      state: {
        contactId,
        action: "conversion_sent",
        platforms,
      },
    };
  }

  private handleStage(event: RoutedEventEnvelope, context: AgentContext): AgentResponse {
    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string;
    const stage = payload.stage as string;
    const profile = context.profile ?? {};
    const ads = profile.ads as Record<string, unknown> | undefined;

    if (!ads) {
      return { events: [], actions: [] };
    }

    const platforms = ads.connectedPlatforms as string[] | undefined;
    const conversionEventMap = ads.conversionEventMap as Record<string, string> | undefined;

    if (!conversionEventMap || !conversionEventMap[stage]) {
      return { events: [], actions: [] };
    }

    if (!platforms || platforms.length === 0) {
      return { events: [], actions: [] };
    }

    const eventName = conversionEventMap[stage]!;

    const actions = platforms.map((platform) => ({
      actionType: "digital-ads.conversion.send",
      parameters: {
        platform,
        eventName,
        contactId,
        fbclid: event.attribution?.fbclid,
        gclid: event.attribution?.gclid,
        ttclid: event.attribution?.ttclid,
        sourceCampaignId: event.attribution?.sourceCampaignId,
        sourceAdId: event.attribution?.sourceAdId,
      },
    }));

    const optimizedEvent = createEventEnvelope({
      organizationId: context.organizationId,
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {
        contactId,
        action: "stage_conversion_sent",
        platforms,
        eventName,
        stage,
      },
      correlationId: event.correlationId,
      causationId: event.eventId,
      attribution: event.attribution,
    });

    return {
      events: [optimizedEvent],
      actions,
      state: {
        contactId,
        action: "stage_conversion_sent",
        stage,
        eventName,
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
      source: { type: "agent", id: "ad-optimizer" },
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
git add packages/agents/src/agents/ad-optimizer/handler.ts packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts
git commit -m "feat(agents): add Ad Optimizer handler with conversion feedback loop"
```

---

## Task 3: Barrel Exports + Final Build Verification

**Files:**

- Create: `packages/agents/src/agents/ad-optimizer/index.ts`
- Modify: `packages/agents/src/index.ts`

**Step 1: Create ad-optimizer barrel**

Create `packages/agents/src/agents/ad-optimizer/index.ts`:

```typescript
export { AD_OPTIMIZER_PORT } from "./port.js";
export { AdOptimizerHandler } from "./handler.js";
```

**Step 2: Update main barrel**

Add to `packages/agents/src/index.ts` after the nurture export line:

```typescript
export { AD_OPTIMIZER_PORT, AdOptimizerHandler } from "./agents/ad-optimizer/index.js";
```

**Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 4: Run full agents tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 5: Run workspace build**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter '!@switchboard/dashboard' build`
Expected: all packages build successfully

**Step 6: Commit**

```bash
git add packages/agents/src/agents/ad-optimizer/index.ts packages/agents/src/index.ts
git commit -m "feat(agents): complete Ad Optimizer agent with barrel exports"
```

---

## Implementation Order

```
Task 1:  Port declaration          (standalone)
Task 2:  Handler + tests           (depends on Task 1)
Task 3:  Barrel exports + build    (depends on all above)
```

## Files Summary

| Action | File                                                                | Task |
| ------ | ------------------------------------------------------------------- | ---- |
| CREATE | `packages/agents/src/agents/ad-optimizer/port.ts`                   | T1   |
| CREATE | `packages/agents/src/agents/ad-optimizer/__tests__/port.test.ts`    | T1   |
| CREATE | `packages/agents/src/agents/ad-optimizer/handler.ts`                | T2   |
| CREATE | `packages/agents/src/agents/ad-optimizer/__tests__/handler.test.ts` | T2   |
| CREATE | `packages/agents/src/agents/ad-optimizer/index.ts`                  | T3   |
| MODIFY | `packages/agents/src/index.ts`                                      | T3   |
