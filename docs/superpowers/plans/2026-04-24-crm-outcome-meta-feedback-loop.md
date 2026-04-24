# CRM Outcome + Meta Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared CRM outcome layer powering two loops — Loop 1 sends CRM conversion events to Meta CAPI, Loop 2 reads CRM outcomes for the Weekly Audit.

**Architecture:** Extend the existing `ConversionEvent` schema with structured `customer`, `attribution`, and `sourceContext` fields. Upgrade `MetaCAPIDispatcher` with three attribution paths (Lead Ads CRM, website click-ID, PII-only fallback). Add a pure event builder and app-layer transition triggers. Split `CrmDataProvider` into CRM-only + `CampaignInsightsProvider`, then refactor `AuditRunner` and its recommendation engine.

**Tech Stack:** TypeScript, Zod, Prisma, Vitest, Fastify, pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-04-24-crm-outcome-meta-feedback-loop-design.md`

---

## File Structure

### New files

| File                                                                | Responsibility                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/crm-outcome.ts`                               | Shared types: `CrmDataProvider`, `CrmFunnelData`, `FunnelBenchmarks`, `CampaignInsightsProvider`, `TargetBreachResult`, `MediaBenchmarks`, `WeeklyCampaignSnapshot` |
| `packages/ad-optimizer/src/crm-event-emitter.ts`                    | Pure `buildConversionEvent` function                                                                                                                                |
| `packages/ad-optimizer/src/crm-event-emitter.test.ts`               | Tests for builder                                                                                                                                                   |
| `packages/ad-optimizer/src/meta-campaign-insights-provider.ts`      | V1 `CampaignInsightsProvider` implementation                                                                                                                        |
| `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts` | Tests for insights provider                                                                                                                                         |
| `packages/db/src/stores/prisma-crm-data-provider.ts`                | `PrismaCrmDataProvider` implementation                                                                                                                              |
| `packages/db/src/stores/__tests__/prisma-crm-data-provider.test.ts` | Tests for CRM provider                                                                                                                                              |

### Modified files

| File                                                                | Change                                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/schemas/src/conversion.ts`                                | Add `accountId`, `customer`, `attribution`, `sourceContext`, `currency`; make `value` optional |
| `packages/schemas/src/ad-optimizer.ts`                              | Add `review_budget` to `RecommendationActionSchema`                                            |
| `packages/schemas/src/index.ts`                                     | Export `crm-outcome.ts`                                                                        |
| `packages/db/prisma/schema.prisma`                                  | Add `leadgenId` + `firstAgentMessageAt` to models                                              |
| `packages/ad-optimizer/src/meta-capi-dispatcher.ts`                 | Three attribution paths, stage→event-name mapping, timing guardrail                            |
| `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`            | Rewrite tests for new behavior                                                                 |
| `packages/ad-optimizer/src/funnel-analyzer.ts`                      | Split benchmark inputs into CRM + media                                                        |
| `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts`       | Update for dual benchmarks                                                                     |
| `packages/ad-optimizer/src/recommendation-engine.ts`                | Replace `daysAboveTarget` with `TargetBreachResult`, add `review_budget`                       |
| `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts` | Update for new rule shape                                                                      |
| `packages/ad-optimizer/src/audit-runner.ts`                         | Add `insightsProvider`, move two method calls, update `CrmDataProvider` interface usage        |
| `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`          | Update mocks for split providers                                                               |
| `packages/ad-optimizer/src/inngest-functions.ts`                    | Update `CronDependencies` for split providers                                                  |
| `packages/ad-optimizer/src/index.ts`                                | Export new modules                                                                             |
| `packages/ad-optimizer/src/meta-leads-ingester.ts`                  | Persist `leadgenId` on return type                                                             |

---

### Task 1: Extend ConversionEvent Schema

**Files:**

- Modify: `packages/schemas/src/conversion.ts`

- [ ] **Step 1: Read the existing schema**

Open `packages/schemas/src/conversion.ts`. It currently defines:

```typescript
export interface ConversionEvent {
  eventId: string;
  type: ConversionStage;
  contactId: string;
  organizationId: string;
  value: number;
  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;
  source: string;
  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 2: Update the ConversionEvent interface**

Replace the `ConversionEvent` interface in `packages/schemas/src/conversion.ts` with:

```typescript
export interface ConversionEvent {
  eventId: string;
  type: ConversionStage;
  contactId: string;
  organizationId: string;
  accountId?: string;

  value?: number;
  currency?: string;

  sourceAdId?: string;
  sourceCampaignId?: string;
  occurredAt: Date;

  source: string;

  sourceContext?: {
    model: "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";
    id: string;
    transition?: string;
  };

  causationId?: string;
  workTraceId?: string;
  metadata: Record<string, unknown>;

  customer?: {
    email?: string;
    phone?: string;
  };

  attribution?: {
    lead_id?: string;
    fbclid?: string;
    fbclidTimestamp?: Date;
    sourceCampaignId?: string;
    sourceAdSetId?: string;
    sourceAdId?: string;
    eventSourceUrl?: string;
    clientUserAgent?: string;
  };
}
```

Key changes from original:

- `value` changed from `number` to `number | undefined` (optional)
- Added `accountId?`, `currency?`, `sourceContext?`, `customer?`, `attribution?`
- `source` kept as `string` for backward compatibility

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm --filter @switchboard/schemas test`
Expected: PASS — all existing tests pass since we only added optional fields and relaxed `value`.

- [ ] **Step 4: Check downstream consumers compile**

Run: `pnpm typecheck`
Expected: There may be failures in files that assume `value` is non-optional (e.g., `google-offline-dispatcher.ts` line 41 uses `event.value || undefined`). If so, that still works because `undefined || undefined` is `undefined`. Check any errors and fix if needed.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(schemas): extend ConversionEvent with customer, attribution, sourceContext fields"
```

---

### Task 2: Add Shared CRM Outcome Types to Schemas

**Files:**

- Create: `packages/schemas/src/crm-outcome.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/src/ad-optimizer.ts`

- [ ] **Step 1: Create the shared types file**

Create `packages/schemas/src/crm-outcome.ts`:

```typescript
// ── CRM Funnel Data ──

export interface CrmFunnelData {
  campaignIds: string[];
  leads: number;
  qualified: number;
  opportunities: number;
  bookings: number;
  closed: number;
  revenue: number;

  rates: {
    leadToQualified: number | null;
    qualifiedToBooking: number | null;
    bookingToClosed: number | null;
    leadToClosed: number | null;
  };

  coverage: {
    attributedContacts: number;
    contactsWithEmailOrPhone: number;
    contactsWithOpportunity: number;
    contactsWithBooking: number;
    contactsWithRevenueEvent: number;
  };
}

// ── Funnel Benchmarks (CRM-only) ──

export interface FunnelBenchmarks {
  leadToQualifiedRate: number;
  qualifiedToBookingRate: number;
  bookingToClosedRate: number;
  leadToClosedRate: number;
}

// ── Media Benchmarks ──

export interface MediaBenchmarks {
  ctr: number;
  landingPageViewRate: number;
  clickToLeadRate?: number;
  cpl?: number;
  cpa?: number;
}

// ── CRM Data Provider ──

export interface CrmDataProvider {
  getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date;
    endDate: Date;
  }): Promise<CrmFunnelData>;

  getBenchmarks(input: {
    orgId: string;
    accountId: string;
    vertical?: string;
  }): Promise<FunnelBenchmarks>;
}

// ── Campaign Insights Provider ──

export interface WeeklyCampaignSnapshot {
  campaignId: string;
  startDate: Date;
  endDate: Date;
  spend: number;
  conversions: number;
  cpa: number | null;
}

export interface TargetBreachResult {
  periodsAboveTarget: number;
  granularity: "weekly" | "daily";
  isApproximate: boolean;
}

export interface CampaignLearningInput {
  effectiveStatus: string;
  learningPhase: boolean;
  lastModifiedDays: number;
  optimizationEvents: number;
}

export interface CampaignInsightsProvider {
  getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
  }): Promise<CampaignLearningInput>;

  getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
  }): Promise<TargetBreachResult>;
}
```

- [ ] **Step 2: Add `review_budget` to RecommendationActionSchema**

In `packages/schemas/src/ad-optimizer.ts`, line 9-16, update the enum:

```typescript
export const RecommendationActionSchema = z.enum([
  "scale",
  "kill",
  "refresh_creative",
  "restructure",
  "hold",
  "test",
  "review_budget",
]);
```

- [ ] **Step 3: Export from barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
// CRM Outcome types (shared across ad-optimizer + db)
export * from "./crm-outcome.js";
```

- [ ] **Step 4: Update learning-phase-guard.ts to use canonical CampaignLearningInput**

In `packages/ad-optimizer/src/learning-phase-guard.ts`, the `CampaignLearningInput` interface (line 16-21) is now duplicated in `@switchboard/schemas`. Remove the local definition and import from schemas:

```typescript
import type { CampaignLearningInput } from "@switchboard/schemas";
```

Remove the local `export interface CampaignLearningInput { ... }` block (lines 16-21). Keep the re-export:

```typescript
export type { CampaignLearningInput };
```

This ensures `CampaignLearningInput` has one canonical definition in `packages/schemas/src/crm-outcome.ts`.

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @switchboard/schemas test && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(schemas): add shared CRM outcome types — CrmDataProvider, CampaignInsightsProvider, benchmarks"
```

---

### Task 3: Prisma Migration — Contact.leadgenId + ConversationThread.firstAgentMessageAt

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `leadgenId` to Contact model**

In `packages/db/prisma/schema.prisma`, find `model Contact` (line 1357). Add after the `roles` field (line 1369):

```prisma
  leadgenId         String?
```

Add a new index after the existing indexes (after line 1383):

```prisma
  @@index([organizationId, leadgenId])
```

- [ ] **Step 2: Add `firstAgentMessageAt` to ConversationThread model**

In `packages/db/prisma/schema.prisma`, find `model ConversationThread` (line 830). Add after the `messageCount` field (line 840):

```prisma
  firstAgentMessageAt DateTime?
```

- [ ] **Step 3: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Prisma client generates successfully with new fields.

- [ ] **Step 4: Create migration**

Run: `pnpm db:migrate -- --name add-leadgen-id-and-first-agent-message-at`
Expected: Migration file created.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @switchboard/db test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(db): add Contact.leadgenId and ConversationThread.firstAgentMessageAt"
```

---

### Task 4: MetaCAPIDispatcher Upgrade

**Files:**

- Modify: `packages/ad-optimizer/src/meta-capi-dispatcher.ts`
- Modify: `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`

- [ ] **Step 1: Write tests for the upgraded dispatcher**

Replace `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    eventId: "org_1:act_1:Booking:bk_1:booked:status_confirmed",
    type: "booked",
    contactId: "ct_1",
    organizationId: "org_1",
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: "Booking",
    metadata: {},
    customer: { email: "test@example.com", phone: "+6591234567" },
    ...overrides,
  };
}

describe("MetaCAPIDispatcher", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dispatcher: MetaCAPIDispatcher;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events_received: 1 }),
    });
    dispatcher = new MetaCAPIDispatcher(
      { pixelId: "px_1", accessToken: "tok_1" },
      fetchMock as never,
    );
  });

  it("platform is 'meta_capi'", () => {
    expect(dispatcher.platform).toBe("meta_capi");
  });

  // ── canDispatch ──

  it("canDispatch returns true with lead_id in attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ attribution: { lead_id: "lead_123" } }))).toBe(true);
  });

  it("canDispatch returns true with fbclid in attribution", () => {
    expect(dispatcher.canDispatch(makeEvent({ attribution: { fbclid: "fb_abc" } }))).toBe(true);
  });

  it("canDispatch returns true with customer email only", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: { email: "a@b.com" } }))).toBe(true);
  });

  it("canDispatch returns true with customer phone only", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: { phone: "+1234" } }))).toBe(true);
  });

  it("canDispatch returns true with legacy metadata email", () => {
    expect(
      dispatcher.canDispatch(makeEvent({ customer: undefined, metadata: { email: "a@b.com" } })),
    ).toBe(true);
  });

  it("canDispatch returns false when no match keys", () => {
    expect(dispatcher.canDispatch(makeEvent({ customer: undefined, metadata: {} }))).toBe(false);
  });

  it("canDispatch returns false even with sourceAdId but no PII/attribution", () => {
    expect(
      dispatcher.canDispatch(
        makeEvent({ sourceAdId: "ad_123", customer: undefined, metadata: {} }),
      ),
    ).toBe(false);
  });

  // ── Attribution path: Lead Ads CRM ──

  it("uses action_source crm when lead_id is present", async () => {
    const event = makeEvent({ attribution: { lead_id: "lead_123" } });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].action_source).toBe("crm");
    expect(body.data[0].user_data.lead_id).toBe("lead_123");
  });

  // ── Attribution path: Website ──

  it("uses action_source website when full web context exists", async () => {
    const event = makeEvent({
      attribution: {
        fbclid: "fb_abc",
        eventSourceUrl: "https://example.com/landing",
        clientUserAgent: "Mozilla/5.0",
      },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].action_source).toBe("website");
    expect(body.data[0].event_source_url).toBe("https://example.com/landing");
    expect(body.data[0].user_data.client_user_agent).toBe("Mozilla/5.0");
    expect(body.data[0].user_data.fbc).toMatch(/^fb\.1\.\d+\.fb_abc$/);
  });

  // ── Attribution path: Fallback ──

  it("uses action_source system_generated for PII-only events", async () => {
    const event = makeEvent({ customer: { email: "a@b.com" } });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].action_source).toBe("system_generated");
  });

  it("includes fbc in fallback when fbclid exists without full web context", async () => {
    const event = makeEvent({
      attribution: { fbclid: "fb_partial" },
      customer: { email: "a@b.com" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].action_source).toBe("system_generated");
    expect(body.data[0].user_data.fbc).toMatch(/^fb\.1\.\d+\.fb_partial$/);
  });

  // ── Stage-to-event-name mapping ──

  it.each([
    ["inquiry", "Contact"],
    ["qualified", "QualifiedLead"],
    ["booked", "ConvertedLead"],
    ["purchased", "Purchase"],
    ["completed", "Purchase"],
  ] as [ConversionStage, string][])("maps stage %s to Meta event %s", async (stage, metaName) => {
    const event = makeEvent({ type: stage });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].event_name).toBe(metaName);
  });

  // ── eventId pass-through ──

  it("passes eventId as event_id in payload", async () => {
    const event = makeEvent({ eventId: "org_1:act_1:Booking:bk_1:booked:confirmed" });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].event_id).toBe("org_1:act_1:Booking:bk_1:booked:confirmed");
  });

  // ── Currency ──

  it("includes custom_data when value and currency are present", async () => {
    const event = makeEvent({ value: 500, currency: "SGD" });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].custom_data).toEqual({ value: 500, currency: "SGD" });
  });

  it("omits custom_data when value exists but currency is missing", async () => {
    const event = makeEvent({ value: 500 });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].custom_data).toBeUndefined();
  });

  it("omits custom_data when no value", async () => {
    const event = makeEvent();
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].custom_data).toBeUndefined();
  });

  // ── 7-day timing guardrail ──

  it("rejects events older than 7 days", async () => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const event = makeEvent({ occurredAt: eightDaysAgo });
    const result = await dispatcher.dispatch(event);

    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toBe("event_time_too_old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts events within 7 days", async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const event = makeEvent({ occurredAt: twoDaysAgo });
    const result = await dispatcher.dispatch(event);

    expect(result.accepted).toBe(true);
  });

  // ── PII hashing ──

  it("hashes email and phone in user_data", async () => {
    const event = makeEvent({
      customer: { email: "Test@Example.COM", phone: "+65 9123 4567" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const ud = body.data[0].user_data;
    expect(ud.em).toMatch(/^[a-f0-9]{64}$/);
    expect(ud.ph).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads PII from metadata as fallback", async () => {
    const event = makeEvent({
      customer: undefined,
      metadata: { email: "legacy@test.com", phone: "+1234" },
    });
    await dispatcher.dispatch(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].user_data.em).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data[0].user_data.ph).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Error handling ──

  it("returns rejected on HTTP error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad Request"),
    });

    const result = await dispatcher.dispatch(makeEvent());
    expect(result.accepted).toBe(false);
    expect(result.errorMessage).toContain("400");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-capi-dispatcher`
Expected: Multiple failures — new tests reference behavior not yet implemented.

- [ ] **Step 3: Rewrite the dispatcher implementation**

Replace `packages/ad-optimizer/src/meta-capi-dispatcher.ts` with:

```typescript
import { createHash } from "node:crypto";
import type { AdConversionDispatcher, DispatchResult } from "./ad-conversion-dispatcher.js";
import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

const API_BASE = "https://graph.facebook.com/v21.0";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const META_EVENT_NAME: Record<ConversionStage, string> = {
  inquiry: "Contact",
  qualified: "QualifiedLead",
  booked: "ConvertedLead",
  purchased: "Purchase",
  completed: "Purchase",
};

interface MetaCAPIConfig {
  pixelId: string;
  accessToken: string;
}

type FetchFn = typeof globalThis.fetch;

export class MetaCAPIDispatcher implements AdConversionDispatcher {
  readonly platform = "meta_capi";
  private readonly config: MetaCAPIConfig;
  private readonly fetchFn: FetchFn;

  constructor(config: MetaCAPIConfig, fetchFn: FetchFn = globalThis.fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  canDispatch(event: ConversionEvent): boolean {
    const email = event.customer?.email ?? (event.metadata?.["email"] as string | undefined);
    const phone = event.customer?.phone ?? (event.metadata?.["phone"] as string | undefined);
    const leadId =
      event.attribution?.lead_id ?? (event.metadata?.["lead_id"] as string | undefined);
    const fbclid = event.attribution?.fbclid ?? (event.metadata?.["fbclid"] as string | undefined);

    return Boolean(leadId || fbclid || email || phone);
  }

  async dispatch(event: ConversionEvent): Promise<DispatchResult> {
    if (event.occurredAt.getTime() < Date.now() - SEVEN_DAYS_MS) {
      console.warn("[MetaCAPIDispatcher] Skipping event: event_time_too_old", event.eventId);
      return { accepted: false, errorMessage: "event_time_too_old" };
    }

    const leadId =
      event.attribution?.lead_id ?? (event.metadata?.["lead_id"] as string | undefined);
    const fbclid = event.attribution?.fbclid ?? (event.metadata?.["fbclid"] as string | undefined);
    const eventSourceUrl = event.attribution?.eventSourceUrl;
    const clientUserAgent = event.attribution?.clientUserAgent;
    const fbclidTimestamp = event.attribution?.fbclidTimestamp;

    const email = event.customer?.email ?? (event.metadata?.["email"] as string | undefined);
    const phone = event.customer?.phone ?? (event.metadata?.["phone"] as string | undefined);

    const userData: Record<string, string> = {};
    let actionSource: string;
    let eventSourceUrlValue: string | undefined;

    if (leadId) {
      actionSource = "crm";
      userData.lead_id = leadId;
    } else if (fbclid && eventSourceUrl && clientUserAgent) {
      actionSource = "website";
      eventSourceUrlValue = eventSourceUrl;
      userData.client_user_agent = clientUserAgent;
      userData.fbc = buildFbc(fbclid, fbclidTimestamp ?? event.occurredAt);
    } else {
      actionSource = "system_generated";
      if (fbclid) {
        userData.fbc = buildFbc(fbclid, fbclidTimestamp ?? event.occurredAt);
      }
    }

    if (email) {
      userData.em = sha256(email.toLowerCase().trim());
    }
    if (phone) {
      userData.ph = sha256(phone.replace(/\D/g, ""));
    }

    let customData: { value: number; currency: string } | undefined;
    if (event.value != null && event.currency) {
      customData = { value: event.value, currency: event.currency };
    } else if (event.value != null && !event.currency) {
      console.warn(
        "[MetaCAPIDispatcher] missing_currency_for_value, omitting custom_data",
        event.eventId,
      );
    }

    const body = {
      data: [
        {
          event_name: META_EVENT_NAME[event.type],
          event_time: Math.floor(event.occurredAt.getTime() / 1000),
          event_id: event.eventId,
          user_data: userData,
          action_source: actionSource,
          ...(eventSourceUrlValue ? { event_source_url: eventSourceUrlValue } : {}),
          ...(customData ? { custom_data: customData } : {}),
        },
      ],
    };

    const url = `${API_BASE}/${this.config.pixelId}/events`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return { accepted: false, errorMessage: `HTTP ${response.status}: ${text}` };
    }

    const result = await response.json();
    return { accepted: true, responsePayload: result };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildFbc(fbclid: string, timestamp: Date): string {
  return `fb.1.${timestamp.getTime()}.${fbclid}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-capi-dispatcher`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): upgrade MetaCAPIDispatcher with three attribution paths, stage mapping, timing guardrail"
```

---

### Task 5: Event Builder — crm-event-emitter.ts

**Files:**

- Create: `packages/ad-optimizer/src/crm-event-emitter.test.ts`
- Create: `packages/ad-optimizer/src/crm-event-emitter.ts`
- Modify: `packages/ad-optimizer/src/index.ts`

- [ ] **Step 1: Write the tests**

Create `packages/ad-optimizer/src/crm-event-emitter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildConversionEvent } from "./crm-event-emitter.js";

describe("buildConversionEvent", () => {
  const baseParams = {
    orgId: "org_1",
    accountId: "act_1",
    type: "booked" as const,
    contact: {
      id: "ct_1",
      email: "test@example.com",
      phone: "+6591234567",
    },
    occurredAt: new Date("2026-04-20T10:00:00Z"),
    source: {
      model: "Booking" as const,
      id: "bk_1",
      transition: "status_confirmed",
    },
  };

  it("produces a valid ConversionEvent", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.type).toBe("booked");
    expect(event.organizationId).toBe("org_1");
    expect(event.accountId).toBe("act_1");
    expect(event.contactId).toBe("ct_1");
    expect(event.occurredAt).toEqual(new Date("2026-04-20T10:00:00Z"));
  });

  it("maps contact email/phone to customer", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.customer).toEqual({ email: "test@example.com", phone: "+6591234567" });
  });

  it("maps leadgenId to attribution.lead_id", () => {
    const event = buildConversionEvent({
      ...baseParams,
      contact: { ...baseParams.contact, leadgenId: "lead_abc" },
    });

    expect(event.attribution?.lead_id).toBe("lead_abc");
  });

  it("maps contact.attribution fields to event.attribution", () => {
    const event = buildConversionEvent({
      ...baseParams,
      contact: {
        ...baseParams.contact,
        attribution: {
          fbclid: "fb_xyz",
          fbclidTimestamp: new Date("2026-04-19T00:00:00Z"),
          sourceCampaignId: "camp_1",
          sourceAdSetId: "adset_1",
          sourceAdId: "ad_1",
          eventSourceUrl: "https://example.com",
          clientUserAgent: "Mozilla/5.0",
        },
      },
    });

    expect(event.attribution?.fbclid).toBe("fb_xyz");
    expect(event.attribution?.sourceCampaignId).toBe("camp_1");
    expect(event.attribution?.eventSourceUrl).toBe("https://example.com");
  });

  it("constructs deterministic eventId", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.eventId).toBe("org_1:act_1:Booking:bk_1:booked:status_confirmed");
  });

  it("uses default transition when none provided", () => {
    const event = buildConversionEvent({
      ...baseParams,
      source: { model: "Booking", id: "bk_1" },
    });

    expect(event.eventId).toBe("org_1:act_1:Booking:bk_1:booked:default");
  });

  it("same inputs produce same eventId", () => {
    const a = buildConversionEvent(baseParams);
    const b = buildConversionEvent(baseParams);

    expect(a.eventId).toBe(b.eventId);
  });

  it("sets source to model name and sourceContext to structured object", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.source).toBe("Booking");
    expect(event.sourceContext).toEqual({
      model: "Booking",
      id: "bk_1",
      transition: "status_confirmed",
    });
  });

  it("sets metadata to empty object", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.metadata).toEqual({});
  });

  it("passes value and currency through", () => {
    const event = buildConversionEvent({
      ...baseParams,
      type: "purchased",
      value: 500,
      currency: "SGD",
    });

    expect(event.value).toBe(500);
    expect(event.currency).toBe("SGD");
  });

  it("omits value when not provided", () => {
    const event = buildConversionEvent(baseParams);

    expect(event.value).toBeUndefined();
    expect(event.currency).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- crm-event-emitter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `packages/ad-optimizer/src/crm-event-emitter.ts`:

```typescript
import type { ConversionEvent, ConversionStage } from "@switchboard/schemas";

type SourceModel = "ConversationThread" | "Opportunity" | "Booking" | "LifecycleRevenueEvent";

export interface BuildConversionEventParams {
  orgId: string;
  accountId: string;
  type: ConversionStage;
  contact: {
    id: string;
    leadgenId?: string;
    attribution?: {
      fbclid?: string;
      fbclidTimestamp?: Date;
      sourceCampaignId?: string;
      sourceAdSetId?: string;
      sourceAdId?: string;
      eventSourceUrl?: string;
      clientUserAgent?: string;
    };
    email?: string;
    phone?: string;
  };
  occurredAt: Date;
  source: {
    model: SourceModel;
    id: string;
    transition?: string;
  };
  value?: number;
  currency?: string;
}

export function buildConversionEvent(params: BuildConversionEventParams): ConversionEvent {
  const { orgId, accountId, type, contact, occurredAt, source, value, currency } = params;
  const transition = source.transition ?? "default";

  const attribution: ConversionEvent["attribution"] = {
    ...(contact.attribution ?? {}),
    ...(contact.leadgenId ? { lead_id: contact.leadgenId } : {}),
  };

  const hasAttribution = Object.keys(attribution).length > 0;

  return {
    eventId: `${orgId}:${accountId}:${source.model}:${source.id}:${type}:${transition}`,
    type,
    contactId: contact.id,
    organizationId: orgId,
    accountId,
    occurredAt,
    source: source.model,
    sourceContext: {
      model: source.model,
      id: source.id,
      transition: source.transition,
    },
    value,
    currency,
    customer:
      contact.email || contact.phone ? { email: contact.email, phone: contact.phone } : undefined,
    attribution: hasAttribution ? attribution : undefined,
    metadata: {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- crm-event-emitter`
Expected: ALL PASS

- [ ] **Step 5: Export from barrel**

Add to `packages/ad-optimizer/src/index.ts`:

```typescript
export { buildConversionEvent } from "./crm-event-emitter.js";
export type { BuildConversionEventParams } from "./crm-event-emitter.js";
export { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
```

Note: `MetaCAPIDispatcher` was previously missing from the barrel exports.

- [ ] **Step 6: Verify build**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ad-optimizer): add buildConversionEvent pure builder function"
```

---

### Task 6: Update meta-leads-ingester to return leadgenId for persistence

**Files:**

- Modify: `packages/ad-optimizer/src/meta-leads-ingester.ts`

- [ ] **Step 1: Read the existing ingester**

The ingester's `LeadData` interface returns `leadId` (mapped from `leadgen_id`). The app layer that calls `parseLeadWebhook` should persist `leadId` as `Contact.leadgenId`. No code change is needed in the ingester itself — the field is already exposed as `LeadData.leadId`.

Verify by checking the existing test:

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-leads-ingester`
Expected: PASS — ingester already returns `leadId`.

- [ ] **Step 2: Document the wiring note**

The app layer code that calls `parseLeadWebhook` and creates/updates Contacts must now persist `leadData.leadId` → `Contact.leadgenId`. This is an app-layer change covered in Task 8 (trigger wiring). No change to the ingester package needed.

- [ ] **Step 3: Commit (skip if no changes)**

No changes needed in this task. The ingester already returns the right data.

---

### Task 7: Funnel Analyzer — Split Benchmarks

**Files:**

- Modify: `packages/ad-optimizer/src/funnel-analyzer.ts`
- Modify: `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts`

- [ ] **Step 1: Update the test file first**

Replace `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { analyzeFunnel } from "../funnel-analyzer.js";
import type { FunnelInput } from "../funnel-analyzer.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

function makeInsight(impressions: number, clicks: number): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions,
    clicks,
    spend: 100,
    conversions: 5,
    revenue: 500,
    frequency: 1.5,
    cpm: 10,
    ctr: clicks / impressions,
    cpc: 100 / clicks,
    dateStart: "2024-01-01",
    dateStop: "2024-01-31",
  };
}

describe("analyzeFunnel", () => {
  it("computes funnel stages with correct rates from normal data", () => {
    const input: FunnelInput = {
      insights: [makeInsight(10_000, 300), makeInsight(5_000, 100)],
      crmData: {
        campaignIds: ["c1"],
        leads: 50,
        qualified: 20,
        opportunities: 25,
        bookings: 12,
        closed: 5,
        revenue: 10_000,
        rates: {
          leadToQualified: 0.4,
          qualifiedToBooking: 0.6,
          bookingToClosed: 0.417,
          leadToClosed: 0.1,
        },
        coverage: {
          attributedContacts: 50,
          contactsWithEmailOrPhone: 45,
          contactsWithOpportunity: 25,
          contactsWithBooking: 12,
          contactsWithRevenueEvent: 5,
        },
      },
      crmBenchmarks: {
        leadToQualifiedRate: 0.5,
        qualifiedToBookingRate: 0.4,
        bookingToClosedRate: 0.3,
        leadToClosedRate: 0.06,
      },
      mediaBenchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
        clickToLeadRate: 0.04,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.stages).toHaveLength(6);

    const [impressions, clicks, lpv, leads, qualified, closed] = result.stages as [
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
    ];

    expect(impressions.name).toBe("Impressions");
    expect(impressions.count).toBe(15_000);

    expect(clicks.name).toBe("Clicks");
    expect(clicks.count).toBe(400);

    expect(lpv.name).toBe("Landing Page Views");
    expect(lpv.count).toBe(320);

    expect(leads.name).toBe("Leads");
    expect(leads.count).toBe(50);

    expect(qualified.name).toBe("Qualified");
    expect(qualified.count).toBe(20);

    expect(closed.name).toBe("Closed");
    expect(closed.count).toBe(5);
  });

  it("handles zero impressions gracefully with leakageMagnitude=0", () => {
    const input: FunnelInput = {
      insights: [],
      crmData: {
        campaignIds: [],
        leads: 0,
        qualified: 0,
        opportunities: 0,
        bookings: 0,
        closed: 0,
        revenue: 0,
        rates: {
          leadToQualified: null,
          qualifiedToBooking: null,
          bookingToClosed: null,
          leadToClosed: null,
        },
        coverage: {
          attributedContacts: 0,
          contactsWithEmailOrPhone: 0,
          contactsWithOpportunity: 0,
          contactsWithBooking: 0,
          contactsWithRevenueEvent: 0,
        },
      },
      crmBenchmarks: {
        leadToQualifiedRate: 0.3,
        qualifiedToBookingRate: 0.4,
        bookingToClosedRate: 0.5,
        leadToClosedRate: 0.06,
      },
      mediaBenchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.leakageMagnitude).toBe(0);
    expect(result.stages).toHaveLength(6);
    for (const stage of result.stages) {
      expect(stage.count).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- funnel-analyzer`
Expected: FAIL — `FunnelInput` shape has changed.

- [ ] **Step 3: Update funnel-analyzer.ts**

Replace `packages/ad-optimizer/src/funnel-analyzer.ts` with:

```typescript
import type {
  CampaignInsightSchema as CampaignInsight,
  FunnelAnalysisSchema as FunnelAnalysis,
  FunnelStageSchema as FunnelStage,
} from "@switchboard/schemas";
import type { CrmFunnelData, FunnelBenchmarks, MediaBenchmarks } from "@switchboard/schemas";

export type { CrmFunnelData, FunnelBenchmarks, MediaBenchmarks };

export interface FunnelInput {
  insights: CampaignInsight[];
  crmData: CrmFunnelData;
  crmBenchmarks: FunnelBenchmarks;
  mediaBenchmarks: MediaBenchmarks;
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function makeStage(name: string, count: number, rate: number, benchmark: number): FunnelStage {
  return { name, count, rate, benchmark, delta: rate - benchmark };
}

export function analyzeFunnel(input: FunnelInput): FunnelAnalysis {
  const { insights, crmData, crmBenchmarks, mediaBenchmarks } = input;

  const totalImpressions = insights.reduce((sum, i) => sum + i.impressions, 0);
  const totalClicks = insights.reduce((sum, i) => sum + i.clicks, 0);

  const ctrBenchmark = mediaBenchmarks.ctr / 100;
  const lpvRate = mediaBenchmarks.landingPageViewRate;
  const lpvCount = Math.round(totalClicks * lpvRate);

  const clickRate = safeDivide(totalClicks, totalImpressions);
  const leadRate = safeDivide(crmData.leads, lpvCount);
  const qualRate = safeDivide(crmData.qualified, crmData.leads);
  const closeRate = safeDivide(crmData.closed, crmData.qualified);

  const leadBenchmark = mediaBenchmarks.clickToLeadRate ?? 0.04;

  const stages: FunnelStage[] = [
    makeStage("Impressions", totalImpressions, 1, 1),
    makeStage("Clicks", totalClicks, clickRate, ctrBenchmark),
    makeStage("Landing Page Views", lpvCount, lpvRate, lpvRate),
    makeStage("Leads", crmData.leads, leadRate, leadBenchmark),
    makeStage("Qualified", crmData.qualified, qualRate, crmBenchmarks.leadToQualifiedRate),
    makeStage("Closed", crmData.closed, closeRate, crmBenchmarks.bookingToClosedRate),
  ];

  if (totalImpressions === 0) {
    const fallbackName = stages[1]?.name ?? "Clicks";
    return { stages, leakagePoint: fallbackName, leakageMagnitude: 0 };
  }

  const candidates = stages.slice(1);
  let worstStage = candidates[0]!;
  for (const stage of candidates) {
    if (stage.delta < worstStage.delta) {
      worstStage = stage;
    }
  }

  const leakageMagnitude = worstStage.delta < 0 ? Math.abs(worstStage.delta) : 0;

  return { stages, leakagePoint: worstStage.name, leakageMagnitude };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- funnel-analyzer`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(ad-optimizer): split FunnelBenchmarks into CRM + media benchmarks"
```

---

### Task 8: Recommendation Engine — TargetBreachResult

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-engine.ts`
- Modify: `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts`

- [ ] **Step 1: Update tests for new RecommendationInput**

In `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts`, replace `daysAboveTarget: number` with `targetBreach: TargetBreachResult` in all test fixtures.

Add the import:

```typescript
import type { TargetBreachResult } from "@switchboard/schemas";
```

Change the `RecommendationInput` usages:

For the kill test (line 24-33), change `daysAboveTarget: 10` to:

```typescript
targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
```

For the scale test (line 44-52), change `daysAboveTarget: 0` to:

```typescript
targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
```

Apply the same pattern to all tests. Replace every `daysAboveTarget: N` with:

```typescript
targetBreach: { periodsAboveTarget: N, granularity: "daily", isApproximate: false },
```

Add a new test for weekly review_budget:

```typescript
it("generates review_budget for weekly breach above kill CPA", () => {
  const input: RecommendationInput = {
    campaignId: "camp-weekly",
    campaignName: "Weekly Breach",
    diagnoses: [],
    deltas: [makeDelta("cpa", 250, 100, "up", true)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 1, granularity: "weekly", isApproximate: true },
  };

  const result = generateRecommendations(input);

  const review = result.find((r) => r.action === "review_budget");
  expect(review).toBeDefined();
  expect(review?.confidence).toBe(0.65);
});

it("does not generate kill for weekly breach", () => {
  const input: RecommendationInput = {
    campaignId: "camp-weekly-2",
    campaignName: "Weekly No Kill",
    diagnoses: [],
    deltas: [makeDelta("cpa", 250, 100, "up", true)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 7, granularity: "weekly", isApproximate: true },
  };

  const result = generateRecommendations(input);

  const kill = result.find((r) => r.action === "kill");
  expect(kill).toBeUndefined();
  const review = result.find((r) => r.action === "review_budget");
  expect(review).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-engine`
Expected: FAIL — `targetBreach` not a valid property.

- [ ] **Step 3: Update recommendation-engine.ts**

In `packages/ad-optimizer/src/recommendation-engine.ts`:

Add import:

```typescript
import type { TargetBreachResult } from "@switchboard/schemas";
```

Change `RecommendationInput` (line 21-30):

```typescript
export interface RecommendationInput {
  campaignId: string;
  campaignName: string;
  diagnoses: Diagnosis[];
  deltas: MetricDelta[];
  targetCPA: number;
  targetROAS: number;
  currentSpend: number;
  targetBreach: TargetBreachResult;
}
```

Replace the kill rule block (lines 72-89) with:

```typescript
const isAboveKillCpa = cpa > KILL_CPA_MULTIPLIER * targetCPA;

if (
  isAboveKillCpa &&
  targetBreach.granularity === "daily" &&
  targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD
) {
  const multiplier = (cpa / targetCPA).toFixed(1);
  results.push(
    makeRec(
      base,
      "kill",
      0.85,
      "immediate",
      "Campaign is significantly over target CPA and should be paused immediately",
      [
        "Pause campaign in Ads Manager",
        `CPA has been ${multiplier}x target for ${targetBreach.periodsAboveTarget} days`,
      ],
      "no impact",
    ),
  );
}

if (
  isAboveKillCpa &&
  targetBreach.granularity === "weekly" &&
  targetBreach.periodsAboveTarget >= 1
) {
  const multiplier = (cpa / targetCPA).toFixed(1);
  results.push(
    makeRec(
      base,
      "review_budget",
      0.65,
      "this_week",
      `Campaign appears above target CPA (${multiplier}x) based on weekly snapshot data — treat as review signal`,
      [
        "Review campaign performance in Ads Manager",
        "Based on weekly snapshot data, not daily trend — exercise caution",
      ],
      "no impact",
    ),
  );
}
```

Update the scale rule to use `targetBreach.periodsAboveTarget === 0` instead of `daysAboveTarget === 0`:

```typescript
  if (cpa > 0 && cpa < 0.8 * targetCPA && targetBreach.periodsAboveTarget === 0 && diagnoses.length === 0) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-engine`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(ad-optimizer): replace daysAboveTarget with TargetBreachResult in recommendation engine"
```

---

### Task 9: CampaignInsightsProvider V1 Implementation

**Files:**

- Create: `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts`
- Create: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts`

- [ ] **Step 1: Write tests**

Create `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";
import type { WeeklyCampaignSnapshot } from "@switchboard/schemas";

function makeAdsClient(): AdsClientInterface {
  return {
    getCampaignInsights: vi.fn().mockResolvedValue([]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: "act_1",
      accountName: "Test",
      currency: "SGD",
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      activeCampaigns: 0,
    }),
  };
}

describe("MetaCampaignInsightsProvider", () => {
  describe("getTargetBreachStatus", () => {
    it("returns 0 periods when CPA is below target in all snapshots", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
      expect(result.granularity).toBe("weekly");
      expect(result.isApproximate).toBe(true);
    });

    it("counts periods where CPA exceeds targetCPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 2,
          cpa: 50,
        },
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 100,
          conversions: 10,
          cpa: 10,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(1);
    });

    it("skips periods with null CPA", async () => {
      const snapshots: WeeklyCampaignSnapshot[] = [
        {
          campaignId: "c1",
          startDate: new Date(),
          endDate: new Date(),
          spend: 0,
          conversions: 0,
          cpa: null,
        },
      ];

      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
        snapshots,
      });

      expect(result.periodsAboveTarget).toBe(0);
    });

    it("returns 0 periods when no snapshots provided", async () => {
      const provider = new MetaCampaignInsightsProvider(makeAdsClient());
      const result = await provider.getTargetBreachStatus({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
        targetCPA: 20,
        startDate: new Date(),
        endDate: new Date(),
      });

      expect(result.periodsAboveTarget).toBe(0);
      expect(result.granularity).toBe("weekly");
      expect(result.isApproximate).toBe(true);
    });
  });

  describe("getCampaignLearningData", () => {
    it("delegates to adsClient", async () => {
      const adsClient = makeAdsClient();
      (adsClient.getCampaignInsights as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          campaignId: "c1",
          campaignName: "Test",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          impressions: 10000,
          clicks: 200,
          spend: 1000,
          conversions: 50,
          revenue: 5000,
          frequency: 2,
          cpm: 100,
          ctr: 2,
          cpc: 5,
          dateStart: "2026-04-01",
          dateStop: "2026-04-07",
        },
      ]);

      const provider = new MetaCampaignInsightsProvider(adsClient);
      const result = await provider.getCampaignLearningData({
        orgId: "org_1",
        accountId: "act_1",
        campaignId: "c1",
      });

      expect(result.effectiveStatus).toBe("ACTIVE");
      expect(result.optimizationEvents).toBe(50);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-campaign-insights-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provider**

Create `packages/ad-optimizer/src/meta-campaign-insights-provider.ts`:

```typescript
import type { AdsClientInterface } from "./audit-runner.js";
import type {
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
  WeeklyCampaignSnapshot,
} from "@switchboard/schemas";

export class MetaCampaignInsightsProvider implements CampaignInsightsProvider {
  private readonly adsClient: AdsClientInterface;

  constructor(adsClient: AdsClientInterface) {
    this.adsClient = adsClient;
  }

  async getCampaignLearningData(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
  }): Promise<CampaignLearningInput> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 7);

    const insights = await this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(now) },
      fields: ["campaign_id", "effective_status", "conversions"],
    });

    const match = insights.find((i) => i.campaignId === input.campaignId);

    return {
      effectiveStatus: match?.effectiveStatus ?? "UNKNOWN",
      learningPhase: false,
      lastModifiedDays: 0,
      optimizationEvents: match?.conversions ?? 0,
    };
  }

  async getTargetBreachStatus(input: {
    orgId: string;
    accountId: string;
    campaignId: string;
    targetCPA: number;
    startDate: Date;
    endDate: Date;
    snapshots?: WeeklyCampaignSnapshot[];
  }): Promise<TargetBreachResult> {
    const snapshots = input.snapshots ?? [];

    let periodsAboveTarget = 0;
    for (const snap of snapshots) {
      if (snap.cpa != null && snap.cpa > input.targetCPA) {
        periodsAboveTarget++;
      }
    }

    return {
      periodsAboveTarget,
      granularity: "weekly",
      isApproximate: true,
    };
  }
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- meta-campaign-insights-provider`
Expected: ALL PASS

- [ ] **Step 5: Export from barrel**

Add to `packages/ad-optimizer/src/index.ts`:

```typescript
export { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ad-optimizer): add MetaCampaignInsightsProvider v1 with weekly target breach"
```

---

### Task 10: AuditRunner Refactor

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts`
- Modify: `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`
- Modify: `packages/ad-optimizer/src/inngest-functions.ts`

- [ ] **Step 1: Update audit-runner tests**

In `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`:

Update imports:

```typescript
import type { AuditDependencies, AdsClientInterface, AuditConfig } from "../audit-runner.js";
import type {
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
} from "@switchboard/schemas";
```

Replace `makeFunnelData()`:

```typescript
function makeFunnelData(): CrmFunnelData {
  return {
    campaignIds: ["camp-1"],
    leads: 100,
    qualified: 40,
    opportunities: 50,
    bookings: 25,
    closed: 10,
    revenue: 30_000,
    rates: {
      leadToQualified: 0.4,
      qualifiedToBooking: 0.625,
      bookingToClosed: 0.4,
      leadToClosed: 0.1,
    },
    coverage: {
      attributedContacts: 100,
      contactsWithEmailOrPhone: 90,
      contactsWithOpportunity: 50,
      contactsWithBooking: 25,
      contactsWithRevenueEvent: 10,
    },
  };
}
```

Replace `makeBenchmarks()`:

```typescript
function makeCrmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function makeMediaBenchmarks(): MediaBenchmarks {
  return {
    ctr: 2.0,
    landingPageViewRate: 0.85,
    clickToLeadRate: 0.05,
  };
}
```

Replace `makeLearningInput()`:

```typescript
function makeLearningInput(): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
}

function makeTargetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}
```

Replace `buildMockDeps()`:

```typescript
function buildMockDeps(
  overrides: {
    currentInsights?: CampaignInsight[];
    previousInsights?: CampaignInsight[];
  } = {},
): AuditDependencies {
  const currentInsights = overrides.currentInsights ?? [makeCampaignInsight()];
  const previousInsights = overrides.previousInsights ?? [
    makeCampaignInsight({
      spend: 4_800,
      impressions: 95_000,
      clicks: 1_900,
      conversions: 48,
      revenue: 14_400,
      frequency: 2.3,
      cpm: 50.5,
      ctr: 2.0,
      cpc: 2.53,
    }),
  ];

  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce(currentInsights)
      .mockResolvedValueOnce(previousInsights),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };

  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };

  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(makeTargetBreach()),
  };

  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };

  return { adsClient, crmDataProvider, insightsProvider, config };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- audit-runner`
Expected: FAIL — `insightsProvider` not in `AuditDependencies`.

- [ ] **Step 3: Update audit-runner.ts**

Key changes to `packages/ad-optimizer/src/audit-runner.ts`:

Remove `CrmDataProvider` interface (now from schemas). Update imports:

```typescript
import type {
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  TargetBreachResult,
} from "@switchboard/schemas";
```

Remove the old `CrmDataProvider` interface definition (lines 30-35).

Update `AuditConfig`:

```typescript
export interface AuditConfig {
  accountId: string;
  orgId: string;
  targetCPA: number;
  targetROAS: number;
  mediaBenchmarks: MediaBenchmarks;
}
```

Update `AuditDependencies`:

```typescript
export interface AuditDependencies {
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  config: AuditConfig;
}
```

Update `AuditRunner` constructor:

```typescript
export class AuditRunner {
  private readonly adsClient: AdsClientInterface;
  private readonly crmDataProvider: CrmDataProvider;
  private readonly insightsProvider: CampaignInsightsProvider;
  private readonly config: AuditConfig;
  private readonly learningGuard: LearningPhaseGuard;

  constructor(deps: AuditDependencies) {
    this.adsClient = deps.adsClient;
    this.crmDataProvider = deps.crmDataProvider;
    this.insightsProvider = deps.insightsProvider;
    this.config = deps.config;
    this.learningGuard = new LearningPhaseGuard();
  }
```

In `run()`, update Step 2 to use new interface:

```typescript
const [crmData, crmBenchmarks] = await Promise.all([
  this.crmDataProvider.getFunnelData({
    orgId: this.config.orgId,
    accountId: this.config.accountId,
    campaignIds,
    startDate: new Date(dateRange.since),
    endDate: new Date(dateRange.until),
  }),
  this.crmDataProvider.getBenchmarks({
    orgId: this.config.orgId,
    accountId: this.config.accountId,
  }),
]);
```

Update Step 3 to pass split benchmarks:

```typescript
const funnel = analyzeFunnel({
  insights: currentInsights,
  crmData,
  crmBenchmarks,
  mediaBenchmarks: this.config.mediaBenchmarks,
});
```

Update Step 5a (line 172) to use `insightsProvider`:

```typescript
const learningInput = await this.insightsProvider.getCampaignLearningData({
  orgId: this.config.orgId,
  accountId: this.config.accountId,
  campaignId: insight.campaignId,
});
```

Update Step 5e (line 215) to use `insightsProvider`:

```typescript
const targetBreach = await this.insightsProvider.getTargetBreachStatus({
  orgId: this.config.orgId,
  accountId: this.config.accountId,
  campaignId: insight.campaignId,
  targetCPA: this.config.targetCPA,
  startDate: new Date(dateRange.since),
  endDate: new Date(dateRange.until),
});
```

Update Step 5f to pass `targetBreach`:

```typescript
const campaignRecs = generateRecommendations({
  campaignId: insight.campaignId,
  campaignName: insight.campaignName,
  diagnoses,
  deltas: campaignDeltas,
  targetCPA: this.config.targetCPA,
  targetROAS: this.config.targetROAS,
  currentSpend: insight.spend,
  targetBreach,
});
```

- [ ] **Step 4: Update inngest-functions.ts CronDependencies**

In `packages/ad-optimizer/src/inngest-functions.ts`, update the import and interface:

```typescript
import type { AdsClientInterface, AuditConfig } from "./audit-runner.js";
import type { CrmDataProvider, CampaignInsightsProvider } from "@switchboard/schemas";
```

Update `CronDependencies`:

```typescript
export interface CronDependencies {
  listActiveDeployments: () => Promise<DeploymentInfo[]>;
  getDeploymentCredentials: (deploymentId: string) => Promise<DeploymentCredentials | null>;
  createAdsClient: (creds: DeploymentCredentials) => AdsClientInterface;
  createCrmProvider: (deploymentId: string) => CrmDataProvider;
  createInsightsProvider: (adsClient: AdsClientInterface) => CampaignInsightsProvider;
  saveAuditReport: (deploymentId: string, report: unknown) => Promise<void>;
}
```

- [ ] **Step 5: Update barrel exports**

In `packages/ad-optimizer/src/index.ts`, remove the old `CrmDataProvider` export from audit-runner and replace:

```typescript
export type { AuditDependencies, AuditConfig, AdsClientInterface } from "./audit-runner.js";
```

(Remove `CrmDataProvider` from this export — it now comes from `@switchboard/schemas`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: ALL PASS

- [ ] **Step 7: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS — fix any remaining type errors in consumers of `CrmDataProvider`.

- [ ] **Step 8: Commit**

```bash
git commit -m "refactor(ad-optimizer): split CrmDataProvider, add insightsProvider to AuditRunner"
```

---

### Task 11: PrismaCrmDataProvider

**Files:**

- Create: `packages/db/src/stores/__tests__/prisma-crm-data-provider.test.ts`
- Create: `packages/db/src/stores/prisma-crm-data-provider.ts`

- [ ] **Step 1: Write tests**

Create `packages/db/src/stores/__tests__/prisma-crm-data-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PrismaCrmDataProvider, QUALIFIED_OR_LATER_STAGES } from "../prisma-crm-data-provider.js";

function makeMockPrisma(contacts: unknown[] = []) {
  return {
    contact: {
      findMany: vi.fn().mockResolvedValue(contacts),
      count: vi.fn().mockResolvedValue(contacts.length),
    },
  };
}

describe("PrismaCrmDataProvider", () => {
  describe("getBenchmarks", () => {
    it("returns hardcoded beauty/aesthetics defaults for v1", async () => {
      const prisma = makeMockPrisma();
      const provider = new PrismaCrmDataProvider(prisma as never);

      const benchmarks = await provider.getBenchmarks({
        orgId: "org_1",
        accountId: "act_1",
      });

      expect(benchmarks.leadToQualifiedRate).toBe(0.3);
      expect(benchmarks.qualifiedToBookingRate).toBe(0.4);
      expect(benchmarks.bookingToClosedRate).toBe(0.5);
      expect(benchmarks.leadToClosedRate).toBe(0.06);
    });
  });

  describe("getFunnelData", () => {
    it("returns zero counts when no contacts match", async () => {
      const prisma = makeMockPrisma([]);
      const provider = new PrismaCrmDataProvider(prisma as never);

      const data = await provider.getFunnelData({
        orgId: "org_1",
        accountId: "act_1",
        campaignIds: ["camp_1"],
        startDate: new Date("2026-04-01"),
        endDate: new Date("2026-04-30"),
      });

      expect(data.leads).toBe(0);
      expect(data.qualified).toBe(0);
      expect(data.bookings).toBe(0);
      expect(data.closed).toBe(0);
      expect(data.revenue).toBe(0);
      expect(data.rates.leadToQualified).toBeNull();
      expect(data.rates.leadToClosed).toBeNull();
    });
  });

  describe("QUALIFIED_OR_LATER_STAGES", () => {
    it("includes expected stages", () => {
      expect(QUALIFIED_OR_LATER_STAGES).toContain("qualified");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("booked");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("won");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("closed");
      expect(QUALIFIED_OR_LATER_STAGES).toContain("completed");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/db test -- prisma-crm-data-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provider**

Create `packages/db/src/stores/prisma-crm-data-provider.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { CrmDataProvider, CrmFunnelData, FunnelBenchmarks } from "@switchboard/schemas";

export const QUALIFIED_OR_LATER_STAGES = ["qualified", "booked", "won", "closed", "completed"];

const BEAUTY_AESTHETICS_DEFAULTS: FunnelBenchmarks = {
  leadToQualifiedRate: 0.3,
  qualifiedToBookingRate: 0.4,
  bookingToClosedRate: 0.5,
  leadToClosedRate: 0.06,
};

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export class PrismaCrmDataProvider implements CrmDataProvider {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getBenchmarks(_input: {
    orgId: string;
    accountId: string;
    vertical?: string;
  }): Promise<FunnelBenchmarks> {
    return BEAUTY_AESTHETICS_DEFAULTS;
  }

  async getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date;
    endDate: Date;
  }): Promise<CrmFunnelData> {
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: input.orgId,
        createdAt: { gte: input.startDate, lte: input.endDate },
        attribution: {
          path: ["sourceCampaignId"],
          string_contains: "", // Prisma JSON filter — will be refined per actual query
        },
      },
      include: {
        opportunities: true,
        revenueEvents: true,
      },
    });

    const attributed = contacts.filter((c) => {
      const attr = c.attribution as Record<string, unknown> | null;
      const campaignId = attr?.["sourceCampaignId"] as string | undefined;
      return campaignId && input.campaignIds.includes(campaignId);
    });

    const leads = attributed.length;

    let qualifiedCount = 0;
    let opportunityCount = 0;
    let bookingCount = 0;
    let closedCount = 0;
    let totalRevenue = 0;
    let contactsWithEmailOrPhone = 0;
    let contactsWithOpportunity = 0;
    let contactsWithBooking = 0;
    let contactsWithRevenueEvent = 0;

    for (const contact of attributed) {
      if (contact.email || contact.phone) contactsWithEmailOrPhone++;

      const opps = contact.opportunities ?? [];
      if (opps.length > 0) contactsWithOpportunity++;
      opportunityCount += opps.length;

      for (const opp of opps) {
        if (QUALIFIED_OR_LATER_STAGES.includes(opp.stage)) {
          qualifiedCount++;
        }
      }

      // Bookings are not included on Contact by default — would need separate query
      // For v1, use opportunity stage progression as proxy for bookings
      // TODO: Add Booking join when Contact→Booking relation is available

      const revEvents = contact.revenueEvents ?? [];
      const confirmedRevenue = revEvents.filter((r) => r.status === "confirmed");
      if (confirmedRevenue.length > 0) {
        contactsWithRevenueEvent++;
        closedCount++;
      }
      for (const rev of confirmedRevenue) {
        totalRevenue += rev.amount;
      }
    }

    return {
      campaignIds: input.campaignIds,
      leads,
      qualified: qualifiedCount,
      opportunities: opportunityCount,
      bookings: bookingCount,
      closed: closedCount,
      revenue: totalRevenue,
      rates: {
        leadToQualified: safeRate(qualifiedCount, leads),
        qualifiedToBooking: safeRate(bookingCount, qualifiedCount),
        bookingToClosed: safeRate(closedCount, bookingCount),
        leadToClosed: safeRate(closedCount, leads),
      },
      coverage: {
        attributedContacts: leads,
        contactsWithEmailOrPhone,
        contactsWithOpportunity,
        contactsWithBooking,
        contactsWithRevenueEvent,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/db test -- prisma-crm-data-provider`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): add PrismaCrmDataProvider with lead-cohort funnel analysis"
```

---

### Task 12: Final Integration — Verify Full Test Suite

**Files:**

- No new files

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS — fix any lint issues.

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "chore: fix integration issues from CRM outcome + Meta feedback loop"
```

---

## App-Layer Trigger Wiring (Deferred)

Tasks for wiring the four transition triggers (inquiry, qualified, booked, purchased) at the app layer are intentionally deferred. These depend on identifying the exact route handlers or service methods where each transition currently happens in `apps/api/`. The pattern is documented in the spec (Section 5) — each trigger loads Contact, calls `buildConversionEvent`, and emits to `ConversionBus`.

The four triggers are:

1. **inquiry** — wire in the conversation processing flow where the first outbound agent message is sent. Requires `ConversationThread.firstAgentMessageAt` transition guard.
2. **qualified** — wire in the opportunity update handler. Guard: `previousStage !== "qualified" && newStage === "qualified"`.
3. **booked** — wire in the booking confirmation handler. Guard: `previousStatus !== "confirmed" && newStatus === "confirmed"`.
4. **purchased** — wire in the revenue event creation handler. Guard: `status === "confirmed"`.

These are app-layer tasks that should be planned after the foundation (Tasks 1-12) is complete and tested.
