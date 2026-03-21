# Stage 3: Close the Attribution Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enter the North Star's Stage 2 (Attribute) by fixing remaining wiring gaps, surfacing outcome analytics, adding per-campaign booking attribution, emitting post-booking revenue events to Meta CAPI, and implementing Google Offline Conversions — so ad platforms optimize for paying customers, not clicks.

**Architecture:** Stage 1-2 built the lead bot pipeline (convert + track). Stage 3 closes the attribution loop: fix the chat app's unwired ConversionBus (events currently go nowhere), query OutcomeEvent data for analytics, break down cost-per-booking by campaign using Meta Insights API, emit `attended`/`paid` revenue events through the existing CAPIDispatcher pipeline, and implement a Google Offline Conversions dispatcher that parallels the Meta CAPIDispatcher. The CAPIDispatcher already handles all 5 event types — we just need to emit the missing ones from the right code paths.

**Tech Stack:** TypeScript, Vitest, Prisma, Fastify, Next.js, Meta Graph API (CAPI + Insights), Google Ads API (Offline Conversions), ConversionBus, OutcomePipeline, CAPIDispatcher

---

## Deliverable 1: Fix Critical Wiring Gaps

**Problem:** Two infrastructure pieces are built but not connected:

1. The **silence detector** (`apps/chat/src/jobs/silence-detector.ts`) is never started — `bootstrap.ts` doesn't import or call `startSilenceDetector()`
2. The **chat app's ConversionBus** has zero subscribers — `InMemoryConversionBus` is created at `bootstrap.ts:411` but no `CAPIDispatcher` or `OutcomeTracker` is registered. Events emitted by the lead handler (`inquiry`, `qualified`, `booked`) go nowhere. The API app correctly wires subscribers at `app.ts:185-204`, but standalone chat mode is blind.

### Task 1: Wire silence detector into bootstrap

**Files:**

- Modify: `apps/chat/src/bootstrap.ts:465-501`
- Test: `apps/chat/src/jobs/__tests__/silence-detector.test.ts` (existing, verify passes)

**Step 1: Read the bootstrap file**

Read `apps/chat/src/bootstrap.ts` lines 460-501 to see the cadence worker section and cleanup function.

**Step 2: Add silence detector wiring**

After the cadence worker block (around line 489) and before the cleanup function, add:

```ts
// Silence detector — flags conversations with 72h+ of inactivity as unresponsive
let stopSilenceDetector: (() => void) | null = null;
if (isLeadBot && outcomeStore) {
  const { startSilenceDetector } = await import("./jobs/silence-detector.js");
  const { OutcomePipeline } = await import("@switchboard/core");
  const { getDb } = await import("@switchboard/db");
  stopSilenceDetector = startSilenceDetector({
    prisma: getDb(),
    outcomePipeline: new OutcomePipeline(outcomeStore),
  });
}
```

Update the cleanup function to include it:

```ts
const cleanup = () => {
  if (campaignRefreshTimer) clearInterval(campaignRefreshTimer);
  if (stopCadenceWorker) stopCadenceWorker();
  if (stopSilenceDetector) stopSilenceDetector();
};
```

**Step 3: Verify existing tests pass**

Run: `cd /Users/jasonljc/switchboard && node_modules/.bin/vitest run apps/chat/src/jobs/__tests__/silence-detector.test.ts`
Expected: 3 tests PASS

**Step 4: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p apps/chat/tsconfig.json`
Expected: clean

**Step 5: Commit**

```bash
git commit -m "fix: wire silence detector into chat bootstrap lifecycle"
```

---

### Task 2: Wire CAPIDispatcher subscriber on chat ConversionBus

**Files:**

- Modify: `apps/chat/src/bootstrap.ts:408-415`
- Test: verify with typecheck

**Context:** The API app wires CAPIDispatcher at `apps/api/src/app.ts:185-204`. The chat app creates `InMemoryConversionBus()` at line 411 but registers no subscribers. When the chat app runs standalone (not API-delegated), conversion events emitted by the lead handler never reach Meta CAPI.

**Step 1: Read the bootstrap file**

Read `apps/chat/src/bootstrap.ts` lines 400-420 to see where ConversionBus is created and what's available (connection store, credential resolution).

**Step 2: Add CAPIDispatcher wiring**

After the ConversionBus creation (line 411), add conditional CAPIDispatcher registration:

```ts
// Wire CAPIDispatcher to ConversionBus so lead bot events reach Meta CAPI
if (process.env["META_PIXEL_ID"] && process.env["META_ADS_ACCESS_TOKEN"]) {
  try {
    const { CAPIDispatcher } = await import("@switchboard/digital-ads");
    const { createMetaAdsWriteProvider } = await import("@switchboard/digital-ads");
    const adsProvider = createMetaAdsWriteProvider({
      accessToken: process.env["META_ADS_ACCESS_TOKEN"],
      adAccountId: process.env["META_ADS_ACCOUNT_ID"] ?? "",
    });
    const crmProvider =
      chatCrmProvider ??
      ({
        searchContacts: async () => [],
        getContact: async () => null,
      } as never);
    const dispatcher = new CAPIDispatcher({
      adsProvider,
      crmProvider,
      pixelId: process.env["META_PIXEL_ID"],
    });
    dispatcher.register(conversionBus);
  } catch (err) {
    console.error("[Bootstrap] Failed to wire CAPIDispatcher:", err);
  }
}
```

**Note:** Check what variables hold the CRM provider in bootstrap context. The API app uses `new PrismaCrmProvider(prismaClient)`. The chat app may have `chatCrmProvider` or similar — read the file to find the exact variable name.

**Step 3: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p apps/chat/tsconfig.json`
Expected: clean

**Step 4: Commit**

```bash
git commit -m "fix: wire CAPIDispatcher on chat ConversionBus for standalone mode"
```

---

## Deliverable 2: Outcome-Powered Analytics

**Problem:** `buildOutcomeSummary()` in `operator-summary.ts:105-158` queries CRM tables (`crmContact.count`, `crmDeal.findMany`) for leads/bookings counts. The 6 outcome types stored in `OutcomeEvent` are never queried. Business owners can't see escalation rates, unresponsive counts, or reactivation success.

### Task 3: Add outcome breakdown to OperatorSummary

**Files:**

- Modify: `apps/api/src/services/operator-summary.ts:9-49` (interface) and `:105-158` (query)
- Test: `apps/api/src/services/__tests__/operator-summary.test.ts`

**Step 1: Write the failing test**

Add a test that verifies `buildOutcomeSummary` returns outcome breakdown fields:

```ts
it("includes outcome breakdown from OutcomeEvent table", async () => {
  const summary = await buildOperatorSummary({
    prisma: mockPrisma,
    redis: null,
    organizationId: "org-1",
  });

  expect(summary.outcomes).toHaveProperty("outcomeBreakdown");
  expect(summary.outcomes.outcomeBreakdown).toEqual(
    expect.objectContaining({
      booked: expect.any(Number),
      lost: expect.any(Number),
      escalated_unresolved: expect.any(Number),
      escalated_resolved: expect.any(Number),
      unresponsive: expect.any(Number),
      reactivated: expect.any(Number),
    }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && node_modules/.bin/vitest run apps/api/src/services/__tests__/operator-summary.test.ts`
Expected: FAIL — `outcomeBreakdown` not present

**Step 3: Extend OperatorSummary interface**

In `operator-summary.ts`, add to the `outcomes` section of the `OperatorSummary` interface:

```ts
outcomes: {
  leads30d: number;
  qualifiedLeads30d: number;
  bookings30d: number;
  revenue30d: number | null;
  costPerLead30d: number | null;
  costPerQualifiedLead30d: number | null;
  costPerBooking30d: number | null;
  // Outcome event breakdown (from OutcomeEvent table)
  outcomeBreakdown: {
    booked: number;
    lost: number;
    escalated_unresolved: number;
    escalated_resolved: number;
    unresponsive: number;
    reactivated: number;
  }
}
```

**Step 4: Query OutcomeEvent in buildOutcomeSummary**

Add a Prisma query to `buildOutcomeSummary()` that groups OutcomeEvent by `outcomeType` for the last 30 days:

```ts
const outcomeEvents = await prisma.outcomeEvent.groupBy({
  by: ["outcomeType"],
  where: {
    organizationId,
    timestamp: { gte: thirtyDaysAgo },
  },
  _count: { id: true },
});

const outcomeBreakdown = {
  booked: 0,
  lost: 0,
  escalated_unresolved: 0,
  escalated_resolved: 0,
  unresponsive: 0,
  reactivated: 0,
};
for (const row of outcomeEvents) {
  const key = row.outcomeType as keyof typeof outcomeBreakdown;
  if (key in outcomeBreakdown) {
    outcomeBreakdown[key] = row._count.id;
  }
}
```

Add `outcomeBreakdown` to the return object.

**Step 5: Run test to verify it passes**

**Step 6: Update dashboard API client type**

In `apps/dashboard/src/lib/api-client.ts`, update the `OperatorSummary` type to include `outcomeBreakdown`.

**Step 7: Commit**

```bash
git commit -m "feat: add outcome breakdown to OperatorSummary from OutcomeEvent table"
```

---

### Task 4: Display outcome breakdown on dashboard

**Files:**

- Modify: `apps/dashboard/src/app/results/page.tsx`

**Step 1: Read the results page**

Read `apps/dashboard/src/app/results/page.tsx` to understand the tile layout pattern.

**Step 2: Add outcome funnel section**

After the existing scorecard row, add a new section "Lead Outcomes" showing the 6 outcome type counts in a horizontal bar or mini-cards:

```tsx
{
  /* Lead Outcomes */
}
<section className="mt-8">
  <h2 className="text-lg font-semibold text-zinc-100 mb-4">Lead Outcomes (30 days)</h2>
  <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
    <OutcomeTile label="Booked" count={outcomes.outcomeBreakdown.booked} color="green" />
    <OutcomeTile label="Lost" count={outcomes.outcomeBreakdown.lost} color="red" />
    <OutcomeTile
      label="Escalated"
      count={outcomes.outcomeBreakdown.escalated_unresolved}
      color="yellow"
    />
    <OutcomeTile
      label="Resolved"
      count={outcomes.outcomeBreakdown.escalated_resolved}
      color="green"
    />
    <OutcomeTile label="Unresponsive" count={outcomes.outcomeBreakdown.unresponsive} color="zinc" />
    <OutcomeTile label="Reactivated" count={outcomes.outcomeBreakdown.reactivated} color="blue" />
  </div>
</section>;
```

Create a simple `OutcomeTile` component inline (not a separate file — used only here):

```tsx
function OutcomeTile({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    green: "bg-emerald-900/40 text-emerald-300",
    red: "bg-red-900/40 text-red-300",
    yellow: "bg-amber-900/40 text-amber-300",
    blue: "bg-blue-900/40 text-blue-300",
    zinc: "bg-zinc-800 text-zinc-400",
  };
  return (
    <div className={`rounded-lg p-3 text-center ${colorMap[color] ?? colorMap.zinc}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}
```

**Step 3: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p apps/dashboard/tsconfig.json`

**Step 4: Commit**

```bash
git commit -m "feat: display outcome breakdown tiles on dashboard results page"
```

---

## Deliverable 3: Per-Campaign Booking Attribution

**Problem:** The weekly digest and dashboard show aggregate cost-per-booking. Business owners need to see which campaigns produce real bookings vs junk inquiries. The data exists — CRM contacts have `sourceAdId`/`sourceCampaignId`, and Meta Insights API supports campaign-level spend queries — but nothing connects them.

### Task 5: Build per-campaign attribution query

**Files:**

- Create: `apps/api/src/services/campaign-attribution.ts`
- Create: `apps/api/src/services/__tests__/campaign-attribution.test.ts`

**Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/campaign-attribution.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCampaignAttribution } from "../campaign-attribution.js";

describe("buildCampaignAttribution", () => {
  it("groups bookings by sourceCampaignId with spend data", async () => {
    const prisma = {
      crmContact: {
        findMany: vi.fn().mockResolvedValue([
          { id: "c1", sourceCampaignId: "camp-1", sourceAdId: "ad-1" },
          { id: "c2", sourceCampaignId: "camp-1", sourceAdId: "ad-2" },
          { id: "c3", sourceCampaignId: "camp-2", sourceAdId: "ad-3" },
        ]),
      },
      crmDeal: {
        findMany: vi.fn().mockResolvedValue([
          { contactId: "c1", stage: "booked" },
          { contactId: "c3", stage: "booked" },
        ]),
      },
    };

    const adsProvider = {
      getCampaignInsights: vi
        .fn()
        .mockResolvedValueOnce([{ spend: "150.00" }])
        .mockResolvedValueOnce([{ spend: "200.00" }]),
    };

    const result = await buildCampaignAttribution({
      prisma: prisma as never,
      adsProvider: adsProvider as never,
      organizationId: "org-1",
      days: 30,
    });

    expect(result).toHaveLength(2);
    const camp1 = result.find((c) => c.campaignId === "camp-1");
    expect(camp1).toBeDefined();
    expect(camp1!.leads).toBe(2);
    expect(camp1!.bookings).toBe(1);
    expect(camp1!.spend).toBe(150);
    expect(camp1!.costPerBooking).toBe(150);
  });

  it("handles campaigns with zero bookings", async () => {
    const prisma = {
      crmContact: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "c1", sourceCampaignId: "camp-1", sourceAdId: null }]),
      },
      crmDeal: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await buildCampaignAttribution({
      prisma: prisma as never,
      adsProvider: null,
      organizationId: "org-1",
      days: 30,
    });

    expect(result).toHaveLength(1);
    expect(result[0].bookings).toBe(0);
    expect(result[0].costPerBooking).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run apps/api/src/services/__tests__/campaign-attribution.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `apps/api/src/services/campaign-attribution.ts`:

```ts
// ---------------------------------------------------------------------------
// Per-Campaign Booking Attribution — links CRM contacts to campaign spend
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";

export interface CampaignAttribution {
  campaignId: string;
  leads: number;
  bookings: number;
  spend: number | null;
  costPerLead: number | null;
  costPerBooking: number | null;
}

interface AdsProviderLike {
  getCampaignInsights(
    campaignId: string,
    options: { dateRange: { since: string; until: string }; fields: string[] },
  ): Promise<Array<{ spend?: string }>>;
}

interface AttributionConfig {
  prisma: PrismaClient;
  adsProvider: AdsProviderLike | null;
  organizationId: string;
  days?: number;
}

export async function buildCampaignAttribution(
  config: AttributionConfig,
): Promise<CampaignAttribution[]> {
  const { prisma, adsProvider, organizationId, days = 30 } = config;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all contacts with campaign attribution in the period
  const contacts = await prisma.crmContact.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      sourceCampaignId: { not: null },
    },
    select: { id: true, sourceCampaignId: true },
  });

  if (contacts.length === 0) return [];

  // Get booked deals for these contacts
  const contactIds = contacts.map((c) => c.id);
  const bookedDeals = await prisma.crmDeal.findMany({
    where: {
      organizationId,
      contactId: { in: contactIds },
      stage: {
        in: ["consultation_booked", "booked", "appointment_scheduled", "closed_won"],
      },
    },
    select: { contactId: true },
  });

  const bookedContactIds = new Set(bookedDeals.map((d) => d.contactId));

  // Group by campaign
  const campaignMap = new Map<string, { leads: number; bookings: number }>();
  for (const contact of contacts) {
    const campId = contact.sourceCampaignId!;
    const entry = campaignMap.get(campId) ?? { leads: 0, bookings: 0 };
    entry.leads++;
    if (bookedContactIds.has(contact.id)) entry.bookings++;
    campaignMap.set(campId, entry);
  }

  // Fetch spend per campaign from ads provider
  const dateRange = {
    since: since.toISOString().split("T")[0],
    until: new Date().toISOString().split("T")[0],
  };

  const results: CampaignAttribution[] = [];
  for (const [campaignId, counts] of campaignMap) {
    let spend: number | null = null;
    if (adsProvider) {
      try {
        const insights = await adsProvider.getCampaignInsights(campaignId, {
          dateRange,
          fields: ["spend"],
        });
        spend = insights[0]?.spend ? parseFloat(insights[0].spend) : null;
      } catch {
        // Campaign might not exist in Meta anymore
      }
    }

    results.push({
      campaignId,
      leads: counts.leads,
      bookings: counts.bookings,
      spend,
      costPerLead:
        spend !== null && counts.leads > 0 ? Math.round((spend / counts.leads) * 100) / 100 : null,
      costPerBooking:
        spend !== null && counts.bookings > 0
          ? Math.round((spend / counts.bookings) * 100) / 100
          : null,
    });
  }

  // Sort by bookings desc, then leads desc
  results.sort((a, b) => b.bookings - a.bookings || b.leads - a.leads);
  return results;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Add API route**

Add a `GET /api/reports/campaign-attribution` endpoint in `apps/api/src/routes/reports.ts` that calls `buildCampaignAttribution()`.

**Step 6: Commit**

```bash
git commit -m "feat: add per-campaign booking attribution query and API endpoint"
```

---

### Task 6: Add campaign attribution to weekly digest

**Files:**

- Modify: `apps/api/src/services/lead-digest.ts`
- Modify: `apps/api/src/services/__tests__/lead-digest.test.ts`

**Step 1: Read the digest service**

Read `apps/api/src/services/lead-digest.ts` to see the `formatDigestMessage()` function.

**Step 2: Add top-campaign line to digest**

In the `WeeklyDigest` interface, add:

```ts
  topCampaign: {
    campaignId: string;
    bookings: number;
    costPerBooking: number | null;
  } | null;
```

In `generateWeeklyDigest()`, after building the summary, call `buildCampaignAttribution()` and pick the top campaign (most bookings). Add a line to `formatDigestMessage`:

```ts
if (data.topCampaign && data.topCampaign.costPerBooking !== null) {
  lines.push(
    `Top campaign: ${data.topCampaign.campaignId} — ${data.topCampaign.bookings} bookings at $${data.topCampaign.costPerBooking.toFixed(2)}/booking`,
  );
}
```

**Step 3: Update tests**

Add a test in `lead-digest.test.ts` verifying the top campaign line appears in the formatted message.

**Step 4: Commit**

```bash
git commit -m "feat: include top campaign in weekly performance digest"
```

---

## Deliverable 4: Post-Booking Revenue Events

**Problem:** The ConversionBus and CAPIDispatcher already support `purchased` and `completed` event types (mapped to Meta `Purchase` events). But these events are never emitted. The North Star says: "Real revenue events — booked consultations, attended visits, treatments paid — are fed back into Meta." Currently only `booked` reaches CAPI. The higher-value `attended` and `paid` signals are missing.

**Approach:** CRM deal stage transitions are the trigger. When a deal moves to `appointment_attended` or `closed_won`/`treatment_paid`, emit the corresponding ConversionBus event. The CAPIDispatcher already handles them — we just need the emission site.

### Task 7: Emit revenue events on CRM deal stage transitions

**Files:**

- Modify: `apps/api/src/routes/crm.ts` (the deal update endpoint)
- Create: `apps/api/src/services/__tests__/deal-stage-events.test.ts`
- Create: `apps/api/src/services/deal-stage-events.ts`

**Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/deal-stage-events.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { emitDealStageEvent } from "../deal-stage-events.js";

describe("emitDealStageEvent", () => {
  it("emits 'purchased' when deal moves to 'appointment_attended'", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 350,
      stage: "appointment_attended",
    };
    const contact = { sourceCampaignId: "camp-1", sourceAdId: "ad-1" };

    emitDealStageEvent(bus, deal, contact);

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "purchased",
        contactId: "contact-1",
        value: 350,
        sourceCampaignId: "camp-1",
        sourceAdId: "ad-1",
      }),
    );
  });

  it("emits 'completed' when deal moves to 'closed_won'", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 500,
      stage: "closed_won",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "completed",
        contactId: "contact-1",
        value: 500,
      }),
    );
  });

  it("does not emit for non-revenue stages", () => {
    const bus = { emit: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    const deal = {
      contactId: "contact-1",
      organizationId: "org-1",
      amount: 0,
      stage: "qualified",
    };

    emitDealStageEvent(bus, deal, null);

    expect(bus.emit).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write implementation**

Create `apps/api/src/services/deal-stage-events.ts`:

```ts
// ---------------------------------------------------------------------------
// Deal Stage Events — emits ConversionBus events on CRM deal transitions
// ---------------------------------------------------------------------------

import type { ConversionBus } from "@switchboard/core";

const STAGE_EVENT_MAP: Record<string, "purchased" | "completed"> = {
  appointment_attended: "purchased",
  treatment_paid: "completed",
  closed_won: "completed",
};

interface DealData {
  contactId: string;
  organizationId: string;
  amount: number | null;
  stage: string;
}

interface ContactAttribution {
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
}

export function emitDealStageEvent(
  bus: ConversionBus,
  deal: DealData,
  contact: ContactAttribution | null,
): void {
  const eventType = STAGE_EVENT_MAP[deal.stage];
  if (!eventType) return;

  bus.emit({
    type: eventType,
    contactId: deal.contactId,
    organizationId: deal.organizationId,
    value: deal.amount ?? 0,
    sourceAdId: contact?.sourceAdId ?? undefined,
    sourceCampaignId: contact?.sourceCampaignId ?? undefined,
    timestamp: new Date(),
    metadata: { stage: deal.stage },
  });
}
```

**Step 4: Run test to verify it passes**

**Step 5: Wire into CRM deal update route**

In `apps/api/src/routes/crm.ts`, find the deal update/create endpoint. After a deal is created or updated with a stage in `STAGE_EVENT_MAP`, call `emitDealStageEvent()` with the app's ConversionBus (available via `app.conversionBus`).

```ts
// After deal create/update:
if (app.conversionBus && deal.contactId) {
  const contact = deal.contactId
    ? await prisma.crmContact.findUnique({
        where: { id: deal.contactId },
        select: { sourceCampaignId: true, sourceAdId: true },
      })
    : null;
  emitDealStageEvent(app.conversionBus, deal, contact);
}
```

**Step 6: Commit**

```bash
git commit -m "feat: emit purchased/completed events to ConversionBus on deal stage transitions"
```

---

## Deliverable 5: Google Offline Conversions Dispatcher

**Problem:** Only Meta receives conversion signals. The North Star says ad platforms (plural) should get smarter. Google Ads supports Offline Conversions via the `uploadClickConversions` API. The `GoogleAdsWriteProvider.sendConversionEvent()` currently throws "not yet implemented."

**Approach:** Create a `GoogleOfflineDispatcher` parallel to `CAPIDispatcher`. It subscribes to ConversionBus events and uploads them to Google Ads as offline conversions. The existing `GoogleAdsWriteProvider` stub gets a real implementation.

### Task 8: Implement Google Offline Conversions upload

**Files:**

- Modify: `cartridges/digital-ads/src/cartridge/providers/google-write-provider.ts`
- Create: `cartridges/digital-ads/src/tracking/google-offline-dispatcher.ts`
- Create: `cartridges/digital-ads/src/tracking/__tests__/google-offline-dispatcher.test.ts`
- Modify: `cartridges/digital-ads/src/index.ts` (export)

**Step 1: Write the failing test**

Create `cartridges/digital-ads/src/tracking/__tests__/google-offline-dispatcher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { GoogleOfflineDispatcher } from "../google-offline-dispatcher.js";
import type { ConversionBus, ConversionEvent } from "@switchboard/core";

describe("GoogleOfflineDispatcher", () => {
  it("uploads offline conversion for 'booked' events with gclid", async () => {
    const uploadFn = vi.fn().mockResolvedValue({ success: true });
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({
        id: "c1",
        email: "test@example.com",
        gclid: "gclid-123",
      }),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: uploadFn,
      crmProvider: crmProvider as never,
      conversionActionId: "conversions/123",
    });

    await dispatcher.handleEvent({
      type: "booked",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date("2026-03-16T10:00:00Z"),
      metadata: {},
    });

    expect(uploadFn).toHaveBeenCalledWith(
      expect.objectContaining({
        gclid: "gclid-123",
        conversionAction: "conversions/123",
        conversionValue: 100,
      }),
    );
  });

  it("skips events without gclid on contact", async () => {
    const uploadFn = vi.fn();
    const crmProvider = {
      getContact: vi.fn().mockResolvedValue({ id: "c1", email: "test@example.com" }),
    };

    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: uploadFn,
      crmProvider: crmProvider as never,
      conversionActionId: "conversions/123",
    });

    await dispatcher.handleEvent({
      type: "booked",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date(),
      metadata: {},
    });

    expect(uploadFn).not.toHaveBeenCalled();
  });

  it("registers on ConversionBus with wildcard", () => {
    const bus = { subscribe: vi.fn(), unsubscribe: vi.fn(), emit: vi.fn() };
    const dispatcher = new GoogleOfflineDispatcher({
      uploadConversion: vi.fn(),
      crmProvider: {} as never,
      conversionActionId: "conversions/123",
    });

    dispatcher.register(bus as ConversionBus);

    expect(bus.subscribe).toHaveBeenCalledWith("*", expect.any(Function));
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write implementation**

Create `cartridges/digital-ads/src/tracking/google-offline-dispatcher.ts`:

```ts
// ---------------------------------------------------------------------------
// Google Offline Conversions Dispatcher — uploads ConversionBus events to Google Ads
// ---------------------------------------------------------------------------

import type { ConversionBus, ConversionEvent } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";

interface OfflineConversion {
  gclid: string;
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: string;
}

export interface GoogleOfflineDispatcherConfig {
  uploadConversion: (conversion: OfflineConversion) => Promise<{ success: boolean }>;
  crmProvider: CrmProvider;
  conversionActionId: string;
  currencyCode?: string;
}

export class GoogleOfflineDispatcher {
  private config: GoogleOfflineDispatcherConfig;

  constructor(config: GoogleOfflineDispatcherConfig) {
    this.config = config;
  }

  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  async handleEvent(event: ConversionEvent): Promise<void> {
    const contact = await this.config.crmProvider.getContact(event.contactId);
    if (!contact?.gclid) return;

    try {
      await this.config.uploadConversion({
        gclid: contact.gclid,
        conversionAction: this.config.conversionActionId,
        conversionDateTime: event.timestamp.toISOString().replace("T", " ").replace("Z", "+00:00"),
        conversionValue: event.value,
        currencyCode: this.config.currencyCode ?? "SGD",
      });
    } catch {
      // Non-critical — don't block the event bus
    }
  }
}
```

**Step 4: Check CRM contact schema for gclid field**

Read `packages/db/prisma/schema.prisma` for the `CrmContact` model. If `gclid` field doesn't exist, add it:

```prisma
  gclid             String?  // Google Click ID for offline conversion attribution
```

Also check `CrmProvider` interface in `packages/schemas/src/crm-provider.ts` for `getContact` method — verify it returns `gclid` if the field exists.

**Step 5: Run test to verify it passes**

**Step 6: Export from digital-ads**

In `cartridges/digital-ads/src/index.ts`, add:

```ts
export { GoogleOfflineDispatcher } from "./tracking/google-offline-dispatcher.js";
export type { GoogleOfflineDispatcherConfig } from "./tracking/google-offline-dispatcher.js";
```

**Step 7: Wire in API app**

In `apps/api/src/app.ts`, after the CAPIDispatcher registration (line 204), add conditional Google dispatcher:

```ts
// Google Offline Conversions dispatcher (when Google Ads credentials available)
if (googleWriteProvider) {
  const { GoogleOfflineDispatcher } = await import("@switchboard/digital-ads");
  const googleDispatcher = new GoogleOfflineDispatcher({
    uploadConversion: (conv) => googleWriteProvider.uploadOfflineConversion(conv),
    crmProvider: new PrismaCrmProvider(prismaClient),
    conversionActionId: process.env["GOOGLE_CONVERSION_ACTION_ID"] ?? "",
  });
  googleDispatcher.register(conversionBus);
}
```

**Step 8: Commit**

```bash
git commit -m "feat: add Google Offline Conversions dispatcher for ConversionBus events"
```

---

### Task 9: Add campaign intelligence to dashboard

**Files:**

- Create: `apps/dashboard/src/app/campaigns/page.tsx`
- Modify: `apps/dashboard/src/lib/api-client.ts` (add method)
- Modify: `apps/dashboard/src/components/layout/shell.tsx` (add nav item)
- Modify: `apps/dashboard/src/lib/query-keys.ts` (add key)

**Step 1: Add API client method**

In `apps/dashboard/src/lib/api-client.ts`, add:

```ts
async getCampaignAttribution(): Promise<CampaignAttribution[]> {
  const data = await this.request<{ campaigns: CampaignAttribution[] }>("/api/reports/campaign-attribution");
  return data.campaigns;
}
```

Add type:

```ts
interface CampaignAttribution {
  campaignId: string;
  leads: number;
  bookings: number;
  spend: number | null;
  costPerLead: number | null;
  costPerBooking: number | null;
}
```

**Step 2: Add query key**

In `query-keys.ts`:

```ts
campaigns: {
  all: ["campaigns"] as const,
  attribution: () => [...queryKeys.campaigns.all, "attribution"] as const,
},
```

**Step 3: Create campaigns page**

Create `apps/dashboard/src/app/campaigns/page.tsx`:

- Table layout: Campaign ID | Leads | Bookings | Booking Rate | Spend | Cost/Booking
- Color-code cost-per-booking: green if < $50, yellow if < $100, red if >= $100
- Sort by bookings descending (most productive first)
- Show "Which campaigns produce real bookings?" as subtitle
- Follow existing auth guard and skeleton patterns

**Step 4: Add nav item**

In `shell.tsx`, add "Campaigns" (with `BarChart3` icon) to the nav between "Chats" and "Results".

**Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p apps/dashboard/tsconfig.json`

**Step 6: Commit**

```bash
git commit -m "feat: add campaign intelligence page to dashboard"
```

---

## Implementation Order

```
Phase 1 (parallel — critical fixes):
  ├── Task 1: Wire silence detector into bootstrap
  └── Task 2: Wire CAPIDispatcher on chat ConversionBus

Phase 2 (parallel — analytics):
  ├── Task 3: Add outcome breakdown to OperatorSummary
  ├── Task 4: Display outcome breakdown on dashboard
  └── Task 5: Build per-campaign attribution query

Phase 3 (sequential — revenue signals):
  ├── Task 6: Add campaign attribution to weekly digest
  └── Task 7: Emit revenue events on deal stage transitions

Phase 4 (parallel — Google + dashboard):
  ├── Task 8: Google Offline Conversions dispatcher
  └── Task 9: Campaign intelligence dashboard page
```

## Verification

After all tasks:

1. `node_modules/.bin/vitest run apps/chat/` — all chat tests pass
2. `node_modules/.bin/vitest run apps/api/` — all API tests pass
3. `node_modules/.bin/vitest run cartridges/digital-ads/` — all digital-ads tests pass
4. `node_modules/.bin/tsc --noEmit -p apps/chat/tsconfig.json` — clean
5. `node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` — clean
6. `node_modules/.bin/tsc --noEmit -p apps/dashboard/tsconfig.json` — clean

## Files Summary

| Action | File                                                                              | Task   |
| ------ | --------------------------------------------------------------------------------- | ------ |
| MODIFY | `apps/chat/src/bootstrap.ts`                                                      | T1, T2 |
| MODIFY | `apps/api/src/services/operator-summary.ts`                                       | T3     |
| MODIFY | `apps/api/src/services/__tests__/operator-summary.test.ts`                        | T3     |
| MODIFY | `apps/dashboard/src/lib/api-client.ts`                                            | T3, T9 |
| MODIFY | `apps/dashboard/src/app/results/page.tsx`                                         | T4     |
| CREATE | `apps/api/src/services/campaign-attribution.ts`                                   | T5     |
| CREATE | `apps/api/src/services/__tests__/campaign-attribution.test.ts`                    | T5     |
| MODIFY | `apps/api/src/routes/reports.ts`                                                  | T5     |
| MODIFY | `apps/api/src/services/lead-digest.ts`                                            | T6     |
| MODIFY | `apps/api/src/services/__tests__/lead-digest.test.ts`                             | T6     |
| CREATE | `apps/api/src/services/deal-stage-events.ts`                                      | T7     |
| CREATE | `apps/api/src/services/__tests__/deal-stage-events.test.ts`                       | T7     |
| MODIFY | `apps/api/src/routes/crm.ts`                                                      | T7     |
| CREATE | `cartridges/digital-ads/src/tracking/google-offline-dispatcher.ts`                | T8     |
| CREATE | `cartridges/digital-ads/src/tracking/__tests__/google-offline-dispatcher.test.ts` | T8     |
| MODIFY | `cartridges/digital-ads/src/index.ts`                                             | T8     |
| MODIFY | `apps/api/src/app.ts`                                                             | T8     |
| CREATE | `apps/dashboard/src/app/campaigns/page.tsx`                                       | T9     |
| MODIFY | `apps/dashboard/src/components/layout/shell.tsx`                                  | T9     |
| MODIFY | `apps/dashboard/src/lib/query-keys.ts`                                            | T9     |
