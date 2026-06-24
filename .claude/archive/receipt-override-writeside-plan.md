# Receipted-booking override write-side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Strict TDD: a real RED before GREEN, one step at a time. Steps use `- [ ]`.

**Goal:** Let an operator override a worklist booking's `attributionConfidence` through a governed `PlatformIngress.submit()` path that writes the override-provenance columns + a re-evaluated derived state to the persisted `ReceiptedBooking` row, and fix `getView` so the persisted override surfaces (raises `manual_override`, reflects the overridden rung) in the already-shipped #1088 worklist.

**Architecture:** New operator-direct intent `receipt.override_attribution` (`system_auto_approved`, mirroring `record-verified-payment`/attendance) → `OperatorMutationHandler` → injected `AttributionOverrideWriter` (satisfied by `PrismaReceiptedBookingStore`). The store write is idempotent + org-scoped, create-or-update keyed on bookingId; CREATE snapshots the live Opportunity value so the revenue rollup (which keys snapshot-vs-live on `issuedAt != null`) does not regress; UPDATE leaves `expectedValueAtIssue`/`currency` frozen. The override self-raises an open `manual_override` exception (integrity: an override can never silently clean a booking). `getView` recomputes recomputable codes lazily (#1083) but now reads the persisted override columns: `overriddenBy` → `manual_override`, and the overridden `attributionConfidence` becomes the effective rung. The persisted `exceptions` Json is merged append-only, scoped to override-owned codes (`missing_source`, `manual_override`), leaving `missing_consent`/`duplicate_contact_risk` untouched.

**Tech Stack:** TypeScript ESM monorepo (pnpm/Turbo), Zod schemas, Prisma (mocked in db tests — no Postgres in CI), Fastify, Vitest.

**Governance rationale (locked, self-directed brainstorm):** `require_approval` for an operator-mutation is unproven in this codebase (zero existing operator intents use it; `approvalMode:"policy"` default-denies without a seeded org policy = dead-feature trap; post-approval dispatch for operator_mutation mode is unbuilt = dead-end trap). The non-financial proof override does not trip the D9-2 `isFinancialIntent` guard (no outbound spend), so `system_auto_approved` is the doctrine-sanctioned path (skips only the human approval-policy lookup, never auth/idempotency/WorkTrace/audit). Integrity is structural: the override self-raises `manual_override` + writes provenance columns + a canonical WorkTrace. This is the brief's explicit "at minimum a fully audited operator-direct action" floor.

**Out of scope (deferred, not invented):** the dashboard action button (small proxy-seam follow-on); `duplicate_contact_risk`/identity (Casey); payment re-eval (Ledger); any scoring-engine change (reuse pure functions).

---

## File map

- Create `packages/core/src/receipts/merge-override-exceptions.ts` — pure append-only merge (override-owned codes).
- Create `packages/core/src/receipts/merge-override-exceptions.test.ts`.
- Modify `packages/core/src/receipts/build-receipted-booking-data.ts` — `export` `snapshotCents`.
- Modify `packages/core/src/receipts/index.ts` — export the merge module (build-data already exported).
- Modify `packages/db/src/stores/prisma-receipted-booking-store.ts` — `getView` consumer fix + new `applyAttributionOverride` + `ApplyAttributionOverrideResult`.
- Modify `packages/db/src/index.ts` — barrel re-export `ApplyAttributionOverrideResult` (the db barrel uses NAMED re-exports, not `export *`, so the api handler's `import type { ApplyAttributionOverrideResult } from "@switchboard/db"` needs it).
- Create `packages/db/src/stores/prisma-receipted-booking-store.test.ts` — mocked-Prisma tests (getView fix + applyAttributionOverride create/update/not-found/revenue-snapshot).

> **HYGIENE (brief hard rule): NO em-dashes (`—`) anywhere in committed code/comments/commits.** Write `-` or restructure. Before each commit, grep the staged diff for `—`. (The plan prose below may contain them; the COMMITTED source must not.)

- Modify `apps/api/src/routes/operator-intents-schemas.ts` — `OverrideAttributionParametersSchema`.
- Create `apps/api/src/bootstrap/operator-intents/attribution-override.ts` — intent const + writer interface + handler factory.
- Create `apps/api/src/bootstrap/operator-intents/attribution-override.test.ts` — handler tests.
- Modify `apps/api/src/bootstrap/operator-intents.ts` — import/register/re-export the handler + intent + dep.
- Create `apps/api/src/routes/receipted-booking-override.ts` — `// @route-class: operator-direct` route.
- Create `apps/api/src/routes/__tests__/receipted-booking-override.test.ts` — route tests (200 / 404 / 400 / 503 / missing-idempotency-400).
- Modify `apps/api/src/bootstrap/routes.ts` — register route.
- Modify `apps/api/src/__tests__/test-server.ts` — register route + thread `attributionOverrideWriter` option.
- Modify `apps/api/src/app.ts` — construct store + pass `attributionOverrideWriter`.

---

## Task 1: Pure append-only override-exceptions merge (core)

**Files:**

- Modify: `packages/core/src/receipts/build-receipted-booking-data.ts` (export snapshotCents)
- Create: `packages/core/src/receipts/merge-override-exceptions.ts`
- Create: `packages/core/src/receipts/merge-override-exceptions.test.ts`
- Modify: `packages/core/src/receipts/index.ts`

- [ ] **Step 1: Write the failing test** `merge-override-exceptions.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mergeOverrideExceptions } from "./merge-override-exceptions.js";
import type { SerializedExceptionEntry } from "./build-receipted-booking-data.js";

const T = "2026-06-15T00:00:00.000Z";
const now = new Date(T);

describe("mergeOverrideExceptions", () => {
  it("adds manual_override on an empty prior (non-unattributed override raises no missing_source)", () => {
    const out = mergeOverrideExceptions([], "high", "user_1", now);
    expect(out).toEqual([{ code: "manual_override", raisedAt: T, resolvedAt: null }]);
  });

  it("raises missing_source + manual_override when the override target is unattributed", () => {
    const out = mergeOverrideExceptions([], "unattributed", "user_1", now);
    expect(out).toEqual([
      { code: "missing_source", raisedAt: T, resolvedAt: null },
      { code: "manual_override", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("resolves an open missing_source when the override improves attribution, and adds manual_override", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "missing_source", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
    ];
    const out = mergeOverrideExceptions(prior, "high", "user_1", now);
    expect(out).toEqual([
      { code: "missing_source", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: T },
      { code: "manual_override", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("leaves non-owned codes (missing_consent) untouched", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "missing_consent", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
    ];
    const out = mergeOverrideExceptions(prior, "high", "user_1", now);
    expect(out).toEqual([
      { code: "missing_consent", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
      { code: "manual_override", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("is idempotent: re-overriding leaves the open manual_override untouched (no duplicate)", () => {
    const prior: SerializedExceptionEntry[] = [
      { code: "manual_override", raisedAt: "2026-06-10T00:00:00.000Z", resolvedAt: null },
    ];
    const out = mergeOverrideExceptions(prior, "high", "user_1", now);
    expect(out).toEqual([
      { code: "manual_override", raisedAt: "2026-06-10T00:00:00.000Z", resolvedAt: null },
    ]);
  });

  it("re-raises an owned code after a resolved history entry, preserving the history", () => {
    const prior: SerializedExceptionEntry[] = [
      {
        code: "missing_source",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-05T00:00:00.000Z",
      },
    ];
    const out = mergeOverrideExceptions(prior, "unattributed", "user_1", now);
    expect(out).toEqual([
      {
        code: "missing_source",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-05T00:00:00.000Z",
      },
      { code: "missing_source", raisedAt: T, resolvedAt: null },
      { code: "manual_override", raisedAt: T, resolvedAt: null },
    ]);
  });

  it("emits JSON-native dates only (ISO strings, never Date)", () => {
    const out = mergeOverrideExceptions([], "unattributed", "user_1", now);
    for (const e of out) {
      expect(typeof e.raisedAt).toBe("string");
      expect(e.resolvedAt === null || typeof e.resolvedAt === "string").toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (module/function does not exist)

Run: `pnpm --filter @switchboard/core test -- merge-override-exceptions`
Expected: FAIL — cannot find `./merge-override-exceptions.js`.

- [ ] **Step 3: Export `snapshotCents`** — in `build-receipted-booking-data.ts` change `function snapshotCents` to `export function snapshotCents`.

- [ ] **Step 4: Implement** `merge-override-exceptions.ts`

```ts
import type { AttributionConfidence, ExceptionCode } from "@switchboard/schemas";
import type { SerializedExceptionEntry } from "./build-receipted-booking-data.js";

/**
 * Codes an attribution override OWNS: it may add or resolve these, and MUST leave every other code
 * (missing_consent, duplicate_contact_risk) exactly as it found them — those are recomputed lazily on
 * the read path / owned by other producers. Keeping the merge scoped is what prevents an attribution
 * override from spuriously resolving an unrelated open code.
 */
const OVERRIDE_OWNED_CODES: ReadonlySet<ExceptionCode> = new Set([
  "missing_source",
  "manual_override",
]);

/**
 * Append-only merge of the persisted exceptions array after a manual attribution override. Pure +
 * JSON-native (ISO strings, never Date), so the resulting payload cannot raise a Prisma Json error.
 * Rules (spec 2026-06-14 resolution, append-only): an open owned code still desired stays untouched
 * (its raisedAt is preserved); an open owned code no longer desired gets resolvedAt stamped; a desired
 * owned code with no open prior entry is appended fresh; resolved-history and non-owned entries are
 * never modified. The desired OPEN owned set after the override is: missing_source iff the effective
 * attribution is unattributed, plus manual_override iff an overriddenBy is set.
 */
export function mergeOverrideExceptions(
  prior: SerializedExceptionEntry[],
  effectiveAttribution: AttributionConfidence,
  overriddenBy: string | null,
  now: Date,
): SerializedExceptionEntry[] {
  const nowIso = now.toISOString();
  const desiredOpen = new Set<ExceptionCode>();
  if (effectiveAttribution === "unattributed") desiredOpen.add("missing_source");
  if (overriddenBy) desiredOpen.add("manual_override");

  const result: SerializedExceptionEntry[] = [];
  for (const entry of prior) {
    const open = entry.resolvedAt == null;
    if (OVERRIDE_OWNED_CODES.has(entry.code) && open) {
      if (desiredOpen.has(entry.code)) {
        result.push(entry); // still desired-open: untouched (preserve original raisedAt)
        desiredOpen.delete(entry.code);
      } else {
        result.push({ ...entry, resolvedAt: nowIso }); // newly absent: stamp resolvedAt
      }
    } else {
      result.push(entry); // non-owned, or already-resolved history: untouched
    }
  }
  for (const code of desiredOpen) {
    result.push({ code, raisedAt: nowIso, resolvedAt: null });
  }
  return result;
}
```

- [ ] **Step 5: Export from index** — add to `packages/core/src/receipts/index.ts`:

```ts
export * from "./merge-override-exceptions.js";
```

- [ ] **Step 6: Run test, expect PASS**

Run: `pnpm --filter @switchboard/core test -- merge-override-exceptions`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/receipts/
git commit -m "feat(receipts): add append-only override-exceptions merge"
```

---

## Task 2: getView consumer fix — reflect persisted override (db)

**Files:**

- Modify: `packages/db/src/stores/prisma-receipted-booking-store.ts`
- Create: `packages/db/src/stores/prisma-receipted-booking-store.test.ts`

Note: mirror the mocked-Prisma pattern of a sibling `packages/db/src/stores/*.test.ts` (vi.fn for each `prisma.<model>.<method>`). Read one before writing if the shape is unclear.

- [ ] **Step 1: Write the failing test** (getView portion) `prisma-receipted-booking-store.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { PrismaReceiptedBookingStore } from "./prisma-receipted-booking-store.js";
import { ReceiptedBookingViewSchema } from "@switchboard/schemas";

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    booking: { findFirst: vi.fn() },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    contact: { findFirst: vi.fn().mockResolvedValue(null) },
    lifecycleRevenueEvent: { findMany: vi.fn().mockResolvedValue([]) },
    opportunity: { findFirst: vi.fn().mockResolvedValue(null) },
    workTrace: { findFirst: vi.fn().mockResolvedValue(null) },
    receiptedBooking: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    ...over,
  };
}

const baseBooking = {
  id: "bk_1",
  contactId: null,
  opportunityId: null,
  workTraceId: null,
  attendance: null,
  service: "botox",
  startsAt: new Date("2026-06-10T00:00:00Z"),
};

describe("getView override reflection", () => {
  it("raises manual_override and uses the overridden rung when overriddenBy is set", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue(baseBooking);
    prisma.receiptedBooking.findFirst.mockResolvedValue({
      issuedAt: new Date("2026-06-10T00:00:00Z"),
      expectedValueAtIssue: 5000,
      currency: "SGD",
      attributionConfidence: "high",
      overriddenBy: "user_1",
      overrideReason: "owner knows source",
      overriddenAt: new Date("2026-06-12T00:00:00Z"),
    });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    const view = await store.getView("org_1", "bk_1", new Date("2026-06-15T00:00:00Z"));
    expect(view).not.toBeNull();
    expect(view!.attributionConfidence).toBe("high"); // overridden rung wins over live "unattributed"
    expect(view!.exceptions.map((e) => e.code)).toContain("manual_override");
    expect(view!.exceptions.map((e) => e.code)).not.toContain("missing_source"); // "high" clears it
    expect(view!.overriddenBy).toBe("user_1");
    expect(ReceiptedBookingViewSchema.safeParse(view).success).toBe(true);
  });

  it("recomputes lazily (no override) when overriddenBy is null", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue(baseBooking);
    prisma.receiptedBooking.findFirst.mockResolvedValue({
      issuedAt: new Date(),
      expectedValueAtIssue: null,
      currency: null,
      attributionConfidence: "high", // issuance snapshot — must be IGNORED on the read path
      overriddenBy: null,
      overrideReason: null,
      overriddenAt: null,
    });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    const view = await store.getView("org_1", "bk_1", new Date("2026-06-15T00:00:00Z"));
    expect(view!.attributionConfidence).toBe("unattributed"); // live recompute (no source evidence)
    expect(view!.exceptions.map((e) => e.code)).toContain("missing_source");
    expect(view!.exceptions.map((e) => e.code)).not.toContain("manual_override");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (override case: `attributionConfidence` is `unattributed`, no `manual_override`)

Run: `pnpm --filter @switchboard/db test -- prisma-receipted-booking-store`
Expected: FAIL — view shows live recompute + no manual_override (the hardcoded `overriddenBy: null` bug).

- [ ] **Step 3: Implement the getView fix** in `prisma-receipted-booking-store.ts`

In the persisted `receiptedBooking.findFirst` select, add `attributionConfidence: true`:

```ts
        this.prisma.receiptedBooking.findFirst({
          where: { organizationId: orgId, bookingId },
          select: {
            issuedAt: true,
            expectedValueAtIssue: true,
            currency: true,
            attributionConfidence: true,
            overriddenBy: true,
            overrideReason: true,
            overriddenAt: true,
          },
        }),
```

Replace the attribution/exceptions block (was lines ~109-118):

```ts
const liveAttribution = scoreAttribution(sourceEvidence);
// A persisted manual override is the human's explicit judgment and wins over the live-derived
// rung (it is the one NON-recomputable attribution signal, spec 2026-06-14 resolution). Absent an
// override, attribution stays lazily recomputed (#1083): the persisted issuance-time
// attributionConfidence is NOT read on the read path.
const overridden = persisted?.overriddenBy != null;
const attributionConfidence: AttributionConfidence =
  overridden && persisted?.attributionConfidence
    ? (persisted.attributionConfidence as AttributionConfidence)
    : liveAttribution;
const exceptions = evaluateExceptions({
  attributionConfidence,
  consentGrantedAt: contact?.consentGrantedAt ?? null,
  consentRevokedAt: contact?.consentRevokedAt ?? null,
  // Reflect the persisted override (was hardcoded null): a set overriddenBy raises manual_override.
  overriddenBy: persisted?.overriddenBy ?? null,
  // No persisted duplicate-contact signal in the lazy read path (Casey owns it).
  duplicateContactRisk: false,
  now,
});
```

Add the `AttributionConfidence` type import at the top:

```ts
import type { ReceiptedBookingView, AttributionConfidence } from "@switchboard/schemas";
```

(The `return` block already references `attributionConfidence`; it now resolves to the effective rung. Leave every other field unchanged.)

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter @switchboard/db test -- prisma-receipted-booking-store`
Expected: PASS (both getView tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-receipted-booking-store.ts packages/db/src/stores/prisma-receipted-booking-store.test.ts
git commit -m "fix(db): surface the persisted attribution override in getView"
```

---

## Task 3: applyAttributionOverride store write (db)

**Files:**

- Modify: `packages/db/src/stores/prisma-receipted-booking-store.ts`
- Modify: `packages/db/src/stores/prisma-receipted-booking-store.test.ts`

- [ ] **Step 1: Add failing tests** (append to the test file)

```ts
describe("applyAttributionOverride", () => {
  const input = {
    orgId: "org_1",
    bookingId: "bk_1",
    attributionConfidence: "high" as const,
    overriddenBy: "user_1",
    overrideReason: "owner knows source",
    now: new Date("2026-06-15T00:00:00.000Z"),
  };

  it("returns not_found when the booking is absent for the org", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue(null);
    const store = new PrismaReceiptedBookingStore(prisma as never);
    expect(await store.applyAttributionOverride(input)).toEqual({ status: "not_found" });
    expect(prisma.receiptedBooking.create).not.toHaveBeenCalled();
  });

  it("UPDATE: writes provenance + merged exceptions, leaving the value snapshot frozen", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: "op_1" });
    prisma.receiptedBooking.findFirst.mockResolvedValue({
      id: "rb_1",
      exceptions: [
        { code: "missing_source", raisedAt: "2026-06-01T00:00:00.000Z", resolvedAt: null },
      ],
    });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 1 });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    const res = await store.applyAttributionOverride(input);
    expect(res).toEqual({ status: "applied", created: false });
    expect(prisma.receiptedBooking.create).not.toHaveBeenCalled();
    const call = prisma.receiptedBooking.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ organizationId: "org_1", bookingId: "bk_1" }); // org-scoped (F12)
    expect(call.data.overriddenBy).toBe("user_1");
    expect(call.data.attributionConfidence).toBe("high");
    expect(call.data).not.toHaveProperty("expectedValueAtIssue"); // snapshot frozen
    expect(call.data).not.toHaveProperty("issuedAt");
    expect(call.data.exceptions).toEqual([
      {
        code: "missing_source",
        raisedAt: "2026-06-01T00:00:00.000Z",
        resolvedAt: "2026-06-15T00:00:00.000Z",
      },
      { code: "manual_override", raisedAt: "2026-06-15T00:00:00.000Z", resolvedAt: null },
    ]);
  });

  it("UPDATE no-match (concurrent delete) aborts as not_found", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue({ id: "rb_1", exceptions: [] });
    prisma.receiptedBooking.updateMany.mockResolvedValue({ count: 0 });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    expect(await store.applyAttributionOverride(input)).toEqual({ status: "not_found" });
  });

  it("CREATE (historical row absent): snapshots the live Opportunity value so revenue is preserved", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: "op_1" });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    prisma.opportunity.findFirst.mockResolvedValue({ estimatedValue: 5000 });
    prisma.receiptedBooking.create.mockResolvedValue({ id: "rb_new" });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    const res = await store.applyAttributionOverride(input);
    expect(res).toEqual({ status: "applied", created: true });
    const data = prisma.receiptedBooking.create.mock.calls[0][0].data;
    expect(data.organizationId).toBe("org_1");
    expect(data.expectedValueAtIssue).toBe(5000); // snapshot of live value (no revenue regression)
    expect(data.issuedAt).toEqual(input.now);
    expect(data.overriddenBy).toBe("user_1");
    expect(data.exceptions).toEqual([
      { code: "manual_override", raisedAt: "2026-06-15T00:00:00.000Z", resolvedAt: null },
    ]);
    expect(prisma.opportunity.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: "org_1",
      id: "op_1",
    }); // org-scoped
  });

  it("CREATE with no opportunity snapshots a null value", async () => {
    const prisma = makePrisma();
    prisma.booking.findFirst.mockResolvedValue({ id: "bk_1", opportunityId: null });
    prisma.receiptedBooking.findFirst.mockResolvedValue(null);
    prisma.receiptedBooking.create.mockResolvedValue({ id: "rb_new" });
    const store = new PrismaReceiptedBookingStore(prisma as never);
    await store.applyAttributionOverride(input);
    expect(prisma.receiptedBooking.create.mock.calls[0][0].data.expectedValueAtIssue).toBeNull();
    expect(prisma.opportunity.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (`applyAttributionOverride` is not a function)

Run: `pnpm --filter @switchboard/db test -- prisma-receipted-booking-store`
Expected: FAIL — `store.applyAttributionOverride is not a function`.

- [ ] **Step 3: Implement** — add imports + method to `prisma-receipted-booking-store.ts`

Top-of-file imports:

```ts
import {
  scoreAttribution,
  evaluateExceptions,
  mergeOverrideExceptions,
  snapshotCents,
} from "@switchboard/core";
import type { SerializedExceptionEntry } from "@switchboard/core";
import type { ReceiptedBookingView, AttributionConfidence } from "@switchboard/schemas";
import { Prisma } from "@prisma/client";
```

Add the result type (above the class):

```ts
/** Outcome of an attribution override write. `created` distinguishes a late issuance row (historical
 *  booking) from an in-place update of an existing one. */
export type ApplyAttributionOverrideResult =
  | { status: "not_found" }
  | { status: "applied"; created: boolean };
```

Then add the barrel re-export in `packages/db/src/index.ts` (next to line 76's `export { PrismaReceiptedBookingStore }`):

```ts
export type { ApplyAttributionOverrideResult } from "./stores/prisma-receipted-booking-store.js";
```

Add the method to the class (after `listForCohort`):

```ts
  /**
   * Apply a human attribution override to a booking's persisted ReceiptedBooking row, through the
   * governed operator path (its own WorkTrace). Idempotent + keyed on bookingId, org-scoped on every
   * leg (F12). Sets the override-provenance columns + the overridden rung + an append-only merged
   * exceptions array (manual_override raised; missing_source resolved if the rung improves). UPDATE
   * keeps the value snapshot (expectedValueAtIssue/currency/issuedAt) frozen; CREATE (a historical
   * booking with no issuance row) snapshots the live Opportunity value so the revenue rollup — which
   * keys snapshot-vs-live on `issuedAt != null` — does NOT regress the booking to zero. JSON-native
   * exceptions (no Date), so the write cannot raise a Prisma Json error.
   */
  async applyAttributionOverride(input: {
    orgId: string;
    bookingId: string;
    attributionConfidence: AttributionConfidence;
    overriddenBy: string;
    overrideReason: string;
    now?: Date;
  }): Promise<ApplyAttributionOverrideResult> {
    const now = input.now ?? new Date();
    const booking = await this.prisma.booking.findFirst({
      where: { organizationId: input.orgId, id: input.bookingId },
      select: { id: true, opportunityId: true },
    });
    if (!booking) return { status: "not_found" };

    const existing = await this.prisma.receiptedBooking.findFirst({
      where: { organizationId: input.orgId, bookingId: input.bookingId },
      select: { id: true, exceptions: true },
    });
    const prior: SerializedExceptionEntry[] = Array.isArray(existing?.exceptions)
      ? (existing!.exceptions as unknown as SerializedExceptionEntry[])
      : [];
    const exceptions = mergeOverrideExceptions(
      prior,
      input.attributionConfidence,
      input.overriddenBy,
      now,
    );

    if (existing) {
      const updated = await this.prisma.receiptedBooking.updateMany({
        where: { organizationId: input.orgId, bookingId: input.bookingId },
        data: {
          attributionConfidence: input.attributionConfidence,
          attributionUpdatedAt: now,
          overriddenBy: input.overriddenBy,
          overrideReason: input.overrideReason,
          overriddenAt: now,
          exceptions: exceptions as unknown as Prisma.InputJsonValue,
          lastEvaluatedAt: now,
        },
      });
      // updateMany silently no-ops on a vanished/cross-tenant row; treat count 0 as not_found
      // (the no-match-abort lesson + F12 conflation of missing-row and tenant-mismatch).
      if (updated.count === 0) return { status: "not_found" };
      return { status: "applied", created: false };
    }

    const opportunity = booking.opportunityId
      ? await this.prisma.opportunity.findFirst({
          where: { organizationId: input.orgId, id: booking.opportunityId },
          select: { estimatedValue: true },
        })
      : null;
    try {
      await this.prisma.receiptedBooking.create({
        data: {
          organizationId: input.orgId,
          bookingId: input.bookingId,
          issuedAt: now,
          attributionConfidence: input.attributionConfidence,
          attributionUpdatedAt: now,
          expectedValueAtIssue: snapshotCents(opportunity?.estimatedValue ?? null),
          currency: null,
          exceptions: exceptions as unknown as Prisma.InputJsonValue,
          overriddenBy: input.overriddenBy,
          overrideReason: input.overrideReason,
          overriddenAt: now,
          lastEvaluatedAt: now,
        },
      });
      return { status: "applied", created: true };
    } catch (err) {
      // A concurrent issuance/override won the create race (unique bookingId). Converge by updating
      // the now-existing row, org-scoped, so the action stays idempotent.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const updated = await this.prisma.receiptedBooking.updateMany({
          where: { organizationId: input.orgId, bookingId: input.bookingId },
          data: {
            attributionConfidence: input.attributionConfidence,
            attributionUpdatedAt: now,
            overriddenBy: input.overriddenBy,
            overrideReason: input.overrideReason,
            overriddenAt: now,
            exceptions: exceptions as unknown as Prisma.InputJsonValue,
            lastEvaluatedAt: now,
          },
        });
        if (updated.count === 0) return { status: "not_found" };
        return { status: "applied", created: false };
      }
      throw err;
    }
  }
```

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter @switchboard/db test -- prisma-receipted-booking-store`
Expected: PASS (all getView + applyAttributionOverride tests).

- [ ] **Step 5: Build core+db so cross-package imports resolve, then commit**

```bash
pnpm --filter @switchboard/core --filter @switchboard/db build
git add packages/db/src/stores/prisma-receipted-booking-store.ts packages/db/src/stores/prisma-receipted-booking-store.test.ts
git commit -m "feat(db): add governed attribution-override write to the receipted-booking store"
```

---

## Task 4: Operator-intent parameter schema (api)

**Files:**

- Modify: `apps/api/src/routes/operator-intents-schemas.ts`

- [ ] **Step 1: Add the schema** (append to the file; add the import at top)

```ts
import {
  OpportunityStageSchema,
  PdpaJurisdictionSchema,
  AttributionConfidenceSchema,
} from "@switchboard/schemas";
```

```ts
export const OverrideAttributionParametersSchema = z.object({
  bookingId: z.string().min(1),
  attributionConfidence: AttributionConfidenceSchema,
  reason: z.string().min(1).max(500),
});

export type OverrideAttributionParameters = z.infer<typeof OverrideAttributionParametersSchema>;
```

(No standalone test — exercised by Tasks 5 and 6.)

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/operator-intents-schemas.ts
git commit -m "feat(api): add override-attribution operator-intent parameter schema"
```

---

## Task 5: Override handler + writer interface (api)

**Files:**

- Create: `apps/api/src/bootstrap/operator-intents/attribution-override.ts`
- Create: `apps/api/src/bootstrap/operator-intents/attribution-override.test.ts`

- [ ] **Step 1: Write the failing test** `attribution-override.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildOverrideAttributionHandler,
  OVERRIDE_ATTRIBUTION_INTENT,
} from "./attribution-override.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

function workUnit(parameters: Record<string, unknown>, actorId = "user_1") {
  return {
    organizationId: "org_1",
    actor: { id: actorId, type: "user" as const },
    intent: OVERRIDE_ATTRIBUTION_INTENT,
    parameters,
  } as never;
}

describe("buildOverrideAttributionHandler", () => {
  it("applies the override with the AUTHENTICATED actor as overriddenBy (never the body)", async () => {
    const writer = {
      applyAttributionOverride: vi.fn().mockResolvedValue({ status: "applied", created: false }),
    };
    const handler = buildOverrideAttributionHandler(writer);
    const res = await handler.execute(
      workUnit(
        { bookingId: "bk_1", attributionConfidence: "high", reason: "owner knows source" },
        "user_42",
      ),
    );
    expect(res.outcome).toBe("completed");
    expect(writer.applyAttributionOverride).toHaveBeenCalledWith({
      orgId: "org_1",
      bookingId: "bk_1",
      attributionConfidence: "high",
      overriddenBy: "user_42",
      overrideReason: "owner knows source",
    });
  });

  it("maps a not_found result to a failed outcome with BOOKING_NOT_FOUND", async () => {
    const writer = { applyAttributionOverride: vi.fn().mockResolvedValue({ status: "not_found" }) };
    const handler = buildOverrideAttributionHandler(writer);
    const res = await handler.execute(
      workUnit({ bookingId: "missing", attributionConfidence: "high", reason: "x" }),
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND);
  });

  it("rejects invalid parameters (bad attribution value) by throwing (Zod)", async () => {
    const writer = { applyAttributionOverride: vi.fn() };
    const handler = buildOverrideAttributionHandler(writer);
    await expect(
      handler.execute(workUnit({ bookingId: "bk_1", attributionConfidence: "bogus", reason: "x" })),
    ).rejects.toThrow();
    expect(writer.applyAttributionOverride).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing)

Run: `pnpm --filter @switchboard/switchboard-api test -- attribution-override` (or the api package's test filter; confirm package name from apps/api/package.json `name`)
Expected: FAIL — cannot find `./attribution-override.js`.

- [ ] **Step 3: Implement** `attribution-override.ts`

```ts
// apps/api/src/bootstrap/operator-intents/attribution-override.ts
// receipt.override_attribution handler — operator overrides a worklist booking's attribution
// confidence. system_auto_approved operator-direct (non-financial proof write): fully audited via
// WorkTrace + the override self-raises manual_override, so it can never silently clean a booking.
import type { OperatorMutationHandler } from "@switchboard/core/platform";
import type { AttributionConfidence } from "@switchboard/schemas";
import type { ApplyAttributionOverrideResult } from "@switchboard/db";
import { OverrideAttributionParametersSchema } from "../../routes/operator-intents-schemas.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

export const OVERRIDE_ATTRIBUTION_INTENT = "receipt.override_attribution";

/** Minimal writer surface; PrismaReceiptedBookingStore satisfies it structurally. */
export interface AttributionOverrideWriter {
  applyAttributionOverride(input: {
    orgId: string;
    bookingId: string;
    attributionConfidence: AttributionConfidence;
    overriddenBy: string;
    overrideReason: string;
    now?: Date;
  }): Promise<ApplyAttributionOverrideResult>;
}

export function buildOverrideAttributionHandler(
  writer: AttributionOverrideWriter,
): OperatorMutationHandler {
  return {
    async execute(workUnit) {
      const params = OverrideAttributionParametersSchema.parse(workUnit.parameters);
      // overriddenBy is the AUTHENTICATED actor, never a body field (provenance authority).
      const overriddenBy = workUnit.actor.id;
      const result = await writer.applyAttributionOverride({
        orgId: workUnit.organizationId,
        bookingId: params.bookingId,
        attributionConfidence: params.attributionConfidence,
        overriddenBy,
        overrideReason: params.reason,
      });
      if (result.status === "not_found") {
        return {
          outcome: "failed" as const,
          summary: `Booking ${params.bookingId} not found for organization`,
          error: {
            code: OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND,
            message: "Booking not found",
          },
        };
      }
      return {
        outcome: "completed" as const,
        summary: `Overrode attribution to ${params.attributionConfidence} for booking ${params.bookingId}`,
        outputs: {
          bookingId: params.bookingId,
          attributionConfidence: params.attributionConfidence,
          created: result.created,
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: api test filter `-- attribution-override`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/operator-intents/attribution-override.ts apps/api/src/bootstrap/operator-intents/attribution-override.test.ts
git commit -m "feat(api): add override-attribution operator-mutation handler"
```

---

## Task 6: Register intent + handler in the bootstrap (api)

**Files:**

- Modify: `apps/api/src/bootstrap/operator-intents.ts`

- [ ] **Step 1** — add import:

```ts
import {
  buildOverrideAttributionHandler,
  OVERRIDE_ATTRIBUTION_INTENT,
  type AttributionOverrideWriter,
} from "./operator-intents/attribution-override.js";
```

- [ ] **Step 2** — re-export (in the existing re-export block):

```ts
export {
  buildOverrideAttributionHandler,
  OVERRIDE_ATTRIBUTION_INTENT,
} from "./operator-intents/attribution-override.js";
```

- [ ] **Step 3** — add the dep to `OperatorIntentsBootstrapDeps`:

```ts
  /** Optional: registers the receipt.override_attribution intent + handler when provided. */
  attributionOverrideWriter?: AttributionOverrideWriter;
```

- [ ] **Step 4** — destructure it in `bootstrapOperatorIntents` and register the handler (with the other `handlers.set` calls):

```ts
if (attributionOverrideWriter) {
  handlers.set(
    OVERRIDE_ATTRIBUTION_INTENT,
    buildOverrideAttributionHandler(attributionOverrideWriter),
  );
}
```

- [ ] **Step 5** — register the intent (with the other `registerOperatorIntent` calls) and bump `intentCount`:

```ts
if (attributionOverrideWriter) {
  registerOperatorIntent(intentRegistry, OVERRIDE_ATTRIBUTION_INTENT);
}
```

```ts
(bookingAttendanceWriter ? 1 : 0) + (attributionOverrideWriter ? 1 : 0);
```

- [ ] **Step 6: Run the existing operator-intents tests to confirm no regression**

Run: api test filter `-- operator-intents`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/operator-intents.ts
git commit -m "feat(api): register the receipt.override_attribution operator intent"
```

---

## Task 7: Operator-direct route + registration + wiring (api)

**Files:**

- Create: `apps/api/src/routes/receipted-booking-override.ts`
- Create: `apps/api/src/routes/__tests__/receipted-booking-override.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing route test** `__tests__/receipted-booking-override.test.ts`

Mirror `apps/api/src/routes/__tests__/booking-attendance.test.ts` (read it first for the exact `buildTestServer` call + header conventions). Use a fake `attributionOverrideWriter` injected via the test-server option.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer } from "../../__tests__/test-server.js";

let app: FastifyInstance;
const writer = { applyAttributionOverride: vi.fn() };

beforeEach(async () => {
  writer.applyAttributionOverride.mockReset();
  app = await buildTestServer({ attributionOverrideWriter: writer });
});
afterEach(async () => {
  await app.close();
});

const url = "/api/org_1/bookings/bk_1/attribution-override";
const hdr = { "x-org-id": "org_1", "x-principal-id": "user_1", "idempotency-key": "idem-1" };

describe("POST attribution-override", () => {
  it("200 on a successful override", async () => {
    writer.applyAttributionOverride.mockResolvedValue({ status: "applied", created: false });
    const res = await app.inject({
      method: "POST",
      url,
      headers: hdr,
      payload: { attributionConfidence: "high", reason: "owner knows source" },
    });
    expect(res.statusCode).toBe(200);
    expect(writer.applyAttributionOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_1",
        bookingId: "bk_1",
        attributionConfidence: "high",
        overriddenBy: "user_1",
      }),
    );
  });

  it("404 when the booking is not found", async () => {
    writer.applyAttributionOverride.mockResolvedValue({ status: "not_found" });
    const res = await app.inject({
      method: "POST",
      url,
      headers: hdr,
      payload: { attributionConfidence: "high", reason: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 on an invalid attribution value", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: hdr,
      payload: { attributionConfidence: "bogus", reason: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(writer.applyAttributionOverride).not.toHaveBeenCalled();
  });

  it("400 when the Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { "x-org-id": "org_1", "x-principal-id": "user_1" },
      payload: { attributionConfidence: "high", reason: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (route 404s — not registered)

Run: api test filter `-- receipted-booking-override`
Expected: FAIL — 404 (route absent) on the 200 case.

- [ ] **Step 3: Implement the route** `receipted-booking-override.ts` (mirror `booking-attendance.ts` exactly)

```ts
// @route-class: operator-direct
// ---------------------------------------------------------------------------
// Receipted-booking attribution override — operator corrects a worklist
// booking's attribution-confidence rung. Mirrors the booking-attendance
// operator-direct pattern: the mutation enters through PlatformIngress.submit()
// (no bypass). The :orgId path param is informational; requireOrgForMutation
// makes the authenticated org authoritative, and the authenticated actor is the
// override's overriddenBy. A missing booking maps to 404; every other failed
// outcome is an unexpected execution error (500).
// ---------------------------------------------------------------------------
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AttributionConfidenceSchema } from "@switchboard/schemas";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { OPERATOR_INTENT_ERROR_CODES } from "../bootstrap/operator-intents/shared.js";
import { OVERRIDE_ATTRIBUTION_INTENT } from "../bootstrap/operator-intents.js";

const OverrideAttributionInputSchema = z.object({
  attributionConfidence: AttributionConfidenceSchema,
  reason: z.string().min(1).max(500),
});

export const receiptedBookingOverrideRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.post(
    "/:orgId/bookings/:bookingId/attribution-override",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const parsed = OverrideAttributionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
      }
      const { bookingId } = request.params as { orgId: string; bookingId: string };

      const response = await app.platformIngress.submit({
        intent: OVERRIDE_ATTRIBUTION_INTENT,
        parameters: { bookingId, ...parsed.data },
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId, // auth is authoritative; :orgId path param is informational only
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      // This intent is system_auto_approved + non-financial, so it never parks; still, branch on
      // approvalRequired before the result before destructuring (the pending_approval lesson) in case
      // a future policy makes it park — fall through to the 503/approval-not-yet-wired path.
      if ("approvalRequired" in response && response.approvalRequired) {
        return reply
          .code(202)
          .send({ status: "pending_approval", lifecycleId: response.lifecycleId });
      }
      if (response.result.outcome === "failed") {
        if (response.result.error?.code === OPERATOR_INTENT_ERROR_CODES.BOOKING_NOT_FOUND) {
          return reply.code(404).send({ error: "Booking not found", statusCode: 404 });
        }
        throw new Error(response.result.error?.message ?? "Attribution override failed");
      }
      return reply.code(200).send({
        bookingId,
        attributionConfidence: parsed.data.attributionConfidence,
        created: response.result.outputs?.created ?? false,
      });
    },
  );
};
```

- [ ] **Step 4: Register the route** in `apps/api/src/bootstrap/routes.ts` — add import beside `bookingAttendanceRoutes` and register beside it:

```ts
import { receiptedBookingOverrideRoutes } from "../routes/receipted-booking-override.js";
```

```ts
await app.register(receiptedBookingOverrideRoutes, { prefix: "/api" });
```

- [ ] **Step 5: Wire the test-server** `apps/api/src/__tests__/test-server.ts`:
  - add option field (beside `bookingAttendanceWriter`):
    ```ts
    attributionOverrideWriter?: import("../bootstrap/operator-intents/attribution-override.js").AttributionOverrideWriter;
    ```
  - thread into `bootstrapOperatorIntents({ ... })`:
    ```ts
    attributionOverrideWriter: options.attributionOverrideWriter,
    ```
  - register the route (beside the attendance registration):
    ```ts
    import { receiptedBookingOverrideRoutes } from "../routes/receipted-booking-override.js";
    ```
    ```ts
    await app.register(receiptedBookingOverrideRoutes, { prefix: "/api" });
    ```

- [ ] **Step 6: Wire app.ts** — in the operator-intents bootstrap block (`if (prismaClient) { ... bootstrapOperatorIntents(...) }`, ~line 890-927), construct the store and pass the writer:

```ts
const { PrismaReceiptedBookingStore } = await import("@switchboard/db");
const attributionOverrideStore = new PrismaReceiptedBookingStore(prismaClient);
```

```ts
      bookingAttendanceWriter: bookingAttendanceStore,
      receiptHeldPromoter: prismaReceipts,
      attributionOverrideWriter: attributionOverrideStore,
      logger: app.log,
```

- [ ] **Step 7: Run, expect PASS**

Run: api test filter `-- receipted-booking-override`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/receipted-booking-override.ts apps/api/src/routes/__tests__/receipted-booking-override.test.ts apps/api/src/bootstrap/routes.ts apps/api/src/__tests__/test-server.ts apps/api/src/app.ts
git commit -m "feat(api): add operator-direct attribution-override route"
```

---

## Task 8: Visible-consumer seam test — worklist reflects an override (core reports)

**Files:**

- Modify: `packages/core/src/reports/compute-receipted-booking-quality.test.ts`

This proves the already-shipped #1088 worklist reflects an overridden view with NO change to `compute-receipted-booking-quality.ts` (manual_override is already in its enum maps + EXCEPTION_ORDER). The producer→consumer seam: a `ReceiptedBookingView` carrying an open `manual_override` (what getView now emits) → worklist row + count.

- [ ] **Step 1: Add the failing test** (read the existing test file first to reuse its `RollupContext` + fake-store helpers; build a minimal view inline)

```ts
it("surfaces an overridden booking on the worklist with manual_override and the overridden rung", async () => {
  const view = {
    bookingId: "bk_1",
    organizationId: "org_1",
    attributionConfidence: "high" as const,
    exceptions: [
      {
        code: "manual_override" as const,
        raisedAt: new Date("2026-06-12T00:00:00Z"),
        resolvedAt: null,
      },
    ],
    receipts: [],
    contactKey: null,
    consentGrantedAt: new Date(),
    consentRevokedAt: null,
    sourceEvidence: {
      leadgenId: null,
      sourceAdId: null,
      sourceCampaignId: null,
      sourceType: null,
      sourceChannel: null,
    },
    traceId: null,
    matchedPolicies: null,
    humanApprovalId: null,
    attendanceState: null,
    service: "botox",
    startsAt: new Date("2026-06-10T00:00:00Z"),
    paymentEventIds: [],
    expectedValue: null,
    issuedAt: new Date("2026-06-10T00:00:00Z"),
    expectedValueAtIssue: null,
    currency: null,
    overriddenBy: "user_1",
    overrideReason: "owner knows source",
    overriddenAt: new Date("2026-06-12T00:00:00Z"),
  };
  const ctx = {
    orgId: "org_1",
    current: { start: new Date("2026-06-08"), end: new Date("2026-06-15") },
  } as never;
  const stores = { listForCohort: vi.fn().mockResolvedValue([view]) };
  const out = await computeReceiptedBookingQuality(ctx, stores as never);
  expect(out.confidence.high).toBe(1);
  expect(out.exceptions.manual_override).toBe(1);
  expect(out.bookingsNeedingAttention).toBe(1);
  expect(out.worklist[0]).toMatchObject({
    bookingId: "bk_1",
    attributionConfidence: "high",
    openExceptionCodes: ["manual_override"],
  });
});
```

- [ ] **Step 2: Run, expect PASS immediately** (the consumer already supports manual_override; this is a regression-pinning seam test, not a behavior change).

Run: `pnpm --filter @switchboard/core test -- compute-receipted-booking-quality`
Expected: PASS. (If it FAILS, the consumer has a real gap — fix it before proceeding.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/reports/compute-receipted-booking-quality.test.ts
git commit -m "test(reports): pin the worklist override-reflection seam"
```

---

## Task 9: Full gate suite (VERIFY)

- [ ] `pnpm reset` if typecheck reports missing lower-layer exports, then:
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @switchboard/core test` + `pnpm --filter @switchboard/db test` + api package test
- [ ] `pnpm test` (full)
- [ ] `pnpm lint` + `pnpm format:check` + `pnpm arch:check`
- [ ] `CI=1 npx tsx scripts/local-verify-fast.ts` (the ONLY gate that catches new mutating-route / intent allowlist debt — the new route must flow through submit and need no allowlist entry)
- [ ] `pnpm build` (app pkgs changed)
- [ ] NO schema change → skip `db:check-drift`. NO decision-engine change → skip evals.
- [ ] Three-dot diff review: `git diff origin/main...HEAD`.
- [ ] Independent fresh-context review (diff + criteria + lessons only) + deep doctrine/works review. Triage with receiving-code-review.

## Acceptance criteria

1. New mutating entry only via `PlatformIngress.submit`; intent registered `system_auto_approved` + executor binding; route `// @route-class: operator-direct`, `requireOrgForMutation`, Idempotency-Key required (400 absent), pending_approval branch present.
2. `getView` reflects persisted `overriddenBy` → `manual_override` + the overridden rung; recomputable codes stay lazy; `ReceiptedBookingViewSchema.safeParse` passes.
3. Producer is idempotent + org-scoped on every leg; `updateMany` count===0 → not_found; CREATE snapshots live Opportunity value (no revenue regression); snapshots stay frozen on UPDATE; exceptions append-only + JSON-native.
4. Worklist (#1088) reflects an overridden booking (manual_override + corrected rung), proven by a seam test, with no change to the rollup code.
5. All required gates green; independent review at zero severity ≥ warn → SURFACE (stop-glob: governance/ingress + receipt data-plane). Do NOT auto-merge.
