# Riley Phase B — Revenue-Truth Measurement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a booked customer measurable end-to-end — stamp the `booked` outbox event with real identity + value, carry that truth intact through the publisher, dispatch it to Meta CAPI (env-gated) with correct units, and replace the reconciliation stub with the real `ReconciliationRunner`.

**Architecture:** Measurement plumbing only — no campaign mutation, no `PlatformIngress` execution path. A pure mapper (`buildBookedConversionPayload`) encodes the attribution field quirks; `calendar-book` stamps the payload; the `OutboxPublisher` carries the new fields onto the `ConversionEvent`; the `MetaCAPIDispatcher` normalizes the cents value to major units only at the Meta boundary; and the inngest reconciliation cron wires the real runner over existing Prisma stores.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Zod schemas, Prisma, Vitest, pnpm + Turbo. Money is stored in **minor units (cents)** system-wide.

**Spec:** `docs/superpowers/specs/2026-06-02-riley-phase-b-measurement-foundation-design.md`

---

## File Structure

| File                                                                      | Responsibility                                       | Action                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `packages/schemas/src/conversion.ts`                                      | `ConversionEvent` contract                           | Modify (one units doc-comment)                   |
| `packages/core/src/skill-runtime/tools/booked-conversion-payload.ts`      | Pure mapper: `Contact` → stamped attribution surface | **Create**                                       |
| `packages/core/src/skill-runtime/tools/booked-conversion-payload.test.ts` | Mapper tests                                         | **Create**                                       |
| `packages/core/src/skill-runtime/tools/calendar-book.ts`                  | Booking tool; stamps the `booked` outbox event       | Modify (widen deps + stamp)                      |
| `packages/core/src/skill-runtime/tools/calendar-book.test.ts`             | Booking tool tests                                   | Modify (add stamped/organic cases)               |
| `apps/api/src/bootstrap/skill-mode.ts`                                    | Wires calendar-book deps                             | Modify (`defaultCurrency` + opportunity adapter) |
| `packages/core/src/events/outbox-publisher.ts`                            | Outbox → `ConversionEvent` reconstruction            | Modify (carry new fields)                        |
| `packages/core/src/events/outbox-publisher.test.ts`                       | Publisher tests                                      | Modify (null/undefined + back-compat)            |
| `packages/ad-optimizer/src/conversion-value.ts`                           | `normalizeConversionValue` (cents → major)           | **Create**                                       |
| `packages/ad-optimizer/src/conversion-value.test.ts`                      | Helper tests                                         | **Create**                                       |
| `packages/ad-optimizer/src/meta-capi-dispatcher.ts`                       | Meta CAPI dispatch                                   | Modify (normalize `custom_data.value`)           |
| `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`                  | Dispatcher tests                                     | Modify (normalized value + hashing)              |
| `packages/core/src/attribution/reconciliation-runner.ts`                  | Reconciliation logic                                 | Modify (`export` its types)                      |
| `packages/core/src/index.ts`                                              | Core barrel                                          | Modify (export runner + types)                   |
| `apps/api/src/services/cron/reconciliation.ts`                            | Reconciliation cron deps + `buildRunReconciliation`  | Modify (add helper)                              |
| `apps/api/src/__tests__/reconciliation-wiring.test.ts`                    | Wiring helper test (real counts)                     | **Create**                                       |
| `apps/api/src/bootstrap/inngest.ts`                                       | Cron bootstrap                                       | Modify (instantiate stores, replace stub)        |

**Out of scope (must NOT be touched):** `ad-optimizer/src/{campaign-decision,audit-runner,recommendation-engine,learning-phase-guard,evidence-floor,denominator-step-change,meta-campaign-insights-provider}.ts`, `ad-optimizer/src/evals/**`, `core/src/agent-home/metrics-riley.ts`, the `byCampaign` projection, `capiAttributionStale` wiring, creative-pipeline / PlatformIngress P2.

**Working directory:** all commands run from the worktree root `/Users/jasonli/switchboard/.claude/worktrees/riley-phase-b-measurement` (branch `worktree-riley-phase-b-measurement`).

---

## Task 1: Document the value-units convention (schema)

**Files:**

- Modify: `packages/schemas/src/conversion.ts` (the `value?: number;` field, ~line 43)

- [ ] **Step 1: Add the units doc-comment**

In `packages/schemas/src/conversion.ts`, replace the `value`/`currency` lines inside `interface ConversionEvent`:

```ts
  /**
   * Economic value in MINOR currency units (cents), consistent with
   * Opportunity.estimatedValue, LifecycleRevenueEvent.amount, and the
   * funnel revenue sums (funnelByOrg `_sum: { value }`). Converted to MAJOR
   * units ONLY at the Meta CAPI boundary via `normalizeConversionValue`.
   */
  value?: number;
  /** ISO-4217 currency code (e.g. "SGD"). Pairs with `value` for CAPI custom_data. */
  currency?: string;
```

- [ ] **Step 2: Verify the package still typechecks**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/conversion.ts
git commit -m "chore(schemas): document ConversionEvent.value is minor units (cents)"
```

---

## Task 2: `buildBookedConversionPayload` mapper (pure function)

**Files:**

- Create: `packages/core/src/skill-runtime/tools/booked-conversion-payload.ts`
- Test: `packages/core/src/skill-runtime/tools/booked-conversion-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/skill-runtime/tools/booked-conversion-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBookedConversionPayload } from "./booked-conversion-payload.js";

describe("buildBookedConversionPayload", () => {
  it("maps a Meta-attributed contact (leadgen_id → lead_id)", () => {
    const result = buildBookedConversionPayload({
      email: "jane@example.com",
      phone: "+6591234567",
      attribution: {
        fbclid: "fb_abc",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp_1",
        sourceAdId: "ad_1",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        leadgen_id: "lead_9",
      },
    });
    expect(result).toEqual({
      sourceCampaignId: "camp_1",
      sourceAdId: "ad_1",
      customer: { email: "jane@example.com", phone: "+6591234567" },
      attribution: { fbclid: "fb_abc", lead_id: "lead_9" },
    });
  });

  it("organic contact (no attribution) still carries email/phone; attribution fields go null", () => {
    const result = buildBookedConversionPayload({
      email: "walkin@example.com",
      phone: "+6580000000",
      attribution: null,
    });
    expect(result).toEqual({
      sourceCampaignId: null,
      sourceAdId: null,
      customer: { email: "walkin@example.com", phone: "+6580000000" },
      attribution: { fbclid: null, lead_id: null },
    });
  });

  it("null/empty contact yields all-null surface with explicit null match keys", () => {
    expect(buildBookedConversionPayload(null)).toEqual({
      sourceCampaignId: null,
      sourceAdId: null,
      customer: { email: null, phone: null },
      attribution: { fbclid: null, lead_id: null },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run booked-conversion-payload`
Expected: FAIL — `Cannot find module './booked-conversion-payload.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/skill-runtime/tools/booked-conversion-payload.ts`:

```ts
import type { AttributionChain } from "@switchboard/schemas";

/**
 * The attribution/identity surface stamped onto a `booked` outbox event.
 *
 * INVARIANT: a booked event preserves customer match keys and source
 * attribution exactly as known at booking time; known-but-missing fields are
 * explicit `null`, never inferred.
 */
export interface BookedConversionPayload {
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  customer: { email: string | null; phone: string | null };
  attribution: { fbclid: string | null; lead_id: string | null };
}

/**
 * Maps a contact's persisted columns + AttributionChain onto the booked-event
 * surface. `customer` derives from contact columns and is INDEPENDENT of
 * attribution — an organic contact with an email still carries it. Encodes the
 * one schema/history quirk: ConversionEvent `attribution.lead_id` comes from
 * AttributionChain `leadgen_id`. `sourceAdSetId` is intentionally omitted (not
 * in the persisted schema; no in-scope consumer).
 */
export function buildBookedConversionPayload(
  contact: {
    email?: string | null;
    phone?: string | null;
    attribution?: AttributionChain | null;
  } | null,
): BookedConversionPayload {
  const attribution = contact?.attribution ?? null;
  return {
    sourceCampaignId: attribution?.sourceCampaignId ?? null,
    sourceAdId: attribution?.sourceAdId ?? null,
    customer: {
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    },
    attribution: {
      fbclid: attribution?.fbclid ?? null,
      lead_id: attribution?.leadgen_id ?? null,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run booked-conversion-payload`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/booked-conversion-payload.ts packages/core/src/skill-runtime/tools/booked-conversion-payload.test.ts
git commit -m "feat(core): booked-conversion payload mapper"
```

---

## Task 3: Stamp the `booked` outbox event in calendar-book

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts` (deps interface ~`:65-78`; opportunity resolution ~`:199-210`; outbox payload ~`:293-314`)
- Modify: `apps/api/src/bootstrap/skill-mode.ts` (deps object ~`:279-311`)
- Test: `packages/core/src/skill-runtime/tools/calendar-book.test.ts`

- [ ] **Step 1: Write the failing test (attributed + organic)**

In `packages/core/src/skill-runtime/tools/calendar-book.test.ts`, add a helper to capture the outbox payload and two tests. Add near the other `make*` factories:

```ts
function makeCapturingRunTransaction() {
  const captured: { payload?: Record<string, unknown> } = {};
  const fn = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      booking: { update: vi.fn().mockResolvedValue({}) },
      outboxEvent: {
        create: vi.fn(async (args: { data: { payload: Record<string, unknown> } }) => {
          captured.payload = args.data.payload;
          return { id: "ob_1" };
        }),
      },
    }),
  );
  return { fn, captured };
}
```

Then add these tests inside the `describe` block (they build their own factory so the `deps` include `defaultCurrency` and a capturing transaction):

```ts
it("booking.create stamps attribution, value, currency on the booked event", async () => {
  const { fn: runTransaction, captured } = makeCapturingRunTransaction();
  const contactStore = {
    findById: vi.fn().mockResolvedValue({
      id: "ct_1",
      name: "Jane Tan",
      email: "jane@example.com",
      phone: "+6591234567",
      attribution: {
        fbclid: "fb_abc",
        sourceCampaignId: "camp_1",
        sourceAdId: "ad_1",
        leadgen_id: "lead_9",
      },
    }),
  };
  const opportunityStore = {
    findActiveByContact: vi.fn().mockResolvedValue({ id: "opp_1", estimatedValue: 320000 }),
    create: vi.fn(),
  };
  bookingStore.create.mockResolvedValue({ id: "bk_1" });
  calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_1" });

  const tool = createCalendarBookToolFactory({
    calendarProviderFactory: async () => calendarProvider as never,
    isCalendarProviderConfigured: () => true,
    bookingStore: bookingStore as never,
    opportunityStore: opportunityStore as never,
    runTransaction: runTransaction as never,
    failureHandler: failureHandler as never,
    contactStore: contactStore as never,
    defaultCurrency: "SGD",
  })(TRUSTED_CTX);

  await tool.operations["booking.create"]!.execute({
    service: "botox",
    slotStart: "2026-06-01T10:00:00Z",
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });

  expect(captured.payload).toMatchObject({
    type: "booked",
    value: 320000, // cents, verbatim from estimatedValue
    currency: "SGD",
    sourceCampaignId: "camp_1",
    sourceAdId: "ad_1",
    customer: { email: "jane@example.com", phone: "+6591234567" },
    attribution: { fbclid: "fb_abc", lead_id: "lead_9" },
  });
  // No PII leaks into metadata
  expect(captured.payload?.metadata).not.toHaveProperty("email");
  expect(captured.payload?.metadata).not.toHaveProperty("phone");
});

it("booking.create degrades to explicit nulls + value 0 for an organic contact", async () => {
  const { fn: runTransaction, captured } = makeCapturingRunTransaction();
  const contactStore = {
    findById: vi.fn().mockResolvedValue({
      id: "ct_2",
      name: "Walk In",
      email: "walkin@example.com",
      phone: null,
      attribution: null,
    }),
  };
  const opportunityStore = {
    findActiveByContact: vi.fn().mockResolvedValue({ id: "opp_2", estimatedValue: null }),
    create: vi.fn(),
  };
  bookingStore.create.mockResolvedValue({ id: "bk_2" });
  calendarProvider.createBooking.mockResolvedValue({ calendarEventId: "gcal_2" });

  const tool = createCalendarBookToolFactory({
    calendarProviderFactory: async () => calendarProvider as never,
    isCalendarProviderConfigured: () => true,
    bookingStore: bookingStore as never,
    opportunityStore: opportunityStore as never,
    runTransaction: runTransaction as never,
    failureHandler: failureHandler as never,
    contactStore: contactStore as never,
    defaultCurrency: "SGD",
  })(TRUSTED_CTX);

  await tool.operations["booking.create"]!.execute({
    service: "botox",
    slotStart: "2026-06-01T10:00:00Z",
    slotEnd: "2026-06-01T10:30:00Z",
    calendarId: "primary",
  });

  expect(captured.payload).toMatchObject({
    value: 0,
    currency: "SGD",
    sourceCampaignId: null,
    sourceAdId: null,
    customer: { email: "walkin@example.com", phone: null },
    attribution: { fbclid: null, lead_id: null },
  });
});
```

> Note: `TRUSTED_CTX`, `bookingStore`, `calendarProvider`, `failureHandler` already exist in this test file. Confirm `TRUSTED_CTX` is the existing trusted context constant (it is referenced at line ~340).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run calendar-book`
Expected: FAIL — `defaultCurrency` not in deps type (TS error) and/or payload missing the new fields.

- [ ] **Step 3: Implement — widen the deps interface**

In `packages/core/src/skill-runtime/tools/calendar-book.ts`, add the import near the top (with the other schema type imports):

```ts
import type { CalendarProvider, AttributionChain } from "@switchboard/schemas";
```

Replace the `OpportunityStoreSubset.findActiveByContact` signature:

```ts
interface OpportunityStoreSubset {
  findActiveByContact(
    orgId: string,
    contactId: string,
  ): Promise<{ id: string; estimatedValue?: number | null } | null>;
  create(input: {
    organizationId: string;
    contactId: string;
    service: string;
  }): Promise<{ id: string }>;
}
```

Replace the `contactStore` member of `CalendarBookToolDeps` and add `defaultCurrency`:

```ts
interface CalendarBookToolDeps {
  calendarProviderFactory: CalendarProviderFactory;
  isCalendarProviderConfigured: (provider: CalendarProvider) => boolean;
  bookingStore: BookingStoreSubset;
  opportunityStore: OpportunityStoreSubset;
  runTransaction: TransactionFn;
  failureHandler: BookingFailureHandler;
  contactStore: {
    findById(
      orgId: string,
      contactId: string,
    ): Promise<{
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      attribution?: AttributionChain | null;
    } | null>;
  };
  /** ISO-4217 default currency for booked-conversion value (cents). Temporary
   *  injected dep until per-org currency is wired. */
  defaultCurrency: string;
}
```

Add the mapper import:

```ts
import { buildBookedConversionPayload } from "./booked-conversion-payload.js";
```

- [ ] **Step 4: Implement — capture estimatedValue and stamp the payload**

In `booking.create`'s execute, change the opportunity resolution block to capture `estimatedValue`:

```ts
// Resolve or create opportunity
let opportunityId: string | null = null;
let estimatedValue: number | null = null;
const existing = await deps.opportunityStore.findActiveByContact(orgId, contactId);
if (existing) {
  opportunityId = existing.id;
  estimatedValue = existing.estimatedValue ?? null;
} else {
  const created = await deps.opportunityStore.create({
    organizationId: orgId,
    contactId,
    service: input.service,
  });
  opportunityId = created.id;
}
```

Then replace the `outboxEvent.create` payload (inside the transaction, ~`:293-314`):

```ts
const conversion = buildBookedConversionPayload(contactRecord);
await tx.outboxEvent.create({
  data: {
    eventId,
    type: "booked",
    status: "pending",
    payload: {
      type: "booked",
      contactId,
      organizationId: orgId,
      value: estimatedValue ?? 0,
      currency: deps.defaultCurrency,
      sourceCampaignId: conversion.sourceCampaignId,
      sourceAdId: conversion.sourceAdId,
      customer: conversion.customer,
      attribution: conversion.attribution,
      occurredAt: new Date().toISOString(),
      source: "calendar-book",
      metadata: {
        bookingId: booking.id,
        opportunityId,
        service: input.service,
        slotStart: input.slotStart,
        slotEnd: input.slotEnd,
      },
    },
  },
});
```

> `const conversion = ...` must be declared inside the `runTransaction` callback (or just above it) so `contactRecord` (fetched at ~`:190`) is in scope. Place it immediately before the `tx.outboxEvent.create` call.

- [ ] **Step 5: Implement — wire deps in skill-mode.ts**

In `apps/api/src/bootstrap/skill-mode.ts`, in the `createCalendarBookToolFactory({...})` call (~`:279-311`):

1. Widen the opportunity adapter's `findActiveByContact` to pass `estimatedValue`:

```ts
    findActiveByContact: async (orgId: string, contactId: string) => {
      const active = await opportunityStore.findActiveByContact(orgId, contactId);
      return active.length > 0
        ? { id: active[0]!.id, estimatedValue: active[0]!.estimatedValue ?? null }
        : null;
    },
```

2. Add `defaultCurrency` to the deps object (after `failureHandler,`):

```ts
  failureHandler,
  defaultCurrency: "SGD",
```

> The `contactStore` passed here is the real store whose `findById` returns the full `Contact` (incl. `phone` + `attribution`), so no change is needed there — the widened interface is satisfied. If `contactStore` is a narrowed local adapter, widen its `findById` to return `phone` + `attribution` (typecheck in Step 6 will flag it).

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run calendar-book && pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck`
Expected: PASS (existing calendar-book tests still green; 2 new tests pass; api typechecks with the new dep).

> If any pre-existing calendar-book test asserted the exact outbox payload and now fails on the added keys, update it to `toMatchObject`/`objectContaining` rather than exact-equal. The success-path mocks that return `{ id: "opp_1" }` for `findActiveByContact` remain valid (`estimatedValue` is optional → `value` becomes 0).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/calendar-book.ts packages/core/src/skill-runtime/tools/calendar-book.test.ts apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(core): stamp booked event with attribution, value, currency"
```

---

## Task 4: Carry new fields through the OutboxPublisher

**Files:**

- Modify: `packages/core/src/events/outbox-publisher.ts` (event reconstruction `:32-45`)
- Test: `packages/core/src/events/outbox-publisher.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/events/outbox-publisher.test.ts`, add two tests inside the `describe` block:

```ts
it("carries customer/attribution/currency through, preserving explicit nulls", async () => {
  outboxStore.fetchPending.mockResolvedValue([
    {
      id: "ob_4",
      eventId: "evt_4",
      type: "booked",
      payload: {
        type: "booked",
        contactId: "ct_1",
        organizationId: "org_1",
        value: 320000,
        currency: "SGD",
        sourceCampaignId: "camp_1",
        sourceAdId: "ad_1",
        customer: { email: "jane@example.com", phone: null },
        attribution: { fbclid: null, lead_id: "lead_9" },
        occurredAt: "2026-04-20T10:00:00Z",
        source: "calendar-book",
        metadata: { bookingId: "bk_1" },
      },
      status: "pending",
      attempts: 0,
    },
  ]);
  bus.emit.mockResolvedValue(undefined);

  await publisher.publishBatch();

  const emitted = (bus.emit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  expect(emitted.currency).toBe("SGD");
  expect(emitted.customer).toEqual({ email: "jane@example.com", phone: null });
  expect(emitted.attribution).toEqual({ fbclid: null, lead_id: "lead_9" });
});

it("reconstructs legacy payloads with no new keys (fields undefined, not dropped-erroneously)", async () => {
  outboxStore.fetchPending.mockResolvedValue([
    {
      id: "ob_5",
      eventId: "evt_5",
      type: "booked",
      payload: {
        type: "booked",
        contactId: "ct_1",
        organizationId: "org_1",
        value: 0,
        occurredAt: "2026-04-20T10:00:00Z",
        source: "calendar-book",
        metadata: {},
      },
      status: "pending",
      attempts: 0,
    },
  ]);
  bus.emit.mockResolvedValue(undefined);

  await publisher.publishBatch();

  const emitted = (bus.emit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  expect(emitted.customer).toBeUndefined();
  expect(emitted.attribution).toBeUndefined();
  expect(emitted.currency).toBeUndefined();
  expect(outboxStore.markPublished).toHaveBeenCalledWith("ob_5");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run outbox-publisher`
Expected: FAIL — `emitted.customer`/`attribution`/`currency` are `undefined` in BOTH tests (the first expects them populated).

- [ ] **Step 3: Implement the carry-through**

In `packages/core/src/events/outbox-publisher.ts`, extend the `event` object literal in `publishBatch` (after the existing `metadata` line, before the closing `};`):

```ts
const event: ConversionEvent = {
  eventId: row.eventId,
  type: row.payload.type as ConversionEvent["type"],
  contactId: row.payload.contactId as string,
  organizationId: row.payload.organizationId as string,
  value: (row.payload.value as number) ?? 0,
  currency: row.payload.currency as string | undefined,
  sourceAdId: row.payload.sourceAdId as string | undefined,
  sourceCampaignId: row.payload.sourceCampaignId as string | undefined,
  occurredAt: new Date(row.payload.occurredAt as string),
  source: (row.payload.source as string) ?? "outbox",
  causationId: row.payload.causationId as string | undefined,
  workTraceId: row.payload.workTraceId as string | undefined,
  accountId: row.payload.accountId as string | undefined,
  actionSource: row.payload.actionSource as ConversionEvent["actionSource"],
  customer: row.payload.customer as ConversionEvent["customer"],
  attribution: row.payload.attribution as ConversionEvent["attribution"],
  metadata: (row.payload.metadata as Record<string, unknown>) ?? {},
};
```

> This uses the same `as` cast pattern already in the file. An absent payload key yields `undefined` (legacy); a present-but-null value (e.g. `customer.phone: null`) is preserved verbatim — exactly the null/undefined boundary the spec requires.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run outbox-publisher`
Expected: PASS (existing 4 tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/outbox-publisher.ts packages/core/src/events/outbox-publisher.test.ts
git commit -m "feat(core): carry customer/attribution/currency through outbox publisher"
```

---

## Task 5: `normalizeConversionValue` helper (ad-optimizer)

**Files:**

- Create: `packages/ad-optimizer/src/conversion-value.ts`
- Test: `packages/ad-optimizer/src/conversion-value.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ad-optimizer/src/conversion-value.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeConversionValue } from "./conversion-value.js";

describe("normalizeConversionValue", () => {
  it("converts cents to major currency units", () => {
    expect(normalizeConversionValue(320000)).toBe(3200);
    expect(normalizeConversionValue(28000)).toBe(280);
  });

  it("handles zero and fractional cents", () => {
    expect(normalizeConversionValue(0)).toBe(0);
    expect(normalizeConversionValue(12345)).toBe(123.45);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- --run conversion-value`
Expected: FAIL — `Cannot find module './conversion-value.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ad-optimizer/src/conversion-value.ts`:

```ts
/**
 * Convert an internal conversion value (MINOR units / cents) to the MAJOR
 * currency units the Meta Conversions API expects.
 *
 * `ConversionEvent.value` is stored in cents system-wide (consistent with
 * Opportunity.estimatedValue and the funnel revenue sums). This conversion is
 * applied ONLY at the Meta dispatch boundary — never to the stored/summed value.
 */
export function normalizeConversionValue(minorUnits: number): number {
  return minorUnits / 100;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test -- --run conversion-value`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/conversion-value.ts packages/ad-optimizer/src/conversion-value.test.ts
git commit -m "feat(ad-optimizer): normalizeConversionValue cents-to-major helper"
```

---

## Task 6: Normalize CAPI `custom_data.value` to major units

**Files:**

- Modify: `packages/ad-optimizer/src/meta-capi-dispatcher.ts` (`custom_data` build ~`:99-107`)
- Test: `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`

- [ ] **Step 1: Update the existing verbatim-value test + add normalization/hashing tests**

In `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`:

1. Replace the existing test that asserts verbatim value (currently `makeEvent({ value: 500, currency: "SGD" })` → `custom_data { value: 500, ... }`, ~lines 179-185) with cents-semantic input and normalized expectation:

```ts
it("normalizes custom_data.value from cents to major units", async () => {
  const event = makeEvent({ value: 50000, currency: "SGD" }); // 50000 cents
  await dispatcher.dispatch(event);

  const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
  expect(body.data[0].custom_data).toEqual({ value: 500, currency: "SGD" });
});
```

2. Add a hashing test (raw PII never leaves):

```ts
it("hashes email and phone in user_data (never sends them raw)", async () => {
  const event = makeEvent({ customer: { email: "Jane@Example.com", phone: "+65 9123 4567" } });
  await dispatcher.dispatch(event);

  const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}");
  const userData = body.data[0].user_data;
  expect(userData.em).toMatch(/^[a-f0-9]{64}$/);
  expect(userData.ph).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(body)).not.toContain("Jane@Example.com");
  expect(JSON.stringify(body)).not.toContain("9123");
});
```

> The `canDispatch` matrix (email-only, phone-only, lead_id-only, none) is already covered by existing tests at lines ~44-78 — no new canDispatch tests needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test -- --run meta-capi-dispatcher`
Expected: FAIL — the normalization test fails (`custom_data.value` is `50000`, not `500`).

- [ ] **Step 3: Implement the normalization**

In `packages/ad-optimizer/src/meta-capi-dispatcher.ts`, add the import at the top (with the other relative imports):

```ts
import { normalizeConversionValue } from "./conversion-value.js";
```

Change the `custom_data` build (~`:99-107`):

```ts
let customData: { value: number; currency: string } | undefined;
if (event.value != null && event.currency) {
  customData = { value: normalizeConversionValue(event.value), currency: event.currency };
} else if (event.value != null && !event.currency) {
  console.warn(
    "[MetaCAPIDispatcher] missing_currency_for_value, omitting custom_data",
    event.eventId,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- --run meta-capi-dispatcher`
Expected: PASS (updated + new tests; the "omits custom_data when currency missing" test still passes).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/meta-capi-dispatcher.ts packages/ad-optimizer/src/meta-capi-dispatcher.test.ts
git commit -m "fix(ad-optimizer): normalize CAPI custom_data.value to major units"
```

---

## Task 7: Export the runner + add `buildRunReconciliation` (testable wiring seam)

**Files:**

- Modify: `packages/core/src/attribution/reconciliation-runner.ts` (add `export` to its types)
- Modify: `packages/core/src/index.ts` (barrel export)
- Modify: `apps/api/src/services/cron/reconciliation.ts` (add `buildRunReconciliation`)
- Test: `apps/api/src/__tests__/reconciliation-wiring.test.ts`

- [ ] **Step 1: Export the runner's types from core**

In `packages/core/src/attribution/reconciliation-runner.ts`, add `export` to the three interfaces (so consumers can type the deps):

```ts
export interface DateRange {
  from: Date;
  to: Date;
}
```

```ts
export interface ReconciliationReport {
  organizationId: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  overallStatus: string;
  checks: Check[];
}
```

```ts
export interface ReconciliationDeps {
```

(Leave `interface Check` as-is; it is referenced via `ReconciliationReport`.) Add to `packages/core/src/index.ts` (alongside other exports):

```ts
export {
  ReconciliationRunner,
  type ReconciliationDeps,
  type ReconciliationReport as RunnerReconciliationReport,
} from "./attribution/reconciliation-runner.js";
```

- [ ] **Step 2: Write the failing wiring test**

Create `apps/api/src/__tests__/reconciliation-wiring.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildRunReconciliation } from "../services/cron/reconciliation.js";

describe("buildRunReconciliation", () => {
  it("produces a real store-backed report (not the stub)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const run = buildRunReconciliation({
      bookingStore: { countConfirmed: vi.fn().mockResolvedValue(10) },
      conversionRecordStore: { countByType: vi.fn().mockResolvedValue(8) },
      opportunityStore: { countByStage: vi.fn().mockResolvedValue(9) },
      reconciliationStore: { save },
    });

    const report = await run("org_1", {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    });

    // booking-linkage: expected=10 (confirmed bookings) vs actual=8 (booked records)
    const linkage = report.checks.find((c) => c.name === "booking-linkage");
    expect(linkage).toMatchObject({ expected: 10, actual: 8 });
    expect(linkage?.status).toBe("fail"); // 20% drift > 5%
    // crm-sync: expected=8 (booked records) vs actual=9 (booked opps)
    const crmSync = report.checks.find((c) => c.name === "crm-sync");
    expect(crmSync).toMatchObject({ expected: 8, actual: 9 });
    expect(report.overallStatus).toBe("failing");
    expect(report.checks).not.toHaveLength(0); // proves the stub is gone
    expect(save).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- --run reconciliation-wiring`
Expected: FAIL — `buildRunReconciliation` is not exported from `reconciliation.js`.

- [ ] **Step 4: Implement `buildRunReconciliation`**

In `apps/api/src/services/cron/reconciliation.ts`, add the import and the exported factory (place near the top imports and after the `ReconciliationCronDeps` interface respectively):

```ts
import { ReconciliationRunner, type ReconciliationDeps } from "@switchboard/core";
```

```ts
/**
 * Builds the `runReconciliation` closure backed by the real ReconciliationRunner.
 * Kept as a separate, store-agnostic seam so the wiring is unit-testable without
 * booting Prisma or the full inngest bootstrap.
 */
export function buildRunReconciliation(
  deps: ReconciliationDeps,
): ReconciliationCronDeps["runReconciliation"] {
  const runner = new ReconciliationRunner(deps);
  return (orgId, dateRange) => runner.run(orgId, dateRange);
}
```

> The runner's `ReconciliationReport` (with `dateRangeFrom`/`dateRangeTo` and richer `Check`s) is structurally assignable to the cron's narrower `ReconciliationReport` return type, so no shape adapter is needed.

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/api test -- --run reconciliation-wiring && pnpm --filter @switchboard/api typecheck`
Expected: PASS. (Rebuild core first so the new barrel export resolves for the api package.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/attribution/reconciliation-runner.ts packages/core/src/index.ts apps/api/src/services/cron/reconciliation.ts apps/api/src/__tests__/reconciliation-wiring.test.ts
git commit -m "feat(api): buildRunReconciliation wiring helper + core barrel export"
```

---

## Task 8: Wire the real runner into the inngest reconciliation cron

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` (imports + `reconciliationDeps` block ~`:398-419`)

- [ ] **Step 1: Add store imports**

In `apps/api/src/bootstrap/inngest.ts`, ensure these are imported from `@switchboard/db` (add any missing to the existing db import group):

```ts
import {
  PrismaBookingStore,
  PrismaConversionRecordStore,
  PrismaOpportunityStore,
  PrismaReconciliationStore,
} from "@switchboard/db";
```

And import the helper from the cron module (extend the existing import from `../services/cron/reconciliation.js`):

```ts
import { buildRunReconciliation } from "../services/cron/reconciliation.js";
```

> `buildRunReconciliation` is a value (function) — import it as a value, separate from the existing `import type { ReconciliationCronDeps, ... }`.

- [ ] **Step 2: Replace the stub with the real runner**

In the `reconciliationDeps` object (~`:399-419`), replace the `runReconciliation` stub with:

```ts
    runReconciliation: buildRunReconciliation({
      bookingStore: new PrismaBookingStore(app.prisma!),
      conversionRecordStore: new PrismaConversionRecordStore(app.prisma!),
      opportunityStore: new PrismaOpportunityStore(app.prisma!),
      reconciliationStore: new PrismaReconciliationStore(app.prisma!),
    }),
```

> The four Prisma stores structurally satisfy `ReconciliationDeps` (`countConfirmed`, `countByType`, `countByStage(orgId, stage)` overload, `save`). If any constructor takes more than `app.prisma`, match the call used elsewhere in the bootstrap (grep `new Prisma*Store(`).

- [ ] **Step 3: Typecheck + build the api**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS — the stores satisfy `ReconciliationDeps`, the helper returns the cron-expected type.

> If `PrismaOpportunityStore.countByStage`'s overload trips assignability, wrap it inline: `opportunityStore: { countByStage: (orgId, stage) => oppStore.countByStage(orgId, stage) }` where `oppStore = new PrismaOpportunityStore(app.prisma!)`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): wire real ReconciliationRunner into reconciliation cron"
```

---

## Task 9: Full verification + scope guard + PR

**Files:** none (verification only)

- [ ] **Step 1: Confirm no out-of-scope engine files changed**

Run:

```bash
git diff --name-only origin/main...HEAD
```

Expected: only the files listed in **File Structure** above. Specifically assert NONE of these appear:

```bash
git diff --name-only origin/main...HEAD | grep -E "campaign-decision|audit-runner|recommendation-engine|learning-phase-guard|evidence-floor|denominator-step-change|meta-campaign-insights-provider|ad-optimizer/src/evals|metrics-riley" && echo "SCOPE VIOLATION" || echo "scope clean"
```

Expected: `scope clean`.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS. (DB-backed integration tests use mocked Prisma — CI has no Postgres. If a known pg_advisory_xact_lock flake appears in work-trace/ledger/greeting, it is unrelated — see memory.)

- [ ] **Step 3: Typecheck, arch-check, format**

Run: `pnpm typecheck && pnpm arch:check && pnpm format:check`
Expected: all PASS. `arch:check` is the separate raw-line CI gate (not `pnpm lint`); it must pass for the dependency-layer / file-size invariants. If `format:check` flags files, run `pnpm format` and amend the relevant commit.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin worktree-riley-phase-b-measurement
gh pr create --base main --title "feat(riley): phase-b revenue-truth measurement foundation" \
  --body "$(cat <<'EOF'
Implements the measurement substrate of Riley Phase B (spec: docs/superpowers/specs/2026-06-02-riley-phase-b-measurement-foundation-design.md).

## What
- Stamp the `booked` outbox event with sourceCampaignId/sourceAdId, customer email+phone, attribution (fbclid, lead_id←leadgen_id), and value (cents) + currency — via a pure `buildBookedConversionPayload` mapper (explicit nulls, never inferred).
- Carry customer/attribution/currency through the OutboxPublisher (else the stamp is dropped before any consumer).
- Normalize CAPI `custom_data.value` cents→major at the Meta boundary (`normalizeConversionValue`); value stays cents internally to keep funnel revenue sums coherent.
- Replace the hardcoded reconciliation stub with the real `ReconciliationRunner` over existing Prisma stores.

## Scope / safety
- Measurement only: no PlatformIngress execution path, no campaign mutation, no MetaAdsClient writes. CAPI dispatch stays env-gated (`META_PIXEL_ID`/`META_CAPI_ACCESS_TOKEN`) — no production flip (gated on Meta App Review).
- File-disjoint from the parallel Riley engine session (no optimizer/decision-path/metrics-riley files touched).
- No Prisma migration (ReconciliationReport model + all stores already exist).
- Persistence: revenue-truth fields (value/campaign/ad) persist via existing ConversionRecord columns; customer/attribution match keys are bus-only (no new plaintext-PII-at-rest).

## Notes
- Known-red "Eval — Claim Classifier" CI check is a baking failure on main too — ignore.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Enable auto-merge once required checks pass**

```bash
gh pr merge --auto --squash
```

Expected: auto-merge enabled; PR merges when required checks (typecheck/lint/test/security) pass. The "Eval — Claim Classifier" check is a known non-required baking failure (red on main too) — ignore it.

---

## Self-Review

**Spec coverage:**

- §1 Component 1 (stamping) → Tasks 2, 3. ✅
- §1 Component 2 (publisher carry-through) → Task 4. ✅
- §1 Component 3 (reconciliation) → Tasks 7, 8. ✅
- §1 Component 4 (CAPI dispatchability) → Tasks 5, 6. ✅
- §2 (units: cents internal, normalize at boundary) → Task 1 (doc), Task 3 (stamp cents), Tasks 5–6 (normalize). ✅
- §3 (persistence A/B) → satisfied structurally (match keys in `customer`/`attribution`, which `record()` drops; no metadata PII) — asserted in Task 3 Step 1 (metadata has no email/phone). ✅
- null/undefined boundary → Task 4 (both tests). ✅
- canDispatch matrix → existing tests (noted in Task 6). ✅
- reconciliation real counts → Task 7 Step 2. ✅
- scope guard → Task 9 Step 1. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✅

**Type consistency:** `buildBookedConversionPayload` signature (Task 2) matches its call in Task 3; `BookedConversionPayload` field names (`customer`, `attribution.lead_id`) match the payload keys and the publisher carry-through (Task 4) and the dispatcher reads (`event.customer`, `event.attribution.lead_id`). `normalizeConversionValue` (Task 5) name matches its use (Task 6). `buildRunReconciliation` / `ReconciliationDeps` (Task 7) match the inngest wiring (Task 8). ✅
