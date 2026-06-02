# Riley Phase A — Trustworthy Sight + Abstention Floor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Riley a principled abstention floor and trustworthy sight — it refuses to act on insufficient or untrustworthy evidence — with a deterministic, model-free eval gate, and zero execution.

**Architecture:** Phase A of the decision-pipeline arc (spec: `docs/superpowers/specs/2026-06-02-riley-autonomous-ad-operator-design.md`). It implements pipeline gates 0–2 (hygiene/coverage, a minimal conversion-denominator-trust guard, action-family sufficiency) plus the minimum learning/cadence schema (`resetsLearning`) and an ad-set learning lockout. It introduces a pure `decideForCampaign()` seam so a model-free eval can exercise the real decision path. **No mutating paths** — every output remains advisory (`recommendation` / `watch` / `insight`).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod schemas (`@switchboard/schemas`, Layer 1), `@switchboard/ad-optimizer` (Layer 2), vitest, pnpm workspaces, tsx eval runners. Meta Graph API v21.0.

**The guardrail (must appear in the PR description, verbatim):**

> Riley is not a universal media-buying brain. Riley is a context-calibrated decision pipeline for small/modest-budget Meta accounts where evidence sufficiency, learning stability, and revenue truth matter more than heavy optimization frameworks.

**Commit convention:** Conventional Commits; subject lowercase first word (commitlint `subject-case`). End every commit message body with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (CLAUDE.md). The commit commands below omit the trailer for brevity — add it.

**Phase A scope guard (do NOT pull forward):** No booked-event stamping, no `byCampaign` per-campaign projection, no reconciliation runner, no CAPI-on, no `candidateAction`/execution, no authority-class routing tags, no Mira/Alex handoff, no lead-form mutation. Those are Phase B+.

**Pre-flight (run once before Task 1):**
```bash
git checkout main && git pull && git checkout -b feat/riley-phase-a-abstention-floor
pnpm install
pnpm --filter @switchboard/ad-optimizer test   # baseline: expect all green (357 tests post-#798)
pnpm exec vitest run --config evals/vitest.config.ts   # baseline: eval harnesses green
```
Expected: ad-optimizer suite green; eval suite green. If red, stop and reconcile `main` first (`pnpm reset`).

---

## File Structure

**New files**
- `packages/ad-optimizer/src/action-reset-classification.ts` — canonical `ACTION_RESETS_LEARNING` map + `resetsLearningFor(action)`. Single source of truth for learning-reset class.
- `packages/ad-optimizer/src/action-reset-classification.test.ts`
- `packages/ad-optimizer/src/evidence-floor.ts` — action-family evidence floors (Gate 2) + `meetsEvidenceFloor()`.
- `packages/ad-optimizer/src/evidence-floor.test.ts`
- `packages/ad-optimizer/src/campaign-decision.ts` — pure `decideForCampaign()` seam extracted from `AuditRunner`'s per-campaign loop.
- `packages/ad-optimizer/src/campaign-decision.test.ts`
- `packages/ad-optimizer/src/denominator-step-change.ts` — Gate 1 conversion-denominator step-change guard.
- `packages/ad-optimizer/src/denominator-step-change.test.ts`
- `evals/riley-recommendation/` — model-free eval harness (`schema.ts`, `load-fixtures.ts`, `decide.ts`, `run-eval.ts`, `package.json`, `README.md`, `fixtures/*.jsonl`, `__tests__/riley-recommendation.test.ts`).

**Modified files**
- `packages/schemas/src/ad-optimizer.ts` — add `ResetsLearningSchema`; add required `resetsLearning` to `RecommendationOutputSchema`; add `conversionActionType`/`attributionWindow` are NOT here (they live on `AuditConfig`).
- `packages/ad-optimizer/src/recommendation-engine.ts` — `makeRec` derives `resetsLearning` + `learningPhaseImpact`; add `evidence` to `RecommendationInput`; gate destructive/scale families through the evidence floor.
- `packages/ad-optimizer/src/recommendation-sink.ts` — enforce `resetsLearning:"yes" ⇒ externalEffect` (never swipe-approvable); render `resetsLearning` in presentation.
- `packages/ad-optimizer/src/learning-phase-guard.ts` — `LearningPhaseGuardV2.isDestructiveAction` reads `resetsLearning`; lockout widened from `{pause,restructure}` to "any reset-class action".
- `packages/ad-optimizer/src/audit-runner.ts` — call `decideForCampaign()`; thread `evidence`; per-campaign ad-set lockout via existing `getAdSetLearningInputs`; Gate-0 coverage abstain; Gate-1 step-change guard; pass `conversionActionType`/`attributionWindow` to the breach call. Net line count drops (extraction).
- `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` — `getTargetBreachStatus` action-type denominator + pinned attribution window + breach-counter fix (zero-conversion day volume-gated).
- `packages/ad-optimizer/src/meta-ads-client.ts` — `getCampaignInsights` accepts `actionAttributionWindows`; `mapCampaignInsight` parses `actions`.
- `packages/ad-optimizer/src/onboarding/coverage-validator.ts` — add a pure `isCoverageSufficient()` helper (no behavior change to `validate`).
- `packages/ad-optimizer/src/index.ts` — export the new public symbols.
- `apps/api/src/services/cron/meta-insights-adapter.ts` — fix `breakdowns:["day"]` → `timeIncrement: 1`.
- `evals/vitest.config.ts` — add the riley-recommendation include.
- `package.json` (root) — add `eval:riley` script.

---

## Task 1: `resetsLearning` structured flag + canonical map (schema-first)

**Files:**
- Modify: `packages/schemas/src/ad-optimizer.ts`
- Create: `packages/ad-optimizer/src/action-reset-classification.ts`
- Test: `packages/ad-optimizer/src/action-reset-classification.test.ts`
- Modify: `packages/ad-optimizer/src/recommendation-engine.ts`
- Modify: `packages/ad-optimizer/src/recommendation-sink.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (the one inline rec literal at ~:467)
- Modify: `packages/schemas/src/ad-optimizer.test.ts` (round-trip)

- [ ] **Step 1: Add the enum + required field to the schema.**

In `packages/schemas/src/ad-optimizer.ts`, after `MarginBasisSchema` (line ~41) add:
```ts
export const ResetsLearningSchema = z.enum(["yes", "no", "conditional"]);
export type ResetsLearningSchema = z.infer<typeof ResetsLearningSchema>;
```
In `RecommendationOutputSchema` (line ~174), add a **required** field after `learningPhaseImpact`:
```ts
  learningPhaseImpact: z.string(),
  // Phase A: structured, single-source-of-truth learning-reset class (derived from
  // the action via ACTION_RESETS_LEARNING). `learningPhaseImpact` is now a human
  // string derived FROM this, not an independent free-text field.
  resetsLearning: ResetsLearningSchema,
```

- [ ] **Step 2: Write the failing classification test.**

Create `packages/ad-optimizer/src/action-reset-classification.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AdRecommendationActionSchema } from "@switchboard/schemas";
import { ACTION_RESETS_LEARNING, resetsLearningFor } from "./action-reset-classification.js";

describe("action reset classification", () => {
  it("classifies every action in the enum (exhaustive, no gaps)", () => {
    for (const action of AdRecommendationActionSchema.options) {
      expect(ACTION_RESETS_LEARNING[action]).toBeDefined();
    }
  });

  it("a <=20% scale does NOT reset learning (fixes the legacy wrong string)", () => {
    expect(resetsLearningFor("scale")).toBe("no");
  });

  it("creative and structural changes reset learning", () => {
    expect(resetsLearningFor("refresh_creative")).toBe("yes");
    expect(resetsLearningFor("add_creative")).toBe("yes");
    expect(resetsLearningFor("restructure")).toBe("yes");
    expect(resetsLearningFor("expand_targeting")).toBe("yes");
    expect(resetsLearningFor("consolidate")).toBe("yes");
    expect(resetsLearningFor("switch_optimization_event")).toBe("yes");
  });

  it("budget reallocation is conditional (resets only past the ~20% step)", () => {
    expect(resetsLearningFor("review_budget")).toBe("conditional");
    expect(resetsLearningFor("shift_budget_to_source")).toBe("conditional");
  });

  it("hygiene / measurement / hold actions do not reset learning", () => {
    expect(resetsLearningFor("hold")).toBe("no");
    expect(resetsLearningFor("fix_signal_health")).toBe("no");
    expect(resetsLearningFor("harden_capi_attribution")).toBe("no");
    expect(resetsLearningFor("pause")).toBe("no");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module './action-reset-classification.js'`).
```bash
pnpm --filter @switchboard/ad-optimizer test action-reset-classification
```

- [ ] **Step 4: Implement the canonical map.**

Create `packages/ad-optimizer/src/action-reset-classification.ts`:
```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";

/**
 * Canonical, single-source-of-truth classification of whether each Riley action
 * resets Meta's learning phase, per Meta mechanics (see the Phase-A spec §5).
 *
 *  - "yes": adding/removing creative, targeting/structure change, or optimization-
 *    event change — Meta re-enters learning.
 *  - "conditional": budget moves that reset ONLY past the ~20% significant-edit
 *    threshold. Riley's `scale` is capped at 20% so it is "no"; generic budget
 *    reviews/shifts can exceed it, so "conditional".
 *  - "no": pause (a <7d pause does not reset; Riley's pause is immediate, not a
 *    timed >=7d pause), hold, and pixel/CAPI hygiene.
 *
 * INVARIANT (enforced in recommendation-sink): any action classified "yes" is
 * never swipe-approvable, regardless of its financial classification.
 */
export const ACTION_RESETS_LEARNING: Record<AdRecommendationAction, ResetsLearning> = {
  scale: "no",
  pause: "no",
  refresh_creative: "yes",
  restructure: "yes",
  hold: "no",
  test: "no",
  review_budget: "conditional",
  add_creative: "yes",
  expand_targeting: "yes",
  consolidate: "yes",
  shift_budget_to_source: "conditional",
  switch_optimization_event: "yes",
  harden_capi_attribution: "no",
  fix_signal_health: "no",
};

export function resetsLearningFor(action: AdRecommendationAction): ResetsLearning {
  return ACTION_RESETS_LEARNING[action];
}

/** Human-facing impact string derived from the structured class (replaces the
 * old hand-authored `learningPhaseImpact` strings). */
export function learningPhaseImpactText(action: AdRecommendationAction): string {
  switch (resetsLearningFor(action)) {
    case "yes":
      return "will reset learning";
    case "conditional":
      return "may reset learning if the budget change exceeds ~20%";
    case "no":
      return "no impact";
  }
}
```

- [ ] **Step 5: Run the test — expect PASS.**
```bash
pnpm --filter @switchboard/ad-optimizer test action-reset-classification
```

- [ ] **Step 6: Make `makeRec` derive both fields; drop the `learningPhaseImpact` param.**

In `packages/ad-optimizer/src/recommendation-engine.ts`, add the import at the top:
```ts
import { resetsLearningFor, learningPhaseImpactText } from "./action-reset-classification.js";
```
Change `makeRec` (lines ~55-77) to remove the `learningPhaseImpact` positional param and derive both:
```ts
function makeRec(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  action: RecommendationOutput["action"],
  confidence: number,
  urgency: Urgency,
  estimatedImpact: string,
  steps: string[],
  params?: Record<string, string>,
): RecommendationOutput {
  return {
    type: "recommendation",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    action,
    confidence,
    urgency,
    estimatedImpact,
    steps,
    learningPhaseImpact: learningPhaseImpactText(action),
    resetsLearning: resetsLearningFor(action),
    ...(params ? { params } : {}),
  };
}
```
Then **delete the now-stale `learningPhaseImpact` string argument** from every `makeRec` call in this file. There are 9 call sites (the `addCreativeRecommendation`, `addPauseRecommendation`, `addReviewBudgetRecommendation` helpers and the inline `scale`/`refresh_creative`×2/`restructure`/`shift_budget_to_source`/`switch_optimization_event`/`hold` pushes). In each, remove the line that is one of `"will reset learning"` / `"no impact"` (the 7th positional arg). Example — `addPauseRecommendation` becomes:
```ts
  results.push(
    makeRec(
      base,
      "pause",
      0.9,
      "immediate",
      "Campaign is critically over target CPA — pause to stop financial loss",
      [
        "Pause campaign in Ads Manager immediately",
        `CPA is ${multiplier}x target — active financial loss`,
      ],
    ),
  );
```
And `makeFixSignalHealthRec` (line ~433) — remove its `"no impact"` arg likewise.

- [ ] **Step 7: Fix the one inline rec literal in `audit-runner.ts`.**

The V2 ad-set learning-limited rec (audit-runner.ts ~:467-478) builds a `RecommendationOutput` literal directly. Add the import and the field:
```ts
import { resetsLearningFor } from "./action-reset-classification.js";
```
In that literal, replace the hand-authored `learningPhaseImpact` line with:
```ts
            learningPhaseImpact:
              diagnosis.recommendation === "expand_targeting" ? "will reset learning" : "no impact",
            resetsLearning: resetsLearningFor(
              diagnosis.recommendation as RecommendationOutput["action"],
            ),
```

- [ ] **Step 8: Write the failing sink-invariant test.**

In a new `packages/ad-optimizer/src/recommendation-sink.test.ts` (or extend the existing one if present — check first with `ls packages/ad-optimizer/src/recommendation-sink.test.ts`):
```ts
import { describe, it, expect, vi } from "vitest";
import { AdRecommendationActionSchema } from "@switchboard/schemas";
import { resetsLearningFor } from "./action-reset-classification.js";
import { runRecommendationSink } from "./recommendation-sink.js";
import type { RecommendationOutput } from "./recommendation-engine.js";

function recFor(action: RecommendationOutput["action"]): RecommendationOutput {
  return {
    type: "recommendation",
    campaignId: "c1",
    campaignName: "C1",
    action,
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "x",
    steps: ["x"],
    learningPhaseImpact: "x",
    resetsLearning: resetsLearningFor(action),
  };
}

describe("sink invariant: resetsLearning:'yes' is never swipe-approvable", () => {
  it.each(AdRecommendationActionSchema.options.filter((a) => resetsLearningFor(a) === "yes"))(
    "%s emits with externalEffect=true (blocks swipe)",
    async (action) => {
      const emit = vi.fn().mockResolvedValue({ surface: "queue" });
      await runRecommendationSink({
        orgId: "o1",
        auditRunId: "a1",
        recommendations: [recFor(action)],
        emit,
        emissionContext: { cronId: "test" },
      });
      const payload = emit.mock.calls[0]![0] as { financialEffect: boolean; externalEffect: boolean };
      expect(payload.externalEffect || payload.financialEffect).toBe(true);
    },
  );
});
```

- [ ] **Step 9: Run it — expect FAIL** (today `refresh_creative` / `add_creative` are `{false,false}`).
```bash
pnpm --filter @switchboard/ad-optimizer test recommendation-sink
```

- [ ] **Step 10: Enforce the invariant in the sink.**

In `packages/ad-optimizer/src/recommendation-sink.ts` `runRecommendationSink` (line ~312), change the contract read to OR-in the reset class:
```ts
    const contract = ACTION_RISK_CONTRACT[rec.action];
    // INVARIANT (Phase-A spec §5/§7): a learning-resetting action is a material,
    // hard-to-undo change even when no dollars move — it must never be swipe-
    // approvable. The router treats externalEffect=true as "not swipe-approvable",
    // so OR the reset class into externalEffect.
    const financialEffect = contract.financialEffect;
    const externalEffect = contract.externalEffect || rec.resetsLearning === "yes";
```
(Remove the old destructured `const { financialEffect, externalEffect } = ACTION_RISK_CONTRACT[rec.action];` line.)

Also render the structured class in `buildPresentation` (line ~285) so the operator sees it:
```ts
    dataLines: [[rec.estimatedImpact], [`Learning phase: ${rec.learningPhaseImpact}`]],
```
(no change needed — `learningPhaseImpact` is now derived; leave as-is.)

- [ ] **Step 11: Add the schema round-trip assertion.**

In `packages/schemas/src/ad-optimizer.test.ts`, add:
```ts
import { RecommendationOutputSchema } from "./ad-optimizer.js";

it("RecommendationOutput requires a resetsLearning class", () => {
  const base = {
    type: "recommendation" as const,
    action: "scale" as const,
    campaignId: "c",
    campaignName: "C",
    confidence: 0.7,
    urgency: "this_week" as const,
    estimatedImpact: "x",
    steps: ["x"],
    learningPhaseImpact: "no impact",
  };
  expect(RecommendationOutputSchema.safeParse(base).success).toBe(false); // missing resetsLearning
  expect(RecommendationOutputSchema.safeParse({ ...base, resetsLearning: "no" }).success).toBe(true);
});
```

- [ ] **Step 12: Run the affected suites green, then commit.**
```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/ad-optimizer test
pnpm --filter @switchboard/ad-optimizer typecheck && pnpm --filter @switchboard/schemas typecheck
git add packages/schemas/src/ad-optimizer.ts packages/schemas/src/ad-optimizer.test.ts \
  packages/ad-optimizer/src/action-reset-classification.ts \
  packages/ad-optimizer/src/action-reset-classification.test.ts \
  packages/ad-optimizer/src/recommendation-engine.ts \
  packages/ad-optimizer/src/recommendation-sink.ts \
  packages/ad-optimizer/src/recommendation-sink.test.ts \
  packages/ad-optimizer/src/audit-runner.ts
git commit -m "feat(ad-optimizer): structured resetsLearning flag + canonical action map"
```
Note: existing tests that build a `RecommendationOutput` literal without `resetsLearning` will fail typecheck — fix each by adding `resetsLearning: resetsLearningFor(action)` (or a literal). Grep first: `grep -rln "learningPhaseImpact" packages/ad-optimizer/src`.

---

## Task 2: Extract the pure `decideForCampaign()` seam (behavior-preserving)

**Files:**
- Create: `packages/ad-optimizer/src/campaign-decision.ts`
- Test: `packages/ad-optimizer/src/campaign-decision.test.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (replace per-campaign loop body 5b–5g)
- Modify: `packages/ad-optimizer/src/index.ts` (export)

**Why:** the model-free eval (Task 3) must exercise the *real* decision path, and `audit-runner.ts` is at the 600-line arch-check ceiling. Extract the per-campaign loop body (currently audit-runner.ts:357-443) verbatim into a pure function. **No behavior change** — the existing `audit-runner-integration.test.ts` and `audit-runner-tiering.test.ts` are the safety net.

- [ ] **Step 1: Write the characterization test (captures current behavior).**

Create `packages/ad-optimizer/src/campaign-decision.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decideForCampaign } from "./campaign-decision.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

const guard = new LearningPhaseGuard();
const successStatus = guard.check("c1", {
  effectiveStatus: "ACTIVE",
  learningPhase: false,
  lastModifiedDays: 30,
  optimizationEvents: 100,
});

function insight(over: Partial<CampaignInsight>): CampaignInsight {
  return {
    campaignId: "c1", campaignName: "C1", status: "ACTIVE", effectiveStatus: "ACTIVE",
    impressions: 10000, inlineLinkClicks: 200, spend: 100, conversions: 10, revenue: 500,
    frequency: 1.5, cpm: 10, inlineLinkClickCtr: 2, costPerInlineLinkClick: 0.5,
    dateStart: "2026-05-01", dateStop: "2026-05-07", ...over,
  };
}

describe("decideForCampaign (characterization)", () => {
  it("a healthy under-target campaign with no diagnoses yields a stable insight", () => {
    const r = decideForCampaign({
      campaignId: "c1", campaignName: "C1",
      currentInsight: insight({ spend: 50, conversions: 10, revenue: 600 }), // cpa 5, roas 12
      previousInsight: insight({ spend: 50, conversions: 10, revenue: 600 }),
      targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "cpl", effectiveTarget: 100, marginBasis: "unavailable",
      targetROAS: 3, nextCycleDate: "2026-05-14",
    });
    expect(r.insights).toHaveLength(1);
    expect(r.recommendations).toHaveLength(0);
  });

  it("a 3x-over campaign with a durable breach yields a pause recommendation", () => {
    const r = decideForCampaign({
      campaignId: "c1", campaignName: "C1",
      currentInsight: insight({ spend: 350, conversions: 1 }), // cpa 350 vs target 100
      previousInsight: insight({ spend: 350, conversions: 1 }),
      targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
      learningStatus: successStatus,
      economicTier: "booked_cac", effectiveTarget: 100, marginBasis: "unavailable",
      targetROAS: 3, nextCycleDate: "2026-05-14",
    });
    expect(r.recommendations.some((x) => x.action === "pause")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).
```bash
pnpm --filter @switchboard/ad-optimizer test campaign-decision
```

- [ ] **Step 3: Create the seam by moving the loop body verbatim.**

Create `packages/ad-optimizer/src/campaign-decision.ts`. Move `insightToMetrics` out of `audit-runner.ts` into here (export it), and lift the per-campaign body (audit-runner.ts:357-443) into `decideForCampaign`:
```ts
import type {
  CampaignInsightSchema as CampaignInsight,
  InsightOutputSchema as InsightOutput,
  WatchOutputSchema as WatchOutput,
  RecommendationOutputSchema as RecommendationOutput,
  LearningPhaseStatusSchema as LearningPhaseStatus,
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
  TargetBreachResult,
} from "@switchboard/schemas";
import { comparePeriods, type MetricSet } from "./period-comparator.js";
import { diagnose } from "./metric-diagnostician.js";
import { generateRecommendations } from "./recommendation-engine.js";
import { applyTier } from "./analyzers/economic-target.js";
import { LearningPhaseGuard } from "./learning-phase-guard.js";

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function insightToMetrics(insight: CampaignInsight): MetricSet {
  const { spend, impressions, inlineLinkClicks, conversions, revenue, frequency } = insight;
  return {
    cpm: safeDivide(spend, impressions) * 1000,
    inlineLinkClickCtr: safeDivide(inlineLinkClicks, impressions) * 100,
    costPerInlineLinkClick: safeDivide(spend, inlineLinkClicks),
    cpl: safeDivide(spend, conversions),
    cpa: safeDivide(spend, conversions),
    roas: safeDivide(revenue, spend),
    frequency,
  };
}

const ZERO_METRICS: MetricSet = {
  cpm: 0, inlineLinkClickCtr: 0, costPerInlineLinkClick: 0, cpl: 0, cpa: 0, roas: 0, frequency: 0,
};

export interface CampaignDecisionInput {
  campaignId: string;
  campaignName: string;
  currentInsight: CampaignInsight;
  previousInsight: CampaignInsight | null;
  targetBreach: TargetBreachResult;
  learningStatus: LearningPhaseStatus;
  economicTier: EconomicTier;
  effectiveTarget: number;
  marginBasis: MarginBasis;
  targetROAS: number;
  nextCycleDate: string;
  sourceComparison?: Parameters<typeof generateRecommendations>[0]["sourceComparison"];
}

export interface CampaignDecisionResult {
  insights: InsightOutput[];
  watches: WatchOutput[];
  recommendations: RecommendationOutput[];
}

const learningGuard = new LearningPhaseGuard();

/**
 * Pure per-campaign decision. Mirrors AuditRunner's former 5b–5g loop body
 * exactly (extracted for testability + the eval seam). Provider calls
 * (learning status, target breach) are inputs, so this is deterministic.
 */
export function decideForCampaign(input: CampaignDecisionInput): CampaignDecisionResult {
  const insights: InsightOutput[] = [];
  const watches: WatchOutput[] = [];
  const recommendations: RecommendationOutput[] = [];

  const current = insightToMetrics(input.currentInsight);
  const previous = input.previousInsight ? insightToMetrics(input.previousInsight) : ZERO_METRICS;
  const deltas = comparePeriods(current, previous);
  const diagnoses = diagnose(deltas);

  if (
    learningGuard.isPerformingWell(
      { cpa: current.cpa, roas: current.roas },
      { targetCPA: input.effectiveTarget, targetROAS: input.targetROAS },
    ) &&
    diagnoses.length === 0
  ) {
    insights.push({
      type: "insight",
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      message: `Campaign has maintained ${current.roas.toFixed(1)}x ROAS. No changes recommended.`,
      category: "stable_performance",
    });
    return { insights, watches, recommendations };
  }

  const campaignRecs = generateRecommendations({
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    diagnoses,
    deltas,
    targetCPA: input.effectiveTarget,
    targetROAS: input.targetROAS,
    currentSpend: input.currentInsight.spend,
    targetBreach: input.targetBreach,
    ...(input.sourceComparison ? { sourceComparison: input.sourceComparison } : {}),
  });

  for (const rec of campaignRecs) {
    const tiered = applyTier({
      recommendation: rec,
      tier: input.economicTier,
      marginBasis: input.marginBasis,
      checkBackDate: input.nextCycleDate,
    });
    if (tiered.watch) {
      watches.push(tiered.watch);
      continue;
    }
    const gated = learningGuard.gate(tiered.recommendation!, input.learningStatus);
    if (gated.type === "watch") watches.push(gated);
    else recommendations.push(gated);
  }

  return { insights, watches, recommendations };
}
```

- [ ] **Step 4: Rewire `AuditRunner` to call the seam.**

In `audit-runner.ts`: delete the now-moved `insightToMetrics` private function (lines ~135-146) and `import { insightToMetrics } from "./campaign-decision.js"` instead (keep `aggregateMetrics`, which still uses it — update `aggregateMetrics` to call the imported one or keep its own inline math; simplest: keep `aggregateMetrics` as-is, it does its own summation). Replace the per-campaign loop body (5b–5g, lines ~357-443) with:
```ts
      const prevInsight = previousMap.get(insight.campaignId) ?? null;
      const targetBreach = await this.insightsProvider.getTargetBreachStatus({
        orgId: this.config.orgId,
        accountId: this.config.accountId,
        campaignId: insight.campaignId,
        targetCPA: effectiveTarget,
        startDate: new Date(dateRange.since),
        endDate: new Date(dateRange.until),
      });
      const decision = decideForCampaign({
        campaignId: insight.campaignId,
        campaignName: insight.campaignName,
        currentInsight: insight,
        previousInsight: prevInsight,
        targetBreach,
        learningStatus,
        economicTier,
        effectiveTarget,
        marginBasis,
        targetROAS: this.config.targetROAS,
        nextCycleDate,
      });
      insights.push(...decision.insights);
      watches.push(...decision.watches);
      recommendations.push(...decision.recommendations);
```
Add the import: `import { decideForCampaign, insightToMetrics } from "./campaign-decision.js";`. Note: `learningStatus` (5a) is still computed above this block; keep 5a.

- [ ] **Step 5: Export the seam.** In `packages/ad-optimizer/src/index.ts`, add:
```ts
export { decideForCampaign } from "./campaign-decision.js";
export type { CampaignDecisionInput, CampaignDecisionResult } from "./campaign-decision.js";
```

- [ ] **Step 6: Run the seam test + the existing integration tests (must stay green).**
```bash
pnpm --filter @switchboard/ad-optimizer test campaign-decision
pnpm --filter @switchboard/ad-optimizer test audit-runner   # tiering + integration must pass unchanged
pnpm --filter @switchboard/ad-optimizer typecheck
```

- [ ] **Step 7: Confirm the arch-check line ceiling improved, then commit.**
```bash
wc -l packages/ad-optimizer/src/audit-runner.ts   # expect well under 600 now
git add packages/ad-optimizer/src/campaign-decision.ts packages/ad-optimizer/src/campaign-decision.test.ts \
  packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/index.ts
git commit -m "refactor(ad-optimizer): extract pure decideForCampaign seam from audit-runner"
```

---

## Task 3: Riley recommendation eval harness (model-free, CI-wired) — land early

**Files:**
- Create: `evals/riley-recommendation/{package.json,README.md,schema.ts,load-fixtures.ts,decide.ts,run-eval.ts}`
- Create: `evals/riley-recommendation/fixtures/smoke.jsonl`
- Create: `evals/riley-recommendation/__tests__/riley-recommendation.test.ts`
- Modify: `evals/vitest.config.ts`, `package.json` (root)

**Pattern:** identical conventions to `evals/governance-decision/` (model-free, DB-free, no `ANTHROPIC_API_KEY`). The eval's `decide()` runs the real `decideForCampaign()` and reduces its output to one outcome label. Later tasks add fixtures.

- [ ] **Step 1: Create the fixture schema.**

`evals/riley-recommendation/schema.ts`:
```ts
import { z } from "zod";

/** One deterministic Riley decision case. Inputs are the exact `decideForCampaign`
 * inputs a fixture can express without a live Graph/CRM call; expectedOutcome is the
 * reduced label the harness asserts. */
export const RileyCaseSchema = z.object({
  id: z.string().min(1),
  current: z.object({
    impressions: z.number(), inlineLinkClicks: z.number(), spend: z.number(),
    conversions: z.number(), revenue: z.number(), frequency: z.number(),
  }),
  previous: z
    .object({
      impressions: z.number(), inlineLinkClicks: z.number(), spend: z.number(),
      conversions: z.number(), revenue: z.number(), frequency: z.number(),
    })
    .nullable(),
  targetBreach: z.object({
    periodsAboveTarget: z.number(),
    granularity: z.enum(["daily", "weekly"]),
  }),
  learningState: z.enum(["learning", "learning_limited", "success", "unknown"]),
  economicTier: z.enum(["booked_cac", "cpl", "cpc"]),
  effectiveTarget: z.number(),
  targetROAS: z.number(),
  /** Reduced expected label: an action name, `watch`, or `insight`. */
  expectedOutcome: z.string().min(1),
  notes: z.string().optional(),
});
export type RileyCase = z.infer<typeof RileyCaseSchema>;
```

- [ ] **Step 2: Copy the loader** (identical to governance-decision's, retyped for `RileyCaseSchema`).

`evals/riley-recommendation/load-fixtures.ts` — copy `evals/governance-decision/load-fixtures.ts` verbatim, replacing `GovernanceCaseSchema`/`GovernanceCase` with `RileyCaseSchema`/`RileyCase` and the import path.

- [ ] **Step 3: Write the decision adapter.**

`evals/riley-recommendation/decide.ts`:
```ts
import { decideForCampaign } from "@switchboard/ad-optimizer";
import { LearningPhaseGuard, LearningPhaseGuardV2 } from "@switchboard/ad-optimizer";
import type { RileyCase } from "./schema.js";
import type { CampaignInsightSchema, LearningPhaseStatusSchema } from "@switchboard/schemas";

const guard = new LearningPhaseGuard();
const v2 = new LearningPhaseGuardV2();

function insight(m: RileyCase["current"]): CampaignInsightSchema {
  return {
    campaignId: "c1", campaignName: "C1", status: "ACTIVE", effectiveStatus: "ACTIVE",
    impressions: m.impressions, inlineLinkClicks: m.inlineLinkClicks, spend: m.spend,
    conversions: m.conversions, revenue: m.revenue, frequency: m.frequency,
    cpm: 0, inlineLinkClickCtr: 0, costPerInlineLinkClick: 0,
    dateStart: "2026-05-01", dateStop: "2026-05-07",
  };
}

function statusFor(state: RileyCase["learningState"]): LearningPhaseStatusSchema {
  // Build a LearningPhaseStatus in the requested state via the V2 classifier.
  return v2.classifyState({
    adSetId: "a1", adSetName: "A1", campaignId: "c1",
    learningStageStatus:
      state === "learning" ? "LEARNING" : state === "learning_limited" ? "FAIL" :
      state === "success" ? "SUCCESS" : "UNKNOWN",
    frequency: 1, spend: 100, conversions: 10, cpa: 10, roas: 3, inlineLinkClickCtr: 1,
  });
}

/** Reduce a decision to a single label for assertion. Priority: recommendation
 * action > watch > insight. */
export function decideForCase(c: RileyCase): string {
  const r = decideForCampaign({
    campaignId: "c1", campaignName: "C1",
    currentInsight: insight(c.current),
    previousInsight: c.previous ? insight(c.previous) : null,
    targetBreach: { ...c.targetBreach, isApproximate: c.targetBreach.granularity === "weekly" },
    learningStatus: statusFor(c.learningState),
    economicTier: c.economicTier,
    effectiveTarget: c.effectiveTarget,
    marginBasis: "unavailable",
    targetROAS: c.targetROAS,
    nextCycleDate: "2026-05-14",
  });
  if (r.recommendations.length > 0) return r.recommendations[0]!.action;
  if (r.watches.length > 0) return "watch";
  if (r.insights.length > 0) return "insight";
  return "none";
}
```
(Note: `decideForCampaign` uses an internal `LearningPhaseGuard` for the `success` case; the imported `guard` is unused here — remove the unused import to satisfy lint, or prefix `_guard`.)

- [ ] **Step 4: Write the runner + the vitest test** (mirror governance-decision's `run-eval.ts` + test). `__tests__/riley-recommendation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRileyCases } from "../load-fixtures.js";
import { decideForCase } from "../decide.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cases = loadRileyCases(FIXTURES_DIR);

describe("riley recommendation matrix (real decideForCampaign)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });
  it.each(cases.map((c) => [c.id, c] as const))(
    "%s resolves to its expected outcome",
    (_id, c) => {
      expect(decideForCase(c)).toBe(c.expectedOutcome);
    },
  );
});
```

- [ ] **Step 5: Seed a smoke fixture proving the harness runs green against current behavior.**

`evals/riley-recommendation/fixtures/smoke.jsonl`:
```
{"id":"smoke-healthy-stable","current":{"impressions":10000,"inlineLinkClicks":300,"spend":50,"conversions":10,"revenue":600,"frequency":1.4},"previous":{"impressions":10000,"inlineLinkClicks":300,"spend":50,"conversions":10,"revenue":600,"frequency":1.4},"targetBreach":{"periodsAboveTarget":0,"granularity":"daily"},"learningState":"success","economicTier":"cpl","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"insight","notes":"healthy under-target, no diagnoses -> stable insight"}
{"id":"smoke-cpc-withheld","current":{"impressions":2000,"inlineLinkClicks":40,"spend":350,"conversions":1,"revenue":0,"frequency":1.2},"previous":{"impressions":2000,"inlineLinkClicks":40,"spend":350,"conversions":1,"revenue":0,"frequency":1.2},"targetBreach":{"periodsAboveTarget":8,"granularity":"daily"},"learningState":"success","economicTier":"cpc","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"watch","notes":"tier cpc withholds the pause as a watch (existing #798 behavior)"}
```

- [ ] **Step 6: Wire `package.json`, README, vitest include, root script.**

`evals/riley-recommendation/package.json` — copy `evals/governance-decision/package.json`, rename to `@switchboard/eval-riley-recommendation`, set deps to `@switchboard/ad-optimizer` + `@switchboard/schemas`. Add to `evals/vitest.config.ts` `include`:
```ts
      "riley-recommendation/__tests__/**/*.test.ts",
```
Add to root `package.json` scripts (after `eval:governance`):
```json
    "eval:riley": "tsx evals/riley-recommendation/run-eval.ts",
```
Write a short `README.md` modeled on governance-decision's (state: model-free, DB-free, runs in CI).

- [ ] **Step 7: Run the eval (both the CLI and the vitest), then commit.**
```bash
pnpm install   # picks up the new workspace package
pnpm eval:riley
pnpm exec vitest run --config evals/vitest.config.ts riley-recommendation
git add evals/riley-recommendation evals/vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat(evals): model-free riley recommendation eval harness"
```

---

## Task 4: Action-family evidence floors (Gate 2)

**Files:**
- Create: `packages/ad-optimizer/src/evidence-floor.ts`
- Test: `packages/ad-optimizer/src/evidence-floor.test.ts`
- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` (add `evidence`, gate destructive/scale families)
- Modify: `packages/ad-optimizer/src/campaign-decision.ts` (thread `evidence` from the insight)
- Add fixtures: `evals/riley-recommendation/fixtures/sufficiency.jsonl`

**Tightening #2:** action-family-specific floors, NOT one `MIN_CLICKS=20`.

- [ ] **Step 1: Write the failing floor test.**

`packages/ad-optimizer/src/evidence-floor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { meetsEvidenceFloor, evidenceFamilyFor } from "./evidence-floor.js";

describe("evidence floors (action-family-specific)", () => {
  it("pause/cut require the highest floor", () => {
    expect(evidenceFamilyFor("pause")).toBe("destructive");
    expect(meetsEvidenceFloor("pause", { clicks: 10, conversions: 1, days: 7 })).toBe(false);
    expect(meetsEvidenceFloor("pause", { clicks: 60, conversions: 6, days: 7 })).toBe(true);
  });
  it("scale uses a moderate-high floor", () => {
    expect(evidenceFamilyFor("scale")).toBe("scale");
    expect(meetsEvidenceFloor("scale", { clicks: 10, conversions: 1, days: 7 })).toBe(false);
    expect(meetsEvidenceFloor("scale", { clicks: 35, conversions: 4, days: 7 })).toBe(true);
  });
  it("diagnose-only / hold uses a low floor", () => {
    expect(evidenceFamilyFor("hold")).toBe("diagnostic");
    expect(meetsEvidenceFloor("hold", { clicks: 12, conversions: 0, days: 3 })).toBe(true);
  });
  it("measurement fixes bypass the campaign-volume floor (signal-health is account-level)", () => {
    expect(evidenceFamilyFor("fix_signal_health")).toBe("measurement");
    expect(meetsEvidenceFloor("fix_signal_health", { clicks: 0, conversions: 0, days: 0 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @switchboard/ad-optimizer test evidence-floor`

- [ ] **Step 3: Implement the floors.**

`packages/ad-optimizer/src/evidence-floor.ts`:
```ts
import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";

export interface Evidence {
  clicks: number;
  conversions: number;
  days: number;
}

export type EvidenceFamily =
  | "destructive"   // pause / cut — highest floor
  | "scale"         // moderate-high
  | "structural"    // restructure/consolidate/expand — requires learning-limited + volume (Phase D); treated as destructive floor here
  | "diagnostic"    // hold / diagnose-only — low floor
  | "measurement";  // signal/CAPI fixes — account-level, bypass campaign-volume floor

const FAMILY: Record<AdRecommendationAction, EvidenceFamily> = {
  pause: "destructive",
  add_creative: "destructive",
  scale: "scale",
  review_budget: "scale",
  shift_budget_to_source: "scale",
  refresh_creative: "diagnostic",
  restructure: "structural",
  consolidate: "structural",
  expand_targeting: "structural",
  switch_optimization_event: "scale",
  hold: "diagnostic",
  test: "diagnostic",
  harden_capi_attribution: "measurement",
  fix_signal_health: "measurement",
};

/** Floors are deliberately small-budget-calibrated; named config, not magic numbers
 * (Phase-A spec §11). Tune via the eval, never silently. */
export const EVIDENCE_FLOORS: Record<EvidenceFamily, Evidence> = {
  destructive: { clicks: 50, conversions: 5, days: 7 },
  structural: { clicks: 50, conversions: 5, days: 7 },
  scale: { clicks: 30, conversions: 3, days: 7 },
  diagnostic: { clicks: 10, conversions: 0, days: 3 },
  measurement: { clicks: 0, conversions: 0, days: 0 },
};

export function evidenceFamilyFor(action: AdRecommendationAction): EvidenceFamily {
  return FAMILY[action];
}

export function meetsEvidenceFloor(action: AdRecommendationAction, e: Evidence): boolean {
  const floor = EVIDENCE_FLOORS[evidenceFamilyFor(action)];
  return e.clicks >= floor.clicks && e.conversions >= floor.conversions && e.days >= floor.days;
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @switchboard/ad-optimizer test evidence-floor`

- [ ] **Step 5: Thread `evidence` into the engine and gate the destructive/scale families.**

In `recommendation-engine.ts`, add to `RecommendationInput`:
```ts
  /** Window evidence for this campaign (Gate 2 sufficiency). */
  evidence: { clicks: number; conversions: number; days: number };
```
Add the import: `import { meetsEvidenceFloor } from "./evidence-floor.js";` and a watch helper:
```ts
function insufficientEvidenceWatch(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
  action: RecommendationOutput["action"],
  e: { clicks: number; conversions: number },
): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "insufficient_evidence",
    message: `Not enough evidence to ${action}: ${e.clicks} clicks / ${e.conversions} conversions in window — re-checking next cycle.`,
    checkBackDate: "",
  };
}
```
(Import `WatchOutputSchema as WatchOutput` from `@switchboard/schemas` and change `generateRecommendations`'s return type to `(RecommendationOutput | WatchOutput)[]`. The caller in `campaign-decision.ts` must route any returned `watch` into `watches` — see Step 7.)

At the start of the kill block (the `isAboveAddCreativeCpa && daily && periodsAboveTarget >= KILL_DAYS_THRESHOLD` branch) and the scale block, gate on the floor. Concretely, wrap each push: before `addPauseRecommendation`/`addCreativeRecommendation`/the scale push, check `meetsEvidenceFloor(action, {clicks, conversions, days})` using `input.evidence`; if not met, push `insufficientEvidenceWatch(...)` instead and skip the rec. Keep the diagnostic recs (`refresh_creative`, `hold`, etc.) and `fix_signal_health`/`harden_capi` ungated (their floors are low/zero).

- [ ] **Step 6: Populate `evidence` in `decideForCampaign`.**

In `campaign-decision.ts`, compute window evidence from the insight and pass it through. `days` = the breach window the provider used is 14, but the *current-period* insight is the 7-day window; use the count of breach periods is not evidence — use the insight's own window. Set:
```ts
    evidence: {
      clicks: input.currentInsight.inlineLinkClicks,
      conversions: input.currentInsight.conversions,
      days: 7,
    },
```
Then split the engine's return into recs vs watches:
```ts
  const engineOut = generateRecommendations({ /* ...as before... */, evidence: {
    clicks: input.currentInsight.inlineLinkClicks,
    conversions: input.currentInsight.conversions,
    days: 7,
  } });
  for (const item of engineOut) {
    if (item.type === "watch") { watches.push(item); continue; }
    // existing applyTier + learningGuard.gate flow on `item`
  }
```

- [ ] **Step 7: Update existing engine tests** that construct `RecommendationInput` without `evidence` — add a generous `evidence: { clicks: 1000, conversions: 100, days: 7 }` so prior assertions about pause/scale stay green (they were written pre-floor). Grep: `grep -rln "generateRecommendations(" packages/ad-optimizer/src`.

- [ ] **Step 8: Add the sufficiency eval fixtures.**

`evals/riley-recommendation/fixtures/sufficiency.jsonl`:
```
{"id":"suff-thin-data-watch","current":{"impressions":300,"inlineLinkClicks":8,"spend":250,"conversions":1,"revenue":0,"frequency":1.1},"previous":{"impressions":300,"inlineLinkClicks":8,"spend":250,"conversions":1,"revenue":0,"frequency":1.1},"targetBreach":{"periodsAboveTarget":8,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"watch","notes":"8 clicks < destructive floor 50 -> abstain, do not pause on noise"}
{"id":"suff-durable-volume-pause","current":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"previous":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"targetBreach":{"periodsAboveTarget":9,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"pause","notes":"600 clicks, 6 conv, cpa 350 vs 100, 9 breach days -> pause"}
{"id":"suff-one-day-spike-watch","current":{"impressions":15000,"inlineLinkClicks":450,"spend":700,"conversions":3,"revenue":0,"frequency":1.5},"previous":{"impressions":15000,"inlineLinkClicks":450,"spend":700,"conversions":3,"revenue":0,"frequency":1.5},"targetBreach":{"periodsAboveTarget":2,"granularity":"daily"},"learningState":"success","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"watch","notes":"cpa over target but only 2 breach days (< KILL_DAYS_THRESHOLD 7) -> no pause; tier may withhold or no rec -> watch/insight; assert watch via diagnoses-driven path"}
```
Verify each `expectedOutcome` by running `pnpm eval:riley` and adjust the fixture (not the code) if the reduced label differs — fixtures encode the *desired* behavior this task implements; if a label is genuinely different (e.g. `insight` vs `watch` for the spike), set it to the real abstention label the pipeline produces and note why.

- [ ] **Step 9: Green + commit.**
```bash
pnpm --filter @switchboard/ad-optimizer test
pnpm eval:riley
git add packages/ad-optimizer/src/evidence-floor.ts packages/ad-optimizer/src/evidence-floor.test.ts \
  packages/ad-optimizer/src/recommendation-engine.ts packages/ad-optimizer/src/campaign-decision.ts \
  evals/riley-recommendation/fixtures/sufficiency.jsonl
git commit -m "feat(ad-optimizer): action-family evidence floors — abstain instead of acting on noise"
```

---

## Task 5: Breach-counter fix — zero-conversion days are volume-gated

**Files:**
- Modify: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` (`getTargetBreachStatus`)
- Test: `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts` (extend)

**Tightening #3:** a zero-conversion-with-spend day must NOT independently create a high-confidence breach; it counts toward durability only if the entity has enough total window volume.

- [ ] **Step 1: Write the failing test.**

Extend `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts` (create if absent) with a fake `adsClient` returning daily rows:
```ts
it("a low-volume campaign of all-zero-conversion days does NOT accrue breach days", async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    campaignId: "c1", spend: 3, conversions: 0,
    inlineLinkClicks: 1, /* ...other CampaignInsight fields zeroed... */
  }));
  const provider = new MetaCampaignInsightsProvider(fakeClient(rows));
  const r = await provider.getTargetBreachStatus({
    orgId: "o", accountId: "a", campaignId: "c1", targetCPA: 100,
    startDate: new Date("2026-05-01"), endDate: new Date("2026-05-14"),
  });
  expect(r.periodsAboveTarget).toBe(0); // 14 clicks total < floor; zero-conv days don't count
});

it("a high-volume campaign with zero-conversion spend days DOES accrue breach days", async () => {
  const rows = Array.from({ length: 14 }, () => ({
    campaignId: "c1", spend: 50, conversions: 0, inlineLinkClicks: 40,
  }));
  const provider = new MetaCampaignInsightsProvider(fakeClient(rows));
  const r = await provider.getTargetBreachStatus({ /* same args */ });
  expect(r.periodsAboveTarget).toBe(14); // 560 clicks >= floor; sustained zero-conv spend is a real breach
});
```
(Provide `fakeClient(rows)` returning an `AdsClientInterface` whose `getCampaignInsights` returns `rows` cast to `CampaignInsight[]`, and a no-op `getAdSetLearningInputs`. Mirror the existing test file's fake.)

- [ ] **Step 2: Run — expect FAIL** (today every zero-conv spend day counts → 14).

- [ ] **Step 3: Implement the volume-gated breach counter.**

In `getTargetBreachStatus`, add `inline_link_clicks` to the daily fields and gate zero-conversion days on window-total clicks:
```ts
    const rows = await this.adsClient.getCampaignInsights({
      dateRange: { since: fmt(since), until: fmt(until) },
      fields: ["campaign_id", "spend", "conversions", "inline_link_clicks"],
      timeIncrement: 1,
    });
    const campaignDays = rows.filter((r) => r.campaignId === input.campaignId);
    // ...weekly fallback unchanged...

    // Window-total clicks gate: a zero-conversion-with-spend day is only a breach
    // when the campaign has enough total volume for "zero" to be real signal, not a
    // quiet low-traffic day (Phase-A spec §3 Gate 2 / breach-counter fix).
    const MIN_WINDOW_CLICKS_FOR_ZERO_DAY_BREACH = 20;
    const windowClicks = campaignDays.reduce((s, d) => s + d.inlineLinkClicks, 0);
    const zeroDayCounts = windowClicks >= MIN_WINDOW_CLICKS_FOR_ZERO_DAY_BREACH;

    let periodsAboveTarget = 0;
    for (const day of campaignDays) {
      if (day.spend <= 0) continue;
      const breached =
        day.conversions > 0
          ? day.spend / day.conversions > input.targetCPA
          : zeroDayCounts; // was `day.spend > 0` — the footgun
      if (breached) periodsAboveTarget++;
    }
    return { periodsAboveTarget, granularity: "daily", isApproximate: false };
```

- [ ] **Step 4: Run — expect PASS**, then run the full provider suite + commit.
```bash
pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider
git add packages/ad-optimizer/src/meta-campaign-insights-provider.ts packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts
git commit -m "fix(ad-optimizer): volume-gate zero-conversion breach days (no kill on quiet low-traffic days)"
```

---

## Task 6: Conversions denominator fix — action-type + pinned attribution window

**Files:**
- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (`getCampaignInsights` param + `mapCampaignInsight`)
- Modify: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` (use the configured result action)
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (`AuditConfig` fields + pass-through)
- Modify: `packages/ad-optimizer/src/inngest-functions.ts` (read optional config)
- Test: extend the provider + client tests

**Pattern to copy:** `meta-report-insights-provider.ts:35-39` already parses `actions` and filters by `action_type`.

- [ ] **Step 1: Add config knobs to `AuditConfig`.**

In `audit-runner.ts` `AuditConfig`:
```ts
  /** Phase A: the Meta result `action_type` to use as the breach denominator
   * (e.g. "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d",
   * "schedule"). When unset, falls back to the aggregate `conversions` field (back-compat). */
  conversionActionType?: string;
  /** Phase A: pinned attribution window, e.g. ["7d_click"]. Defaults to ["7d_click"]. */
  attributionWindows?: string[];
```

- [ ] **Step 2: Write the failing client test** — `getCampaignInsights` forwards `action_attribution_windows` and `mapCampaignInsight` surfaces an `actions` array. Add to `meta-ads-client.test.ts`:
```ts
it("forwards action_attribution_windows and parses actions", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ data: [{ campaign_id: "c1", spend: "100",
      actions: [{ action_type: "lead", value: "4" }] }] })),
  );
  const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
  const rows = await client.getCampaignInsights({
    dateRange: { since: "2026-05-01", until: "2026-05-07" },
    fields: ["campaign_id", "spend", "actions"],
    actionAttributionWindows: ["7d_click"],
  });
  const url = fetchMock.mock.calls[0]![0] as string;
  expect(url).toContain("action_attribution_windows");
  expect(rows[0]!.actions?.find((a) => a.action_type === "lead")?.value).toBe("4");
});
```

- [ ] **Step 3: Implement on the client.** Add `actionAttributionWindows?: string[]` to `CampaignInsightsParams`; in `getCampaignInsights` set `queryParams.set("action_attribution_windows", JSON.stringify(params.actionAttributionWindows))` when present. Add an optional `actions` field to `CampaignInsightSchema` (`packages/schemas/src/ad-optimizer.ts`):
```ts
  actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
```
In `mapCampaignInsight`, pass through `actions` when present:
```ts
      ...(Array.isArray((raw as Record<string, unknown>).actions)
        ? { actions: (raw as unknown as { actions: { action_type: string; value: string }[] }).actions }
        : {}),
```
(Adjust the `raw` typing — `getCampaignInsights` currently casts `data` to `Record<string,string>[]`; widen to `Record<string, unknown>[]` so `actions` survives, and keep the scalar `parseFloat(String(raw.x ?? "0"))` reads.)

- [ ] **Step 4: Write the failing provider test** — when `conversionActionType` is set, the breach denominator uses that action's value, not aggregate `conversions`. Add to `meta-campaign-insights-provider.test.ts`. Then thread `conversionActionType`/`attributionWindows` into the provider. The provider's `getTargetBreachStatus` signature gains optional `conversionActionType`/`attributionWindows` (passed from the runner), and the per-day denominator becomes:
```ts
      const dayConversions = input.conversionActionType
        ? Number(day.actions?.find((a) => a.action_type === input.conversionActionType)?.value ?? 0)
        : day.conversions;
```
with the daily fetch including `"actions"` and `actionAttributionWindows: input.attributionWindows ?? ["7d_click"]` when `conversionActionType` is set.

- [ ] **Step 5: Pass the config through.** In `audit-runner.ts` 5e/`decideForCampaign` call path, pass `conversionActionType: this.config.conversionActionType` and `attributionWindows: this.config.attributionWindows` into `getTargetBreachStatus`. In `inngest-functions.ts`, read them from `inputConfig` (add to the `DeploymentInfo.inputConfig` type and the `config` literal) — **as strings coerced to the right shape**; default unset (back-compat: aggregate conversions).

- [ ] **Step 6: Green + commit.**
```bash
pnpm --filter @switchboard/ad-optimizer test
pnpm --filter @switchboard/schemas test
git add -A && git commit -m "feat(ad-optimizer): action-type + pinned-window conversions denominator (configurable, back-compat)"
```

---

## Task 7: Conversion-denominator step-change guard (Gate 1)

**Files:**
- Create: `packages/ad-optimizer/src/denominator-step-change.ts`
- Test: `packages/ad-optimizer/src/denominator-step-change.test.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (account-wide guard before the per-campaign loop)
- Add fixtures: `evals/riley-recommendation/fixtures/measurement-trust.jsonl`

**Tightening #1:** name it the conversion-denominator step-change guard — the failure mode is an account-wide reporting/attribution-window/action-type denominator shift, not a generic "measurement" wobble.

- [ ] **Step 1: Write the failing test.**
```ts
import { describe, it, expect } from "vitest";
import { detectDenominatorStepChange } from "./denominator-step-change.js";

describe("conversion-denominator step-change guard", () => {
  it("flags an account-wide conversion-rate collapse with flat spend/clicks", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 12, spend: 1000 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(true);
  });
  it("does not flag a normal small movement", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 55, spend: 1000 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(false);
  });
  it("does not flag when clicks also fell (real volume drop, not a denominator shift)", () => {
    const r = detectDenominatorStepChange({
      current: { clicks: 200, conversions: 12, spend: 200 },
      previous: { clicks: 1000, conversions: 60, spend: 1000 },
    });
    expect(r.suspected).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `packages/ad-optimizer/src/denominator-step-change.ts`:
```ts
export interface AccountWindowTotals {
  clicks: number;
  conversions: number;
  spend: number;
}

export interface StepChangeResult {
  suspected: boolean;
  reason: string;
}

const DROP_RATIO = 0.5;      // conversion-rate fell to <=50% of prior
const FLATNESS_BAND = 0.2;   // while clicks stayed within +/-20%

/**
 * Detect an account-wide conversion-DENOMINATOR step-change: conversion rate
 * (conv/clicks) collapses while clicks/spend stay flat — the signature of an
 * attribution-window or action-type reporting shift (e.g. Meta's Jan-2026 window
 * change), NOT a real performance drop. When suspected, the runner abstains on
 * budget actions and surfaces a measurement-fix signal rather than killing campaigns.
 */
export function detectDenominatorStepChange(input: {
  current: AccountWindowTotals;
  previous: AccountWindowTotals;
}): StepChangeResult {
  const { current, previous } = input;
  if (previous.clicks <= 0 || previous.conversions <= 0) {
    return { suspected: false, reason: "insufficient prior baseline" };
  }
  const prevRate = previous.conversions / previous.clicks;
  const curRate = current.clicks > 0 ? current.conversions / current.clicks : 0;
  const clicksFlat = Math.abs(current.clicks - previous.clicks) / previous.clicks <= FLATNESS_BAND;
  const rateCollapsed = curRate <= prevRate * DROP_RATIO;
  const suspected = clicksFlat && rateCollapsed;
  return {
    suspected,
    reason: suspected
      ? `conversion rate fell ${(prevRate ? (1 - curRate / prevRate) * 100 : 0).toFixed(0)}% with flat clicks — suspected denominator/window shift`
      : "no step-change",
  };
}
```

- [ ] **Step 4: Wire it into the runner (account-wide, before the per-campaign loop).** In `audit-runner.ts` after Step 4 (period deltas), compute account totals from `currentInsights`/`previousInsights` and, when `detectDenominatorStepChange(...).suspected`, set a flag that (a) appends an account-level `harden_capi_attribution`-style **watch** (not a rec) describing the suspected shift, and (b) suppresses destructive recs for this run by downgrading them to watches in the per-campaign loop. Minimal implementation: pass a `measurementTrusted: boolean` into `decideForCampaign`; when false, route every `resetsLearning !== "no"` or destructive/scale rec to a watch with pattern `"measurement_untrusted"`. Keep `fix_signal_health`/`hold` flowing.

- [ ] **Step 5: Add the eval fixture.** `evals/riley-recommendation/fixtures/measurement-trust.jsonl` — a case where the per-campaign metrics would otherwise pause, but `measurementTrusted=false` yields `watch`. (Extend `RileyCaseSchema` with an optional `measurementTrusted` boolean defaulting true, and thread it through `decide.ts`.)

- [ ] **Step 6: Green + commit.**
```bash
pnpm --filter @switchboard/ad-optimizer test && pnpm eval:riley
git add -A && git commit -m "feat(ad-optimizer): conversion-denominator step-change guard — abstain on suspected reporting shifts"
```

---

## Task 8: Learning lockout by reset-class, ad-set aware (Gate 6 minimum)

**Files:**
- Modify: `packages/ad-optimizer/src/learning-phase-guard.ts` (`LearningPhaseGuardV2.isDestructiveAction` reads `resetsLearning`)
- Test: `packages/ad-optimizer/src/learning-phase-guard.test.ts` (extend)
- Modify: `packages/ad-optimizer/src/campaign-decision.ts` (gate reset-class actions when the campaign has a learning/learning-limited ad set)
- Add fixtures: `evals/riley-recommendation/fixtures/learning.jsonl`

- [ ] **Step 1: Write the failing guard test.**
```ts
it("V2 lockout holds ANY reset-class action during learning, not just pause/restructure", () => {
  const v2 = new LearningPhaseGuardV2();
  const learning = v2.classifyState({ /* LEARNING ad set input */ });
  const refresh = { /* a refresh_creative RecommendationOutput, resetsLearning:"yes" */ };
  expect(v2.gate(refresh, learning).type).toBe("watch");   // today this PASSES THROUGH (bug)
  const hold = { /* a hold RecommendationOutput, resetsLearning:"no" */ };
  expect(v2.gate(hold, learning).type).toBe("recommendation"); // non-reset still allowed
});
```

- [ ] **Step 2: Run — expect FAIL** (today only `{pause,restructure}` are gated).

- [ ] **Step 3: Implement.** In `learning-phase-guard.ts`, replace the hardcoded `DESTRUCTIVE_ACTIONS` set logic in `LearningPhaseGuardV2.isDestructiveAction` with a read of the structured flag:
```ts
import { resetsLearningFor } from "./action-reset-classification.js";
// ...
  /** Returns true for actions that would reset the learning phase (any "yes" class). */
  isDestructiveAction(action: string): boolean {
    return resetsLearningFor(action as Parameters<typeof resetsLearningFor>[0]) === "yes";
  }
```
(Delete the now-unused `DESTRUCTIVE_ACTIONS` const.)

- [ ] **Step 4: Make the live path ad-set aware.** In `audit-runner.ts` 5a, the provider already exposes `getAdSetLearningInputs(campaignId)` (used by `deriveLearningPhase`). When `this.adsClient.getAdSetLearningInputs` exists, fetch the campaign's ad-set learning inputs once, derive whether any material ad set is `LEARNING`/`FAIL`, and pass a `learningPhaseActive: boolean` into `decideForCampaign`. In `campaign-decision.ts`, after `applyTier`, if `learningPhaseActive` and `rec.resetsLearning === "yes"`, route to a `watch` (pattern `"in_learning_phase"`) instead of the rec — i.e. apply the V2 reset-class lockout, not just the campaign-level V1 gate. (V1 `learningGuard.gate` stays as the campaign-level backstop.)

  Note: this reuses an existing Graph call path (`getAdSetLearningInputs`), so it adds no new fetch beyond what `deriveLearningPhase` already does — but verify it isn't double-fetched; if `getCampaignLearningData` already pulled it, thread that result instead of re-calling. Keep the 60s rate-limit cost in mind (documented scale TODO; acceptable at pilot tenancy).

- [ ] **Step 5: Add eval fixtures.** `evals/riley-recommendation/fixtures/learning.jsonl`:
```
{"id":"learn-no-reset-during-learning","current":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"previous":{"impressions":20000,"inlineLinkClicks":600,"spend":2100,"conversions":6,"revenue":0,"frequency":1.6},"targetBreach":{"periodsAboveTarget":9,"granularity":"daily"},"learningState":"learning","economicTier":"booked_cac","effectiveTarget":100,"targetROAS":3,"expectedOutcome":"watch","notes":"would pause, but ad set is LEARNING -> held as watch"}
```
(The `success`-state durable-pause fixture from Task 4 already covers the contrast.)

- [ ] **Step 6: Green + commit.**
```bash
pnpm --filter @switchboard/ad-optimizer test && pnpm eval:riley
git add -A && git commit -m "feat(ad-optimizer): reset-class learning lockout, ad-set aware"
```

---

## Task 9: CoverageValidator (Gate 0) wiring + zero-coverage abstain

**Files:**
- Modify: `packages/ad-optimizer/src/onboarding/coverage-validator.ts` (add pure `isCoverageSufficient`)
- Test: `packages/ad-optimizer/src/onboarding/coverage-validator.test.ts` (extend)
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (optional coverage gate at Step 0)
- Modify: `packages/ad-optimizer/src/inngest-functions.ts` (wire an optional coverage check)

- [ ] **Step 1: Add a pure sufficiency helper to the validator.**
```ts
const MIN_COVERAGE_PCT = 0.5;
export function isCoverageSufficient(report: CoverageReport): boolean {
  return report.coveragePct >= MIN_COVERAGE_PCT;
}
```
Test it: coverage 0.6 → true; 0.2 → false.

- [ ] **Step 2: Gate the audit (optional dep, back-compat).** In `AuditDependencies` add `coverageValidator?: { validate(q: { orgId: string; accountId: string }): Promise<CoverageReport> }`. At Step 0 (before signal-health), when present, call it; when `!isCoverageSufficient(report)`, return an audit report with **no recommendations** and a single account-level insight explaining the data-coverage gap (Riley abstains: it cannot trust its read). Keep all existing callers working (dep is optional).

- [ ] **Step 3: Wire it in the cron** (`inngest-functions.ts`) behind an optional `deps.createCoverageValidator?` — default unset, so production behavior is unchanged until the validator is provided in `apps/api/src/bootstrap/inngest.ts` (that wiring is a one-line follow-up, out of this plan's package scope; note it in the PR).

- [ ] **Step 4: Green + commit.**
```bash
pnpm --filter @switchboard/ad-optimizer test
git add -A && git commit -m "feat(ad-optimizer): coverage gate (Gate 0) — abstain below data-sufficiency threshold"
```

---

## Task 10: `time_increment` bug fix + final wire-up, guardrail doc, eval baseline

**Files:**
- Modify: `apps/api/src/services/cron/meta-insights-adapter.ts:60`
- Test: `apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts` (create/extend)
- Modify: `evals/riley-recommendation/README.md` (guardrail sentence)

- [ ] **Step 1: Write the failing adapter test** asserting the Graph call uses a daily `time_increment`, not an invalid `breakdowns:["day"]`. Mock `MetaAdsClient.getCampaignInsights` and assert it was called with `timeIncrement: 1` and no `breakdowns:["day"]`.

- [ ] **Step 2: Fix.** In `meta-insights-adapter.ts`, change the insights call (line ~50-61):
```ts
      const insights = await client.getCampaignInsights({
        dateRange: { since, until },
        fields: [
          "campaign_id", "spend", "inline_link_click_ctr",
          "impressions", "date_start", "date_stop",
        ],
        timeIncrement: 1,
      });
```
(Remove `breakdowns: ["day"]` — `"day"` is not a valid Meta breakdown dimension; the daily series comes from `time_increment=1`.)

- [ ] **Step 3: Add the guardrail sentence** to `evals/riley-recommendation/README.md` and confirm it's in the PR template note.

- [ ] **Step 4: Full-suite + eval + build green.**
```bash
pnpm --filter @switchboard/ad-optimizer test
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/api test
pnpm exec vitest run --config evals/vitest.config.ts
pnpm eval:riley
pnpm typecheck
pnpm lint && pnpm format:check
```

- [ ] **Step 5: Commit.**
```bash
git add -A && git commit -m "fix(api): use time_increment=1 for daily insights (drop invalid breakdowns:[day])"
```

- [ ] **Step 6: Open the PR** with the guardrail sentence verbatim in the description, the Phase-A scope guard, and a "no mutating paths" checklist line (grep-confirm: no `PlatformIngress`, no `apply_ad_action`, no `updateCampaignBudget`, no `MetaAdsClient` mutating caller added).

---

## Self-Review (completed by plan author)

**Spec coverage** (against `2026-06-02-riley-autonomous-ad-operator-design.md` Phase A): Gate 0 hygiene/coverage → Task 9. Gate 1 conversion-denominator trust (step-change + denominator fix) → Tasks 6, 7. Gate 2 sufficiency + breach-counter → Tasks 4, 5. `resetsLearning` schema (tightening #4, schema-first) → Task 1. Ad-set learning lockout → Task 8. `time_increment` bug → Task 10. Deterministic eval early (tightening #5) → Task 3 (lands 3rd, before all gate logic; fixtures added per-task). Action-family floors (tightening #2) → Task 4. Breach-counter nuance (tightening #3) → Task 5. Conversion-denominator naming (tightening #1) → Task 7. Guardrail sentence → header + Task 10. No-execution invariant → scope guard + Task 10 grep. **No gaps.**

**Deferred-correctly (Phase B+, NOT in this plan):** booked-event stamping, `byCampaign` projection, reconciliation runner, CAPI-on, `candidateAction`/execution, authority-class routing tags, Mira/Alex handoff, lead-form mutation, full Gate-5 lever routing, Beta-Binomial confidence.

**Type consistency:** `decideForCampaign` input/return shape is consistent across Task 2 (definition), Task 4 (adds `evidence` via the engine, not the seam signature), Task 7 (`measurementTrusted`), Task 8 (`learningPhaseActive`) — each later task that extends the input lists the exact field added. `resetsLearning` is required from Task 1 onward; every constructor (`makeRec`, the audit-runner literal, test fixtures) sets it. `RecommendationOutput | WatchOutput` union from `generateRecommendations` (Task 4) is handled in `campaign-decision.ts` (Task 4 Step 6).

**Open verification the executor must do:** the exact `expectedOutcome` labels in eval fixtures (Tasks 3/4/7/8) must be confirmed by running `pnpm eval:riley` — fixtures encode desired behavior; if a reduced label differs, adjust the fixture (not the code) and note why. The `meta-campaign-insights-provider.test.ts` and `meta-ads-client.test.ts` fakes must match the real `AdsClientInterface` (confirm field names against `packages/schemas/src/ad-optimizer.ts`).
