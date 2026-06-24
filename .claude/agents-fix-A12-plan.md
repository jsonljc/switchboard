# A12 — Riley count-vs-value reallocation gate — Implementation Plan

> **For agentic workers:** TDD, one step at a time, RED before GREEN. Steps use `- [ ]`. This plan is `.claude/` scratch (uncommitted); it is NOT a docs/ spec.

**Goal:** Gate Riley's executable `scale` -> reallocate money-move on PROVEN paid value (verified-purchase ConversionRecord value attributed to the campaign) so a cheap-cost-per-LEAD campaign whose leads never pay does NOT auto-scale; fail-closed on absent/non-finite/zero paid value.

**Architecture:** A new `queryPaidValueCentsByCampaign` (db; the paid sibling of the booked-value query, `type:"purchased"`) feeds a per-campaign paid value into `decideForCampaign` (ad-optimizer) via an optional `paidValueGate` input + a new `PaidValueByCampaignProvider` port wired in apps/api. When the gate is active and the campaign lacks finite positive paid value, the `scale` rec is demoted to a `scale_unproven_paid_value` watch (mirrors the existing `measurement_untrusted` demotion) BEFORE it can become a reallocation candidate. The eval drives the gate through the REAL `decideForCampaign` seam.

**Tech Stack:** TypeScript monorepo (pnpm/turbo), Prisma (mocked in db tests), Vitest, the riley-recommendation eval harness.

## Global Constraints (verbatim, every task)

- ESM only, `.js` extensions in relative imports. No `console.log`. No `any`. No em-dashes anywhere (copy/comments/messages).
- Prettier: semi, double quotes, 2-space, trailing commas, 100 width. Conventional Commits, lowercase subject.
- Co-located `*.test.ts`. Run `pnpm --filter X exec tsc --noEmit` per touched pkg before EVERY commit (pre-commit = eslint+prettier only). Rebuild each lower pkg's dist (`pnpm --filter X build`) after its task so consumers (api/chat tsc + the eval, which consume DIST) see new types.
- NO schema change (ConversionRecord already has type/value/origin/sourceCampaignId + indexes). NO migration. The store method is a READ (groupBy), not a mutation.
- Fail-closed is load-bearing: a null / non-finite (NaN/Infinity) / zero / negative paid value must FAIL the floor. Number.isFinite-guard ([[feedback_nan_blind_comparison_gates]]). Never fabricate a pass on missing data.
- baseline_sha: d5dcbaa5e (= origin/main HEAD at PLAN).

## File Structure

- `packages/db/src/stores/prisma-conversion-record-store.ts` — ADD `queryPaidValueCentsByCampaign` (paid sibling of booked).
- `packages/ad-optimizer/src/recommendation-watches.ts` — ADD pure `scaleValueFloorMet` + `scaleUnprovenPaidValueWatch`.
- `packages/ad-optimizer/src/campaign-decision.ts` — ADD `CampaignDecisionInput.paidValueGate?` + the demotion in `decideForCampaign`.
- `packages/ad-optimizer/src/audit-runner.ts` — ADD `PaidValueByCampaignProvider` port + resolve the per-campaign paid-value Map + thread `paidValueGate` into each `decideForCampaign` call.
- `packages/ad-optimizer/src/index.ts` — export the new port type.
- `apps/api/src/bootstrap/inngest.ts` — wire the existing `PrismaConversionRecordStore` instance as `paidValueByCampaignProvider`.
- `evals/riley-recommendation/schema.ts` + `decide.ts` + `fixtures/scale-paid-value-gate.jsonl` + `README.md` — the engine-seam proof.
- `docs/runbooks/riley-reallocation-go-live.md` — the paid-value-attribution flag-flip precondition (honest producer-population).

---

### Task A: pure paid-value floor + watch constructor (ad-optimizer leaf)

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-watches.ts`
- Test: `packages/ad-optimizer/src/__tests__/recommendation-watches.test.ts` (create or extend)

**Interfaces:**

- Produces: `scaleValueFloorMet(gate: { paidValueCents: number | null }): boolean` (true iff finite positive paid value); `scaleUnprovenPaidValueWatch(base: { campaignId: string; campaignName: string }): WatchOutput` (pattern `scale_unproven_paid_value`, `checkBackDate: ""` for the caller to fill).

- [ ] **Step 1: Write failing tests** (append to the test file; create it mirroring an existing ad-optimizer test if absent)

```ts
import { describe, it, expect } from "vitest";
import { scaleValueFloorMet, scaleUnprovenPaidValueWatch } from "../recommendation-watches.js";

describe("scaleValueFloorMet (A12 count-vs-value floor, fail-closed)", () => {
  it("passes only on finite positive paid value", () => {
    expect(scaleValueFloorMet({ paidValueCents: 50000 })).toBe(true);
    expect(scaleValueFloorMet({ paidValueCents: 1 })).toBe(true);
  });
  it("fails closed on null / zero / negative", () => {
    expect(scaleValueFloorMet({ paidValueCents: null })).toBe(false);
    expect(scaleValueFloorMet({ paidValueCents: 0 })).toBe(false);
    expect(scaleValueFloorMet({ paidValueCents: -100 })).toBe(false);
  });
  it("fails closed on non-finite (NaN / Infinity)", () => {
    expect(scaleValueFloorMet({ paidValueCents: Number.NaN })).toBe(false);
    expect(scaleValueFloorMet({ paidValueCents: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("scaleUnprovenPaidValueWatch", () => {
  it("builds a scale_unproven_paid_value watch with a blank checkBackDate", () => {
    const w = scaleUnprovenPaidValueWatch({ campaignId: "c1", campaignName: "C1" });
    expect(w.type).toBe("watch");
    expect(w.pattern).toBe("scale_unproven_paid_value");
    expect(w.campaignId).toBe("c1");
    expect(w.checkBackDate).toBe("");
    expect(w.message).not.toContain("—"); // no em-dash
  });
});
```

- [ ] **Step 2: Run, verify RED**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/recommendation-watches.test.ts`
Expected: FAIL ("scaleValueFloorMet is not a function" / not exported).

- [ ] **Step 3: Implement** (append to `recommendation-watches.ts`)

```ts
/**
 * A12 (count-vs-value gate): the paid-value floor for a `scale` -> reallocate money-move.
 * A `scale` rec may flow to the reallocation dispatch ONLY when the campaign has finite,
 * positive, campaign-attributed VERIFIED-PAID value. Fail-closed: null (no attributed paid
 * value), non-finite (NaN/Infinity from a poisoned sum), zero, or negative all return false,
 * so a cheap-cost-per-lead campaign whose leads never pay is held, never auto-scaled. Pure;
 * Number.isFinite-guarded before any comparison ([[feedback_nan_blind_comparison_gates]]).
 */
export function scaleValueFloorMet(gate: { paidValueCents: number | null }): boolean {
  const v = gate.paidValueCents;
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Watch surfaced when a `scale` rec is demoted by the paid-value floor: the campaign's cost
 * per lead is under target, but no verified-paid revenue is attributed to it yet, so a budget
 * increase is not justified on lead count alone. Visible + recoverable (graduates to a real
 * scale money-move once paid receipts populate). `checkBackDate` is filled by the caller
 * (campaign-decision.ts) from `input.nextCycleDate`, like the other watches.
 */
export function scaleUnprovenPaidValueWatch(base: WatchBase): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "scale_unproven_paid_value",
    message:
      "Holding a budget increase: cost per lead is under target, but no verified-paid revenue is attributed to this campaign yet, so scaling is not justified on lead count alone. Re-checking next cycle as paid receipts populate.",
    checkBackDate: "",
  };
}
```

- [ ] **Step 4: Run, verify GREEN.** Run the same vitest command. Expected: PASS.
- [ ] **Step 5: tsc + build + commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit` (expect clean), then `pnpm --filter @switchboard/ad-optimizer build`.

```bash
git add packages/ad-optimizer/src/recommendation-watches.ts packages/ad-optimizer/src/__tests__/recommendation-watches.test.ts
git commit -m "feat(riley): paid-value floor + scale_unproven_paid_value watch (A12)"
```

---

### Task B: wire the floor into decideForCampaign (the engine gate)

**Files:**

- Modify: `packages/ad-optimizer/src/campaign-decision.ts` (add `paidValueGate?` to `CampaignDecisionInput` ~after :105; add the demotion in `decideForCampaign` after the measurement_untrusted block, currently :238)
- Test: `packages/ad-optimizer/src/__tests__/campaign-decision.test.ts` (create or extend)

**Interfaces:**

- Consumes (Task A): `scaleValueFloorMet`, `scaleUnprovenPaidValueWatch`.
- Produces: `CampaignDecisionInput.paidValueGate?: { paidValueCents: number | null }` (presence activates the floor; absent => no gate, back-compat).

- [ ] **Step 1: Write failing tests** (a cheap-cpa case that produces `scale` absent the gate, then the gated variants). Mirror the eval's metric shape: `cpa = spend/conversions < 0.8*targetCPA` AND `roas = revenue/spend < targetROAS` (so isPerformingWell is false and the early insight return is skipped); `periodsAboveTarget:0`, identical previous (no diagnoses), `learningState success`.

```ts
import { describe, it, expect } from "vitest";
import { decideForCampaign, type CampaignDecisionInput } from "../campaign-decision.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

function insight(over: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 40000,
    inlineLinkClicks: 800,
    spend: 2000,
    conversions: 40,
    revenue: 0,
    frequency: 1.5,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  };
}
function baseInput(over: Partial<CampaignDecisionInput> = {}): CampaignDecisionInput {
  const cur = insight();
  return {
    campaignId: "c1",
    campaignName: "C1",
    currentInsight: cur,
    previousInsight: insight(),
    targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
    learningStatus: {
      state: "success",
      reason: "",
      checkedAt: "2026-05-07",
    } as CampaignDecisionInput["learningStatus"],
    economicTier: "booked_cac",
    effectiveTarget: 100,
    revenueState: {
      measurementTrusted: true,
      marginBasis: "unavailable",
    } as CampaignDecisionInput["revenueState"],
    targetROAS: 3,
    nextCycleDate: "2026-05-14",
    learningPhaseActive: false,
    ...over,
  };
}

describe("decideForCampaign A12 count-vs-value gate", () => {
  it("emits scale with NO paidValueGate (gate opt-in, back-compat)", () => {
    const r = decideForCampaign(baseInput());
    expect(r.recommendations.map((x) => x.action)).toContain("scale");
  });
  it("demotes scale to a watch when paid value is absent (fail-closed)", () => {
    const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents: null } }));
    expect(r.recommendations.map((x) => x.action)).not.toContain("scale");
    expect(r.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
    expect(r.watches.find((w) => w.pattern === "scale_unproven_paid_value")?.checkBackDate).toBe(
      "2026-05-14",
    );
  });
  it("demotes scale on zero and on NaN paid value (fail-closed)", () => {
    for (const paidValueCents of [0, Number.NaN]) {
      const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents } }));
      expect(r.recommendations.map((x) => x.action)).not.toContain("scale");
      expect(r.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
    }
  });
  it("lets scale flow when paid value is proven (finite positive)", () => {
    const r = decideForCampaign(baseInput({ paidValueGate: { paidValueCents: 50000 } }));
    expect(r.recommendations.map((x) => x.action)).toContain("scale");
    expect(r.watches.map((w) => w.pattern)).not.toContain("scale_unproven_paid_value");
  });
});
```

- [ ] **Step 2: Run, verify RED.** Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/campaign-decision.test.ts`. Expected: FAIL — `paidValueGate` not a known property (tsc) and/or the gated cases still return scale. (If the first test "emits scale with NO gate" also fails, the base metrics do not trigger the scale rule; adjust spend/conversions/targets until the no-gate case yields scale BEFORE proceeding — this is the control that proves the gate is what changes behavior.)

- [ ] **Step 3a: Add the input field** to `CampaignDecisionInput` (after the `outcomeMultiplierByKind?` field):

```ts
  /**
   * A12 (count-vs-value gate): the campaign's verified-paid value for the window. PRESENCE of
   * this object activates the floor on the `scale` -> reallocate money-move (the live audit-runner
   * passes it whenever the paid-value provider is wired); absent => no gate (back-compat with every
   * existing caller and the eval). `paidValueCents` is the campaign's type="purchased" ConversionRecord
   * value sum (cents) for the window, or null when none is attributed. A null / non-finite / zero value
   * FAILS the floor (fail-closed) and demotes the `scale` rec to a `scale_unproven_paid_value` watch.
   * Never fabricates a pass on missing data.
   */
  paidValueGate?: { paidValueCents: number | null };
```

- [ ] **Step 3b: Add the import** at the top of `campaign-decision.ts`:

```ts
import { scaleValueFloorMet, scaleUnprovenPaidValueWatch } from "./recommendation-watches.js";
```

- [ ] **Step 3c: Add the demotion** in the `for (const item of campaignRecs)` loop, immediately AFTER the measurement_untrusted block (after the `}` that closes `if (input.revenueState.measurementTrusted === false && ...) { ... continue; }`, currently line 238) and BEFORE `const tiered = applyTier(...)`:

```ts
// A12 (count-vs-value gate): a `scale` rec is the executable budget-increase money-move
// (scale -> reallocate). Require PROVEN paid value before it can flow: a cheap cost-per-LEAD
// campaign whose leads never PAY must not auto-scale. Fail-closed -- when the gate is active
// (the live audit-runner passes paidValueGate whenever the paid-value provider is wired) and
// this campaign has no finite positive attributed paid value, demote to a visible, recoverable
// `scale_unproven_paid_value` watch (it graduates to a real money-move once paid receipts
// populate). This is the EARLIEST point in the scale -> reallocate transition; `scale` is
// produced ONLY by generateRecommendations (recommendation-engine.ts) and the dispatch
// hard-abstains unless actionType==="scale" (riley-budget-dispatch.ts), so the rec never
// becomes a reallocation candidate -- the account-level recs appended later in the audit
// (expand_targeting/consolidate/review_budget, shift_budget_to_source, fix_signal_health) are
// never `scale`. Placed AFTER the measurement_untrusted block on purpose: scale is costDriven,
// so an untrusted denominator (a stronger hold) already demotes it there and short-circuits
// this. Gate absent (undefined) => no demotion (back-compat). Mirrors the measurement_untrusted
// demotion above.
if (item.action === "scale" && input.paidValueGate && !scaleValueFloorMet(input.paidValueGate)) {
  watches.push({
    ...scaleUnprovenPaidValueWatch({
      campaignId: item.campaignId,
      campaignName: item.campaignName,
    }),
    checkBackDate: input.nextCycleDate,
  });
  continue;
}
```

- [ ] **Step 4: Run, verify GREEN.** Same vitest command. Expected: PASS (all four cases).
- [ ] **Step 5: tsc + build + commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`, then `pnpm --filter @switchboard/ad-optimizer build` (so the eval/dist consumers see `paidValueGate`).

```bash
git add packages/ad-optimizer/src/campaign-decision.ts packages/ad-optimizer/src/__tests__/campaign-decision.test.ts
git commit -m "feat(riley): demote scale to a watch when paid value is unproven (A12)"
```

---

### Task C: prove the gate through the REAL eval seam

**Files:**

- Modify: `evals/riley-recommendation/schema.ts` (add optional `paidValueGate`), `evals/riley-recommendation/decide.ts` (thread it + add to the `RileyDecisionInputCase` Pick), `evals/riley-recommendation/README.md` (coverage row)
- Create: `evals/riley-recommendation/fixtures/scale-paid-value-gate.jsonl`

**Interfaces:**

- Consumes (Task B): `CampaignDecisionInput.paidValueGate` (via the ad-optimizer dist built in Task B Step 5).

- [ ] **Step 1: Add the fixtures** (`fixtures/scale-paid-value-gate.jsonl`). Same cheap-cpa metrics; the control has no gate, then unpaid -> watch, paid -> scale, zero -> watch:

```
# A12 count-vs-value gate, driven through the REAL decideForCampaign seam. Base metrics: cpa=2000/40=50 < 0.8*100=80 (scale rule) and roas=0/2000=0 < targetROAS 3 (isPerformingWell false -> no early insight). periodsAboveTarget 0, identical previous (no diagnoses), success learning -> the ONLY rec is scale. The paidValueGate is the single variable.
{"id":"scale-control-no-paid-gate","current":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"previous":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"targetBreach":{"periodsAboveTarget":0,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"scale","expectedActions":["scale"],"notes":"control: no paidValueGate -> gate inactive (back-compat) -> scale flows. Proves the scale rule fires so the gated cases below isolate the gate."}
{"id":"scale-unpaid-demotes-to-watch","current":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"previous":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"targetBreach":{"periodsAboveTarget":0,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"paidValueGate":{"paidValueCents":null},"expectedOutcome":"watch","expectedWatchPatterns":["scale_unproven_paid_value"],"notes":"fail-closed: cheap CPA but NO attributed paid value -> scale demoted to a watch, NOT a money-move."}
{"id":"scale-zero-paid-demotes-to-watch","current":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"previous":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"targetBreach":{"periodsAboveTarget":0,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"paidValueGate":{"paidValueCents":0},"expectedOutcome":"watch","expectedWatchPatterns":["scale_unproven_paid_value"],"notes":"fail-closed on zero paid value."}
{"id":"scale-paid-flows","current":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"previous":{"impressions":40000,"inlineLinkClicks":800,"spend":2000,"conversions":40,"revenue":0,"frequency":1.5},"targetBreach":{"periodsAboveTarget":0,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"paidValueGate":{"paidValueCents":50000},"expectedOutcome":"scale","expectedActions":["scale"],"notes":"proven paid value ($500) -> the floor passes -> scale flows. Proves the gate is not a blanket block."}
```

- [ ] **Step 2: Run, verify RED.** Run: `pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley`. Expected: FAIL on `scale-unpaid-demotes-to-watch` / `scale-zero-paid-demotes-to-watch` (got `scale`, expected `watch`) because `decide.ts` does not yet thread `paidValueGate` into `decideForCampaign`. NOTE (do NOT "fix" this as a bug): `RileyCaseSchema` is a default `z.object` which STRIPS unknown keys (it does not `.strict()`-reject), so the fixture LOADS fine with `paidValueGate` silently dropped, and the gate-less decision yields `scale` -> the assertion fails. This RED proves the harness must actually feed the gate (not a self-signing oracle).

- [ ] **Step 3a: schema.ts** — add the optional field (after `outcomeHistory`):

```ts
  /** A12: optional count-vs-value gate input. When present, the harness passes it into
   * decideForCampaign exactly as the live audit-runner does (built only when the paid-value
   * provider is wired), proving the gate end-to-end through the REAL engine. `paidValueCents`
   * is the campaign's verified-paid (type="purchased") value for the window (cents), or null when
   * none is attributed; a null / non-finite / zero value fails the floor and demotes a `scale` rec
   * to a `scale_unproven_paid_value` watch (fail-closed). */
  paidValueGate: z.object({ paidValueCents: z.number().nullable() }).optional(),
```

- [ ] **Step 3b: decide.ts** — TWO co-required edits (the `decideForCampaign({...})` call lives inside `decideRawForCase`, decide.ts:171; without the Pick edit, `c.paidValueGate` is a tsc error "Property 'paidValueGate' does not exist on type 'RileyDecisionInputCase'"):
      (i) Add `"paidValueGate"` to the `RileyDecisionInputCase = Pick<RileyCase, ...>` union (decide.ts:97-110), so the field is type-visible on `c`.
      (ii) Add the spread into the `decideForCampaign({ ... })` call in `decideRawForCase`, next to the existing `...(outcomeMultiplierByKind ? ...)` conditional (decide.ts:~195):

```ts
    ...(c.paidValueGate ? { paidValueGate: c.paidValueGate } : {}),
```

(`arbitration-eval.ts:138` also calls `decideRawForCase` but builds its own input that never carries `paidValueGate`, so it is unaffected.)

- [ ] **Step 4: Run, verify GREEN.** Run: `pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley`. Expected: PASS (all fixtures incl the 4 new). Confirm the pre-existing count still passes (existing fixtures carry no `paidValueGate` => unchanged).

- [ ] **Step 5: README coverage row + commit.** Add a row to the coverage table in `evals/riley-recommendation/README.md` for `scale-paid-value-gate.jsonl` (A12: scale demotes to `scale_unproven_paid_value` when paid value is absent/zero, flows when proven).

Run: `pnpm format:check` (the .jsonl + .ts).

```bash
git add evals/riley-recommendation/schema.ts evals/riley-recommendation/decide.ts evals/riley-recommendation/fixtures/scale-paid-value-gate.jsonl evals/riley-recommendation/README.md
git commit -m "test(riley): eval fixtures pin the A12 paid-value gate via the real seam"
```

---

### Task D: paid-value store query (db)

**Files:**

- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts` (add `queryPaidValueCentsByCampaign` after `queryBookedValueCentsByCampaign`, ~:254)
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` (extend; MOCKED Prisma)

**Interfaces:**

- Produces: `PrismaConversionRecordStore.queryPaidValueCentsByCampaign(query: { orgId: string; from: Date; to: Date; campaignIds?: string[] }): Promise<Map<string, number>>`.

- [ ] **Step 1: Write failing test** (mirror the existing booked-value store test; assert the `type:"purchased"` filter + the per-campaign sum from a realistic verified-payment row shape):

```ts
it("queryPaidValueCentsByCampaign sums type=purchased value per campaign (paid sibling)", async () => {
  const groupBy = vi.fn().mockResolvedValue([
    { sourceCampaignId: "camp_1", _sum: { value: 50000 } },
    { sourceCampaignId: "camp_2", _sum: { value: 0 } },
    { sourceCampaignId: null, _sum: { value: 9999 } },
  ]);
  const store = new PrismaConversionRecordStore({ conversionRecord: { groupBy } } as never);
  const out = await store.queryPaidValueCentsByCampaign({
    orgId: "org_1",
    from: new Date("2026-05-01"),
    to: new Date("2026-05-07"),
    campaignIds: ["camp_1", "camp_2"],
  });
  expect(groupBy).toHaveBeenCalledWith(
    expect.objectContaining({
      by: ["sourceCampaignId"],
      where: expect.objectContaining({
        organizationId: "org_1",
        type: "purchased",
        origin: "live",
        value: { gt: 0 },
        sourceCampaignId: { in: ["camp_1", "camp_2"] },
      }),
      _sum: { value: true },
    }),
  );
  expect(out.get("camp_1")).toBe(50000); // proven paid value
  expect(out.has("camp_2")).toBe(false); // zero sum excluded (fail-closed absence)
  expect(out.has("")).toBe(false); // null campaign dropped
});
```

(Confirm the constructor + import shape against the existing booked-value test in the same file; reuse its `PrismaConversionRecordStore` construction idiom verbatim.)

- [ ] **Step 2: Run, verify RED.** Run: `pnpm --filter @switchboard/db exec vitest run src/stores/__tests__/prisma-conversion-record-store.test.ts`. Expected: FAIL (method not defined).

- [ ] **Step 3: Implement** (add after `queryBookedValueCentsByCampaign`):

```ts
  /**
   * Per-campaign sum of VERIFIED-PAID conversion value for the window, in MINOR units
   * (cents). The paid sibling of queryBookedValueCentsByCampaign: identical filters except
   * `type:"purchased"` (a verified-payment ConversionRecord written by the record-verified-payment
   * / revenue operator intents, carrying the real paid amount + sourceCampaignId) instead of
   * "booked" (expected value at issuance). A campaign with no valued purchased record is ABSENT
   * from the map (the caller reads absence as "no proven paid value" => the A12 count-vs-value floor
   * fails closed), never a fabricated 0.
   */
  async queryPaidValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId"],
      where: {
        organizationId: query.orgId,
        type: "purchased",
        origin: "live",
        value: { gt: 0 },
        occurredAt: { gte: query.from, lte: query.to },
        sourceCampaignId: query.campaignIds ? { in: query.campaignIds } : { not: null },
      },
      _sum: { value: true },
    });

    const result = new Map<string, number>();
    for (const row of rows as Array<{
      sourceCampaignId: string | null;
      _sum: { value: number | null };
    }>) {
      const sum = row._sum.value ?? 0;
      if (row.sourceCampaignId && sum > 0) result.set(row.sourceCampaignId, sum);
    }
    return result;
  }
```

- [ ] **Step 4: Run, verify GREEN.** Same vitest command. Expected: PASS.
- [ ] **Step 5: tsc + build + commit**

Run: `pnpm --filter @switchboard/db exec tsc --noEmit`, then `pnpm --filter @switchboard/db build`.

```bash
git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "feat(db): per-campaign verified-paid value query (A12 paid sibling)"
```

---

### Task E: PaidValueByCampaignProvider port + audit-runner threading

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts` (declare the port ~after the `BookedValueByCampaignProvider` interface :151-158; add the dep + private field + constructor assignment mirroring `bookedValueByCampaignProvider`; resolve the Map before the per-campaign loop; thread `paidValueGate` into each `decideForCampaign` call ~:634-660)
- Modify: `packages/ad-optimizer/src/index.ts` (export `PaidValueByCampaignProvider`)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-*.test.ts` (extend an existing audit-runner test, or a focused new one, that constructs AuditRunner WITH a fake paid-value provider)

**Interfaces:**

- Consumes (Task B): `CampaignDecisionInput.paidValueGate`. Consumes (Task D, structurally): `queryPaidValueCentsByCampaign`.
- Produces: `PaidValueByCampaignProvider` (port) + `AuditRunnerDeps.paidValueByCampaignProvider?`.

- [ ] **Step 1: Write failing test** — drive a full audit with a cheap-cpa campaign and a fake paid-value provider; provider present + campaign has no paid value => the scale rec is demoted to a `scale_unproven_paid_value` watch; provider present + paid value > 0 => scale flows. Assert against `report.recommendations` / `report.watches`.

  IMPORTANT (review-flagged): NO existing audit-runner test produces a `scale` rec through the full `run()` (they all drive `periodsAboveTarget: 9` and assert `pause`). So you must BUILD the scale scenario, not copy one. Read `packages/ad-optimizer/src/__tests__/audit-runner-percampaign-target.test.ts` for its mock-deps/insight builder, then adapt the knobs so the campaign produces EXACTLY `scale`: `getTargetBreachStatus -> { periodsAboveTarget: 0, granularity: "daily" }`; one insight with cpa = spend/conversions < 0.8 \* effectiveTarget (e.g. spend 2000, conversions 40, target 100 -> cpa 50) and revenue 0 (roas 0 < targetROAS so isPerformingWell is false -> no early insight, no scale-suppressing diagnosis); identical previous insight (no diagnoses); `learningState success`. Confirm the RESOLVED economic tier passes scale through applyTier (booked_cac and the account fallback both do, per the CODE-GROUNDED grade). The FIRST assertion is the CONTROL: with NO paid provider, `run()` yields `scale` — this proves the scenario fires and that any tier/diagnosis subtlety is handled BEFORE the gate assertions. Only then add the paid provider for the two gate cases.

```ts
// sketch — adapt to the existing audit-runner test harness in the chosen file
it("A12: demotes a cheap-cpa scale to a watch when the paid-value provider reports no paid value", async () => {
  const paidValueByCampaignProvider = {
    queryPaidValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
  };
  const runner = makeRunnerWithCheapCpaScaleCampaign({ paidValueByCampaignProvider });
  const report = await runner.run();
  expect(report.recommendations.map((r) => r.action)).not.toContain("scale");
  expect(report.watches.map((w) => w.pattern)).toContain("scale_unproven_paid_value");
  expect(paidValueByCampaignProvider.queryPaidValueCentsByCampaign).toHaveBeenCalledWith(
    expect.objectContaining({ orgId: expect.any(String), campaignIds: expect.any(Array) }),
  );
});
it("A12: lets the scale flow when the provider reports proven paid value", async () => {
  const paidValueByCampaignProvider = {
    queryPaidValueCentsByCampaign: vi.fn().mockResolvedValue(new Map([["camp_1", 50000]])),
  };
  const report = await makeRunnerWithCheapCpaScaleCampaign({ paidValueByCampaignProvider }).run();
  expect(report.recommendations.map((r) => r.action)).toContain("scale");
});
```

- [ ] **Step 2: Run, verify RED.** Run the chosen audit-runner test file with vitest. Expected: FAIL (the dep is not accepted / the scale is not demoted).

- [ ] **Step 3a: Declare the port** after `BookedValueByCampaignProvider`:

```ts
/**
 * A12: per-campaign VERIFIED-PAID value provider (the paid sibling of BookedValueByCampaignProvider).
 * Implemented by the same PrismaConversionRecordStore. An absent campaign means "no proven paid value"
 * (=> the count-vs-value floor in decideForCampaign fails closed and the `scale` rec is held).
 */
export interface PaidValueByCampaignProvider {
  queryPaidValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>>;
}
```

- [ ] **Step 3b: Add the dep + field + assignment** mirroring `bookedValueByCampaignProvider` (in the deps interface ~:215, the private field ~:314, the constructor ~:333):

```ts
  // deps interface:
  paidValueByCampaignProvider?: PaidValueByCampaignProvider;
  // private field:
  private readonly paidValueByCampaignProvider?: PaidValueByCampaignProvider;
  // constructor:
  this.paidValueByCampaignProvider = deps.paidValueByCampaignProvider;
```

- [ ] **Step 3c: Resolve the Map** immediately before the `for (const insight of currentInsights)` loop (after `const prefetched = await this.prefetchAndIndexAccountRows(dateRange);`):

```ts
// A12: resolve per-campaign VERIFIED-PAID value ONCE (only when the provider is wired) so each
// per-campaign decision can gate the scale -> reallocate money-move on PROVEN paid value. Provider
// absent (legacy / analysis-only fake providers) => undefined => no gate (back-compat). When wired,
// EVERY campaign gets a paidValueGate, so a cheap-cpa campaign with no attributed paid value is
// held, not scaled (fail-closed).
const paidValueByCampaign = this.paidValueByCampaignProvider
  ? await this.paidValueByCampaignProvider.queryPaidValueCentsByCampaign({
      orgId: this.config.orgId,
      from: new Date(dateRange.since),
      to: new Date(dateRange.until),
      campaignIds: currentInsights.map((i) => i.campaignId),
    })
  : undefined;
```

- [ ] **Step 3d: Thread `paidValueGate`** into the `decideForCampaign({ ... })` call (alongside the existing spread-conditionals at ~:652-659):

```ts
        // A12: forward this campaign's verified-paid value as the count-vs-value gate (only when the
        // provider is wired; absent => no gate). null when no paid value is attributed => fail-closed.
        ...(paidValueByCampaign
          ? { paidValueGate: { paidValueCents: paidValueByCampaign.get(insight.campaignId) ?? null } }
          : {}),
```

- [ ] **Step 3e: Export the port** from `packages/ad-optimizer/src/index.ts` (next to `BookedValueByCampaignProvider`):

```ts
  PaidValueByCampaignProvider,
```

- [ ] **Step 4: Run, verify GREEN.** Run the chosen audit-runner test file. Expected: PASS. Also run the FULL ad-optimizer suite (`pnpm --filter @switchboard/ad-optimizer test`) to confirm no existing audit-runner test regressed (existing tests pass no paid provider => no gate => unchanged).
- [ ] **Step 5: tsc + build + commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`, then `pnpm --filter @switchboard/ad-optimizer build`.

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/index.ts packages/ad-optimizer/src/__tests__/
git commit -m "feat(riley): thread per-campaign paid value into the audit decision (A12)"
```

---

### Task F: wire the concrete provider in apps/api

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` (add `paidValueByCampaignProvider: bookedValueByCampaignStore` next to the existing `bookedValueByCampaignProvider:` dep ~:554)
- Test: extend the closest existing inngest/bootstrap test that asserts the AuditRunner deps, OR a focused unit assertion that the store instance implements `queryPaidValueCentsByCampaign` and is passed.

**Interfaces:**

- Consumes (Task D): `PrismaConversionRecordStore.queryPaidValueCentsByCampaign`. Consumes (Task E): the port.

- [ ] **Step 1: Write the failing test.** NOTE (review-flagged): `registerInngest` has NO existing unit test, so there is no bootstrap test to extend. Use the structural-satisfaction proof: a focused test asserting `new PrismaConversionRecordStore(fakePrisma).queryPaidValueCentsByCampaign` is a function (i.e. the store instance wired at inngest.ts really implements the `PaidValueByCampaignProvider` port). The REAL consumer gate for this task is `pnpm --filter api exec tsc --noEmit` + `pnpm --filter api test` (Step 4) — they catch a wiring/type break. Do NOT invent a brittle bootstrap-internals test.

```ts
import { describe, it, expect } from "vitest";
import { PrismaConversionRecordStore } from "@switchboard/db";

describe("PrismaConversionRecordStore satisfies PaidValueByCampaignProvider (A12 wiring)", () => {
  it("exposes queryPaidValueCentsByCampaign so inngest can wire it as the paid-value provider", () => {
    const store = new PrismaConversionRecordStore({} as never);
    expect(typeof store.queryPaidValueCentsByCampaign).toBe("function");
  });
});
```

- [ ] **Step 2: Run, verify RED** (before Task D's method lands this is red; after Task D it is green — so if Task D is already merged, the RED here is the inngest type error instead). Run the focused test + `pnpm --filter api exec tsc --noEmit` WITHOUT the wiring line present. Expected: the structural test passes (method exists from Task D) but `pnpm --filter api test` / tsc is unaffected until you ADD the dep; the meaningful RED is: omit Step 3, confirm the audit is NOT passed a paid provider (grep inngest.ts shows only `bookedValueByCampaignProvider`).

- [ ] **Step 3: Wire it** at the AuditRunner construction in inngest.ts:

```ts
    bookedValueByCampaignProvider: bookedValueByCampaignStore,
    // A12: the SAME store instance implements the paid sibling; wiring it makes the count-vs-value
    // floor LIVE (a scale only flows for a campaign with finite positive verified-paid value).
    paidValueByCampaignProvider: bookedValueByCampaignStore,
```

- [ ] **Step 4: Run, verify GREEN** + `pnpm --filter api exec tsc --noEmit` + `pnpm --filter api test` (the consumer-package gate). Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts apps/api/src/bootstrap/__tests__/
git commit -m "feat(api): wire the live paid-value provider into the Riley audit (A12)"
```

---

### Task G: honest producer-population + flag-flip precondition (docs)

**Files:**

- Modify: `docs/runbooks/riley-reallocation-go-live.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Add a section** to the go-live runbook recording the A12 gate + its data dependency (honest producer-population, [[feedback_safety_gate_needs_producer_population]]):

```markdown
## Count-vs-value gate (A12) and the paid-value data dependency

Riley's `scale` -> reallocate money-move is gated on PROVEN paid value: a `scale` rec only becomes a
reallocation candidate when the campaign has finite, positive, campaign-attributed verified-paid value
(`type:"purchased"` ConversionRecord value, summed per campaign). When paid value is absent, non-finite,
or zero, the rec is demoted to a `scale_unproven_paid_value` watch (fail-closed; it surfaces and recovers
as receipts populate). The advisory is never silently dropped.

Paid value is produced ONLY by verified payments that carry campaign attribution (the
`record-verified-payment` / revenue operator intents write `type:"purchased"` ConversionRecords with the
real paid amount and `sourceCampaignId`; the record-store defaults `origin` to `"live"`, which the floor
query requires, so a future producer writing `origin:"seed"`/`"demo"` would correctly NOT satisfy the
floor). Until an org records campaign-attributed verified payments,
every `scale` for that org surfaces as a `scale_unproven_paid_value` watch rather than a budget-increase
money-move. This is the intended fail-closed default, not a bug.

Flag-flip precondition: before flipping `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`, confirm on a real org
that (a) the paid-value provider is wired (it is, in `apps/api/src/bootstrap/inngest.ts`), and (b) verified
payments are being recorded WITH `sourceCampaignId` so the floor has data to pass on a genuinely-paying
campaign. Without (b) the floor abstains by holding every scale as a watch (safe, but the reallocation
feature stays dark). A6 (honest blast-radius contract + cap telemetry) and A12 (this gate) are the two
prerequisites for the flag-flip.
```

- [ ] **Step 2: Verify + format + commit.** Run `pnpm format:check` on the doc (or `prettier --check`). Read the file back to confirm no em-dashes and the section reads cleanly.

```bash
git add docs/runbooks/riley-reallocation-go-live.md
git commit -m "docs(riley): record the A12 paid-value gate flag-flip precondition"
```

---

## Self-Review (run after writing; fix inline)

- Spec coverage: gate placement (Task B), fail-closed/NaN (Tasks A,B,D), paid-value query (Task D), trueROAS-reuse-vs-new-query resolved = new paid query + finite-positive floor (Tasks A,D), eval via real seam (Task C), producer-population honesty (Tasks D,G), live wiring (E,F). All covered.
- Placeholders: none (every code step has complete code; the audit-runner test sketch (Task E Step 1) is the one place the executor adapts to the existing harness — flagged explicitly, not a silent TODO).
- Type consistency: `paidValueGate: { paidValueCents: number | null }` identical across CampaignDecisionInput (B), the eval schema (C), the audit-runner thread (E). `queryPaidValueCentsByCampaign` signature identical across the store (D) and the port (E). `scale_unproven_paid_value` pattern identical across A/B/C/G.
- Scope: one bounded PR (the producer->consumer span of one gate). Merge-stop = money-adjacent -> SURFACE-before-merge.

## VERIFY gates (Phase 4)

typecheck (all) · `pnpm test` + `pnpm --filter @switchboard/ad-optimizer test` + `pnpm --filter @switchboard/db test` + `pnpm --filter api test` · lint · format:check · arch:check · `CI=1 npx tsx scripts/local-verify-fast.ts` · `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` (read-only store method, expect clean) · `pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley` (REQUIRED, engine touched) · `pnpm build` (api changed) · independent fresh-context review (diff + criteria + lessons only).
NO migration / NO db:check-drift (no schema change). NO new env var / route allowlist.
