# Riley v3 Slice 1: RevenueState Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: inline, single cohesive behavior-preserving refactor) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one typed `RevenueState` object in `packages/ad-optimizer`, assembled progressively from the six existing producers in `AuditRunner.run()`, and read by the decision layer (`decideForCampaign`, `decideSourceReallocation`) in place of the loose positional variables, with ZERO behavior change.

**Architecture:** `RevenueState` is an account-level "is it safe to act?" object. It carries the six producers' outputs; late fields (`economicTier`, `effectiveTarget`, `marginBasis`, `coverage`, `signalHealthScore`, `spendAttributionCoverageBySource`) are optional because they are unavailable at the two early aborts. The per-campaign economic tier/target/source stay separate inputs to `decideForCampaign` (they are genuinely per-campaign, resolved by `resolveEconomicTargetForCampaign`; the eval's hybrid cases prove this). `spendAttributionCoverageBySource` is completed late, inside `computeAuditEconomicsSections`, just before `decideSourceReallocation` — the genuine progressive-assembly seam.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/ad-optimizer` (Layer 2, surface-agnostic); Vitest; the `pnpm eval:riley` golden harness (CI-blocking).

---

## Consumes (already on origin/main)

- `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (sections 2.1, 7.3)
- `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` (Slice 1)

## Invariants (verify every task)

- Advisory-only: no new `PlatformIngress` caller in `packages/ad-optimizer`; no Meta write; no new mutating caller.
- Surface-agnostic: no UI import (Layer 2).
- `pnpm eval:riley` green and UNCHANGED (no emitted-recommendation diff on fixtures).
- ESM + `.js` relative imports; no `any`; co-located `*.test.ts`; no em-dashes; files under the 600-line ceiling.

## Live anchors (re-derived against origin/main @ 8af445f9; re-verify if drifted)

- Coverage Gate-0 abstention early return: `audit-runner.ts:305-320` (before all providers).
- Signal-health fetch + `signalHealthCritical`: `audit-runner.ts:327-336`.
- Meta insight fetches (getCampaignInsights x2 + getAccountSummary): `audit-runner.ts:339-343`.
- Signal-health-red early return: `audit-runner.ts:345-357` (after Meta fetches, before CRM funnel/economic-target/per-campaign).
- `measurementTrusted` (denominator step-change): `audit-runner.ts:408-412`.
- `economicTier`/`effectiveTarget` (resolveEconomicTarget): `audit-runner.ts:417-422`.
- `marginBasis = "unavailable"`: `audit-runner.ts:425`.
- per-campaign `decideForCampaign` call: `audit-runner.ts:495-510`.
- `computeAuditEconomicsSections` call: `audit-runner.ts:536-547`.
- `decideSourceReallocation` call inside economics: `source-reallocation.ts:269-282`.

---

### Task 1: RevenueState type + pure builder

**Files:**

- Create: `packages/ad-optimizer/src/revenue-state.ts`
- Test: `packages/ad-optimizer/src/revenue-state.test.ts`

- [ ] **Step 1: Write the failing test** (`revenue-state.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  assembleRevenueState,
  withSpendAttributionCoverage,
  type RevenueState,
} from "./revenue-state.js";

describe("assembleRevenueState", () => {
  it("maps producer outputs onto typed fields and reserves businessContextFreshness", () => {
    const state = assembleRevenueState({
      measurementTrusted: true,
      economicTier: "cpl",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      coverage: { coveragePct: 0.8, sufficient: true },
      signalHealthScore: "green",
    });
    expect(state).toEqual({
      measurementTrusted: true,
      economicTier: "cpl",
      effectiveTarget: 100,
      marginBasis: "unavailable",
      coverage: { coveragePct: 0.8, sufficient: true },
      signalHealthScore: "green",
      businessContextFreshness: "unknown",
    });
  });

  it("supports a partial (pre-economics) assembly with only required + early fields", () => {
    const state = assembleRevenueState({ measurementTrusted: false });
    expect(state.measurementTrusted).toBe(false);
    expect(state.economicTier).toBeUndefined();
    expect(state.spendAttributionCoverageBySource).toBeUndefined();
    expect(state.businessContextFreshness).toBe("unknown");
  });

  it("completes the late spend-attribution coverage field without mutating the input", () => {
    const base = assembleRevenueState({ measurementTrusted: true });
    const enriched = withSpendAttributionCoverage(base, { meta_ads: 0.9, google_ads: 0.4 });
    expect(enriched.spendAttributionCoverageBySource).toEqual({
      meta_ads: 0.9,
      google_ads: 0.4,
    });
    expect(base.spendAttributionCoverageBySource).toBeUndefined();
    expect(enriched.measurementTrusted).toBe(true);
    expect(enriched.businessContextFreshness).toBe("unknown");
  });

  it("is well-typed as RevenueState", () => {
    const state: RevenueState = assembleRevenueState({ measurementTrusted: true });
    expect(state.businessContextFreshness).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- revenue-state`
Expected: FAIL (module `./revenue-state.js` not found).

- [ ] **Step 3: Write minimal implementation** (`revenue-state.ts`)

```ts
import type {
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
} from "@switchboard/schemas";

/** Signal-health score (red short-circuits the audit before the decision layer). */
export type SignalHealthScore = "red" | "yellow" | "green";

/** Slice-4 reserved; always "unknown" until the operator operational-state source lands. */
export type BusinessContextFreshness = "unknown";

/**
 * Account-level "is it safe to act?" pre-flight object for one audit cycle. Consolidates
 * the six independent signals that AuditRunner.run() previously threaded as loose
 * positional variables. Assembled PROGRESSIVELY in producer order: it is only ever built
 * on the post-abort happy path, and its late fields (economicTier, effectiveTarget,
 * marginBasis, coverage, signalHealthScore, spendAttributionCoverageBySource) are
 * optional because they are unavailable at the two early aborts. Per-campaign economic
 * tier/target are NOT here; they are resolved per-campaign and passed separately.
 */
export interface RevenueState {
  /** Producer 1 (evaluateDenominatorStepChange): account-wide conversion-denominator trust.
   *  Present whenever the decision layer runs (computed after both aborts). */
  measurementTrusted: boolean;
  /** Producer 2 (resolveEconomicTarget): account economic tier (the Tier-2 fallback feeding
   *  per-campaign resolution and slice-2's revenueProximity). */
  economicTier?: EconomicTier;
  /** Producer 2: account effective target paired with economicTier. */
  effectiveTarget?: number;
  /** Producer 3: margin basis. Currently always "unavailable" (no AOV/margin source plumbed). */
  marginBasis?: MarginBasis;
  /** Producer 4 (CoverageValidator Gate-0): tracked-source coverage. Present only when a
   *  coverage validator was injected; on the happy path it is always sufficient (an
   *  insufficient result aborts before the decision layer). Read by slice-2 truthConfidence. */
  coverage?: { coveragePct: number; sufficient: boolean };
  /** Producer 5 (SignalHealthChecker): signal-health score. Present only when checker+pixelId
   *  were wired; on the happy path it is never "red" (red aborts first). Read by slice-2. */
  signalHealthScore?: SignalHealthScore;
  /** Producer 6 (computeSpendBySource): per-source spend-attribution coverage [0,1]. Completed
   *  LATE inside computeAuditEconomicsSections; absent at both aborts and during the
   *  per-campaign loop. Read by decideSourceReallocation. */
  spendAttributionCoverageBySource?: Record<string, number>;
  /** Slice-4 reserved; always "unknown" in slice 1. */
  businessContextFreshness: BusinessContextFreshness;
}

/** The account-level producer outputs known by the time the per-campaign loop begins. */
export interface AssembleRevenueStateInput {
  measurementTrusted: boolean;
  economicTier?: EconomicTier;
  effectiveTarget?: number;
  marginBasis?: MarginBasis;
  coverage?: { coveragePct: number; sufficient: boolean };
  signalHealthScore?: SignalHealthScore;
}

/**
 * Pure assembly of the account-level RevenueState from producer outputs already in scope.
 * No new computation: every field is a pass-through; this only co-locates them and stamps
 * the slice-4 reserved default. Omits undefined optional fields so partial (pre-economics)
 * states are honest.
 */
export function assembleRevenueState(input: AssembleRevenueStateInput): RevenueState {
  return {
    measurementTrusted: input.measurementTrusted,
    ...(input.economicTier !== undefined ? { economicTier: input.economicTier } : {}),
    ...(input.effectiveTarget !== undefined ? { effectiveTarget: input.effectiveTarget } : {}),
    ...(input.marginBasis !== undefined ? { marginBasis: input.marginBasis } : {}),
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
    ...(input.signalHealthScore !== undefined
      ? { signalHealthScore: input.signalHealthScore }
      : {}),
    businessContextFreshness: "unknown",
  };
}

/**
 * Progressive late-field completion: returns a NEW RevenueState with the per-source
 * spend-attribution coverage filled in. Pure (does not mutate the input). Called by
 * computeAuditEconomicsSections once computeSpendBySource has produced coverageBySource.
 */
export function withSpendAttributionCoverage(
  state: RevenueState,
  spendAttributionCoverageBySource: Record<string, number>,
): RevenueState {
  return { ...state, spendAttributionCoverageBySource };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test -- revenue-state`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/revenue-state.ts packages/ad-optimizer/src/revenue-state.test.ts
git commit -m "feat(ad-optimizer): add RevenueState type + progressive builder (riley v3 slice 1)"
```

---

### Task 2: Export RevenueState from the package barrel

**Files:**

- Modify: `packages/ad-optimizer/src/index.ts`

- [ ] **Step 1: Add the export** (find the existing analyzer/type export block; add)

```ts
export {
  assembleRevenueState,
  withSpendAttributionCoverage,
  type RevenueState,
  type AssembleRevenueStateInput,
  type SignalHealthScore,
  type BusinessContextFreshness,
} from "./revenue-state.js";
```

- [ ] **Step 2: Verify typecheck + barrel test**

Run: `pnpm --filter @switchboard/ad-optimizer test -- barrel`
Expected: PASS (barrel-abstention-exports test unaffected; <40 symbols).

- [ ] **Step 3: Commit**

```bash
git add packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): export RevenueState from package barrel"
```

---

### Task 3: Asymmetric abort-guard test (failing first)

**Files:**

- Test: `packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts`

This test pins the load-bearing constraint (spec 7.3): Gate-0 calls ZERO providers; signal-health-red runs ONLY the Meta insight fetches its report depends on, then aborts before CRM funnel / economic-target / spend-attribution / booked-value / per-campaign decisions. It reuses the existing test harness fixtures (mirror `audit-runner.test.ts`). Provider call counts are the assertion surface; `resolveEconomicTarget` is proven not-called by control flow (it sits after `getFunnelData`, which must be uncalled).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type {
  AuditDependencies,
  AdsClientInterface,
  AuditConfig,
  BookedValueByCampaignProvider,
} from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
} from "@switchboard/schemas";
import type { CoverageReport } from "../onboarding/coverage-validator.js";

function makeCampaignInsight(overrides: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 100_000,
    inlineLinkClicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.5,
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    dateStart: "2026-03-01",
    dateStop: "2026-03-31",
    ...overrides,
  };
}

function makeAccountSummary(): AccountSummary {
  return {
    accountId: "act-123",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 10_000,
    totalImpressions: 200_000,
    totalClicks: 4_000,
    activeCampaigns: 1,
  };
}

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

function makeCrmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function makeMediaBenchmarks(): MediaBenchmarks {
  return { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
}

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

function makeSignalReport(score: "red" | "yellow" | "green") {
  return {
    pixelId: "px_1",
    score,
    pixelHealth: {
      pixelId: "px_1",
      name: "P",
      lastFiredAt: new Date().toISOString(),
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: score === "red",
    },
    eventVolume: { events: [] },
    capiHealth: {
      serverToBrowserRatio: 0.95,
      dedupRate: 0.85,
      lastServerEventAt: new Date().toISOString(),
      freshnessMs: 60_000,
      isFresh: true,
    },
    daChecks: { checks: [], hasFailure: false },
    emqProxy: 0.85 * 0.95,
    breaches:
      score === "red"
        ? [{ signal: "pixel_dead" as const, severity: "critical" as const, message: "dead" }]
        : [],
  };
}

function buildSpiedDeps(): {
  deps: AuditDependencies;
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  bookedValueProvider: BookedValueByCampaignProvider;
} {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      .mockResolvedValueOnce([makeCampaignInsight()])
      .mockResolvedValueOnce([makeCampaignInsight({ spend: 4_800 })]),
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
  const bookedValueProvider: BookedValueByCampaignProvider = {
    queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };
  const deps: AuditDependencies = {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config,
    bookedValueByCampaignProvider: bookedValueProvider,
  };
  return { deps, adsClient, crmDataProvider, insightsProvider, bookedValueProvider };
}

const RANGE = {
  dateRange: { since: "2026-03-01", until: "2026-03-31" },
  previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
};

describe("AuditRunner abort-guard (RevenueState progressive assembly)", () => {
  it("Gate-0 coverage abstention calls ZERO downstream providers", async () => {
    const { deps, adsClient, crmDataProvider, insightsProvider, bookedValueProvider } =
      buildSpiedDeps();
    const insufficient: CoverageReport = {
      orgId: "org-1",
      accountId: "act-123",
      coveragePct: 0.2,
      trackedSpend: 200,
      totalSpend: 1000,
      bySource: {},
    };
    const coverageValidator = { validate: vi.fn().mockResolvedValue(insufficient) };
    const runner = new AuditRunner({ ...deps, coverageValidator });

    const report = await runner.run(RANGE);

    // Abstention report shape (one explanatory insight, no recs).
    expect(report.recommendations).toEqual([]);
    expect(coverageValidator.validate).toHaveBeenCalledTimes(1);
    // ZERO providers past the gate: no Meta fetch, no CRM funnel, no per-campaign, no booked-value.
    expect(adsClient.getCampaignInsights).not.toHaveBeenCalled();
    expect(adsClient.getAccountSummary).not.toHaveBeenCalled();
    expect(crmDataProvider.getFunnelData).not.toHaveBeenCalled();
    expect(insightsProvider.getCampaignLearningData).not.toHaveBeenCalled();
    expect(insightsProvider.getTargetBreachStatus).not.toHaveBeenCalled();
    expect(bookedValueProvider.queryBookedValueCentsByCampaign).not.toHaveBeenCalled();
  });

  it("signal-health-red runs ONLY the Meta insight fetches, then aborts before late producers", async () => {
    const { deps, adsClient, crmDataProvider, insightsProvider, bookedValueProvider } =
      buildSpiedDeps();
    const checker = {
      getSignalHealthReport: vi.fn().mockResolvedValue(makeSignalReport("red")),
    };
    const runner = new AuditRunner({
      ...deps,
      signalHealthChecker: checker as never,
      config: { ...deps.config, pixelId: "px_1" },
    });

    await runner.run(RANGE);

    // Meta insight fetches DID run (they feed the critical report's totals — not skippable).
    expect(adsClient.getCampaignInsights).toHaveBeenCalledTimes(2);
    expect(adsClient.getAccountSummary).toHaveBeenCalledTimes(1);
    // But every LATE producer is skipped: CRM funnel (which gates resolveEconomicTarget),
    // per-campaign decisions, spend-attribution, booked-value.
    expect(crmDataProvider.getFunnelData).not.toHaveBeenCalled();
    expect(insightsProvider.getCampaignLearningData).not.toHaveBeenCalled();
    expect(insightsProvider.getTargetBreachStatus).not.toHaveBeenCalled();
    expect(bookedValueProvider.queryBookedValueCentsByCampaign).not.toHaveBeenCalled();
  });

  it("happy path (no abort) runs Meta fetches, CRM funnel, and per-campaign decisions", async () => {
    const { deps, adsClient, crmDataProvider, insightsProvider } = buildSpiedDeps();
    const runner = new AuditRunner(deps);

    await runner.run(RANGE);

    expect(adsClient.getCampaignInsights).toHaveBeenCalledTimes(2);
    expect(crmDataProvider.getFunnelData).toHaveBeenCalledTimes(1);
    expect(insightsProvider.getCampaignLearningData).toHaveBeenCalledTimes(1);
    expect(insightsProvider.getTargetBreachStatus).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes against CURRENT code**

Run: `pnpm --filter @switchboard/ad-optimizer test -- audit-runner-abort-guard`
Expected: PASS. (The current code already honors the asymmetry; this test PINS it so the Task 4 refactor cannot regress it. Verify the `CoverageReport` shape compiles — adjust field names to the live type if drifted.)

- [ ] **Step 3: Commit**

```bash
git add packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts
git commit -m "test(ad-optimizer): pin asymmetric abort-guard before RevenueState refactor"
```

---

### Task 4: Re-point `decideForCampaign` at RevenueState

**Files:**

- Modify: `packages/ad-optimizer/src/campaign-decision.ts`
- Test: `packages/ad-optimizer/src/campaign-decision.test.ts`

`CampaignDecisionInput` drops loose `measurementTrusted?` + `marginBasis`, gains `revenueState: RevenueState`. The per-campaign `economicTier`/`effectiveTarget`/`targetSource` stay. Body reads `input.revenueState.measurementTrusted` and `input.revenueState.marginBasis ?? "unavailable"`. Behavior byte-identical (values unchanged).

- [ ] **Step 1: Update the test fixtures first** (`campaign-decision.test.ts`)

Read the file. Every `decideForCampaign({...})` call currently passing `measurementTrusted` and/or `marginBasis` must instead pass `revenueState`. Replacement pattern — for a call that had `marginBasis: "unavailable"` and (optionally) `measurementTrusted: X`:

```ts
// before: marginBasis: "unavailable", measurementTrusted: false,
// after:
revenueState: assembleRevenueState({ measurementTrusted: false, marginBasis: "unavailable" }),
```

Add the import at the top:

```ts
import { assembleRevenueState } from "./revenue-state.js";
```

For calls that omitted `measurementTrusted` (relied on undefined→true), pass `assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" })` (preserves the effective value). Keep `economicTier`, `effectiveTarget`, `targetSource` exactly as they were.

- [ ] **Step 2: Run the test to verify it FAILS (type error / wrong shape)**

Run: `pnpm --filter @switchboard/ad-optimizer test -- campaign-decision`
Expected: FAIL (type error: `revenueState` missing / `measurementTrusted` not in input) until Step 3.

- [ ] **Step 3: Update `CampaignDecisionInput` and the body** (`campaign-decision.ts`)

Add import:

```ts
import type { RevenueState } from "./revenue-state.js";
```

In `CampaignDecisionInput`: remove the `marginBasis: MarginBasis;` field and the `measurementTrusted?: boolean;` field (keep their doc comments' intent on the new field). Add:

```ts
/**
 * Account-level pre-flight signals for this audit cycle. `measurementTrusted` (producer 1)
 * gates cost-driven + learning-resetting recs; `marginBasis` (producer 3) feeds applyTier.
 * The per-campaign economic tier/target/source above are NOT taken from here (they are
 * resolved per-campaign); RevenueState carries the account-level economicTier for later slices.
 */
revenueState: RevenueState;
```

Remove the now-unused `MarginBasisSchema as MarginBasis` import if nothing else uses it (check: `applyTier` arg type — keep if referenced elsewhere; otherwise drop).

In the body, replace `input.measurementTrusted === false` (the Gate-1 demotion check) with:

```ts
    if (
      input.revenueState.measurementTrusted === false &&
      (costDriven || resetsLearningFor(item.action) !== "no")
    ) {
```

Replace the `applyTier` call's `marginBasis: input.marginBasis` with:

```ts
      marginBasis: input.revenueState.marginBasis ?? "unavailable",
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @switchboard/ad-optimizer test -- campaign-decision`
Expected: PASS (all existing assertions, unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/campaign-decision.ts packages/ad-optimizer/src/campaign-decision.test.ts
git commit -m "refactor(ad-optimizer): decideForCampaign reads account signals from RevenueState"
```

---

### Task 5: Re-point `decideSourceReallocation` + `computeAuditEconomicsSections` at RevenueState

**Files:**

- Modify: `packages/ad-optimizer/src/analyzers/source-reallocation.ts`
- Test: `packages/ad-optimizer/src/analyzers/source-reallocation.test.ts`

`SourceReallocationInput` drops `measurementTrusted` + `spendAttributionCoverageBySource`, gains `revenueState: RevenueState`. `AuditEconomicsSectionsInput` drops `measurementTrusted`, gains `revenueState: RevenueState`. `computeAuditEconomicsSections` completes the late field via `withSpendAttributionCoverage` before calling `decideSourceReallocation`.

- [ ] **Step 1: Update the test fixtures first** (`source-reallocation.test.ts`)

Read the file. Add import:

```ts
import { assembleRevenueState } from "../revenue-state.js";
```

Every `decideSourceReallocation({...})` call: replace the `measurementTrusted: X` and `spendAttributionCoverageBySource: Y` fields with:

```ts
revenueState: assembleRevenueState({ measurementTrusted: X, /* others omitted */ }).
  // then enriched with coverage:
```

Concretely use the helper so the late field is set:

```ts
revenueState: withSpendAttributionCoverage(
  assembleRevenueState({ measurementTrusted: X }),
  Y,
),
```

(add `withSpendAttributionCoverage` to the same import). Keep `sourceComparison`, `bySource`, `accountEvidence`, `nextCycleDate` unchanged.

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @switchboard/ad-optimizer test -- source-reallocation`
Expected: FAIL (type error: `revenueState` missing) until Step 3.

- [ ] **Step 3: Update the types + bodies** (`source-reallocation.ts`)

Add imports:

```ts
import { withSpendAttributionCoverage, type RevenueState } from "../revenue-state.js";
```

In `SourceReallocationInput`: remove `spendAttributionCoverageBySource: Record<string, number>;` and `measurementTrusted: boolean;`. Add:

```ts
/**
 * Account-level pre-flight state for this cycle. Reads `measurementTrusted` (Gate-1) and
 * `spendAttributionCoverageBySource` (producer 6, completed late by the economics
 * orchestrator) — the latter gates BOTH compared sources against SPEND_ATTRIBUTION_COVERAGE_FLOOR.
 */
revenueState: RevenueState;
```

In `decideSourceReallocation` body: replace `input.spendAttributionCoverageBySource[from.source] ?? 0` with `(input.revenueState.spendAttributionCoverageBySource ?? {})[from.source] ?? 0` (same for `to.source`); replace `input.measurementTrusted === false` with `input.revenueState.measurementTrusted === false`.

In `AuditEconomicsSectionsInput`: remove `measurementTrusted: boolean;`. Add:

```ts
/** Account-level pre-flight state (without the late spend-attribution coverage, which this
 *  orchestrator computes and completes before calling decideSourceReallocation). */
revenueState: RevenueState;
```

In `computeAuditEconomicsSections` body: change the `decideSourceReallocation(...)` call to drop `spendAttributionCoverageBySource` and `measurementTrusted` and pass:

```ts
reallocation = decideSourceReallocation({
  sourceComparison,
  bySource,
  accountEvidence: {
    clicks: input.currentInsights.reduce((s, i) => s + i.inlineLinkClicks, 0),
    conversions: input.currentInsights.reduce((s, i) => s + i.conversions, 0),
    days: 7,
  },
  nextCycleDate: input.nextCycleDate,
  revenueState: withSpendAttributionCoverage(input.revenueState, coverageBySource),
});
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @switchboard/ad-optimizer test -- source-reallocation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/source-reallocation.ts packages/ad-optimizer/src/analyzers/source-reallocation.test.ts
git commit -m "refactor(ad-optimizer): source reallocation reads RevenueState; late coverage completed in orchestrator"
```

---

### Task 6: Thread RevenueState through `AuditRunner.run()`

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts`

Assemble the account-level RevenueState once, post-abort, after the producers; pass it to `decideForCampaign` (with per-campaign tier still separate) and to `computeAuditEconomicsSections`. Do NOT hoist producers above the aborts.

- [ ] **Step 1: Add import**

```ts
import { assembleRevenueState, type RevenueState } from "./revenue-state.js";
```

- [ ] **Step 2: Capture the coverage report for the happy path**

At `audit-runner.ts:300`, hoist the coverage report so its value survives past the abstention block. Replace the `if (this.coverageValidator) { const coverage = ... }` opener so `coverage` is declared in `run()` scope:

```ts
let coverageReport: CoverageReport | undefined;
if (this.coverageValidator) {
  coverageReport = await this.coverageValidator.validate({
    orgId: this.config.orgId,
    accountId: this.config.accountId,
  });
  if (!isCoverageSufficient(coverageReport)) {
    const pct = Math.round(coverageReport.coveragePct * 100);
    return buildCoverageAbstentionReport({
      // ...unchanged...
    });
  }
}
```

(Replace the two inner `coverage.` references with `coverageReport.`.)

- [ ] **Step 3: Assemble RevenueState after marginBasis (after line 425), before the per-campaign loop**

```ts
// Riley v3 slice 1: consolidate the six account-level pre-flight producers into one
// typed RevenueState. Assembled HERE (post both aborts): coverage was validated
// sufficient (or absent), signal-health is non-red (or absent), and measurementTrusted
// / economicTier / effectiveTarget / marginBasis are now resolved. The late
// spendAttributionCoverageBySource is completed inside computeAuditEconomicsSections.
const revenueState: RevenueState = assembleRevenueState({
  measurementTrusted,
  economicTier,
  effectiveTarget,
  marginBasis,
  ...(coverageReport
    ? { coverage: { coveragePct: coverageReport.coveragePct, sufficient: true } }
    : {}),
  ...(signalHealthReport ? { signalHealthScore: signalHealthReport.score } : {}),
});
```

- [ ] **Step 4: Pass RevenueState into `decideForCampaign`** (the call at ~`:495`)

Remove `marginBasis,` and `measurementTrusted,` from the `decideForCampaign({...})` argument; add `revenueState,`. Keep `economicTier: campaignTarget.economicTier`, `effectiveTarget: campaignTarget.effectiveTarget`, and `targetSource: campaignTarget.targetSource` exactly as-is (per-campaign).

- [ ] **Step 5: Pass RevenueState into `computeAuditEconomicsSections`** (the call at ~`:536`)

Remove `measurementTrusted,` from the `computeAuditEconomicsSections({...})` argument; add `revenueState,`.

- [ ] **Step 6: Run the full ad-optimizer suite + abort-guard**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS (all suites, incl. audit-runner-abort-guard, audit-runner-integration, percampaign-target, tiering, source-reallocation).

- [ ] **Step 7: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts
git commit -m "refactor(ad-optimizer): assemble + thread RevenueState through AuditRunner.run()"
```

---

### Task 7: Re-point the eval seam at RevenueState

**Files:**

- Modify: `evals/riley-recommendation/decide.ts`
- Modify: `evals/riley-recommendation/source-reallocation-eval.ts`

- [ ] **Step 1: Update `decide.ts`**

Add import:

```ts
import { assembleRevenueState } from "@switchboard/ad-optimizer";
```

In the `decideForCampaign({...})` call: remove `marginBasis: "unavailable",` and `measurementTrusted: c.measurementTrusted ?? true,`; add:

```ts
    revenueState: assembleRevenueState({
      measurementTrusted: c.measurementTrusted ?? true,
      marginBasis: "unavailable",
      economicTier,
      effectiveTarget,
    }),
```

Keep `economicTier`, `effectiveTarget`, `targetSource` (per-campaign) exactly as-is.

- [ ] **Step 2: Update `source-reallocation-eval.ts`** (two call sites)

Add import:

```ts
import {
  assembleRevenueState,
  withSpendAttributionCoverage,
  compareSources,
  decideSourceReallocation,
  computeAuditEconomicsSections,
} from "@switchboard/ad-optimizer";
```

(merge with the existing import). Activated path — replace `measurementTrusted: c.measurementTrusted ?? true,` in `computeAuditEconomicsSections({...})` with:

```ts
      revenueState: assembleRevenueState({ measurementTrusted: c.measurementTrusted ?? true }),
```

Legacy path — replace `spendAttributionCoverageBySource,` and `measurementTrusted: c.measurementTrusted ?? true,` in `decideSourceReallocation({...})` with:

```ts
    revenueState: withSpendAttributionCoverage(
      assembleRevenueState({ measurementTrusted: c.measurementTrusted ?? true }),
      spendAttributionCoverageBySource,
    ),
```

- [ ] **Step 3: Run the eval (the behavior-preservation gate)**

Run: `pnpm eval:riley`
Expected: `All 12 decideForCampaign + 10 source-reallocation cases match.` (UNCHANGED from baseline.)

- [ ] **Step 4: Run the eval's own vitest suite (if present)**

Run: `pnpm --filter <eval workspace or root> test -- riley-recommendation`
Expected: PASS. (If the eval tests run under the root `pnpm test`, defer to Task 8.)

- [ ] **Step 5: Commit**

```bash
git add evals/riley-recommendation/decide.ts evals/riley-recommendation/source-reallocation-eval.ts
git commit -m "refactor(eval): riley recommendation seam constructs RevenueState (behavior-identical)"
```

---

### Task 8: Full verification + invariant grep

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, format, arch:check, full test, eval**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm arch:check
pnpm test
pnpm eval:riley
```

Expected: all green; eval output identical to baseline.

- [ ] **Step 2: Advisory-only + surface-agnostic grep proof**

```bash
# No new PlatformIngress caller in ad-optimizer:
git diff origin/main -- packages/ad-optimizer | grep -nE "PlatformIngress|\.submit\(" || echo "OK: no ingress"
# No UI import added (Layer 2 surface-agnostic):
git diff origin/main -- packages/ad-optimizer | grep -nE "dashboard|next/|react" || echo "OK: no UI import"
# RevenueState is internal to ad-optimizer (+ eval), not added to schemas:
git diff origin/main -- packages/schemas | grep -ni "revenuestate" || echo "OK: not in schemas"
```

Expected: each prints its OK line (no matches).

- [ ] **Step 3: Confirm no emitted-recommendation diff**

The eval green at Step 1 IS this proof (it asserts emitted actions/watches match golden fixtures). Note in the PR body.

- [ ] **Step 4: Final commit if any format fixups**

```bash
git add -A && git commit -m "chore(ad-optimizer): riley v3 slice 1 verification fixups" || echo "nothing to commit"
```

---

## Self-Review (spec coverage)

- Spec 2.1 RevenueState (six producers, progressive assembly, late fields optional) → Tasks 1, 6.
- Spec 7.3 / load-bearing asymmetric aborts → Task 3 (pinned before refactor), Task 6 (preserved).
- Plan Slice 1 "decision layer reads RevenueState not positional vars" → Tasks 4, 5 (account-level fields; per-campaign tier stays per-campaign — reconciled against live code).
- DOD "eval green and UNCHANGED" → Task 7 + Task 8.
- DOD "advisory-only + surface-agnostic (grep-proven)" → Task 8 Step 2.
- Convention: businessContextFreshness reserved "unknown" → Task 1.
