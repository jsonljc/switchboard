# Riley Booked-Stats Live-Origin Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing `origin: "live"` filter to `PrismaConversionRecordStore.getBookedStatsForOrgWindow` so seed/demo booked rows cannot fabricate a "corroborated" Riley outcome.

**Architecture:** `getBookedStatsForOrgWindow` is the CRM-side independent second estimate behind Riley's outcome-corroboration multiplier (and the reallocation-guardrail rollback sizer). Every sibling booked query in the same store filters `origin: "live"` to exclude fixtures; this one aggregate omits it, so a seeded/demo `origin != "live"` booking inflates the corroboration count/value. The fix is a single `where`-clause addition plus its guarding tests. No interface, signature, or return-type change, so Layer-3 (`core`) and Layer-5 (`apps/api`) consumers are untouched at the type level.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma (mocked in unit tests via `vi.fn`), Vitest, pnpm + Turborepo.

## Global Constraints

- Source of truth: `docs/audits/2026-06-22-second-wave-gap-eval/README.md` row P2-10.
- Design decision (recorded): **unconditional** `origin: "live"`, matching all five sibling queries (`queryBookedValueCentsByCampaign`, `queryBookedStatsByCampaign`, `countAdAttributedBookings`, `sumAttributedBookedValueCentsForWindow`, `countBookedConversionsForWindow`) and the in-file convention documented at the existing "`origin:"live"` excludes fixtures" comment. **Rejected:** `isProduction`-gating, because (a) it diverges from every sibling, (b) it adds a fail-open path in non-prod where a demo could still show a fabricated "corroborated" badge, and (c) no consumer needs non-live rows here: both the core corroboration test and the apps/api bind test inject a mocked reader, and the only two production consumers (corroboration confidence + guardrail rollback) are money-path readers that must count live bookings only.
- No `any`; no `console.log`; ESM `.js` import suffixes; Prettier (semi, double quotes, 2-space, trailing commas, 100-col); Conventional Commits lowercase subject.
- NO em-dashes anywhere in the diff (prose, comments, strings). Scan `git diff` before the commit.
- db unit tests mock Prisma (no CI Postgres). Mirror the existing `prisma-conversion-record-store.test.ts` patterns.
- Gates before commit: `pnpm --filter @switchboard/db exec tsc --noEmit` + `pnpm --filter @switchboard/core exec tsc --noEmit` + `pnpm --filter @switchboard/api exec tsc --noEmit` (cross-layer consumers) + `pnpm --filter @switchboard/db test` + `pnpm eval:riley`.

---

### Task 1: Pin live-origin filtering on getBookedStatsForOrgWindow

**Files:**

- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts:384-403` (add `origin: "live"` to the aggregate `where`; update the method docstring at `:367-383`)
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts:348-399` (strengthen the existing where-assertion; add a dedicated fixture-exclusion guard test)

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change. `getBookedStatsForOrgWindow(args: { organizationId: string; startInclusive: Date; endExclusive: Date }): Promise<{ bookedValueCents: number; bookedCount: number }>` is unchanged. The only observable difference is the Prisma `where` now includes `origin: "live"`.

- [ ] **Step 1: Update the existing where-assertion test to expect `origin: "live"`, and add a dedicated fixture-exclusion guard test**

In `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`, inside the `describe("getBookedStatsForOrgWindow (riley v3 slice 4d)", ...)` block:

First, in the existing test `it("aggregates valued bookings org-wide over the HALF-OPEN window ...")`, add `origin: "live"` to the asserted `where` object so it reads:

```typescript
expect(prisma.conversionRecord.aggregate).toHaveBeenCalledWith({
  where: {
    organizationId: "org-1",
    type: "booked",
    origin: "live",
    value: { gt: 0 },
    occurredAt: {
      gte: new Date("2026-04-24T12:00:00Z"),
      lt: new Date("2026-05-01T12:00:00Z"),
    },
  },
  _sum: { value: true },
  _count: { _all: true },
});
```

Then, immediately after that test (before the `it("returns honest zeros ...")` test), add a dedicated guard:

```typescript
it("filters to origin:live so seed/demo fixtures cannot fabricate CRM corroboration", async () => {
  // This aggregate is the independent CRM-side estimate behind the outcome
  // corroboration multiplier; a non-live (seed/demo) booked row must never
  // inflate it. Every sibling booked query in this store enforces
  // origin:"live"; this one must too. Pins the where shape against regression.
  (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
    _sum: { value: 12000 },
    _count: { _all: 2 },
  });

  await store.getBookedStatsForOrgWindow({
    organizationId: "org-7",
    startInclusive: new Date("2026-05-01T00:00:00Z"),
    endExclusive: new Date("2026-05-08T00:00:00Z"),
  });

  expect(prisma.conversionRecord.aggregate).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ origin: "live" }),
    }),
  );
});
```

- [ ] **Step 2: Run the test file to verify both fail (red)**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store`
Expected: FAIL. The strengthened `toHaveBeenCalledWith` and the new `expect.objectContaining({ origin: "live" })` both fail because the current `where` omits `origin`.

- [ ] **Step 3: Add `origin: "live"` to the aggregate `where` clause**

In `packages/db/src/stores/prisma-conversion-record-store.ts`, in `getBookedStatsForOrgWindow`, change the `where` from:

```typescript
      where: {
        organizationId: args.organizationId,
        type: "booked",
        value: { gt: 0 },
        occurredAt: { gte: args.startInclusive, lt: args.endExclusive },
      },
```

to:

```typescript
      where: {
        organizationId: args.organizationId,
        type: "booked",
        origin: "live",
        value: { gt: 0 },
        occurredAt: { gte: args.startInclusive, lt: args.endExclusive },
      },
```

- [ ] **Step 4: Update the method docstring to record the live-origin filter**

In the same file, change the first docstring paragraph of `getBookedStatsForOrgWindow` from:

```typescript
   * Org-level windowed booked stats for the outcome ledger's corroboration
   * predicate (Riley v3 slice 4d). Sum and count aggregate over the SAME
   * predicate (`type:"booked"` AND `value > 0`), org-wide: campaign
   * attribution is deliberately NOT required, because the CRM-side second
   * estimate must be independent of Meta attribution and
   * partially-attributed orgs still book real revenue.
```

to:

```typescript
   * Org-level windowed booked stats for the outcome ledger's corroboration
   * predicate (Riley v3 slice 4d). Sum and count aggregate over the SAME
   * predicate (`type:"booked"` AND `origin:"live"` AND `value > 0`), org-wide:
   * campaign attribution is deliberately NOT required, because the CRM-side
   * second estimate must be independent of Meta attribution and
   * partially-attributed orgs still book real revenue. `origin:"live"` excludes
   * seed/demo fixtures (matching every sibling booked query), so a non-live row
   * can never fabricate a corroborated outcome.
```

- [ ] **Step 5: Run the test file to verify it passes (green)**

Run: `pnpm --filter @switchboard/db test -- prisma-conversion-record-store`
Expected: PASS. All `getBookedStatsForOrgWindow` tests green, including the strengthened assertion and the new guard.

- [ ] **Step 6: Run the cross-layer gates**

Run, expecting each to pass:

- `pnpm --filter @switchboard/db exec tsc --noEmit`
- `pnpm --filter @switchboard/core exec tsc --noEmit`
- `pnpm --filter @switchboard/api exec tsc --noEmit`
- `pnpm --filter @switchboard/db test`
- `pnpm eval:riley`

(The "Eval - Claim Classifier" CI job is a known unrelated `ANTHROPIC_API_KEY` flake; judge its conclusion, do not be blocked by it.)

- [ ] **Step 7: Scan the diff for em-dashes, then commit**

Run: `git diff --cached | perl -ne 'print "em-dash at line $.: $_" if /\x{2014}/'` (prints nothing when clean; rephrase any hit before committing).

```bash
git add packages/db/src/stores/prisma-conversion-record-store.ts \
        packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "fix(db): filter getBookedStatsForOrgWindow to origin:live (riley P2-10)"
```

---

## Self-Review

**1. Spec coverage:** Row P2-10 requires the org-window booked-stats reader to enforce `origin: "live"` like its siblings. Task 1 adds it and pins it with two assertions. Covered.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every step shows exact code and exact commands. Clean.

**3. Type consistency:** No signature change; `getBookedStatsForOrgWindow` keeps its exact name, args shape, and return type, so `OrgBookedStatsReader` (core) and the apps/api bindings remain assignable. The structural-DI-seam test already in the suite re-verifies this.
