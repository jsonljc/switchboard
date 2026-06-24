# Receipted-Booking Proof-Quality Report Surface — Implementation Plan

> Build-loop scratch (uncommitted). TDD-shaped. Consumes slices 1-4 (data plane) on origin/main.

**Goal:** Ship the first owner-facing consumer of the receipted-booking read-projection: a weekly
proof-quality surface on the owner report showing the attribution-confidence breakdown and the
exceptions worklist, consuming `PrismaReceiptedBookingStore.listForCohort`.

**Architecture:** Mirror the slice-3 count seam exactly. New `ReportStores.receiptedBookings.listForCohort`
interface key (core defines, db's `PrismaReceiptedBookingStore` implements, app.ts binds via adapter —
core never imports db). New pure `computeReceiptedBookingQuality` aggregates the cohort views into a
`ReceiptedBookingQualityData` block on `ReportDataV1`. Dashboard renders a new ProofQuality section in
the existing report disclosure. Read-only slice: no schema/migration, org-scoping inherited from
slice-4 (F12-safe).

**Design rationale (FRAME; not greenfield → designed against named files, brainstorming skill not invoked):**

- Option A (confidence breakdown only / extend count tile): REJECTED — task+spec want the worklist too.
- Option B (breakdown + per-exception-code worklist counts + bookingsNeedingAttention, new compute fn +
  ReportDataV1 field + new section): CHOSEN — smallest actionable cut; mirrors slice-3 decoupling;
  reuses store-derived scoring (no re-impl/drift).
- Option C (+ per-booking drill-down table): REJECTED — surfaces per-contact PII in a PDPA vertical;
  needs new table+routing; defer to a later Ledger-agent slice.
- New field (not extending ReceiptedBookingsData): keeps the cheap 1-query count independent of the
  heavier per-booking view assembly; preserves parallel-compute; a quality failure can't kill the count.
- Consume listForCohort + aggregate in core (not a SQL aggregate): confidence/exceptions are derived
  judgments getView already computes via the pure core/receipts fns; SQL would re-implement scoring.
  N+1 acceptable: report cached 1h, pilot cohorts are tens; store join strategy is a separate concern.
- Record-keyed confidence/exceptions for compile-time enum exhaustiveness (spec uses enum scoring
  precisely to avoid NaN-blind gates).

---

## Commit 1 — Data plane + producer + transport (schemas L1 / core L3 / db L4 / api)

Adding a REQUIRED `ReportStores` key and a REQUIRED `ReportDataV1` field breaks every literal at once,
so the type + producer (period-rollup) + all literals land atomically (one green typecheck unit).

**Files:**

- Modify: `packages/schemas/src/reports/v1.ts` (import + interface + field)
- Modify: `packages/schemas/src/__tests__/reports-v1.test.ts` (sample + assertion)
- Modify: `packages/core/src/reports/interfaces.ts` (ReportStores.receiptedBookings key + import)
- Create: `packages/core/src/reports/compute-receipted-booking-quality.ts`
- Create: `packages/core/src/reports/compute-receipted-booking-quality.test.ts`
- Modify: `packages/core/src/reports/period-rollup.ts` (import + Promise.all + return)
- Modify: `packages/core/src/reports/period-rollup.test.ts` (stubStores key + assertion)
- Modify: `packages/core/src/reports/in-memory-store.test.ts` (samplePayload field)
- Modify: `packages/db/src/stores/__tests__/prisma-report-cache-store.test.ts` (sample field)
- Modify: `apps/api/src/app.ts` (import + store instance + adapter)
- Modify: `apps/api/src/__tests__/test-server.ts` (mock key)
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/fixtures.ts` (3 fixtures field)

### Steps

- [ ] **1.1 RED** — Write `compute-receipted-booking-quality.test.ts` (mkView helper; 3 cases:
      breakdown+worklist aggregation, resolved-exceptions-excluded, empty-cohort all-zeros; asserts
      listForCohort called with {orgId, from, to}). Run `pnpm --filter @switchboard/core test -- compute-receipted-booking-quality`
      → FAIL (cannot find module).
- [ ] **1.2 GREEN type** — Add to `v1.ts`: `import type { AttributionConfidence, ExceptionCode } from "../receipted-booking.js";`
  - `ReceiptedBookingQualityData` interface (cohortSize; confidence Record<AttributionConfidence,number>;
    exceptions Record<ExceptionCode,number>; bookingsNeedingAttention) + `receiptedBookingQuality:
ReceiptedBookingQualityData;` on `ReportDataV1`.
- [ ] **1.3 GREEN interface** — Add `receiptedBookings: { listForCohort(input: {orgId; from; to}):
Promise<ReceiptedBookingView[]> }` to `ReportStores`; extend the schemas import with `ReceiptedBookingView`.
- [ ] **1.4 GREEN fn** — Write `compute-receipted-booking-quality.ts` (await listForCohort; init both
      Records to 0; for each view: `confidence[v.attributionConfidence]++`, open = exceptions w/o resolvedAt,
      `bookingsNeedingAttention++` if open.length, `exceptions[e.code]++` per open). Run the unit test → PASS.
- [ ] **1.5** — Wire `period-rollup.ts`: import `computeReceiptedBookingQuality`; add `receiptedBookingQuality`
      to the Promise.all destructure + `computeReceiptedBookingQuality(ctx, deps.stores.receiptedBookings)`
      to the array + `receiptedBookingQuality` to the return object.
- [ ] **1.6** — Fix literals: `period-rollup.test.ts` stubStores `receiptedBookings: { listForCohort:
async () => [] }` + assert `result.receiptedBookingQuality` toEqual all-zeros block; `reports-v1.test.ts`
      sample field + `expect(sample.receiptedBookingQuality.cohortSize).toBe(41)`; `in-memory-store.test.ts`
  - `prisma-report-cache-store.test.ts` samplePayload all-zeros field; `fixtures.ts` 3 fixtures
    (good 41 / quiet 0 / problem 112, confidence sums == count, missing_source == unattributed).
- [ ] **1.7** — Wire `app.ts`: add `PrismaReceiptedBookingStore` to the db import; `const
receiptedBookingViewStore = new PrismaReceiptedBookingStore(prismaClient);` before reportStores;
      `receiptedBookings: { listForCohort: (input: {orgId; from; to}) =>
receiptedBookingViewStore.listForCohort(input.orgId, input.from, input.to) }` in the literal.
      Add `receiptedBookings: { listForCohort: async () => [] }` to `test-server.ts` mock.
- [ ] **1.8 VERIFY** — `pnpm --filter @switchboard/schemas --filter @switchboard/core --filter
@switchboard/db --filter @switchboard/api typecheck` + those test filters green. Commit
      `feat(reports): receipted-booking proof-quality aggregate on the owner report (data plane)`.

## Commit 2 — Dashboard proof-quality section (apps/dashboard)

**Files:**

- Modify: `apps/dashboard/src/components/results/types.ts` (re-export ReceiptedBookingQualityData)
- Modify: `apps/dashboard/src/components/results/results-model.ts` (import + field + fallback)
- Modify: `apps/dashboard/src/components/results/results-model.test.ts` (default test)
- Create: `apps/dashboard/src/components/results/receipted-booking-quality-tile.tsx`
- Create: `apps/dashboard/src/components/results/receipted-booking-quality-tile.test.tsx`
- Modify: `apps/dashboard/src/components/results/results-page.tsx` (import + render after ConsentCompletenessTile)
- Modify: `apps/dashboard/src/components/results/results.module.css` (section classes)

### Steps

- [ ] **2.1** — `types.ts`: add `ReceiptedBookingQualityData` to the re-export list.
- [ ] **2.2** — `results-model.ts`: import `ReceiptedBookingQualityData`; add to `ResultsModel`;
      in `buildResultsModel` add `receiptedBookingQuality: data.receiptedBookingQuality ?? { cohortSize: 0,
confidence: {deterministic:0,high:0,medium:0,low:0,unattributed:0}, exceptions:
{missing_source:0,missing_consent:0,manual_override:0,duplicate_contact_risk:0}, bookingsNeedingAttention: 0 }`.
- [ ] **2.3 RED** — Write `receipted-booking-quality-tile.test.tsx` (buildResultsModel(goodFixture) →
      render → assert "strongly attributed" lead count, a rung count, and a worklist count;
      buildResultsModel(quietFixture) → render → assert the empty-state prose). Run
      `pnpm --filter @switchboard/dashboard test -- receipted-booking-quality-tile` → FAIL (no module).
- [ ] **2.4 GREEN** — Write `receipted-booking-quality-tile.tsx`: eyebrow "Proof quality"; when
      cohortSize === 0 a quiet prose empty-state; else lead `{deterministic+high} of {cohortSize} strongly
attributed`, then 5 confidence rungs (label + count + amber proportion bar via inline width), then a
      worklist (`{bookingsNeedingAttention} need attention` + non-zero exception-code lines, or an
      all-clear line when 0). No em-dashes in prose. Run the tile test → PASS.
- [ ] **2.5** — `results-model.test.ts`: add "defaults receiptedBookingQuality ... when absent" test.
- [ ] **2.6** — `results.module.css`: add `.proofQuality*` classes mirroring the tile/funnel idiom
      (mono eyebrow, mono tabular nums, amber `hsl(var(--action))` bar, quiet captions; reuse tokens, no :root).
- [ ] **2.7** — `results-page.tsx`: import `ReceiptedBookingQualityTile`; render
      `{!showNoMeta && <ReceiptedBookingQualityTile model={model} />}` right after `<ConsentCompletenessTile/>`.
- [ ] **2.8 VERIFY** — `pnpm --filter @switchboard/dashboard test` green + `pnpm --filter dashboard build`
      (next build) green + `.tsx` prettier pass. Commit
      `feat(dashboard): proof-quality section on the owner report (receipted-booking consumer)`.

## Final gate suite (build-loop VERIFY)

typecheck; `pnpm test`; `pnpm --filter @switchboard/dashboard test`; lint; format:check; arch:check;
`CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm --filter dashboard build`; security (`pnpm audit
--audit-level=high`). Then independent fresh-context review (diff + criteria + lessons only).
