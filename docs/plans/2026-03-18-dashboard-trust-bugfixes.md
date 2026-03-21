# Dashboard Operational Trust — Bugfix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the critical inbox data mismatch, multi-deal attribution bug, missing server-side validation, and days param validation from PR #136 review.

**Architecture:** Four independent fixes touching BFF transform layer, pure aggregation function, and input validation. No new dependencies.

**Tech Stack:** TypeScript, Next.js App Router, Fastify, Vitest

---

## Task 1: Fix inbox BFF data shape mismatch (Critical)

The BFF proxies raw backend response `{ handoffs: [...] }` but `useInbox` expects `{ items: InboxItem[]; total: number }` with nested `handoff`/`conversation` keys and computed `waitingSince`/`slaRemaining`. The inbox page is completely broken at runtime.

**Files:**

- Modify: `apps/dashboard/src/app/api/dashboard/inbox/route.ts`

**Step 1: Write the failing test**

There's no test infrastructure for Next.js BFF routes in this project (they're thin proxies). Instead we'll verify the fix manually. But first, read the current file to understand the shape.

The backend at `apps/api/src/routes/handoff.ts:45-60` returns:

```typescript
{
  handoffs: [
    {
      ...handoffFields,
      slaDeadlineAt: string,
      createdAt: string,
      conversation: { channel, status, lastActivityAt } | null,
    },
  ];
}
```

The hook at `apps/dashboard/src/hooks/use-inbox.ts:49` expects:

```typescript
{ items: InboxItem[]; total: number }
// where InboxItem = { handoff: {...}, conversation: {...} | null, waitingSince: string, slaRemaining: number }
```

**Step 2: Transform the response in the BFF route**

Replace `apps/dashboard/src/app/api/dashboard/inbox/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

interface BackendHandoff {
  id: string;
  sessionId: string;
  organizationId: string;
  reason: string;
  status: string;
  leadSnapshot: Record<string, unknown>;
  qualificationSnapshot: Record<string, unknown>;
  conversationSummary: Record<string, unknown>;
  slaDeadlineAt: string;
  createdAt: string;
  acknowledgedAt: string | null;
  conversation: {
    channel: string;
    status: string;
    lastActivityAt: string;
  } | null;
}

export async function GET() {
  try {
    await requireSession();
    const client = await getApiClient();
    const data = await client.listPendingHandoffs();
    const handoffs: BackendHandoff[] = data.handoffs ?? [];
    const now = Date.now();

    const items = handoffs.map((h) => ({
      handoff: {
        id: h.id,
        sessionId: h.sessionId,
        organizationId: h.organizationId,
        reason: h.reason,
        status: h.status,
        leadSnapshot: h.leadSnapshot,
        qualificationSnapshot: h.qualificationSnapshot,
        conversationSummary: h.conversationSummary,
        slaDeadlineAt: h.slaDeadlineAt,
        createdAt: h.createdAt,
        acknowledgedAt: h.acknowledgedAt,
      },
      conversation: h.conversation,
      waitingSince: h.createdAt,
      slaRemaining: new Date(h.slaDeadlineAt).getTime() - now,
    }));

    return NextResponse.json({ items, total: items.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

**Step 3: Verify the inbox page renders correctly**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "fix(dashboard): transform inbox BFF response to match useInbox expected shape"
```

---

## Task 2: Fix multi-deal attribution bug (Medium)

`campaign-attribution.ts:56-59` uses `Map<string, DealAttribution>` — `Map.set` overwrites, so only the last deal per contact is kept. A contact with both a `booked` deal and a `won` deal would miscount.

**Files:**

- Modify: `apps/api/src/routes/campaign-attribution.ts:56-93`
- Modify: `apps/api/src/routes/__tests__/campaign-attribution.test.ts`

**Step 1: Add a failing test for multi-deal contacts**

Add this test case to `apps/api/src/routes/__tests__/campaign-attribution.test.ts`:

```typescript
it("counts bookings and paid correctly when a contact has multiple deals", () => {
  const contacts = [{ id: "c1", sourceCampaignId: "camp1", sourceAdId: "ad1" }];
  const deals = [
    { id: "d1", contactId: "c1", stage: "booked", amount: null },
    { id: "d2", contactId: "c1", stage: "won", amount: 300 },
  ];
  const revenueEvents = [{ contactId: "c1", amount: 300 }];
  const campaignSpend = new Map([["camp1", { name: "Camp 1", spend: 100 }]]);

  const result = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);
  const camp = result.find((r) => r.campaignId === "camp1")!;

  // Contact has a booked deal AND a won deal — should count as 1 booking AND 1 paid
  expect(camp.leads).toBe(1);
  expect(camp.bookings).toBe(1);
  expect(camp.paid).toBe(1);
  expect(camp.revenue).toBe(300);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/campaign-attribution.test.ts`
Expected: FAIL — with the current code, only the last deal (`won`) is kept, so `bookings` is 1 and `paid` is 1. Actually this specific case might pass because `won` is in `BOOKING_STAGES`. Let's use a case that actually fails:

The real bug: if the last deal is `lead` stage, it overwrites an earlier `booked` deal. Update the test:

```typescript
it("counts bookings correctly when contact has booked deal followed by a lead-stage deal", () => {
  const contacts = [{ id: "c1", sourceCampaignId: "camp1", sourceAdId: "ad1" }];
  // Two deals: first is booked, second is lead (e.g., a separate service inquiry)
  const deals = [
    { id: "d1", contactId: "c1", stage: "booked", amount: 200 },
    { id: "d2", contactId: "c1", stage: "lead", amount: null },
  ];
  const revenueEvents: { contactId: string; amount: number }[] = [];
  const campaignSpend = new Map([["camp1", { name: "Camp 1", spend: 100 }]]);

  const result = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);
  const camp = result.find((r) => r.campaignId === "camp1")!;

  // The booked deal should be counted even though a later lead-stage deal exists
  expect(camp.bookings).toBe(1);
  expect(camp.paid).toBe(0);
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/campaign-attribution.test.ts`
Expected: FAIL — `bookings` will be 0 because the `lead` deal overwrites the `booked` deal.

**Step 4: Fix the aggregation to use an array map**

In `apps/api/src/routes/campaign-attribution.ts`, replace lines 56-59:

```typescript
// OLD:
const dealsByContact = new Map<string, DealAttribution>();
for (const deal of deals) {
  if (deal.contactId) dealsByContact.set(deal.contactId, deal);
}
```

With:

```typescript
// NEW:
const dealsByContact = new Map<string, DealAttribution[]>();
for (const deal of deals) {
  if (deal.contactId) {
    const existing = dealsByContact.get(deal.contactId) ?? [];
    existing.push(deal);
    dealsByContact.set(deal.contactId, existing);
  }
}
```

Then replace lines 81-87:

```typescript
// OLD:
const deal = dealsByContact.get(contact.id);
if (deal && BOOKING_STAGES.has(deal.stage)) {
  bucket.bookings += 1;
}
if (deal && PAID_STAGES.has(deal.stage)) {
  bucket.paid += 1;
}
```

With:

```typescript
// NEW:
const contactDeals = dealsByContact.get(contact.id) ?? [];
if (contactDeals.some((d) => BOOKING_STAGES.has(d.stage))) {
  bucket.bookings += 1;
}
if (contactDeals.some((d) => PAID_STAGES.has(d.stage))) {
  bucket.paid += 1;
}
```

**Step 5: Run all attribution tests**

Run: `pnpm --filter @switchboard/api exec vitest run src/routes/__tests__/campaign-attribution.test.ts`
Expected: All 3 tests PASS.

**Step 6: Commit**

```bash
git commit -m "fix(api): handle multi-deal contacts in campaign attribution aggregation"
```

---

## Task 3: Add server-side validation to mark-paid BFF route (Security)

The `mark-paid/route.ts` casts `request.json()` without validation. A crafted request could send negative amounts or omit `contactId`.

**Files:**

- Modify: `apps/dashboard/src/app/api/dashboard/crm/deals/[id]/mark-paid/route.ts`

**Step 1: Add validation**

Replace the body parsing block (lines 9-13) with:

```typescript
const raw: unknown = await request.json();
if (
  typeof raw !== "object" ||
  raw === null ||
  typeof (raw as Record<string, unknown>).amount !== "number" ||
  typeof (raw as Record<string, unknown>).contactId !== "string"
) {
  return NextResponse.json(
    { error: "amount (positive number) and contactId (string) are required" },
    { status: 400 },
  );
}
const body = raw as { amount: number; contactId: string; reference?: string };
if (body.amount <= 0) {
  return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
}
if (!body.contactId) {
  return NextResponse.json({ error: "contactId is required" }, { status: 400 });
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "fix(dashboard): add server-side validation to mark-paid BFF route"
```

---

## Task 4: Validate days param in agent activity BFF route (Low)

`parseInt("abc")` returns `NaN`, producing `Invalid Date`.

**Files:**

- Modify: `apps/dashboard/src/app/api/dashboard/agents/activity/route.ts:10-11`

**Step 1: Clamp the days parameter**

Replace lines 10-11:

```typescript
// OLD:
const days = url.searchParams.get("days") ?? "1";
const after = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000).toISOString();
```

With:

```typescript
// NEW:
const daysRaw = parseInt(url.searchParams.get("days") ?? "1");
const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 1;
const after = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "fix(dashboard): validate days param in agent activity BFF route"
```

---

## Execution Order

Tasks are independent — can be executed in any order or in parallel. Recommended priority:

1. **Task 1** — Critical: inbox page is completely broken
2. **Task 2** — Medium: attribution data silently wrong
3. **Task 3** — Security: input validation gap
4. **Task 4** — Low: edge case hardening

Total: ~4 commits, all independently shippable.
