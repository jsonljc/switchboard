# Riley per-campaign economic truth (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the per-campaign economic-truth layer for Riley — per-campaign booked-CAC, trueROAS, and a Hybrid target resolver (campaign Tier-1 → account Tier-2) — as pure, tested, advisory-only substrate, without wiring it into Gate 4 (that is PR2, after #815 merges).

**Architecture:** Four additive, independently-testable units. (1) a db lookup that sums booked `ConversionRecord.value` per campaign; (2) a `byCampaign` counts projection on the CRM provider (zero new queries); (3) a pure `compareCampaigns` that joins counts + spend + booked value into booked-CAC/trueROAS with correct cents→dollar normalization (and fixes the same latent bug in the existing per-source `compareSources`); (4) a pure `resolveEconomicTargetForCampaign` that delegates to #798's account resolver as the Tier-2 fallback. Nothing touches the decision loop or any file PR #815 edits.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest (mocked Prisma — CI has no Postgres), Prisma, pnpm + Turborepo. Packages: `@switchboard/db` (L4), `@switchboard/ad-optimizer` (L2).

**Spec:** [`docs/superpowers/specs/2026-06-02-riley-per-campaign-economic-truth-slice.md`](../specs/2026-06-02-riley-per-campaign-economic-truth-slice.md). Contracts referenced below as "§4.N".

**Conventions:**

- Run a single test file: `pnpm --filter @switchboard/<pkg> test <filename-stem>` (→ `vitest run <stem>`).
- Before each commit: `pnpm --filter @switchboard/ad-optimizer test` + `pnpm --filter @switchboard/db test`, `pnpm typecheck`, `pnpm arch:check`, `pnpm format:check`.
- Commit messages: conventional, lowercase subject; end with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- db tests live in `src/stores/__tests__/`; ad-optimizer tests are co-located.

---

### Task 1: db — per-campaign booked-value lookup

**Files:**

- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts` (add a method to the `PrismaConversionRecordStore` class, after `leadsBySource` ~`:212`)
- Test: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("PrismaConversionRecordStore", ...)` block (the `makePrisma`/`store` fixtures already exist):

```ts
describe("queryBookedValueCentsByCampaign", () => {
  const window = { from: new Date("2026-04-01"), to: new Date("2026-04-30") };

  it("sums booked value (cents) per campaign, preserving cents (no /100)", async () => {
    (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { sourceCampaignId: "c1", _sum: { value: 12345 } },
      { sourceCampaignId: "c2", _sum: { value: 50000 } },
    ]);
    const result = await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
    expect(result.get("c1")).toBe(12345);
    expect(result.get("c2")).toBe(50000);
    expect(result.size).toBe(2);
  });

  it("filters to booked type, value>0, non-null campaign, and the window", async () => {
    const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
    groupBy.mockResolvedValue([]);
    await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
    const where = groupBy.mock.calls[0]![0].where;
    expect(where.type).toBe("booked");
    expect(where.value).toEqual({ gt: 0 });
    expect(where.sourceCampaignId).toEqual({ not: null });
    expect(where.occurredAt.gte).toBeInstanceOf(Date);
    expect(where.occurredAt.lte).toBeInstanceOf(Date);
  });

  it("scopes to campaignIds when provided", async () => {
    const groupBy = prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>;
    groupBy.mockResolvedValue([]);
    await store.queryBookedValueCentsByCampaign({
      orgId: "org_1",
      ...window,
      campaignIds: ["c1", "c2"],
    });
    expect(groupBy.mock.calls[0]![0].where.sourceCampaignId).toEqual({ in: ["c1", "c2"] });
  });

  it("omits campaigns with no attributed booked value — honest absence, not a fabricated 0", async () => {
    (prisma.conversionRecord.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { sourceCampaignId: "c1", _sum: { value: 0 } }, // defensive: WHERE excludes these, code drops them too
      { sourceCampaignId: null, _sum: { value: 999 } }, // defensive: null campaign dropped
    ]);
    const result = await store.queryBookedValueCentsByCampaign({ orgId: "org_1", ...window });
    expect(result.has("c1")).toBe(false);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store`
Expected: FAIL — `store.queryBookedValueCentsByCampaign is not a function`.

- [ ] **Step 3: Write the implementation**

Add this method to the `PrismaConversionRecordStore` class (after `leadsBySource`, before the closing `}` of the class ~`:212`):

```ts
  /**
   * Per-campaign sum of booked-conversion value for the window, in MINOR units
   * (cents) — consistent with ConversionEvent.value; the caller normalizes to
   * major units only at the trueROAS boundary, never here.
   *
   * Only valued records count: `type:"booked"` AND `value > 0` AND a present
   * `sourceCampaignId`. A campaign with no valued booked record is ABSENT from
   * the map (the caller reads absence as "no attributed booked value" →
   * trueRoas null, spec §4.3), never a fabricated 0.
   */
  async queryBookedValueCentsByCampaign(query: {
    orgId: string;
    from: Date;
    to: Date;
    campaignIds?: string[];
  }): Promise<Map<string, number>> {
    const rows = await this.prisma.conversionRecord.groupBy({
      by: ["sourceCampaignId"],
      where: {
        organizationId: query.orgId,
        type: "booked",
        value: { gt: 0 },
        occurredAt: { gte: query.from, lte: query.to },
        sourceCampaignId: query.campaignIds ? { in: query.campaignIds } : { not: null },
      },
      _sum: { value: true },
    });

    const result = new Map<string, number>();
    for (const row of rows as Array<{ sourceCampaignId: string | null; _sum: { value: number | null } }>) {
      const sum = row._sum.value ?? 0;
      if (row.sourceCampaignId && sum > 0) result.set(row.sourceCampaignId, sum);
    }
    return result;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/db test prisma-conversion-record-store`
Expected: PASS (all four new cases + the pre-existing cases).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "$(cat <<'EOF'
feat(db): per-campaign booked-conversion value lookup

queryBookedValueCentsByCampaign sums booked ConversionRecord.value (cents)
per sourceCampaignId, valued records only; absent campaign ⇒ honest null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ad-optimizer — `byCampaign` funnel projection

**Files:**

- Modify: `packages/ad-optimizer/src/crm-data-provider/real-provider.ts` (add `CampaignFunnel` alias `~:55`; add `byCampaign` to `CrmFunnelDataWithSources` `~:73-75`; populate in `getFunnelData` `~:116-170`)
- Test: `packages/ad-optimizer/src/crm-data-provider/real-provider.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block inside the existing `describe("RealCrmDataProvider", ...)` (the `makeStore` helper already exists):

```ts
describe("byCampaign projection", () => {
  it("groups funnel counts by campaign across source types (zero extra queries)", async () => {
    const store = makeStore([
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "lead", count: 100 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "booked", count: 8 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "booked", count: 4 },
      { sourceType: "ctwa", sourceCampaignId: "c2", stage: "lead", count: 50 },
      { sourceType: "ctwa", sourceCampaignId: "c2", stage: "booked", count: 2 },
    ]);
    const data = await new RealCrmDataProvider(store).getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1", "c2"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.byCampaign.c1!.booked).toBe(12); // 8 ctwa + 4 instant_form
    expect(data.byCampaign.c1!.received).toBe(100);
    expect(data.byCampaign.c2!.booked).toBe(2); // sparse campaign still present
    expect(data.byCampaign.c2!.received).toBe(50);
    // queryFunnelCounts called exactly once — no extra query for the projection
    expect(store.queryFunnelCounts).toHaveBeenCalledTimes(1);
  });

  it("carries per-campaign closed revenue (cents) but no spend/value economics", async () => {
    const store = makeStore([
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "booked", count: 5 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "paid", count: 2, revenue: 80000 },
    ]);
    const data = await new RealCrmDataProvider(store).getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.byCampaign.c1!.revenue).toBe(80000); // legacy closed cents (mirrors SourceFunnel)
    const c1 = data.byCampaign.c1 as unknown as Record<string, unknown>;
    expect(c1.costPerBooked).toBeUndefined();
    expect(c1.trueRoas).toBeUndefined();
  });

  it("skips unknown source types in byCampaign too", async () => {
    const store = makeStore([
      { sourceType: "organic", sourceCampaignId: "c9", stage: "lead", count: 999 },
    ]);
    const data = await new RealCrmDataProvider(store).getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c9"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.byCampaign.c9).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test real-provider`
Expected: FAIL — `data.byCampaign` is `undefined`.

- [ ] **Step 3: Write the implementation**

3a. After the `SourceFunnel` interface and its `EMPTY` const (`~:55`), add the semantic alias:

```ts
/** A per-campaign funnel projection. Structurally identical to {@link SourceFunnel}. */
export type CampaignFunnel = SourceFunnel;
```

3b. Extend `CrmFunnelDataWithSources` (`~:73-75`):

```ts
export type CrmFunnelDataWithSources = CrmFunnelData & {
  bySource: Record<string, SourceFunnel>;
  byCampaign: Record<string, CampaignFunnel>;
};
```

3c. In `getFunnelData`, replace the `bySource` init + accumulation loop (`~:116-133`) with this (adds the `byCampaign` map + an `addStage` helper applied to both buckets):

```ts
const bySource: Record<string, SourceFunnel> = {
  ctwa: { ...EMPTY },
  instant_form: { ...EMPTY },
};
// Per-campaign projection over the SAME rows (zero new queries), lazily keyed
// by sourceCampaignId. Counts + the existing closed-revenue field only; booked
// value + spend economics are joined later by compareCampaigns (spec §3.2).
const byCampaign: Record<string, CampaignFunnel> = {};

for (const row of rows) {
  const bucket = bySource[row.sourceType];
  if (!bucket) continue; // unknown source type — excluded from both projections
  const stageKey = row.stage === "lead" ? "received" : row.stage;
  const addStage = (target: SourceFunnel): void => {
    if (stageKey in target) {
      const indexable = target as unknown as Record<string, number>;
      indexable[stageKey] = (indexable[stageKey] ?? 0) + row.count;
    }
    if (row.revenue) target.revenue += row.revenue;
  };
  addStage(bucket);
  if (row.sourceCampaignId) {
    addStage((byCampaign[row.sourceCampaignId] ??= { ...EMPTY }));
  }
}
```

3d. Add `byCampaign` to the returned object (alongside `bySource` `~:169`):

```ts
      bySource,
      byCampaign,
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test real-provider`
Expected: PASS (new `byCampaign` cases + all pre-existing `bySource`/aggregate cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/crm-data-provider/real-provider.ts packages/ad-optimizer/src/crm-data-provider/real-provider.test.ts
git commit -m "$(cat <<'EOF'
feat(ad-optimizer): byCampaign funnel projection

Second group-by over the same rows (zero new queries); counts + closed
revenue per campaign. Substrate for per-campaign booked-CAC.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ad-optimizer — per-campaign economics (`trueRoasFromCents` + `compareCampaigns`)

**Files:**

- Modify: `packages/ad-optimizer/src/analyzers/source-comparator.ts` (import `normalizeConversionValue` + `CampaignFunnel`; add helper + `compareCampaigns`)
- Test: `packages/ad-optimizer/src/analyzers/source-comparator.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add new `describe` blocks to `source-comparator.test.ts`, and update its imports line:

```ts
import { compareSources, compareCampaigns, trueRoasFromCents } from "./source-comparator.js";
```

```ts
describe("trueRoasFromCents", () => {
  it("normalizes cents→dollars exactly once (the #819 cents trap)", () => {
    // 12345 cents = $123.45; ÷ $100 spend = 1.2345 — NOT 123.45
    expect(trueRoasFromCents(12345, 100)).toBeCloseTo(1.2345, 4);
  });
  it("returns null for unknown value or non-positive spend (never a fabricated 0)", () => {
    expect(trueRoasFromCents(null, 100)).toBeNull();
    expect(trueRoasFromCents(5000, 0)).toBeNull();
  });
});

describe("compareCampaigns", () => {
  const byCampaign = {
    c1: { received: 100, qualified: 30, booked: 10, showed: 0, paid: 2, revenue: 5000 },
    c2: { received: 40, qualified: 8, booked: 0, showed: 0, paid: 0, revenue: 0 },
  };

  it("booked-CAC from CRM booked count; trueROAS from booked value cents (normalized)", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c1: 500, c2: 200 },
      bookedValueCentsByCampaign: new Map([["c1", 123450]]), // $1234.50
    });
    const c1 = rows.find((r) => r.campaignId === "c1")!;
    expect(c1.costPerBooked).toBeCloseTo(50, 2); // $500 / 10 booked
    expect(c1.bookedValueCents).toBe(123450);
    expect(c1.trueRoas).toBeCloseTo(2.469, 3); // $1234.50 / $500
  });

  it("honest null: bookings but no booked value → trueRoas null, costPerBooked present", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c1: 500 },
      bookedValueCentsByCampaign: new Map(), // c1 absent
    });
    const c1 = rows.find((r) => r.campaignId === "c1")!;
    expect(c1.bookedValueCents).toBeNull();
    expect(c1.trueRoas).toBeNull();
    expect(c1.costPerBooked).toBeCloseTo(50, 2);
  });

  it("costPerBooked null when zero bookings", () => {
    const { rows } = compareCampaigns({
      byCampaign,
      spendByCampaign: { c2: 200 },
      bookedValueCentsByCampaign: new Map(),
    });
    expect(rows.find((r) => r.campaignId === "c2")!.costPerBooked).toBeNull();
  });

  it("preserves sparse campaign rows and drops value-only orphans", () => {
    const { rows } = compareCampaigns({
      byCampaign, // c1, c2
      spendByCampaign: { c1: 500 },
      bookedValueCentsByCampaign: new Map([
        ["c1", 1000],
        ["c_orphan", 9999], // absent from byCampaign → dropped
      ]),
    });
    expect(rows.map((r) => r.campaignId).sort()).toEqual(["c1", "c2"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer test source-comparator`
Expected: FAIL — `compareCampaigns`/`trueRoasFromCents` are not exported.

- [ ] **Step 3: Write the implementation**

3a. Update the imports at the top of `source-comparator.ts`:

```ts
import type { SourceFunnel, CampaignFunnel } from "../crm-data-provider/real-provider.js";
import { normalizeConversionValue } from "../conversion-value.js";
```

3b. Append the helper + `compareCampaigns` (after `compareSources`):

```ts
/**
 * trueROAS from a CENTS value numerator and a MAJOR-unit (dollar) spend
 * denominator. Normalizes cents→major exactly once (the #819 trap, spec §4.4).
 * Returns null when the value is unknown (`null`) or spend is non-positive —
 * never a fabricated 0 for "no attributed value".
 */
export function trueRoasFromCents(valueCents: number | null, spend: number): number | null {
  if (valueCents === null || spend <= 0) return null;
  return normalizeConversionValue(valueCents) / spend;
}

/** Per-campaign economics row (spec §5). Any metric over a zero/unknown input is `null`. */
export interface CampaignEconomicsRow {
  campaignId: string;
  cpl: number | null;
  costPerBooked: number | null; // spend ÷ CRM booked count (§4.1)
  bookedValueCents: number | null; // booked ConversionRecord value; null = no attributed value
  trueRoas: number | null; // normalizeConversionValue(bookedValueCents) ÷ spend
}

export interface CampaignComparisonInput {
  byCampaign: Record<string, CampaignFunnel>;
  spendByCampaign: Record<string, number>; // MAJOR units (dollars)
  bookedValueCentsByCampaign: Map<string, number>; // CENTS; absent key = no attributed value
}

/**
 * Per-campaign booked-CAC + trueROAS, joined from three canonical sources
 * (spec §4.1): funnel counts (CRM `booked` count → booked-CAC denominator),
 * spend (Meta, dollars), and booked value (ConversionRecord, cents → trueROAS
 * numerator). Iterates the `byCampaign` (counts) keys, so a campaign with no
 * booked value is preserved as `bookedValueCents: null` / `trueRoas: null`
 * (sparse-row preservation, §4.5); campaigns present only in the booked-value
 * map are dropped (no funnel/spend context).
 */
export function compareCampaigns(input: CampaignComparisonInput): { rows: CampaignEconomicsRow[] } {
  const rows: CampaignEconomicsRow[] = [];
  for (const [campaignId, funnel] of Object.entries(input.byCampaign)) {
    const spend = input.spendByCampaign[campaignId] ?? 0;
    const bookedValueCents = input.bookedValueCentsByCampaign.get(campaignId) ?? null;
    rows.push({
      campaignId,
      cpl: safeDiv(spend, funnel.received),
      costPerBooked: safeDiv(spend, funnel.booked),
      bookedValueCents,
      trueRoas: trueRoasFromCents(bookedValueCents, spend),
    });
  }
  return { rows };
}
```

(`safeDiv` already exists in this file `~:30` and returns `null` when the denominator ≤ 0.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer test source-comparator`
Expected: PASS for the new blocks. (The pre-existing `compareSources` "true ROAS" test still asserts the old buggy value `1.95` here — it is corrected in Task 4. If it fails now because the import line changed, that is fine; Task 4 fixes its expectation.)

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/source-comparator.ts packages/ad-optimizer/src/analyzers/source-comparator.test.ts
git commit -m "$(cat <<'EOF'
feat(ad-optimizer): per-campaign economics comparison

compareCampaigns joins funnel counts + spend + booked value into per-campaign
booked-CAC and trueROAS; trueRoasFromCents normalizes the #819 cents trap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ad-optimizer — fix the latent cents bug in `compareSources`

**Files:**

- Modify: `packages/ad-optimizer/src/analyzers/source-comparator.ts` (`compareSources` `~:48`)
- Test: `packages/ad-optimizer/src/analyzers/source-comparator.test.ts` (correct the per-source `trueRoas` expectation)

Context: `compareSources.trueRoas` divides `funnel.revenue` (cents, from `LifecycleRevenueEvent.amount`) by `spend` (dollars) — 100× too high. Decision-safe today (only consumed as display, and shift-budget compares a _ratio_ where the factor cancels), but wrong. Reuse `trueRoasFromCents` from Task 3.

- [ ] **Step 1: Correct the existing test to expect the right (normalized) value**

In `source-comparator.test.ts`, the first `compareSources` test currently passes `revenue: 800` (and `80`) and asserts `trueRoas ≈ 1.95`. Make the revenue explicitly cents so the assertion stays meaningful:

```ts
const result = compareSources({
  bySource: {
    // revenue is stored in CENTS (LifecycleRevenueEvent.amount); trueRoas normalizes cents→dollars.
    ctwa: { received: 100, qualified: 30, booked: 12, showed: 10, paid: 8, revenue: 80000 }, // $800
    instant_form: { received: 200, qualified: 16, booked: 4, showed: 3, paid: 1, revenue: 8000 }, // $80
  },
  spendBySource: { ctwa: 410, instant_form: 380 },
});
expect(result.rows).toHaveLength(2);
const ctwa = result.rows.find((r) => r.source === "ctwa")!;
expect(ctwa.cpl).toBeCloseTo(4.1, 2);
expect(ctwa.costPerBooked).toBeCloseTo(34.17, 2);
expect(ctwa.closeRate).toBeCloseTo(0.08, 2);
expect(ctwa.trueRoas).toBeCloseTo(1.95, 2); // $800 / $410, cents-normalized
```

- [ ] **Step 2: Run to verify the test fails against the un-fixed code**

Run: `pnpm --filter @switchboard/ad-optimizer test source-comparator`
Expected: FAIL — un-fixed `compareSources` yields `80000 / 410 = 195.1`, not `1.95`.

- [ ] **Step 3: Fix `compareSources`**

In `compareSources` (`~:48`), replace the `trueRoas` line:

```ts
      trueRoas: trueRoasFromCents(funnel.revenue, spend),
```

(`funnel.revenue` is always a number; `revenue === 0` → `trueRoas === 0`, preserving the existing "no revenue ⇒ 0 ROAS" semantic, now correctly scaled.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test source-comparator`
Expected: PASS. Then run the whole package to confirm no other assertion depended on the old value: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS (recommendation-engine fixtures pass synthetic `trueRoas` inputs — unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/source-comparator.ts packages/ad-optimizer/src/analyzers/source-comparator.test.ts
git commit -m "$(cat <<'EOF'
fix(ad-optimizer): normalize cents in per-source trueROAS

compareSources divided cents revenue by dollar spend (100x high); reuse
trueRoasFromCents. Display-only path, decision-safe, now correct.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ad-optimizer — `resolveEconomicTargetForCampaign` (the Hybrid resolver)

**Files:**

- Modify: `packages/ad-optimizer/src/analyzers/economic-target.ts` (append after `resolveEconomicTarget` `~:183` — no edits to existing functions)
- Test: `packages/ad-optimizer/src/analyzers/economic-target.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `economic-target.test.ts`. Update the import to include the new symbols:

```ts
import {
  selectEconomicTier,
  calibrateTargetFromBooking,
  applyTier,
  resolveEconomicTarget,
  resolveEconomicTargetForCampaign,
  MIN_BOOKED_FOR_TIER1,
  MIN_LEADS_FOR_TIER2,
  TIER2_CONFIDENCE_PENALTY,
} from "./economic-target.js";
import type { ResolvedEconomicTarget } from "./economic-target.js";
```

```ts
describe("resolveEconomicTargetForCampaign (Hybrid ladder)", () => {
  const accountTarget: ResolvedEconomicTarget = { economicTier: "cpl", effectiveTarget: 50 };

  it("Tier-1: campaign clears the booking floor → campaign-specific calibrated target", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: MIN_BOOKED_FOR_TIER1, // 10
      campaignConversions: 50,
      targetCostPerBooked: 200,
      accountTarget,
    });
    expect(out.targetSource).toBe("campaign");
    expect(out.economicTier).toBe("booked_cac");
    expect(out.effectiveTarget).toBe(40); // 200 × (10/50)
  });

  it("Tier-2: thin campaign (booked < floor) → account fallback, verbatim, tagged 'account'", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 3,
      campaignConversions: 50,
      targetCostPerBooked: 200,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out.economicTier).toBe("cpl"); // delegated from accountTarget
    expect(out.effectiveTarget).toBe(50);
  });

  it("Tier-1 still resolves a CAC target with no booked value (resolver ignores trueROAS)", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 12,
      campaignConversions: 40,
      targetCostPerBooked: 100,
      accountTarget,
    });
    expect(out.targetSource).toBe("campaign");
    expect(out.effectiveTarget).toBe(30); // 100 × (12/40)
  });

  it("falls back to account when calibration cannot run (zero campaign conversions)", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 15,
      campaignConversions: 0,
      targetCostPerBooked: 100,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out).toMatchObject(accountTarget);
  });

  it("falls back to account when no targetCostPerBooked is configured", () => {
    const out = resolveEconomicTargetForCampaign({
      campaignBookings: 20,
      campaignConversions: 40,
      accountTarget,
    });
    expect(out.targetSource).toBe("account");
    expect(out.effectiveTarget).toBe(50);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test economic-target`
Expected: FAIL — `resolveEconomicTargetForCampaign` not exported.

- [ ] **Step 3: Write the implementation**

Append to `economic-target.ts` (after `resolveEconomicTarget`, end of file):

```ts
export interface PerCampaignEconomicTargetInput {
  campaignBookings: number; // CRM booked count for this campaign (the Tier-1 floor input, §4.6)
  campaignConversions: number; // Meta-reported conversions for this campaign
  targetCostPerBooked?: number; // dollars
  minBooked?: number; // defaults to MIN_BOOKED_FOR_TIER1
  accountTarget: ResolvedEconomicTarget; // #798 account-level resolution = Tier-2 fallback
}

export interface PerCampaignEconomicTarget extends ResolvedEconomicTarget {
  targetSource: "campaign" | "account";
}

/**
 * Hybrid ladder (spec §3.4): use the CAMPAIGN's own booking-calibrated target
 * (Tier-1) when it clears the booking floor and calibration succeeds; otherwise
 * delegate to the already-resolved account-level target (Tier-2), returned
 * verbatim with `targetSource:"account"`. Tier-1 needs only bookings +
 * conversions — never the booked VALUE (trueROAS may be null while CAC qualifies).
 */
export function resolveEconomicTargetForCampaign(
  input: PerCampaignEconomicTargetInput,
): PerCampaignEconomicTarget {
  const minBooked = input.minBooked ?? MIN_BOOKED_FOR_TIER1;
  const configuredCpb =
    typeof input.targetCostPerBooked === "number" && input.targetCostPerBooked > 0
      ? input.targetCostPerBooked
      : null;

  if (configuredCpb !== null && input.campaignBookings >= minBooked) {
    const calibrated = calibrateTargetFromBooking({
      targetCostPerBooked: configuredCpb,
      accountBookings: input.campaignBookings, // reused as a per-entity bookings/conversion rate
      accountConversions: input.campaignConversions,
    });
    if (calibrated !== null && calibrated > 0) {
      return { economicTier: "booked_cac", effectiveTarget: calibrated, targetSource: "campaign" };
    }
  }
  return { ...input.accountTarget, targetSource: "account" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test economic-target`
Expected: PASS (new Hybrid cases + all pre-existing `resolveEconomicTarget` cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/economic-target.ts packages/ad-optimizer/src/analyzers/economic-target.test.ts
git commit -m "$(cat <<'EOF'
feat(ad-optimizer): per-campaign Hybrid economic-target resolver

resolveEconomicTargetForCampaign: campaign-level Tier-1 booked-CAC calibration
when the campaign clears the booking floor; else delegates to the #798 account
target as Tier-2, tagged with provenance. Advisory substrate; not yet wired.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification + open PR

- [ ] **Step 1: Full test + typecheck + arch + format**

```bash
pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/db test
pnpm typecheck
pnpm arch:check
pnpm format:check
```

Expected: all PASS. (If `format:check` flags the new files, run `pnpm format` / `prettier --write` on them and amend the relevant commit.)

- [ ] **Step 2: Confirm scope — no contested files touched**

```bash
git diff --name-only origin/main...HEAD
```

Expected: only `packages/db/src/stores/prisma-conversion-record-store.ts` (+ its test), `packages/ad-optimizer/src/crm-data-provider/real-provider.ts` (+ test), `packages/ad-optimizer/src/analyzers/source-comparator.ts` (+ test), `packages/ad-optimizer/src/analyzers/economic-target.ts` (+ test), and the two `docs/superpowers/{specs,plans}/…` files. **No `audit-runner.ts`, `campaign-decision.ts`, `recommendation-engine.ts`, or `evals/*`.**

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin worktree-riley-per-campaign-economic-truth
gh pr create --base main --title "feat(ad-optimizer): per-campaign economic-truth substrate (Riley PR1)" --body "$(cat <<'EOF'
Per-campaign booked-CAC / trueROAS + the Hybrid target resolver as pure,
tested, advisory-only substrate — the direct payoff of #819's booked-event
stamping. **No Gate-4 wiring** (that is PR2, after #815 merges): this PR touches
none of the files #815 edits.

- db: `queryBookedValueCentsByCampaign` — per-campaign booked value (cents), valued-only, honest-absent.
- ad-optimizer: `byCampaign` funnel projection (zero new queries); `compareCampaigns` (booked-CAC from CRM count, trueROAS from booked value cents, normalized); `resolveEconomicTargetForCampaign` (campaign Tier-1 → account Tier-2 fallback).
- Also fixes the latent cents bug in per-source `compareSources.trueRoas`.

Spec: `docs/superpowers/specs/2026-06-02-riley-per-campaign-economic-truth-slice.md`.
Eval unchanged (no live target altered). The known-red "Eval — Claim Classifier" baking check is unrelated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Enable auto-merge once required checks pass**

```bash
gh pr merge --auto --squash
```

Note: the "Eval — Claim Classifier" check is red on `main` too — ignore it; it is not a required gate for this PR.

---

## Self-Review

**Spec coverage (§3 components → tasks):** §3.1 booked-value lookup → Task 1. §3.2 byCampaign projection → Task 2. §3.3 compareCampaigns + compareSources fix → Tasks 3 + 4. §3.4 resolver → Task 5. §4 contracts: dual-source (§4.1) → Task 3 (CRM `booked` for CAC, `bookedValueCents` for ROAS); zero-vs-null (§4.2) → `safeDiv`/`trueRoasFromCents` tests (Tasks 3); honest-null map (§4.3) → Task 1 case 4; cents (§4.4) → `trueRoasFromCents` + `bookedValueCents` naming; sparse rows (§4.5) → Task 3 case 4; Tier-1 floor on CRM bookings (§4.6) → Task 5 cases 1/3; provenance (§4.7) → Task 5 `targetSource`; eval deferred (§4.8) → no eval/decision file touched (verified Task 6 step 2). Non-goals (§7): no audit-runner/engine/eval/config/port changes — enforced by Task 6 step 2.

**Placeholder scan:** none — every step has runnable code and exact commands.

**Type consistency:** `CampaignFunnel` (alias of `SourceFunnel`) defined in Task 2, consumed by `compareCampaigns` in Task 3. `ResolvedEconomicTarget` imported in Task 5 tests, extended by `PerCampaignEconomicTarget`. `trueRoasFromCents(valueCents, spend)` defined in Task 3, reused in Task 4. `queryBookedValueCentsByCampaign` returns `Map<string, number>`; `compareCampaigns` consumes `bookedValueCentsByCampaign: Map<string, number>` — consistent. `bookedValueCents` field name consistent across the store, the projection input, and `CampaignEconomicsRow`.
