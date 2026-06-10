# Tier 2: "The brain stops missing the worst case" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails (§6), the answered open decisions, and the cross-slice integration review (§7); they are not repeated here.

**Goal:** Close the five engine/ingress correctness holes the audit found in Riley's decision brain: a zero-conversion burn that reads as silence (or, worse, a positive insight), a sub-durable breach that drops to silence before day 7, two NaN-blind parse boundaries that let a single garbage Meta number void a recommendation or fabricate a trust verdict, and an idempotent replay that fires Riley's loudest false alarm while dropping the park-ownership truth. None of these needs a live account, a seeded org, or a credential; they are pure functions over inputs the engine already receives.

**Architecture:** This tier is **independent of Tier 0/1**. It touches only the decision engine (`packages/ad-optimizer/src/`), the core ingress replay branch (`packages/core/src/platform/`), the receipted-outcome attribution adapter/derivation (`apps/api/src/services/cron/` plus `packages/core/src/recommendations/`), and the CI-blocking eval gate (`evals/riley-recommendation/`). It can run immediately in a parallel worktree (overview §5, Worktree B). Every engine-behavior change is pinned by a new or extended eval fixture so the 28-assertion gate stays green and grows.

**Tech Stack:** TypeScript (`@switchboard/ad-optimizer`, `@switchboard/core`, `apps/api`), Vitest, the `evals/riley-recommendation` deterministic harness (no Postgres, no ANTHROPIC_API_KEY; `decideForCampaign` is the source of truth). `Number.isFinite` is the canonical numeric guard across this tier.

---

## Verified findings (this tier)

All five re-verified at file:line against current `main` on 2026-06-10. Status legend matches the overview table.

| #           | Status    | Pinned location                                                                                                                                                                                                                                                                            | Plan owner |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| D1-1        | CONFIRMED | `safeDivide` `campaign-decision.ts:20-22`; `cpa:` `:31`; positive-insight `:131-145` via `learning-phase-guard.ts:99-100`; gates `recommendation-engine.ts:190-191,198-202`; scale guard already `cpa>0` `:220`; breach detector accrues days `meta-campaign-insights-provider.ts:131-161` | PR 2.1     |
| D1-2        | CONFIRMED | durability gate `recommendation-engine.ts:198-202` (`>= KILL_DAYS_THRESHOLD`=7, `:23`); no sub-durable watch anywhere                                                                                                                                                                      | PR 2.2     |
| D1-4        | CONFIRMED | `mapCampaignInsight` `meta-ads-client.ts:456-479` (`spend` `:464`, `conversions` `:465`, no `Number.isFinite`); `mapAdSetInsight` `:481-497`; `getAccountSummary` `:265-267`; finite-guarded peer `meta-campaign-insights-provider.ts:146-149`                                             | PR 2.3     |
| D7-3 / D3-3 | CONFIRMED | `meta-insights-adapter.ts:76-77` (`spendCents`/`ctr`, unguarded) vs guarded `:84`; propagates `outcome-attribution.ts:117` (`cockpitRenderable`), `:169` (`trustDelta:"down"`)                                                                                                             | PR 2.3     |
| D5-3 / D4-1 | CONFIRMED | producer replay branch `platform-ingress.ts:150-177` (omits `approvalRequired`); original park shape `:363-373`; consumer mis-fire `riley-pause-submitter.ts:47-81` (false alarm `:78-79`, drops park-truth `:81`)                                                                         | PR 2.4     |

**Re-verification corrections (folded into the steps below):**

- D5-3/D4-1: the WorkTrace persisted by the park leg does **not** carry `lifecycleId`/`bindingHash` (confirmed: `buildWorkTrace` in `work-trace-recorder.ts` stores neither; the only schema homes for those fields are `approval-lifecycle.ts`/`chat.ts`, not `WorkTrace`). So the replay fix reconstructs **`approvalRequired:true` only**, the single load-bearing field the submitter branches on, and the optional `lifecycleId`/`bindingHash` are legitimately absent on a replay (they were already minted on the first park). The submitter already tolerates their absence (`res.lifecycleId ?? "?"` at `riley-pause-submitter.ts:65`).
- D1-1: the breach detector half is already correct on current `main`. `getTargetBreachStatus` accrues a zero-conversion day as a breach when `windowClicks >= MIN_WINDOW_CLICKS_FOR_ZERO_DAY_BREACH` (=20) (`meta-campaign-insights-provider.ts:136-158`). The bug is downstream: the breach **count** survives, but `decideForCampaign` then computes `cpa = safeDivide(spend, 0) = 0` and every actionable gate is a `cpa > k*target` test that `0` fails, so the accrued breach is discarded. The fix is a new rule in the engine, not a breach-counter change. The eval harness feeds `targetBreach` as a literal (`decide.ts:150`), so a fixture can model "14 breach days already accrued, conversions=0" directly.
- D1-1 positive-insight arm: reproducible only when `targetROAS` is `0` (then `roas=0 >= 0` is true and `isPerformingWell` returns true at `cpa=0 <= effectiveTarget`). With a non-zero `targetROAS` the engine is merely silent. Both regressions get a fixture.

---

## File structure (what each PR creates/modifies)

- **PR 2.1**: `packages/ad-optimizer/src/recommendation-engine.ts` (zero-conversion-burn rule), `packages/ad-optimizer/src/recommendation-engine.test.ts` (extend), `packages/ad-optimizer/src/campaign-decision.test.ts` (extend, positive-insight regression), `evals/riley-recommendation/fixtures/zero-conversion-burn.jsonl` (new), `evals/riley-recommendation/__tests__/drift-guard.test.ts` (extend coverage assertion), `evals/riley-recommendation/README.md` (coverage row).
- **PR 2.2**: `packages/ad-optimizer/src/recommendation-engine.ts` (`breach_building` watch), `recommendation-engine.test.ts` (extend), `evals/riley-recommendation/fixtures/breach-building.jsonl` (new), `drift-guard.test.ts` (extend), `README.md` (coverage row).
- **PR 2.3**: `packages/ad-optimizer/src/meta-ads-client.ts` (finite-guard the three mappers/summary), `packages/ad-optimizer/src/meta-ads-client.test.ts` (**new**), `apps/api/src/services/cron/meta-insights-adapter.ts:76-77` (finite-guard `spendCents`/`ctr`), `apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts` (extend), `packages/core/src/recommendations/outcome-attribution.ts:117` (defense-in-depth `Number.isFinite(deltaPct)`), `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts` (extend).
- **PR 2.4**: `packages/core/src/platform/platform-ingress.ts:150-177` (reconstruct `approvalRequired` on a `pending_approval` replay), `packages/core/src/platform/__tests__/platform-ingress.test.ts` (extend, replay branch), `apps/api/src/bootstrap/__tests__/riley-pause-submitter.test.ts` (extend, replay outcome through the submitter).

---

## PR 2.1: Zero-conversion-burn rule plus eval fixtures (D1-1, the most important brain fix)

**Why:** A campaign spending real money with **zero** attributed conversions is the single worst case Riley can face, and today it is total silence. `safeDivide(spend, 0)` returns `0` (`campaign-decision.ts:20-22,31`), so `cpa=0`. Every actionable gate is a `>`-multiple comparison (`cpa > 2*target` / `cpa > 3*target`, `recommendation-engine.ts:190-191`) gated behind the durability AND (`:198-202`), and `0` fails all of them, yielding `{insights:[],watches:[],recommendations:[]}`. Worse, when `targetROAS` is unset (`0`), `isPerformingWell` (`learning-phase-guard.ts:99-100`) returns true at `cpa=0 <= target`, and the engine emits a **positive** "maintained 0.0x ROAS" insight (`campaign-decision.ts:138-145`). The scale rule already guards `cpa > 0` (`recommendation-engine.ts:220`), proof the codebase knows "0 = no data," but no burn rule exists, and **no eval fixture** covers `conversions=0` (the minimum `conversions` across all 12 fixtures is `1`). The breach detector already accrues the 14 breach days (`meta-campaign-insights-provider.ts:131-161`); the engine just throws them away because `getCPA(deltas)` reads `0`.

**Fix shape:** add a zero-conversion-burn rule **early** in `generateRecommendations` (before the `cpa`-multiple gates, so a `cpa=0` reading never short-circuits it). When **spend exceeds a floor AND conversions===0 AND clicks meet the evidence-floor click bar (>= ~20)**, the cost signal is "unknown-high," not "good": route it through the existing gates as a `review_budget`/`pause`-class recommendation (so the durability/learning/tier gates still demote it on thin or in-learning data), and, at minimum when the durability window is not yet met, emit a `burn` watch so it is never silent. Critically, **suppress the positive `isPerformingWell` insight when `conversions===0`** so the "maintained 0.0x ROAS" regression cannot fire. Never encode a `0`/NaN-denominator CPA as "good."

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` (new burn rule plus the `isPerformingWell`-suppression hook surfaced to `campaign-decision.ts`)
- Modify: `packages/ad-optimizer/src/campaign-decision.ts` (guard the positive-insight branch on `conversions > 0`)
- Test: `packages/ad-optimizer/src/recommendation-engine.test.ts`, `packages/ad-optimizer/src/campaign-decision.test.ts` (extend)
- Create: `evals/riley-recommendation/fixtures/zero-conversion-burn.jsonl`
- Modify: `evals/riley-recommendation/__tests__/drift-guard.test.ts`, `evals/riley-recommendation/README.md`

- [ ] **Step 1: Write the failing engine test.** Extend `recommendation-engine.test.ts`. This reproduces the silence both audit verifiers re-reproduced via `tsx`:

```ts
import { describe, it, expect } from "vitest";
import { generateRecommendations } from "./recommendation-engine.js";
import type { TargetBreachResult } from "@switchboard/schemas";

// A burning campaign: $2100 spent, 0 conversions, 600 clicks, breach already
// accrued for 14 of 14 days by the provider. cpa = safeDivide(2100,0) = 0, so
// every `cpa > k*target` gate reads false today and the engine goes silent.
const burnDeltas = [{ metric: "cpa", current: 0, previous: 0, deltaPct: 0 }];
const durableBreach: TargetBreachResult = {
  periodsAboveTarget: 14,
  granularity: "daily",
  isApproximate: false,
};

describe("zero-conversion burn (D1-1)", () => {
  it("does NOT go silent when spend>floor, conversions=0, clicks>=20", () => {
    const out = generateRecommendations({
      campaignId: "c1",
      campaignName: "C1",
      diagnoses: [],
      deltas: burnDeltas,
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2100,
      targetBreach: durableBreach,
      evidence: { clicks: 600, conversions: 0, days: 7 },
    });
    // The accrued 14-day burn must surface SOMETHING actionable, never [].
    expect(out.length).toBeGreaterThan(0);
    const kinds = out.map((o) => ("action" in o ? o.action : o.pattern));
    // Either a destructive/review rec OR a burn watch, but not silence and
    // never a "good"/scale signal.
    expect(kinds.some((k) => k === "pause" || k === "review_budget" || k === "burn")).toBe(true);
    expect(kinds).not.toContain("scale");
  });

  it("does NOT fire the burn rule below the click floor (a quiet zero day is noise)", () => {
    const out = generateRecommendations({
      campaignId: "c1",
      campaignName: "C1",
      diagnoses: [],
      deltas: burnDeltas,
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2100,
      targetBreach: durableBreach,
      evidence: { clicks: 8, conversions: 0, days: 7 }, // < 20-click floor
    });
    // Thin data abstains via the existing evidence floor: no burn rec/pause.
    expect(out.every((o) => !("action" in o) || o.action !== "pause")).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing positive-insight regression test.** Extend `campaign-decision.test.ts`. This pins the "maintained 0.0x ROAS" regression (the worst face of D1-1):

```ts
import { describe, it, expect } from "vitest";
import { decideForCampaign } from "./campaign-decision.js";
// (reuse the test's existing insight/breach builders; targetROAS:0 is the trigger)

it("never emits a positive 'maintained ROAS' insight on a zero-conversion burn (D1-1)", () => {
  const res = decideForCampaign(
    makeDecisionInput({
      current: { spend: 2100, conversions: 0, inlineLinkClicks: 600, revenue: 0 },
      effectiveTarget: 100,
      targetROAS: 0, // the exact condition that makes isPerformingWell true at cpa=0
      targetBreach: { periodsAboveTarget: 14, granularity: "daily", isApproximate: false },
    }),
  );
  // The stable-performance insight must NOT appear; the burn must surface instead.
  expect(res.insights.some((i) => i.category === "stable_performance")).toBe(false);
  expect(res.recommendations.length + res.watches.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run both tests to verify they fail.** `pnpm --filter @switchboard/ad-optimizer test recommendation-engine campaign-decision` should FAIL: the engine returns `[]` (silence) and `decideForCampaign` emits the `stable_performance` insight.

- [ ] **Step 4: Implement the burn rule.** In `generateRecommendations`, add a guarded early branch. Sketch (keep it inside the existing `results` accumulation so the trailing `meetsEvidenceFloor` map at `:340-344` still demotes thin data):

```ts
const ZERO_CONV_SPEND_FLOOR = 50; // documented: below this, spend is noise, not a burn
const ZERO_CONV_MIN_CLICKS = 20; // align with the provider's zero-day click floor

// Zero-conversion burn (D1-1): spend with no attributed conversions is unknown-HIGH,
// never "good". cpa=safeDivide(spend,0)=0 fails every `>`-gate, so handle it explicitly
// BEFORE those gates. The evidence floor (`meetsEvidenceFloor`, applied at return) still
// demotes a thin-click burn to insufficient_evidence; a durable, well-clicked burn that
// the breach window confirms routes to a pause-class action through the normal gates.
const conversions = input.evidence.conversions;
const isZeroConversionBurn =
  conversions === 0 &&
  input.currentSpend > ZERO_CONV_SPEND_FLOOR &&
  input.evidence.clicks >= ZERO_CONV_MIN_CLICKS;
if (isZeroConversionBurn) {
  if (
    targetBreach.granularity === "daily" &&
    targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD
  ) {
    addPauseRecommendation(
      results,
      base,
      /* cpa unknown-high */ targetCPA * PAUSE_CPA_MULTIPLIER,
      targetCPA,
    );
  } else {
    results.push(/* a `burn` watch: visible, informational, not yet a pause */);
  }
}
```

Two cautions for the implementer:

- Do **not** synthesize a fake numeric `cpa` into rationale/logs/evidence. Mirror the provider's "never carry Infinity into rationale" discipline (`meta-campaign-insights-provider.ts:156`). The copy should say "no attributed conversions on $X spend," not "0.0x CPA."
- The `burn` watch is a new `WatchOutput.pattern` value. Confirm `WatchOutputSchema` admits it (grep the schema enum); if `pattern` is a closed enum, add `"burn"` to it in `packages/schemas` **in the same PR** (schema change, no migration needed since it is a Zod string enum) and run `pnpm reset` so the type propagates.

- [ ] **Step 5: Suppress the positive insight on zero conversions.** In `campaign-decision.ts`, tighten the `isPerformingWell` branch (`:131-137`) so it cannot fire when there were no conversions:

```ts
if (
  input.currentInsight.conversions > 0 && // D1-1: never call a zero-conversion burn "performing well"
  learningGuard.isPerformingWell(
    { cpa: current.cpa, roas: current.roas },
    { targetCPA: input.effectiveTarget, targetROAS: input.targetROAS },
  ) &&
  diagnoses.length === 0
) {
  /* ...stable insight... */
}
```

- [ ] **Step 6: Run tests to verify they pass.** `pnpm --filter @switchboard/ad-optimizer test recommendation-engine campaign-decision` should PASS.

- [ ] **Step 7: Add the eval fixture.** Create `evals/riley-recommendation/fixtures/zero-conversion-burn.jsonl`. Two cases: the durable burn (must ACT) and the positive-insight regression (must NOT emit `insight`). The harness feeds `targetBreach` literally (`decide.ts:150`) and computes `cpa` via the real `insightToMetrics` (so `conversions:0` gives `cpa=0`), exercising the exact silence path end-to-end:

```jsonl
# D1-1 zero-conversion burn: $2100 spend, 0 conversions, 600 clicks, 14/14 daily
# breach days already accrued by the provider. PRE-FIX: cpa=safeDivide(2100,0)=0 fails
# every `cpa > k*target` gate, giving {[],[],[]}, primary "none" (total silence). POST-FIX:
# the burn rule routes a durable, well-clicked zero-conversion burn to a pause-class
# action. This fixture FLIPS from "none" to a non-silent outcome when D1-1 lands; a
# revert that re-silences the burn fails the eval.
{"id":"burn-durable-zero-conversion-acts","current":{"impressions":40000,"inlineLinkClicks":600,"spend":2100,"conversions":0,"revenue":0,"frequency":1.6},"previous":{"impressions":40000,"inlineLinkClicks":600,"spend":2100,"conversions":0,"revenue":0,"frequency":1.6},"targetBreach":{"periodsAboveTarget":14,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"pause","expectedActions":["pause"],"notes":"D1-1: durable zero-conversion burn must ACT (pause-class), never go silent. The provider already accrues these as breach days (zero-day click floor met at 600 clicks); the engine previously discarded them because safeDivide put cpa=0."}
# Positive-insight regression: identical burn but targetROAS:0, the ONLY condition under
# which isPerformingWell returns true at cpa=0 (0>=0). PRE-FIX the engine emits a positive
# "maintained 0.0x ROAS" stable_performance insight. POST-FIX (conversions>0 guard) it must
# not; the burn surfaces instead. Pinned so the worst-face regression can never return.
{"id":"burn-zero-conversion-not-a-good-insight","current":{"impressions":40000,"inlineLinkClicks":600,"spend":2100,"conversions":0,"revenue":0,"frequency":1.6},"previous":{"impressions":40000,"inlineLinkClicks":600,"spend":2100,"conversions":0,"revenue":0,"frequency":1.6},"targetBreach":{"periodsAboveTarget":14,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":0,"expectedOutcome":"pause","expectedActions":["pause"],"notes":"D1-1 worst-face: targetROAS:0 makes isPerformingWell true at cpa=0, so PRE-FIX a zero-conversion burn was labeled a positive 'maintained 0.0x ROAS' insight. POST-FIX the conversions>0 guard suppresses it and the burn rule acts. expectedOutcome is NOT 'insight'."}
```

(If the burn-rule design routes the **non-durable** case to a `burn` watch rather than a pause, add a third fixture with `periodsAboveTarget:3` and `expectedWatchPatterns:["burn"]` so that arm is pinned too. Choose `expectedActions`/`expectedWatchPatterns` to match whatever the implementation in Step 4 actually produces; fixtures encode actual behavior, per the repo's existing `recovering-holds-no-destructive` precedent.)

- [ ] **Step 8: Verify the regression is gone via the eval.** `pnpm --filter @switchboard/eval-riley-recommendation test` (and `pnpm eval:riley`): the two new cases pass; the prior 28 assertions stay green.

- [ ] **Step 9: Tighten the drift guard so `burn` (if emitted as a watch) is coverage-pinned.** In `drift-guard.test.ts`, the union-collection block (`:48-75`) already asserts the key abstention surfaces. If Step 4 emits a `burn` watch on the non-durable arm, add `expect(watchPatterns.has("burn")).toBe(true);` so deleting the burn fixture later fails loudly. Also add a `zero-conversion` row to the README §11 coverage table (it currently has **no** zero-conversion row; this is a net-new scenario).

- [ ] **Step 10: Build and commit.** Run the package build before push (`pnpm --filter @switchboard/ad-optimizer build`; untyped `vi.fn` greens vitest but reds the build, overview §6). Commit: `git commit -m "feat(ad-optimizer): treat zero-conversion burn as unknown-high, never silent or 'good'"`

**Acceptance:** a campaign with `spend>floor`, `conversions=0`, `clicks>=20`, and a durable daily breach yields a pause-class outcome (or a `burn` watch on the non-durable arm) instead of `{[],[],[]}`; the positive "maintained 0.0x ROAS" insight can no longer fire; the eval gate gains the burn fixtures and stays green. **Integration-review seam #6.**

---

## PR 2.2: Sub-durable `breach_building` watch (D1-2)

**Why:** The durability gate requires `targetBreach.periodsAboveTarget >= KILL_DAYS_THRESHOLD` (=7) (`recommendation-engine.ts:198-202,23`). A breach of **1 to 6 of 14 days** satisfies no recommendation branch and there is no informational watch, so an accumulating breach is **silent** until it crosses day 7; the operator never sees it building. This is the conservative side of the same `>`-gate family as D1-1: the engine is right to not _pause_ a 4-day breach, but it should not be _invisible_.

**Fix shape:** emit an informational `breach_building` watch (not a pause, not a recommendation) when the campaign is above the add-creative CPA multiple on a daily granularity but `1 <= periodsAboveTarget < KILL_DAYS_THRESHOLD`. This is purely additive visibility; it must not change any existing rec/watch/insight outcome for the durable case.

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` (sub-durable watch branch)
- Test: `packages/ad-optimizer/src/recommendation-engine.test.ts` (extend)
- Create: `evals/riley-recommendation/fixtures/breach-building.jsonl`
- Modify: `evals/riley-recommendation/__tests__/drift-guard.test.ts`, `evals/riley-recommendation/README.md`

- [ ] **Step 1: Write the failing test.** Extend `recommendation-engine.test.ts`:

```ts
import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";

// 3.5x CPA on a real conversion volume, but only 4 of 14 breach days, below the
// 7-day durability threshold. PRE-FIX: no rec branch fires and no watch, so silence.
const buildingDeltas: MetricDelta[] = [{ metric: "cpa", current: 350, previous: 350, deltaPct: 0 }];

describe("non-durable breach visibility (D1-2)", () => {
  it("emits a breach_building watch for a 1-6/14-day breach (not a pause, not silence)", () => {
    const out = generateRecommendations({
      campaignId: "c1",
      campaignName: "C1",
      diagnoses: [],
      deltas: buildingDeltas,
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2100,
      targetBreach: { periodsAboveTarget: 4, granularity: "daily", isApproximate: false },
      evidence: { clicks: 600, conversions: 6, days: 7 },
    });
    const watches = out.filter((o) => o.type === "watch");
    expect(watches.some((w) => w.pattern === "breach_building")).toBe(true);
    // Must NOT pause/add_creative below the durability threshold.
    expect(
      out.some((o) => "action" in o && (o.action === "pause" || o.action === "add_creative")),
    ).toBe(false);
  });

  it("does NOT emit breach_building once the breach is durable (>=7 days); the pause path owns it", () => {
    const out = generateRecommendations({
      campaignId: "c1",
      campaignName: "C1",
      diagnoses: [],
      deltas: buildingDeltas,
      targetCPA: 100,
      targetROAS: 3,
      currentSpend: 2100,
      targetBreach: { periodsAboveTarget: 9, granularity: "daily", isApproximate: false },
      evidence: { clicks: 600, conversions: 6, days: 7 },
    });
    expect(out.every((o) => !("pattern" in o) || o.pattern !== "breach_building")).toBe(true);
    expect(out.some((o) => "action" in o && o.action === "add_creative")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail.** `pnpm --filter @switchboard/ad-optimizer test recommendation-engine` should FAIL: no `breach_building` watch exists.

- [ ] **Step 3: Implement.** Add the sub-durable branch alongside the daily durable gate (`:198-207`). Note this watch is built by the engine but `checkBackDate` is filled by `campaign-decision.ts:170` (the engine has no `nextCycleDate`), exactly like `insufficientEvidenceWatch`, so emit it with `checkBackDate: ""` and let the existing fill apply:

```ts
const isBuilding =
  isAboveAddCreativeCpa &&
  targetBreach.granularity === "daily" &&
  targetBreach.periodsAboveTarget >= 1 &&
  targetBreach.periodsAboveTarget < KILL_DAYS_THRESHOLD;
if (isBuilding) {
  results.push(/* breach_building watch: informational; checkBackDate filled by caller */);
}
```

Add `"breach_building"` to the `WatchOutputSchema.pattern` enum if it is closed (same PR; `pnpm reset` after). Confirm the watch is returned **as a watch** through the `results` map at `:340-344`: `meetsEvidenceFloor` only demotes _recommendations_, so make sure the building watch is pushed as a `WatchOutput` (type `"watch"`), not a recommendation, or restructure so it bypasses the rec-only evidence map (mirror how Gate-2 watches are handled in `campaign-decision.ts:169`).

- [ ] **Step 4: Verify pass.** `pnpm --filter @switchboard/ad-optimizer test recommendation-engine` should PASS.

- [ ] **Step 5: Add the eval fixture.** `evals/riley-recommendation/fixtures/breach-building.jsonl`:

```jsonl
# D1-2 non-durable breach: cpa 350 = 3.5x target, real volume (600 clicks / 6 conv),
# but only 4 of 14 daily breach days (< 7-day durability threshold). PRE-FIX: no rec
# branch fires and no watch, so primary "none" (the breach is invisible until day 7).
# POST-FIX: an informational breach_building watch surfaces it. expectedWatchPatterns
# pins the new visibility surface so deleting it later fails the drift guard.
{"id":"breach-building-sub-durable-visible","current":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"previous":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"targetBreach":{"periodsAboveTarget":4,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"watch","expectedWatchPatterns":["breach_building"],"notes":"D1-2: a 4/14-day breach is below the 7-day pause threshold; the engine must SHOW it building (breach_building watch) rather than stay silent until day 7. The durable counterpart (suff-durable-volume-act, 9 days) still ACTS, proving this is additive visibility, not a new pause path."}
```

- [ ] **Step 6: Pin coverage in the drift guard.** In `drift-guard.test.ts:48-75`, add `expect(watchPatterns.has("breach_building")).toBe(true);`. Add a README §11 coverage row ("breach building gives an informational watch").

- [ ] **Step 7: Run the eval, build, and commit.** `pnpm eval:riley` (green), `pnpm --filter @switchboard/ad-optimizer build`. Commit: `git commit -m "feat(ad-optimizer): surface a sub-durable breach as a breach_building watch"`

**Acceptance:** a 1-to-6/14-day daily breach above the add-creative multiple emits a `breach_building` watch; the durable (>=7) case is unchanged and still acts; the eval gains the fixture and the drift guard pins the new pattern.

---

## PR 2.3: NaN guards at the two external-number boundaries (D1-4 plus D7-3/D3-3)

**Why bundled:** these are the **same defect class**, a numeric parsed from an external Meta payload with no `Number.isFinite` guard, which then flows into a comparison that reads `false` silently or a renderability predicate that reads `true` falsely. The audit names the asymmetry explicitly: the only finite-guarded numeric boundaries on each side are already correct (`meta-campaign-insights-provider.ts:146-149` action-type denominator; `meta-insights-adapter.ts:84` `accountSpendCents`), while their siblings on the same lines are not. Fixing both boundaries in one PR keeps the class-level fix coherent and lets one reviewer confirm the guard is now symmetric. Repo lesson: `feedback_nan_blind_comparison_gates`, #939 (NaN passes every `<`/`>` floor as `false`; only `Number.isFinite` catches it).

### 2.3a: Meta client mapper (D1-4)

`mapCampaignInsight` (`meta-ads-client.ts:456-479`) does `spend: parseFloat(String(raw.spend ?? "0"))` (`:464`), `conversions` (`:465`), `revenue` (`:466`), `frequency`, `cpm`, with no finite guard; same in `mapAdSetInsight` (`:481-497`) and `getAccountSummary` (`:265-267`). A non-numeric Meta sentinel (`"N/A"`, an empty string that parses oddly, a malformed payload) yields `NaN`, which flows through `safeDivide` (returns `NaN` because the denominator is non-zero) into `insightToMetrics`, and every `>`-gate then reads `false` and emits no recommendation, silently.

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (the three mappers/summary)
- Create: `packages/ad-optimizer/src/meta-ads-client.test.ts` (none exists today)

- [ ] **Step 1: Write the failing test.** `meta-ads-client.test.ts`. `getCampaignInsights` maps each raw row through `mapCampaignInsight` (`:137`); `get`/`post` call the global `fetch`, so stub `fetch` to return a row with a non-numeric `spend`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MetaAdsClient } from "./meta-ads-client.js";

function stubFetch(jsonBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => jsonBody,
  } as unknown as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe("MetaAdsClient numeric mappers finite-guard external Meta numbers (D1-4)", () => {
  it("maps a non-numeric spend to a finite value (0), never NaN", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        data: [
          {
            campaign_id: "c1",
            campaign_name: "C1",
            spend: "N/A", // a non-numeric Meta sentinel; parseFloat gives NaN today
            conversions: "3",
            inline_link_clicks: "40",
          },
        ],
      }),
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const [row] = await client.getCampaignInsights({
      dateRange: { since: "2026-05-01", until: "2026-05-07" },
      fields: ["campaign_id", "spend", "conversions"],
    });
    expect(Number.isFinite(row!.spend)).toBe(true);
    expect(row!.spend).toBe(0); // honest 0, not NaN
  });

  it("getAccountSummary returns finite totals on a garbage payload", async () => {
    vi.stubGlobal(
      "fetch",
      // metadata, then insights, then campaigns (three sequential gets)
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "act_1", name: "A", currency: "USD" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ spend: "oops", impressions: "x", clicks: "y" }] }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }),
    );
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    const summary = await client.getAccountSummary();
    expect(Number.isFinite(summary.totalSpend)).toBe(true);
    expect(Number.isFinite(summary.totalImpressions)).toBe(true);
    expect(Number.isFinite(summary.totalClicks)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail.** `pnpm --filter @switchboard/ad-optimizer test meta-ads-client` should FAIL: `row.spend` is `NaN`.

- [ ] **Step 3: Implement a finite-parse helper and apply it.** Add a small local helper and route every external numeric parse through it (mappers at `:456-497` and the summary at `:265-267`):

```ts
/** Parse an external Meta numeric, coercing any non-finite result to a fallback
 * (default 0). NaN/Infinity from a malformed payload must never reach a comparison
 * gate (#939): a `>`-gate reads NaN as false silently, voiding a recommendation. */
function finiteFloat(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : fallback;
}
function finiteInt(value: unknown, fallback = 0): number {
  const n = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) ? n : fallback;
}
```

Replace each `parseFloat(...)`/`parseInt(...)` in `mapCampaignInsight`, `mapAdSetInsight`, and `getAccountSummary` with `finiteFloat`/`finiteInt`. Leave the `actions` passthrough untouched: the provider already finite-guards the action-type value at `:146-149`.

- [ ] **Step 4: Verify pass.** `pnpm --filter @switchboard/ad-optimizer test meta-ads-client` should PASS.

### 2.3b: Receipted-outcome attribution adapter plus derivation (D7-3/D3-3)

`createMetaInsightsProviderForOrg` computes `spendCents` (`meta-insights-adapter.ts:76`) and `ctr` (`:77`) with **no** finite guard, while `accountSpendCents` IS guarded (`:84`, `...(Number.isFinite(accountSpendCents) ? {...} : {})`). A NaN `spendCents` flows into `attributeOneRecommendation`: `deltaPct` becomes NaN (`outcome-attribution.ts:90-100`), and the renderability predicate `cockpitRenderable = flags.length === 0 && deltaPct !== null` (`:117`) reads **true** because `NaN !== null`. That then fabricates a `trustDelta:"down"` at `:169` (`Math.sign(NaN)` is `NaN`, so `isFavorable` is `false`, giving "down") and renders a confident-but-fictional cockpit row. The corroboration arm is already guarded (`outcome-corroboration.ts`).

**Files:**

- Modify: `apps/api/src/services/cron/meta-insights-adapter.ts:76-77` (finite-guard `spendCents`/`ctr`, mirror `:84`)
- Modify: `packages/core/src/recommendations/outcome-attribution.ts:117` (defense-in-depth `Number.isFinite(deltaPct)`)
- Test: `apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts`, `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts` (extend)

- [ ] **Step 5: Write the failing adapter test.** Extend `meta-insights-adapter.test.ts`. The existing NaN test at `:189-204` only covers `accountSpendCents` (the requested campaign row is finite there). Add the case where the **requested campaign's own** row is NaN, which today poisons `spendCents`:

```ts
it("never returns a NaN spendCents/ctr for the requested campaign (D7-3/D3-3)", async () => {
  getCampaignInsightsSpy.mockResolvedValue([
    { campaignId: "camp-42", spend: NaN, inlineLinkClickCtr: NaN }, // the requested campaign, garbage row
  ]);
  const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

  const metrics = await provider.getWindowMetrics(makeQuery()); // campaignId "camp-42"

  // Honest absence beats a poisoned number. Either return null (no usable window)
  // or finite zeros, but NEVER NaN, which renders a fictional cockpit row downstream.
  if (metrics !== null) {
    expect(Number.isFinite(metrics.spendCents)).toBe(true);
    expect(Number.isFinite(metrics.ctr)).toBe(true);
  }
});
```

- [ ] **Step 6: Implement the adapter guard.** At `:76-77`, mirror the `:84` pattern. Decide the honest-absence contract: a non-finite `spendCents`/`ctr` should make the window **unjudgeable**, not fabricate a delta. The cleanest fix returns `null` when the campaign sum is non-finite (the loop already returns `null` for an empty campaign at `:74`, and the orchestrator treats `null` as `meta_data_missing`, the correct fallback the adapter docstring already promises). If a partial window is preferred, omit the non-finite field and let the derivation's null-delta path hide the row:

```ts
const spendCents = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100);
const ctr = rows.reduce((sum, r) => sum + r.inlineLinkClickCtr, 0) / rows.length;
if (!Number.isFinite(spendCents) || !Number.isFinite(ctr)) return null; // unjudgeable, not fictional
```

- [ ] **Step 7: Write the failing derivation test (defense-in-depth).** Extend `outcome-attribution.test.ts`. Even if a future adapter regresses, the renderability predicate must refuse a NaN delta:

```ts
it("does not render or stamp a trust delta when deltaPct is non-finite (D7-3/D3-3 defense-in-depth)", () => {
  const row = attributeOneRecommendation({
    candidate: makePauseCandidate(),
    // a pre-window whose spendCents is NaN forces deltaPct NaN at :93
    preWindow: { spendCents: NaN, ctr: 0, dailyRowCount: 14 },
    postWindow: { spendCents: 1000, ctr: 0, dailyRowCount: 14 },
    overlaps: [],
  });
  expect(row.cockpitRenderable).toBe(false); // NaN !== null must NOT read as renderable
  expect(row.trustDelta).toBe("none"); // never a fabricated "down"
});
```

- [ ] **Step 8: Implement the derivation guard.** At `outcome-attribution.ts:117`, tighten the predicate:

```ts
const cockpitRenderable = flags.length === 0 && deltaPct !== null && Number.isFinite(deltaPct);
```

This also flows through `:118` (`confidence`), `:149-152` (`causalStrength`, which independently checks `deltaPct !== null`; add `&& Number.isFinite(deltaPct)` there too), and `:158` (the copy/trustDelta block, gated by `cockpitRenderable`), so the NaN row becomes an honest non-renderable outcome end-to-end.

- [ ] **Step 9: Verify both tests pass.** `pnpm --filter @switchboard/api test meta-insights-adapter` and `pnpm --filter @switchboard/core test outcome-attribution` should PASS.

- [ ] **Step 10: Build both packages and commit.** `pnpm --filter @switchboard/ad-optimizer build && pnpm --filter @switchboard/core build` (catch any untyped-`vi.fn` build red). Commit: `git commit -m "fix: finite-guard meta client mappers and the base attribution row (NaN-blind boundaries)"`

**Acceptance:** a non-numeric Meta `spend`/`conversions` maps to a finite `0` (never NaN) in the client; a garbage requested-campaign row yields honest absence (or finite zeros), never a NaN `spendCents`; a NaN `deltaPct` can no longer read as `cockpitRenderable` or fabricate `trustDelta:"down"`. The finite-guard is now symmetric on both boundaries.

---

## PR 2.4: Idempotent-replay approval marker (D5-3/D4-1)

**Why:** A weekly-cron Inngest step that replays the deterministic pause idempotency key (`mutate:riley:${recommendationId}:pause`, `riley-pause-submit-request.ts:83`) on a retry hits the ingress cached-replay branch for an existing `pending_approval` trace (`platform-ingress.ts:150-177`). That branch returns `{ok:true, result, workUnit}` with the cached `pending_approval` outcome but **never reconstructs `approvalRequired`**, the key the original park leg sets at `:363-373`. The consumer's branch order then mis-fires (`riley-pause-submitter.ts:47-81`): `res === null` false, then `!res.ok` false, then `"approvalRequired" in res` **false** (key absent on replay), then `res.result.outcome === "failed"` false (outcome is `pending_approval`), then it falls through to the **loudest** error, `"...UNEXPECTEDLY executed without approval... investigate governance seeding"` (`:78-79`), and returns `{parked:false}` (`:81`), dropping the `pauseParkedIndex` so `riley_self` ownership is lost. The `running`-trace branch (`:136-149`) correctly fails closed; only the resolved-outcome fall-through (`pending_approval`/`completed`/`failed`/`queued`) omits `approvalRequired`.

**Why a marker, not a rewrite:** `pending_approval` is the ONLY resolved outcome whose original response carried `approvalRequired`. The replay must reproduce that **shape** so the deterministic key returns the same answer on attempt N as on attempt 1 (idempotency's contract). The WorkTrace does not persist `lifecycleId`/`bindingHash` (verified: `buildWorkTrace` stores neither; they live only on the lifecycle/chat schemas), and they are not needed: the submitter branches solely on `"approvalRequired" in res && res.approvalRequired` (`:63`), and reads `res.lifecycleId ?? "?"` tolerantly (`:65`). So reconstruct `approvalRequired:true` and omit the optional lifecycle fields (legitimately absent on a replay; they were minted on the first park).

**This is load-bearing for Tier 5 D5-2's safety alarm:** Tier 5 adds a last-mile approved-lifecycle check whose alarm semantics assume the submitter's `"UNEXPECTEDLY executed without approval"` path fires ONLY on a genuine ungated execution. A replayed park that falsely trips that path would either desensitize the operator to the alarm or mask a real one. Land this before Tier 5 wires that alarm (overview §5: both are independent worktrees; note the ordering).

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts:150-177` (the resolved-outcome replay branch)
- Test: `packages/core/src/platform/__tests__/platform-ingress.test.ts` (extend, replay branch)
- Test: `apps/api/src/bootstrap/__tests__/riley-pause-submitter.test.ts` (extend, the replay outcome through the real submitter)

- [ ] **Step 1: Write the failing ingress test.** Extend `platform-ingress.test.ts` (reuse its `createConfig`/`baseRequest` harness). Drive a `getByIdempotencyKey` that returns a `pending_approval` trace and assert the replay response carries `approvalRequired:true`:

```ts
it("a replay of a pending_approval trace reconstructs approvalRequired:true (D5-3/D4-1)", async () => {
  const pendingTrace = {
    workUnitId: "wu-park",
    outcome: "pending_approval" as const,
    executionSummary: "Awaiting approval",
    executionOutputs: {},
    mode: "skill" as const,
    durationMs: 0,
    traceId: "trace-park",
    error: undefined,
    organizationId: "org-1",
    requestedAt: new Date().toISOString(),
    actor: { id: "system", type: "system" as const },
    intent: "campaign.pause",
    parameters: { campaignId: "camp-123" },
    deploymentContext: { deploymentId: "dep-1", skillSlug: "ad-optimizer" },
    trigger: "schedule" as const,
    idempotencyKey: "mutate:riley:rec_1:pause",
  };
  const traceStore = {
    persist: vi.fn(),
    claim: vi.fn(),
    getByWorkUnitId: vi.fn(),
    update: vi.fn(),
    getByIdempotencyKey: vi
      .fn()
      .mockResolvedValue({ trace: pendingTrace, integrity: { ok: true } }),
  } as unknown as WorkTraceStore;

  const ingress = new PlatformIngress(createConfig({ traceStore }));
  const res = await ingress.submit({
    ...baseRequest,
    trigger: "schedule",
    idempotencyKey: "mutate:riley:rec_1:pause",
  });

  expect(res.ok).toBe(true);
  // The load-bearing assertion: the replay shape MATCHES the original park.
  expect("approvalRequired" in res && res.approvalRequired).toBe(true);
  if (res.ok) expect(res.result.outcome).toBe("pending_approval");
});

it("a replay of a completed trace does NOT carry approvalRequired (unchanged)", async () => {
  // ...same harness with outcome:"completed"; "approvalRequired" in res === false
});
```

(Note the test must allow `trigger:"schedule"`: the default `testRegistration.allowedTriggers` is `["chat","api"]`; either add `"schedule"` to the registration in this test's config or use `trigger:"chat"`. The idempotency check at `:119` runs **before** trigger validation, so the replay branch is reached regardless; keep the trigger valid so a non-replay control path doesn't 4xx for the wrong reason.)

- [ ] **Step 2: Verify fail.** `pnpm --filter @switchboard/core test platform-ingress` should FAIL: the replay response has no `approvalRequired` key.

- [ ] **Step 3: Implement the marker.** In the resolved-outcome replay branch (`:150-177`), after building `result`, conditionally widen the returned object when the cached outcome is `pending_approval`:

```ts
const replayResponse = {
  ok: true as const,
  result,
  workUnit: {
    /* ...unchanged reconstruction from existingTrace... */
  },
};
// D5-3/D4-1: a pending_approval replay MUST carry the same approvalRequired marker
// the original park returned (platform-ingress.ts:363-373), so a deterministic-key
// retry yields the same shape and the pause submitter does not misread it as an
// ungated execution. lifecycleId/bindingHash are not persisted on the WorkTrace and
// were already minted on the first park, so they are legitimately absent here.
if (existingTrace.outcome === "pending_approval") {
  return { ...replayResponse, approvalRequired: true as const };
}
return replayResponse;
```

(Keep the `SubmitWorkResponse` union honest: the `approvalRequired:true` arm at `:90-97` already allows optional `lifecycleId`/`bindingHash`, so omitting them type-checks.)

- [ ] **Step 4: Verify the ingress test passes.** `pnpm --filter @switchboard/core test platform-ingress` should PASS. Build core (`pnpm --filter @switchboard/core build`).

- [ ] **Step 5: Write the failing submitter test.** Extend `riley-pause-submitter.test.ts`. This proves the end-to-end contract: a replay outcome (now carrying `approvalRequired:true`) is read as a park, not a false alarm. Mirror the file's existing `okResult` helper:

```ts
it("a replayed park (approvalRequired:true on pending_approval) reports parked, no false alarm (D5-3/D4-1)", async () => {
  const l = log();
  const submitter = buildRileyPauseSubmitter({
    submitRileyPause: async () =>
      ({
        ...okResult("pending_approval"),
        approvalRequired: true, // reconstructed by the ingress replay marker
        // lifecycleId intentionally absent on a replay
      }) as unknown as SubmitWorkResponse,
    log: l,
  });
  expect(await submitter(candidate)).toEqual({ parked: true });
  expect(l.error).not.toHaveBeenCalled(); // the "UNEXPECTEDLY executed" alarm must NOT fire
  expect(l.info).toHaveBeenCalledTimes(1); // logs the park (lifecycle "?" tolerated)
});
```

This test FAILS against the pre-fix ingress shape: without `approvalRequired`, the submitter would log the loud error and return `{parked:false}` (it is the regression guard for the whole finding). It PASSES once the marker is reconstructed (the submitter's existing `:63` branch handles it; no submitter change is required).

- [ ] **Step 6: Verify pass.** `pnpm --filter @switchboard/api test riley-pause-submitter` should PASS. Run `pnpm --filter @switchboard/api test` (the submitter is consumed there) and `pnpm typecheck`.

- [ ] **Step 7: Build and commit.** `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/api build`. Commit: `git commit -m "fix(core): reconstruct approvalRequired on a pending_approval idempotent replay"`

**Acceptance:** a replay of a `pending_approval` trace returns `approvalRequired:true` (byte-shape-compatible with the original park, minus the legitimately-absent lifecycle ids); the pause submitter reads it as `parked:true` with no false "executed without approval" alarm and no dropped park-truth; a `completed`/`failed`/`queued` replay is unchanged. **Integration-review seam #7. Load-bearing for Tier 5 D5-2.**

---

## P2 sweep appendix (fold in only if cheap; no full breakdown)

These related P2s touch the same files/classes this tier already opens. Pick them up opportunistically; each is one line of intent, not a planned task:

- **D4-2**: uncovered approve-to-dispatch throw-legs in the pause execution path lack tests; if PR 2.4 already has the ingress/submitter harness loaded, a couple of throw-leg assertions (dispatch throws gives `EXECUTION_EXCEPTION` finalize, no double-apply) are cheap to add (`platform-ingress.ts:427-458` is the seam).
- **D4-3 / D3-4**: ambiguous Meta timeout-but-applied write. `updateCampaignStatus` (`meta-ads-client.ts:355-363`) cannot distinguish "request timed out" from "applied then the response was lost," so a retry may double-apply or a real success may read as failure. A defensive `getCampaignStatus` re-read (already exists at `:370-382`) on a write timeout would disambiguate; only fold in if PR 2.3's `meta-ads-client.test.ts` harness makes it nearly free, otherwise leave for a dedicated write-idempotency follow-up.

(The remaining audit P2 long-tail, D3-5 booking-time stamping, D7-4 eval path-filter, D8-7 `window=all`, D5-6 internal-ingress trigger, is out of this tier's surface and stays in the overview's named-out-of-scope set.)

---

## Tier 2 dependencies and sequencing

- All four PRs are **independent of Tier 0/1** and of each other; they share no files except the eval harness (PR 2.1 and PR 2.2 both add fixtures and touch `drift-guard.test.ts`/`README.md`). Sequence 2.1 then 2.2 to avoid a trivial fixture/README merge conflict; 2.3 and 2.4 can land in any order alongside them.
- **Eval-gate discipline (every engine PR):** the `evals/riley-recommendation` gate is CI-blocking and currently green across 28 assertions. PR 2.1 and PR 2.2 each ADD fixtures and may add a `watchPatterns.has(...)` drift assertion; run `pnpm eval:riley` and `pnpm --filter @switchboard/eval-riley-recommendation test` locally before push. The eval path-filter detonates on `main`, not on the PR (`feedback_arch_job_path_filter_route_debt`-class); if a stale Prisma client throws a false "main is broken," run `pnpm reset` first.
- **Schema enum additions** (`burn`, `breach_building` on `WatchOutputSchema.pattern`, if it is a closed enum) are Zod string-enum edits (no DB migration), but they propagate through `@switchboard/schemas`; run `pnpm reset` so `@switchboard/ad-optimizer`/`@switchboard/core` see the new members before typecheck.
- **Exit criteria for Tier 2:** a zero-conversion durable burn acts instead of going silent and never reads as "good"; a sub-durable breach is visible as `breach_building`; no NaN can void a recommendation or fabricate a cockpit trust row at either boundary; a replayed park returns `approvalRequired:true` and the submitter reports `parked:true` with no false alarm. The eval gate is green with the new fixtures.

## Self-review (per writing-plans)

- **Spec coverage:** every Tier-2 finding in the overview table maps to a PR (D1-1 to 2.1, D1-2 to 2.2, D1-4 plus D7-3/D3-3 to 2.3, D5-3/D4-1 to 2.4). Integration-review seams #6 (D1-1 to eval) and #7 (D5-3/D4-1 to submitter) are each closed by their PR's acceptance.
- **Placeholder scan:** the only deliberately-conditional items are (a) whether `WatchOutputSchema.pattern` is a closed enum needing `burn`/`breach_building` added, flagged as an execution-time grep in PRs 2.1/2.2; (b) the exact `expectedActions`/`expectedWatchPatterns` of the burn fixtures, which must match whatever Step 4's implementation produces (the repo's `recovering-holds-no-destructive` precedent: fixtures encode actual behavior). Every code step shows the real change or a faithful sketch grounded in the cited line.
- **Type consistency:** `finiteFloat`/`finiteInt` (PR 2.3), the `approvalRequired:true as const` marker against the existing `SubmitWorkResponse` union arm (`platform-ingress.ts:90-97`), and the `WindowMetrics` null-vs-partial contract (PR 2.3b) are used consistently and match the cited signatures.
- **Eval/test guardrails honored:** DB-free engine tests; `fetch`/Prisma stubbed; spy args typed; package build run before push (untyped `vi.fn` reds the build while vitest greens, overview §6); no em-dashes; `Number.isFinite` is the single canonical guard across both NaN boundaries.
- **Open risk flagged for execution:** confirm the `WatchOutputSchema.pattern` enum shape and that the burn rule's pause-class routing still passes the existing tier/learning/evidence gates (a durable burn on an in-learning campaign should still be held as `in_learning_phase`, not force-paused; verify against `campaign-decision.ts:213-224` at execution time).
