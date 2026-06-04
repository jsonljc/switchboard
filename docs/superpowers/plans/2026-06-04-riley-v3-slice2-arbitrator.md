# Riley v3 Slice 2: OpportunityArbitrator + ActionContract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen: inline, one cohesive additive-metadata slice with a strict no-behavior-change envelope) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick ONE primary mutating opportunity per account per audit cycle (plus optionally one non-mutating measurement fix) via a deterministic, model-free score, as additive ranking metadata on the audit report, consolidating the three per-action maps into one ActionContract record on the way, with zero change to emission, handoff gating, or the existing eval assertions.

**Architecture:** `action-contract.ts` becomes the single keyed source for `{financialEffect, externalEffect, resetsLearning, evidenceFamily}` plus `isMutating()` (baking in the sink's resetsLearning elevation); the sink, evidence-floor, and reset-classification modules re-point at it with byte-identical behavior. A pure `arbitrate()` in `analyzers/opportunity-arbitrator.ts` scores all mutating candidates (`shareOfSpend x revenueProximity x truthConfidence - learningResetPenalty - attributionConflictPenalty`), annotates `{primary, secondary[], measurementFix?}` onto a new optional `AuditReportSchema.arbitration` field, and is pinned by a new multi-campaign eval sub-harness with `expectedPrimary` (the existing per-campaign harness is structurally blind to cross-campaign selection).

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/ad-optimizer` (Layer 2, surface-agnostic) + `packages/schemas` (additive Zod field); Vitest; the `pnpm eval:riley` golden harness (CI-blocking).

---

## Consumes (already on origin/main @ 2e8a3267)

- `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (sections 2.2, 2.3, 3, 7.1, 7.6, 7.7)
- `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` (Slice 2)
- Slice 1 (RevenueState) merged as #867.

## Invariants (verify every task)

- Advisory-only: no new `PlatformIngress` caller in `packages/ad-optimizer`; no Meta write; no new mutating caller.
- Surface-agnostic: no UI import (Layer 2).
- Slice 2 is ADDITIVE ranking metadata: emission candidate set, emitted payload shape, and handoff gating are byte-identical. The sink never reads arbitration.
- `pnpm eval:riley` existing 12 + 10 + matrix assertions UNCHANGED; the new arbitration sub-eval only adds.
- ESM + `.js` relative imports; no `any`; co-located `*.test.ts`; no em-dashes; conventional lowercase commit subjects; `audit-runner.ts` stays lean (it sits over the 600 cap on an explicit eslint-disable).

## Verified live anchors (origin/main @ 2e8a3267; re-verify if drifted)

- `ACTION_RISK_CONTRACT`: `recommendation-sink.ts:149-169` (sink-local; no external importer).
- Elevation: `recommendation-sink.ts:453` — `contract.externalEffect || rec.resetsLearning === "yes"`; `rec.resetsLearning` is always `resetsLearningFor(action)` (`recommendation-engine.ts:82`, `source-reallocation.ts:205`).
- `ACTION_RESETS_LEARNING` + `resetsLearningFor` + `learningPhaseImpactText`: `action-reset-classification.ts:21-55`.
- `FAMILY` + `EVIDENCE_FLOORS` + `evidenceFamilyFor` + `meetsEvidenceFloor`: `evidence-floor.ts`.
- Candidate assembly final after Step 8c: `audit-runner.ts:566-573`; sink consumes at `:582-594`; report at `:608-631`.
- `shift_budget_to_source` rec: `campaignId: "account"` (`ACCOUNT_CAMPAIGN_ID`, `source-reallocation.ts:21`, NOT exported yet), `params: {from, to, fromTrueRoas, toTrueRoas}` (no structured shift amount).
- `fix_signal_health` recs: one per breach, `campaignId: "signal:<pixelId>"`, urgency `immediate` (critical) / `this_week` (else) — `recommendation-engine.ts:407-442`; (campaignId, action) is NOT unique, so arbitration entries carry the recommendations[] `index`.
- Enriched RevenueState (producer 6) exists only INSIDE `computeAuditEconomicsSections` (`source-reallocation.ts:288`); the runner's `revenueState` const is pre-enrichment.
- `AuditReportSchema`: `packages/schemas/src/ad-optimizer.ts:221-280`; report persists as AgentTask JSON output (`apps/api/src/bootstrap/inngest.ts:324-340`), NOT runtime-Zod-validated downstream → optional field additive-safe. Zod-only change; no Prisma model touched, so no DB migration.
- Eval: `loadRileyCases` reads top-level `*.jsonl` only (no recursion) → a new `fixtures/arbitration/` subdir cannot disturb the drift guard; `decide.ts` `decideForCase` hardcodes `c1`; harness imports via the `@switchboard/ad-optimizer` barrel; `generateSignalHealthRecommendations` NOT in the barrel yet; vitest glob `riley-recommendation/__tests__/**/*.test.ts` auto-includes a new test file; CI path filter `evals/riley-recommendation/**` + `packages/ad-optimizer/src/**` covers everything here.

## Design decisions (settled in brainstorm; do not re-litigate mid-build)

1. **`deriveOwnership` is NOT built in slice 2** (spec 2.2/7.7 placement decision, recorded): the arbitrator does not consume ownership; building it spans dashboard + handoff + core (not surface-agnostic, not a focused PR). Nothing changes for `swipe-policy` consumers, so no silent duplication is created. Revisit when an operator surface consumes arbitration.
2. **Report-level annotation, not per-rec fields**: recommendations[] stays byte-identical (the sink emits it); `arbitration` references entries by `{campaignId, action, index}` (+ `score` for ranked entries).
3. **Materiality = candidate spend share**: campaign candidates use their campaign's current-window spend / account spend; the account-scoped shift candidate uses its `params.from` source's attributed spend (via a new additive `spendBySource` return from the economics orchestrator). All score terms live in [0,1] so the subtractive penalties are meaningful. `estimateRisk` (prose scrape) and `rec.confidence` (engine self-assessment, already reflected at emission) are deliberately NOT inputs.
4. **revenueProximity from the ACCOUNT tier** (`revenueState.economicTier`, spec section 3 table); per-candidate tier refinement is a considered-and-deferred follow-up. Defensive `cpc` factor when absent.
5. **truthConfidence per candidate** = `(measurementTrusted ? 1 : 0.5) x (signalHealthScore === "yellow" ? 0.8 : 1) x (coverage?.coveragePct ?? 1)`, times `min(fromCoverage, toCoverage)` for the shift candidate only (per-source coverage is per-source; applying it globally would mis-apply campaign candidates). Red is unreachable here (aborts upstream).
6. **attributionConflictPenalty**: flat 0.2 on every mutating candidate whose campaignId carries >= 2 mutating candidates this cycle (the intra-cycle analogue of the ledger's `same_campaign_overlap`). Account-scope vs campaign-scope cross-conflicts are NOT penalized in slice 2 (documented simplification).
7. **Determinism**: total order = score desc, then campaignId asc, then action asc, then index asc. Measurement fix = lowest urgency rank (immediate < this_week < next_cycle), then index asc. `hold`/`test` (non-mutating, non-measurement) are unranked by design.
8. **Constants are named exports** tuned via the eval, never silently (evidence-floor convention).

---

### Task 1: action-contract.ts — consolidated record + isMutating (failing test first)

**Files:**

- Create: `packages/ad-optimizer/src/action-contract.ts`
- Test: `packages/ad-optimizer/src/action-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { ACTION_CONTRACT, isMutating, type ActionContract } from "./action-contract.js";
import { ACTION_RESETS_LEARNING, resetsLearningFor } from "./action-reset-classification.js";
import { evidenceFamilyFor } from "./evidence-floor.js";
import { runRecommendationSink } from "./recommendation-sink.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import type { RecommendationInput } from "@switchboard/schemas";

const ALL_ACTIONS = Object.keys(ACTION_CONTRACT) as RecommendationOutput["action"][];

function makeRec(action: RecommendationOutput["action"]): RecommendationOutput {
  return {
    type: "recommendation",
    action,
    campaignId: "c1",
    campaignName: "C1",
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "test impact",
    steps: ["step"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
  };
}

describe("ACTION_CONTRACT consolidation", () => {
  it("covers exactly the 14 actions", () => {
    expect(ALL_ACTIONS.sort()).toEqual(
      [
        "scale",
        "pause",
        "restructure",
        "review_budget",
        "shift_budget_to_source",
        "consolidate",
        "expand_targeting",
        "switch_optimization_event",
        "hold",
        "test",
        "refresh_creative",
        "add_creative",
        "harden_capi_attribution",
        "fix_signal_health",
      ].sort(),
    );
  });

  it("agrees with the legacy reset classification for every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_CONTRACT[action].resetsLearning).toBe(ACTION_RESETS_LEARNING[action]);
      expect(ACTION_CONTRACT[action].resetsLearning).toBe(resetsLearningFor(action));
    }
  });

  it("agrees with the legacy evidence-family classification for every action", () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_CONTRACT[action].evidenceFamily).toBe(evidenceFamilyFor(action));
    }
  });

  it("isMutating bakes in the elevation: both static-false-but-elevated cases are mutating", () => {
    // refresh_creative AND add_creative are {financialEffect:false, externalEffect:false}
    // in the static contract but resetsLearning="yes" — the sink elevates them.
    expect(ACTION_CONTRACT.refresh_creative.financialEffect).toBe(false);
    expect(ACTION_CONTRACT.refresh_creative.externalEffect).toBe(false);
    expect(isMutating("refresh_creative")).toBe(true);
    expect(ACTION_CONTRACT.add_creative.financialEffect).toBe(false);
    expect(ACTION_CONTRACT.add_creative.externalEffect).toBe(false);
    expect(isMutating("add_creative")).toBe(true);
    // pause is static true/true with resetsLearning="no" — mutating via the booleans.
    expect(isMutating("pause")).toBe(true);
    // The four informational actions stay non-mutating.
    expect(isMutating("hold")).toBe(false);
    expect(isMutating("test")).toBe(false);
    expect(isMutating("harden_capi_attribution")).toBe(false);
    expect(isMutating("fix_signal_health")).toBe(false);
  });

  it("isMutating agrees with the REAL sink's emitted booleans for all 14 actions", async () => {
    const emitted: RecommendationInput[] = [];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit:test",
      recommendations: ALL_ACTIONS.map(makeRec),
      emit: vi.fn(async (input: RecommendationInput) => {
        emitted.push(input);
        return { surface: "approval_queue" as const };
      }),
      emissionContext: { cronId: "cron-test" },
    });
    expect(emitted).toHaveLength(ALL_ACTIONS.length);
    for (const input of emitted) {
      const action = input.action as RecommendationOutput["action"];
      const c = ACTION_CONTRACT[action];
      // The sink's emitted booleans derive from the SAME record (financial verbatim,
      // external elevated by resetsLearning).
      expect(input.financialEffect).toBe(c.financialEffect);
      expect(input.externalEffect).toBe(c.externalEffect || c.resetsLearning === "yes");
      // isMutating is exactly "the sink would emit a financial or (elevated) external effect".
      expect(isMutating(action)).toBe(
        Boolean(input.financialEffect) || Boolean(input.externalEffect),
      );
    }
  });

  it("exposes the contract type", () => {
    const c: ActionContract = ACTION_CONTRACT.scale;
    expect(c.financialEffect).toBe(true);
  });
});
```

Note: if `RecommendationSurface` does not include `"approval_queue"`, mirror whatever surface literal `recommendation-sink.test.ts` uses for its fake emitter (read it first; adjust only the literal).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer test -- action-contract`
Expected: FAIL (module `./action-contract.js` not found).

- [ ] **Step 3: Write the implementation**

```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";

/** Evidence families (moved here from evidence-floor.ts so the one-way import
 * graph stays acyclic: action-contract <- evidence-floor / reset-classification /
 * sink / arbitrator). evidence-floor re-exports it for back-compat. */
export type EvidenceFamily =
  | "destructive" // pause / cut — highest floor
  | "scale" // moderate-high
  | "structural" // restructure/consolidate/expand — destructive-grade floor (Phase D)
  | "diagnostic" // hold / diagnose-only — low floor
  | "measurement"; // signal/CAPI fixes — account-level, bypass campaign-volume floor

/**
 * Riley v3 slice 2 (spec 2.3): ONE keyed per-action contract consolidating the three
 * formerly-parallel maps — the sink's ACTION_RISK_CONTRACT booleans, the
 * ACTION_RESETS_LEARNING classification, and the evidence-floor FAMILY map. The legacy
 * modules re-point here (single source of truth); their public APIs are unchanged.
 *
 * financialEffect / externalEffect: static risk booleans (spec section 8.4: money/
 * platform-state actions must never be swipe-approvable).
 * resetsLearning: Meta learning-phase reset class (Phase-A spec section 5).
 * evidenceFamily: minimum-evidence family (evidence-floor.ts owns the floors).
 */
export interface ActionContract {
  financialEffect: boolean;
  externalEffect: boolean;
  resetsLearning: ResetsLearning;
  evidenceFamily: EvidenceFamily;
}

export const ACTION_CONTRACT: Record<AdRecommendationAction, ActionContract> = {
  // ── Money- or ad-platform-state-changing: NOT swipe-approvable ──
  scale: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "no", // capped at 20%, under Meta's significant-edit threshold
    evidenceFamily: "scale",
  },
  pause: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "no", // immediate pause, not a timed >=7d pause
    evidenceFamily: "destructive",
  },
  restructure: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  review_budget: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "conditional", // resets only past the ~20% significant-edit threshold
    evidenceFamily: "scale",
  },
  shift_budget_to_source: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "conditional",
    evidenceFamily: "scale",
  },
  consolidate: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  expand_targeting: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  switch_optimization_event: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "scale",
  },
  // ── Informational / internal-queue only: swipe-approvable ──
  hold: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "diagnostic",
  },
  test: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "diagnostic",
  },
  refresh_creative: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "yes", // elevated to externally-effecting at emission
    evidenceFamily: "diagnostic",
  },
  add_creative: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "yes", // elevated to externally-effecting at emission
    evidenceFamily: "destructive",
  },
  harden_capi_attribution: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "measurement",
  },
  fix_signal_health: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "measurement",
  },
};

/**
 * "Would this action mutate live money / platform state?" — the question the
 * OpportunityArbitrator (and, in Phase C, any execution path) must answer the SAME
 * way the sink does. Bakes in the sink's elevation (recommendation-sink: any
 * resetsLearning === "yes" action is externally-effecting even when its static
 * booleans are false): financialEffect || externalEffect || resetsLearning === "yes".
 */
export function isMutating(action: AdRecommendationAction): boolean {
  const c = ACTION_CONTRACT[action];
  return c.financialEffect || c.externalEffect || c.resetsLearning === "yes";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer test -- action-contract`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/action-contract.ts packages/ad-optimizer/src/action-contract.test.ts
git commit -m "feat(ad-optimizer): add consolidated ActionContract record + isMutating (riley v3 slice 2)"
```

---

### Task 2: re-point the three legacy modules at ACTION_CONTRACT (no behavior change)

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts` (delete local `ACTION_RISK_CONTRACT`, import the record)
- Modify: `packages/ad-optimizer/src/action-reset-classification.ts` (derive from the record)
- Modify: `packages/ad-optimizer/src/evidence-floor.ts` (derive from the record; re-export `EvidenceFamily`)
- Modify: `packages/ad-optimizer/src/index.ts` (barrel: export the new module; keep legacy export paths working)

- [ ] **Step 1: recommendation-sink.ts** — add `import { ACTION_CONTRACT } from "./action-contract.js";`, delete the entire local `ACTION_RISK_CONTRACT` const (`:149-169` incl. its doc comment), and change the loop line

```ts
const contract = ACTION_CONTRACT[rec.action];
```

(the `financialEffect` / elevation lines below it are unchanged — they read the same two booleans).

- [ ] **Step 2: action-reset-classification.ts** — replace the file body so the record derives from the contract; public API identical:

```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";
import { ACTION_CONTRACT } from "./action-contract.js";

/**
 * Learning-phase reset classification, now DERIVED from the consolidated
 * ACTION_CONTRACT (Riley v3 slice 2) — see action-contract.ts for the rationale
 * per action (Meta mechanics, Phase-A spec section 5). Public API unchanged.
 *
 * INVARIANT (enforced in recommendation-sink): any action classified "yes" is
 * never swipe-approvable, regardless of its financial classification.
 */
export const ACTION_RESETS_LEARNING: Record<AdRecommendationAction, ResetsLearning> = (() => {
  const out = {} as Record<AdRecommendationAction, ResetsLearning>;
  for (const action of Object.keys(ACTION_CONTRACT) as AdRecommendationAction[]) {
    out[action] = ACTION_CONTRACT[action].resetsLearning;
  }
  return out;
})();

export function resetsLearningFor(action: AdRecommendationAction): ResetsLearning {
  return ACTION_CONTRACT[action].resetsLearning;
}

/**
 * Human-facing impact string derived from the structured class (replaces the old
 * hand-authored `learningPhaseImpact` strings).
 */
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

- [ ] **Step 3: evidence-floor.ts** — keep `Evidence`, `EVIDENCE_FLOORS`, `meetsEvidenceFloor` exactly; delete the local `FAMILY` map and `EvidenceFamily` type; derive + re-export:

```ts
import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";
import { ACTION_CONTRACT, type EvidenceFamily } from "./action-contract.js";

export type { EvidenceFamily } from "./action-contract.js";

export interface Evidence {
  clicks: number;
  conversions: number;
  days: number;
}

/** Floors are small-budget-calibrated; named config, not magic numbers (Phase-A spec §11).
 * Tune via the eval, never silently. */
export const EVIDENCE_FLOORS: Record<EvidenceFamily, Evidence> = {
  destructive: { clicks: 50, conversions: 5, days: 7 },
  structural: { clicks: 50, conversions: 5, days: 7 },
  scale: { clicks: 30, conversions: 3, days: 7 },
  diagnostic: { clicks: 10, conversions: 0, days: 3 },
  measurement: { clicks: 0, conversions: 0, days: 0 },
};

/** Derived from the consolidated ACTION_CONTRACT (Riley v3 slice 2). API unchanged. */
export function evidenceFamilyFor(action: AdRecommendationAction): EvidenceFamily {
  return ACTION_CONTRACT[action].evidenceFamily;
}

export function meetsEvidenceFloor(action: AdRecommendationAction, e: Evidence): boolean {
  const floor = EVIDENCE_FLOORS[evidenceFamilyFor(action)];
  return e.clicks >= floor.clicks && e.conversions >= floor.conversions && e.days >= floor.days;
}
```

- [ ] **Step 4: barrel** — in `packages/ad-optimizer/src/index.ts`, next to the existing abstention-helper block, add:

```ts
// Riley v3 slice 2: the consolidated per-action contract (single source for the
// sink booleans + reset class + evidence family) and the mutating-ness question.
export { ACTION_CONTRACT, isMutating } from "./action-contract.js";
export type { ActionContract } from "./action-contract.js";
```

(`EvidenceFamily` stays exported via the existing `evidence-floor.js` type line, which now re-exports.)

- [ ] **Step 5: Run the package suite + eval (behavior-preservation gate)**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm build && pnpm eval:riley`
Expected: all 55+ files pass (incl. the existing sink + barrel tests untouched); eval prints `All 12 decideForCampaign + 10 source-reallocation cases match.`

- [ ] **Step 6: Commit**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/action-reset-classification.ts packages/ad-optimizer/src/evidence-floor.ts packages/ad-optimizer/src/index.ts
git commit -m "refactor(ad-optimizer): re-point sink, evidence floor, reset class at ACTION_CONTRACT"
```

---

### Task 3: opportunity-arbitrator.ts — unit tests first

**Files:**

- Test: `packages/ad-optimizer/src/analyzers/opportunity-arbitrator.test.ts`
- Modify: `packages/ad-optimizer/src/analyzers/source-reallocation.ts:21` — change `const ACCOUNT_CAMPAIGN_ID` to `export const ACCOUNT_CAMPAIGN_ID` (single source for the sentinel).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  arbitrate,
  PROXIMITY_BY_TIER,
  MEASUREMENT_UNTRUSTED_FACTOR,
  SIGNAL_YELLOW_FACTOR,
  LEARNING_RESET_PENALTY,
  ATTRIBUTION_CONFLICT_PENALTY,
} from "./opportunity-arbitrator.js";
import { ACCOUNT_CAMPAIGN_ID } from "./source-reallocation.js";
import { assembleRevenueState, withSpendAttributionCoverage } from "../revenue-state.js";
import { resetsLearningFor } from "../action-reset-classification.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";

function rec(
  action: RecommendationOutput["action"],
  campaignId: string,
  overrides: Partial<RecommendationOutput> = {},
): RecommendationOutput {
  return {
    type: "recommendation",
    action,
    campaignId,
    campaignName: campaignId.toUpperCase(),
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "impact",
    steps: ["step"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

const trusted = assembleRevenueState({
  measurementTrusted: true,
  economicTier: "booked_cac",
  effectiveTarget: 100,
  marginBasis: "unavailable",
});

describe("arbitrate", () => {
  it("returns empty result shape for zero candidates", () => {
    const r = arbitrate({ candidates: [], revenueState: trusted, currentInsights: [] });
    expect(r.primary).toBeUndefined();
    expect(r.secondary).toEqual([]);
    expect(r.measurementFix).toBeUndefined();
  });

  it("picks the higher-spend mutating candidate as primary (structured materiality)", () => {
    const candidates = [rec("pause", "c1"), rec("pause", "c2")];
    const r = arbitrate({
      candidates,
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 2_000 },
        { campaignId: "c2", spend: 8_000 },
      ],
    });
    expect(r.primary).toMatchObject({ campaignId: "c2", action: "pause", index: 1 });
    expect(r.secondary).toHaveLength(1);
    expect(r.secondary[0]).toMatchObject({ campaignId: "c1", action: "pause", index: 0 });
    // Exact scores: share x proximity(booked_cac=1) x confidence(1) - penalties(0).
    expect(r.primary?.score).toBeCloseTo(0.8, 10);
    expect(r.secondary[0]?.score).toBeCloseTo(0.2, 10);
  });

  it("non-mutating diagnostics (hold/test) are never ranked; no mutating -> no primary", () => {
    const r = arbitrate({
      candidates: [rec("hold", "c1"), rec("test", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary).toBeUndefined();
    expect(r.secondary).toEqual([]);
  });

  it("learning-reset penalty demotes a same-spend resetting action below a non-resetting one", () => {
    // Same campaign spend on two campaigns; add_creative resets learning ("yes"), pause does not.
    const r = arbitrate({
      candidates: [rec("add_creative", "c1"), rec("pause", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary?.campaignId).toBe("c2");
    expect(r.primary?.score).toBeCloseTo(0.5, 10);
    expect(r.secondary[0]?.score).toBeCloseTo(0.5 - LEARNING_RESET_PENALTY.yes, 10);
  });

  it("attribution-conflict penalty hits every mutating candidate on a contested campaign", () => {
    // c1 proposes TWO mutating edits (conflict); c2 proposes one with lower spend.
    const r = arbitrate({
      candidates: [rec("pause", "c1"), rec("scale", "c1"), rec("pause", "c2")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 6_000 },
        { campaignId: "c2", spend: 4_500 },
      ],
    });
    // c1 share 0.5714... - 0.2 conflict = 0.3714 < c2 0.4286 -> c2 wins.
    expect(r.primary?.campaignId).toBe("c2");
    const c1Entries = r.secondary.filter((s) => s.campaignId === "c1");
    expect(c1Entries).toHaveLength(2);
    for (const e of c1Entries) {
      expect(e.score).toBeLessThan(r.primary!.score);
    }
  });

  it("ties break deterministically: campaignId asc, then action asc, then index asc", () => {
    const r = arbitrate({
      candidates: [rec("pause", "c2"), rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 5_000 },
        { campaignId: "c2", spend: 5_000 },
      ],
    });
    expect(r.primary?.campaignId).toBe("c1");
    const r2 = arbitrate({
      candidates: [rec("scale", "c1"), rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    // Same campaign, same score after identical penalties? pause and scale both
    // resetsLearning "no", both conflict-penalized -> tie -> action asc: pause < scale.
    expect(r2.primary?.action).toBe("pause");
  });

  it("measurement fix is never starved by the mutating cap and is chosen by urgency then index", () => {
    const fixLow = rec("fix_signal_health", "signal:px", { urgency: "this_week" });
    const fixHigh = rec("fix_signal_health", "signal:px", { urgency: "immediate" });
    const r = arbitrate({
      candidates: [
        rec("pause", "c1"),
        fixLow,
        fixHigh,
        rec("harden_capi_attribution", "signal:px"),
      ],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    expect(r.primary?.action).toBe("pause");
    expect(r.measurementFix).toMatchObject({ action: "fix_signal_health", index: 2 });
  });

  it("truthConfidence dampens: untrusted measurement and yellow signal multiply in", () => {
    const damp = assembleRevenueState({
      measurementTrusted: false,
      economicTier: "cpl",
      signalHealthScore: "yellow",
      coverage: { coveragePct: 0.6, sufficient: true },
    });
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: damp,
      currentInsights: [{ campaignId: "c1", spend: 5_000 }],
    });
    const expected =
      1 * PROXIMITY_BY_TIER.cpl * (MEASUREMENT_UNTRUSTED_FACTOR * SIGNAL_YELLOW_FACTOR * 0.6);
    expect(r.primary?.score).toBeCloseTo(expected, 10);
  });

  it("the account-scoped shift candidate takes magnitude from its from-source spend and the per-source coverage factor", () => {
    const shift = rec("shift_budget_to_source", ACCOUNT_CAMPAIGN_ID, {
      params: { from: "google_ads", to: "meta_ads", fromTrueRoas: "0.80", toTrueRoas: "2.40" },
    });
    const state = withSpendAttributionCoverage(trusted, { google_ads: 0.8, meta_ads: 0.9 });
    const r = arbitrate({
      candidates: [shift, rec("pause", "c1")],
      revenueState: state,
      currentInsights: [{ campaignId: "c1", spend: 2_000 }],
      spendBySource: { google_ads: 8_000, meta_ads: 0 },
    });
    // account spend = sum(currentInsights) = 2000; from-source magnitude = 8000.
    // share = 8000 / (2000) is clamped... NO: accountSpend includes ONLY campaign insights;
    // the shift share uses the same denominator and may exceed 1 -> clamped to 1.
    // score(shift) = min(1, 8000/2000) x 1 x (1 x min(0.8, 0.9)) - 0.05 (conditional reset)
    expect(r.primary?.action).toBe("shift_budget_to_source");
    expect(r.primary?.score).toBeCloseTo(1 * 1 * 0.8 - LEARNING_RESET_PENALTY.conditional, 10);
  });

  it("zero account spend yields zero materiality, never NaN", () => {
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: trusted,
      currentInsights: [{ campaignId: "c1", spend: 0 }],
    });
    expect(r.primary?.score).toBeCloseTo(0, 10);
    expect(Number.isNaN(r.primary?.score)).toBe(false);
  });

  it("is pure: does not mutate the candidates array or its items", () => {
    const candidates = [rec("pause", "c1"), rec("hold", "c2")];
    const snapshot = JSON.parse(JSON.stringify(candidates)) as unknown;
    arbitrate({
      candidates,
      revenueState: trusted,
      currentInsights: [
        { campaignId: "c1", spend: 1_000 },
        { campaignId: "c2", spend: 1_000 },
      ],
    });
    expect(JSON.parse(JSON.stringify(candidates))).toEqual(snapshot);
  });

  it("defensive tier fallback: missing economicTier uses the conservative cpc proximity", () => {
    const bare = assembleRevenueState({ measurementTrusted: true });
    const r = arbitrate({
      candidates: [rec("pause", "c1")],
      revenueState: bare,
      currentInsights: [{ campaignId: "c1", spend: 1_000 }],
    });
    expect(r.primary?.score).toBeCloseTo(PROXIMITY_BY_TIER.cpc, 10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test -- opportunity-arbitrator`
Expected: FAIL (module not found).

- [ ] **Step 3: Commit the test (red) only if your workflow commits red tests; otherwise proceed to Task 4 and commit green.** Default here: proceed to Task 4, commit both together.

---

### Task 4: implement arbitrate()

**Files:**

- Create: `packages/ad-optimizer/src/analyzers/opportunity-arbitrator.ts`

- [ ] **Step 1: Implementation**

```ts
import type {
  RecommendationOutputSchema as RecommendationOutput,
  EconomicTierSchema as EconomicTier,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";
import { ACTION_CONTRACT, isMutating } from "../action-contract.js";
import type { RevenueState } from "../revenue-state.js";
import { ACCOUNT_CAMPAIGN_ID } from "./source-reallocation.js";

/**
 * Riley v3 slice 2 (spec section 3): the OpportunityArbitrator. For low-volume SMB,
 * multiple simultaneous mutating edits in one cycle wreck attribution and reset
 * learning (the OutcomeLedger flags that damage after the fact as
 * same_campaign_overlap / same_kind_retry). The arbitrator closes the loop BEFORE
 * the fact, as decision support: it names the single most material mutating
 * opportunity per account per cycle (plus optionally one non-mutating measurement
 * fix) so the operator approves one change rather than many.
 *
 * ADDITIVE RANKING METADATA ONLY: arbitrate() is pure, never filters or reorders
 * candidates, and nothing in the emission or handoff path reads its output. The
 * ranking lands on the audit report for operator surfaces to consume later.
 *
 * Deterministic, model-free score per mutating candidate, every term in [0,1]:
 *   score = shareOfSpend x revenueProximity x truthConfidence
 *           - learningResetPenalty - attributionConflictPenalty
 * Tuning lives in the named constants below; tune via the eval, never silently.
 */

/** revenueProximity: how close this cycle's economic tier sits to booked revenue. */
export const PROXIMITY_BY_TIER: Record<EconomicTier, number> = {
  booked_cac: 1,
  cpl: 0.85,
  cpc: 0.7,
};

/** truthConfidence factor when the conversion denominator is suspect (producer 1). */
export const MEASUREMENT_UNTRUSTED_FACTOR = 0.5;

/** truthConfidence factor for a yellow signal-health score (red aborts upstream). */
export const SIGNAL_YELLOW_FACTOR = 0.8;

/** Penalty per learning-reset class (ACTION_CONTRACT.resetsLearning). */
export const LEARNING_RESET_PENALTY: Record<ResetsLearning, number> = {
  yes: 0.15,
  conditional: 0.05,
  no: 0,
};

/** Penalty when >=2 mutating candidates target the same campaign this cycle (the
 * intra-cycle analogue of the ledger's same_campaign_overlap flag). */
export const ATTRIBUTION_CONFLICT_PENALTY = 0.2;

const URGENCY_RANK: Record<RecommendationOutput["urgency"], number> = {
  immediate: 0,
  this_week: 1,
  next_cycle: 2,
};

/** A ranked mutating candidate. `index` is the candidate's position in the audit
 * report's recommendations[] (recs carry no id at report time; campaignId+action
 * alone is not unique, e.g. per-breach fix_signal_health recs). */
export interface RankedOpportunity {
  campaignId: string;
  action: RecommendationOutput["action"];
  index: number;
  score: number;
}

/** The selected non-mutating measurement fix (bypasses the mutating cap; unscored). */
export interface MeasurementFixRef {
  campaignId: string;
  action: RecommendationOutput["action"];
  index: number;
}

export interface ArbitrationResult {
  /** The single most material mutating opportunity; absent when no mutating candidate. */
  primary?: RankedOpportunity;
  /** Every other mutating candidate, best-first (same total order as primary). */
  secondary: RankedOpportunity[];
  /** At most one measurement-integrity fix (fix_signal_health / harden_capi_attribution). */
  measurementFix?: MeasurementFixRef;
}

export interface ArbitrateInput {
  /** The report's recommendations[] verbatim (order defines `index`). Never mutated. */
  candidates: RecommendationOutput[];
  /** Account-level pre-flight state — read the economics-ENRICHED state (producer 6). */
  revenueState: RevenueState;
  /** Structured materiality source: per-campaign current-window spend (dollars). */
  currentInsights: ReadonlyArray<{ campaignId: string; spend: number }>;
  /** Per-source attributed spend (dollars); keys the account-scoped shift candidate's
   * magnitude (its params.from pool). Absent -> that candidate's magnitude is 0. */
  spendBySource?: Record<string, number>;
}

/** Structured magnitude (dollars) for one candidate: its campaign's spend, or for the
 * account-scoped shift candidate, the from-source attributed spend being re-potted. */
function magnitudeFor(
  candidate: RecommendationOutput,
  spendByCampaign: ReadonlyMap<string, number>,
  spendBySource: Record<string, number> | undefined,
): number {
  if (candidate.campaignId === ACCOUNT_CAMPAIGN_ID) {
    const from = candidate.params?.from;
    return from !== undefined ? (spendBySource?.[from] ?? 0) : 0;
  }
  return spendByCampaign.get(candidate.campaignId) ?? 0;
}

/** Per-candidate truth confidence in [0,1] from the RevenueState composite. The
 * per-source attribution-coverage factor applies ONLY to the cross-source shift
 * candidate (it is a per-source signal; campaign candidates are not gated on it). */
function truthConfidenceFor(candidate: RecommendationOutput, state: RevenueState): number {
  let confidence =
    (state.measurementTrusted ? 1 : MEASUREMENT_UNTRUSTED_FACTOR) *
    (state.signalHealthScore === "yellow" ? SIGNAL_YELLOW_FACTOR : 1) *
    (state.coverage?.coveragePct ?? 1);
  if (
    candidate.action === "shift_budget_to_source" &&
    candidate.params?.from !== undefined &&
    candidate.params?.to !== undefined &&
    state.spendAttributionCoverageBySource !== undefined
  ) {
    const fromCov = state.spendAttributionCoverageBySource[candidate.params.from];
    const toCov = state.spendAttributionCoverageBySource[candidate.params.to];
    // The decision gate already enforced the 0.7 floor at creation; absence here is a
    // plumbing gap, not a signal gap, so missing entries do not re-penalize.
    confidence *= Math.min(fromCov ?? 1, toCov ?? 1, 1);
  }
  return confidence;
}

/** Total deterministic order: score desc, campaignId asc, action asc, index asc. */
function compareRanked(a: RankedOpportunity, b: RankedOpportunity): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.campaignId !== b.campaignId) return a.campaignId < b.campaignId ? -1 : 1;
  if (a.action !== b.action) return a.action < b.action ? -1 : 1;
  return a.index - b.index;
}

export function arbitrate(input: ArbitrateInput): ArbitrationResult {
  const { candidates, revenueState, spendBySource } = input;

  const spendByCampaign = new Map<string, number>();
  let accountSpend = 0;
  for (const i of input.currentInsights) {
    spendByCampaign.set(i.campaignId, i.spend);
    accountSpend += i.spend;
  }

  // Conflict detection: a campaign with >=2 mutating candidates this cycle.
  const mutatingCountByCampaign = new Map<string, number>();
  for (const c of candidates) {
    if (!isMutating(c.action)) continue;
    mutatingCountByCampaign.set(c.campaignId, (mutatingCountByCampaign.get(c.campaignId) ?? 0) + 1);
  }

  const proximity = PROXIMITY_BY_TIER[revenueState.economicTier ?? "cpc"];

  const ranked: RankedOpportunity[] = [];
  let measurementFix: MeasurementFixRef | undefined;
  let measurementFixRank = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    const contract = ACTION_CONTRACT[candidate.action];

    if (contract.evidenceFamily === "measurement") {
      // Measurement-integrity fixes bypass the mutating cap: non-mutating, they do not
      // conflict with attribution and must never be starved by it. Pick ONE, by
      // urgency rank then report order.
      const rank = URGENCY_RANK[candidate.urgency] * candidates.length + index;
      if (rank < measurementFixRank) {
        measurementFixRank = rank;
        measurementFix = { campaignId: candidate.campaignId, action: candidate.action, index };
      }
      continue;
    }

    if (!isMutating(candidate.action)) continue; // hold/test: informational, unranked.

    const magnitude = magnitudeFor(candidate, spendByCampaign, spendBySource);
    const shareOfSpend = accountSpend > 0 ? Math.min(magnitude / accountSpend, 1) : 0;
    const conflictPenalty =
      (mutatingCountByCampaign.get(candidate.campaignId) ?? 0) >= 2
        ? ATTRIBUTION_CONFLICT_PENALTY
        : 0;
    const score =
      shareOfSpend * proximity * truthConfidenceFor(candidate, revenueState) -
      LEARNING_RESET_PENALTY[candidate.resetsLearning] -
      conflictPenalty;
    ranked.push({ campaignId: candidate.campaignId, action: candidate.action, index, score });
  }

  ranked.sort(compareRanked);
  const [primary, ...secondary] = ranked;
  return {
    ...(primary !== undefined ? { primary } : {}),
    secondary,
    ...(measurementFix !== undefined ? { measurementFix } : {}),
  };
}
```

- [ ] **Step 2: Run the unit tests**

Run: `pnpm --filter @switchboard/ad-optimizer test -- opportunity-arbitrator`
Expected: PASS (12 tests).

- [ ] **Step 3: Commit (test + impl + sentinel export)**

```bash
git add packages/ad-optimizer/src/analyzers/opportunity-arbitrator.ts packages/ad-optimizer/src/analyzers/opportunity-arbitrator.test.ts packages/ad-optimizer/src/analyzers/source-reallocation.ts
git commit -m "feat(ad-optimizer): deterministic opportunity arbitrator (one primary mutating opportunity per cycle)"
```

Note: the `resetsLearning` read in the score uses `candidate.resetsLearning` (the rec field, always `resetsLearningFor(action)` today) — same source the sink elevation reads, so the two cannot disagree per-rec.

---

### Task 5: economics orchestrator returns the enriched RevenueState + spendBySource (additive)

**Files:**

- Modify: `packages/ad-optimizer/src/analyzers/source-reallocation.ts` (`computeAuditEconomicsSections` return)
- Test: `packages/ad-optimizer/src/analyzers/source-reallocation.test.ts` (extend)

- [ ] **Step 1: Extend the test file first** — add to the existing `computeAuditEconomicsSections` describe block (mirror its existing fixture builders; read them before writing):

```ts
it("returns the producer-6-enriched revenueState and spendBySource when per-source data exists", async () => {
  // Reuse the existing activated-path fixture from this file (bySource + adSetData present).
  const result = await computeAuditEconomicsSections(buildActivatedInput());
  expect(result.spendBySource).toBeDefined();
  expect(result.revenueState.spendAttributionCoverageBySource).toBeDefined();
});

it("passes the input revenueState through untouched when no per-source data exists", async () => {
  const input = buildActivatedInput();
  const bare = { ...input, bySource: undefined };
  const result = await computeAuditEconomicsSections(bare);
  expect(result.spendBySource).toBeUndefined();
  expect(result.revenueState).toBe(bare.revenueState);
});
```

(`buildActivatedInput` stands for whatever helper/fixture shape the existing tests use — reuse it exactly; do not invent a parallel fixture.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/ad-optimizer test -- source-reallocation`
      Expected: FAIL (`spendBySource`/`revenueState` not on the return type).

- [ ] **Step 3: Implement** — in `computeAuditEconomicsSections`:
  - extend the return type with `revenueState: RevenueState;` and `spendBySource?: Record<string, number>;` (doc comments: "Riley v3 slice 2: the input RevenueState completed with producer 6 when per-source data was available (passthrough otherwise); the arbitrator reads it" / "per-source attributed spend (dollars); keys the account-scoped shift candidate's structured materiality").
  - inside the `bySource` branch, hoist the enriched state to a const and reuse it:

```ts
const enrichedRevenueState = withSpendAttributionCoverage(input.revenueState, coverageBySource);
reallocation = decideSourceReallocation({
  // ...unchanged args...
  revenueState: enrichedRevenueState,
  nextCycleDate: input.nextCycleDate,
});
```

- track `spendBySource` from `computeSpendBySource`'s existing destructure and return:

```ts
return {
  sourceComparison,
  campaignEconomics,
  reallocation,
  revenueState: enrichedOrInput,
  ...(spendBySourceOut ? { spendBySource: spendBySourceOut } : {}),
};
```

(declare `let enrichedOrInput = input.revenueState;` + `let spendBySourceOut: Record<string, number> | undefined;` before the branch; assign inside it.)

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/ad-optimizer test -- source-reallocation`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/source-reallocation.ts packages/ad-optimizer/src/analyzers/source-reallocation.test.ts
git commit -m "feat(ad-optimizer): economics orchestrator returns enriched revenue state + per-source spend"
```

---

### Task 6: AuditReportSchema.arbitration (additive, schemas)

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts` (inside `AuditReportSchema`, after `campaignEconomics`)

- [ ] **Step 1: Add the optional field**

```ts
  // Riley v3 slice 2: cross-campaign arbitration — ADDITIVE ranking metadata over
  // recommendations[]; it never filters emission or handoff. Entries reference
  // recommendations[] by array index (recs carry no id at report time, and
  // campaignId+action alone is not unique, e.g. per-breach fix_signal_health recs)
  // plus campaignId+action for human legibility. primary is absent exactly when the
  // cycle produced no mutating candidate; measurementFix is the at-most-one
  // non-mutating measurement-integrity fix (it bypasses the mutating cap).
  arbitration: z
    .object({
      primary: z
        .object({
          campaignId: z.string(),
          action: AdRecommendationActionSchema,
          index: z.number().int().nonnegative(),
          score: z.number(),
        })
        .optional(),
      secondary: z.array(
        z.object({
          campaignId: z.string(),
          action: AdRecommendationActionSchema,
          index: z.number().int().nonnegative(),
          score: z.number(),
        }),
      ),
      measurementFix: z
        .object({
          campaignId: z.string(),
          action: AdRecommendationActionSchema,
          index: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional(),
```

No Prisma model is touched (the report persists as AgentTask JSON output), so no DB migration. `strict` tool-schema min/max constraints are not in play here (server-side Zod only).

- [ ] **Step 2: Build schemas + typecheck** — `pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/ad-optimizer typecheck`
      Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/ad-optimizer.ts
git commit -m "feat(schemas): optional arbitration ranking metadata on the audit report"
```

---

### Task 7: thread arbitration through AuditRunner.run() + integration test

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts` (Step 8d + report field; minimal lines — the file rides an explicit max-lines disable)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-arbitration.test.ts` (mirror the abort-guard harness builders)

- [ ] **Step 1: Write the failing integration test** — copy the fixture builders from `__tests__/audit-runner-abort-guard.test.ts` (makeCampaignInsight, makeAccountSummary, makeFunnelData, makeCrmBenchmarks, makeMediaBenchmarks, makeLearningInput, makeTargetBreach, buildSpiedDeps, RANGE) and assert:

```ts
describe("AuditRunner arbitration (additive ranking metadata)", () => {
  it("annotates arbitration on the report without changing recommendations or emission", async () => {
    const { deps } = buildSpiedDeps();
    const emitted: unknown[] = [];
    const emitter = vi.fn(async (input: unknown) => {
      emitted.push(input);
      return { surface: "approval_queue" as const };
    });
    const runner = new AuditRunner({
      ...deps,
      recommendationEmitter: emitter as never,
      recommendationEmissionContext: { cronId: "cron-test" },
    });
    const report = await runner.run(RANGE);

    if (report.recommendations.length > 0) {
      expect(report.arbitration).toBeDefined();
      const ranked = [
        ...(report.arbitration?.primary ? [report.arbitration.primary] : []),
        ...(report.arbitration?.secondary ?? []),
      ];
      // Every ranked entry indexes a real mutating recommendation, faithfully.
      for (const entry of ranked) {
        const rec = report.recommendations[entry.index];
        expect(rec).toBeDefined();
        expect(rec?.campaignId).toBe(entry.campaignId);
        expect(rec?.action).toBe(entry.action);
        expect(isMutating(rec!.action)).toBe(true);
      }
      // At most ONE primary; it is the best-ranked mutating candidate.
      // Emission saw every candidate (unfiltered), and no emitted payload carries arbitration.
      expect(emitter).toHaveBeenCalledTimes(report.recommendations.length);
      for (const input of emitted) {
        expect(Object.keys(input as Record<string, unknown>)).not.toContain("arbitration");
      }
    } else {
      expect(report.arbitration).toBeUndefined();
    }
  });

  it("abort paths carry no arbitration field", async () => {
    // Gate-0 abstention (insufficient coverage) — mirror the abort-guard fixture.
    const { deps } = buildSpiedDeps();
    const coverageValidator = {
      validate: vi.fn().mockResolvedValue({
        orgId: "org-1",
        accountId: "act-123",
        coveragePct: 0.2,
        trackedSpend: 200,
        totalSpend: 1000,
        bySource: {},
      }),
    };
    const runner = new AuditRunner({ ...deps, coverageValidator });
    const report = await runner.run(RANGE);
    expect(report.arbitration).toBeUndefined();
  });
});
```

Use the deps fixture WITHOUT an emitter for a second spied variant if the existing harness makes emitter wiring awkward — the load-bearing assertions are: arbitration present + faithful indices on the happy path, absent on aborts, emission count equals candidate count, emitted payloads carry no arbitration key. Ensure the happy-path fixture actually yields at least one recommendation (the abort-guard happy-path fixture produces decisions; if it yields none, adjust `makeCampaignInsight` overrides — e.g. a durable target breach via `makeTargetBreach()` with `periodsAboveTarget: 9` — so at least one mutating rec emerges; pin whatever the engine actually produces, do not force it).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/ad-optimizer test -- audit-runner-arbitration`
      Expected: FAIL (`report.arbitration` undefined / type error).

- [ ] **Step 3: Wire the runner** — in `audit-runner.ts`:
  - import: `import { arbitrate } from "./analyzers/opportunity-arbitrator.js";`
  - destructure the new economics returns at Step 8b:

```ts
    const {
      sourceComparison,
      campaignEconomics,
      reallocation,
      revenueState: economicsRevenueState,
      spendBySource,
    } = await computeAuditEconomicsSections({
```

- after Step 8c (signal recs appended), add Step 8d:

```ts
// Step 8d (Riley v3 slice 2): cross-campaign arbitration — ADDITIVE ranking
// metadata over the final candidate set. Pure annotation: Step 9 emission and
// the handoff consume `recommendations` unchanged; only the report carries the
// ranking. Reads the economics-enriched RevenueState (producer 6 present when
// per-source data existed).
const arbitration =
  recommendations.length > 0
    ? arbitrate({
        candidates: recommendations,
        revenueState: economicsRevenueState,
        currentInsights,
        ...(spendBySource ? { spendBySource } : {}),
      })
    : undefined;
```

- report assembly: add `...(arbitration ? { arbitration } : {}),` after the `campaignEconomics` spread.

- [ ] **Step 4: Run the suite** — `pnpm --filter @switchboard/ad-optimizer test`
      Expected: PASS (all files incl. abort-guard + new arbitration integration).

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/audit-runner-arbitration.test.ts
git commit -m "feat(ad-optimizer): annotate cross-campaign arbitration on the audit report"
```

---

### Task 8: the arbitration eval — raw decide helper, sub-harness, fixtures, runner section, vitest matrix

**Files:**

- Modify: `evals/riley-recommendation/decide.ts` (extract `decideRawForCase`; `decideForCase` delegates)
- Create: `evals/riley-recommendation/arbitration-eval.ts`
- Create: `evals/riley-recommendation/fixtures/arbitration/cases.jsonl`
- Modify: `evals/riley-recommendation/run-eval.ts` (third section)
- Create: `evals/riley-recommendation/__tests__/arbitration.test.ts`
- Modify: `packages/ad-optimizer/src/index.ts` (barrel: `generateSignalHealthRecommendations` for the eval's REAL measurement-fix producer)

- [ ] **Step 1: barrel** — extend the existing recommendation-engine export line:

```ts
export {
  generateRecommendations,
  generateSignalHealthRecommendations,
} from "./recommendation-engine.js";
```

- [ ] **Step 2: decide.ts raw helper** — add (above `decideForCase`), and make `decideForCase` delegate so the existing matrix is provably unchanged:

```ts
/** The decision-relevant subset of a fixture case (the arbitration eval reuses it
 * with eval-only fields stripped). */
export type RileyDecisionInputCase = Pick<
  RileyCase,
  | "current"
  | "previous"
  | "targetBreach"
  | "learningState"
  | "economicTier"
  | "effectiveTarget"
  | "targetROAS"
  | "measurementTrusted"
  | "hybrid"
>;

export interface RileyRawDecision {
  recommendations: ReturnType<typeof decideForCampaign>["recommendations"];
  watches: ReturnType<typeof decideForCampaign>["watches"];
  insights: ReturnType<typeof decideForCampaign>["insights"];
  targetSource?: TargetSource;
}

/**
 * Resolve a case through the REAL decideForCampaign pipeline and return the RAW
 * outputs (the arbitration eval feeds them to arbitrate(); decideForCase reduces
 * them to the per-campaign assertion surfaces). campaignId/campaignName are
 * parameterizable because a multi-campaign arbitration account needs distinct ids.
 */
export function decideRawForCase(
  c: RileyDecisionInputCase,
  campaignId = "c1",
  campaignName = "C1",
): RileyRawDecision {
  // ...body is the CURRENT decideForCase body verbatim with these changes:
  //   insight(m) -> insight(m, campaignId, campaignName)  (builder gains two params)
  //   decideForCampaign({ campaignId, campaignName, ... })
  //   returns { recommendations: r.recommendations, watches: r.watches,
  //             insights: r.insights, targetSource }
}

export function decideForCase(c: RileyCase): RileyDecision {
  const raw = decideRawForCase(c);
  const actions = sortedUnique(raw.recommendations.map((rec) => rec.action));
  const watchPatterns = sortedUnique(raw.watches.map((w) => w.pattern));
  const hasInsight = raw.insights.length > 0;
  const primary =
    raw.recommendations.length > 0
      ? raw.recommendations[0]!.action
      : raw.watches.length > 0
        ? "watch"
        : raw.insights.length > 0
          ? "insight"
          : "none";
  return { actions, watchPatterns, hasInsight, primary, targetSource: raw.targetSource };
}
```

(The `insight()` builder gains `campaignId`/`campaignName` params with the same defaults; statusFor stays campaign-agnostic — `adSetId`/`campaignId` literals inside it only label the classification input.)

Note on exactOptionalPropertyTypes: if `targetSource` assignment errors, build the return object with a conditional spread (`...(targetSource ? { targetSource } : {})`) exactly as the current file does at the decideForCampaign call.

- [ ] **Step 3: Run the EXISTING matrix to prove no drift** — `pnpm exec vitest run --config evals/vitest.config.ts riley-recommendation && pnpm eval:riley`
      Expected: green, `All 12 decideForCampaign + 10 source-reallocation cases match.`

- [ ] **Step 4: arbitration-eval.ts**

```ts
import {
  arbitrate,
  assembleRevenueState,
  generateSignalHealthRecommendations,
} from "@switchboard/ad-optimizer";
import type { SignalHealthReport, Breach } from "@switchboard/ad-optimizer";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RileyCaseSchema } from "./schema.js";
import { decideRawForCase } from "./decide.js";

/** One campaign inside a multi-campaign arbitration account: a standard riley case
 * body (decision-relevant fields only) plus the campaign identity. */
const ArbitrationCampaignSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string().optional(),
  case: RileyCaseSchema.omit({
    id: true,
    expectedOutcome: true,
    expectedActions: true,
    expectedWatchPatterns: true,
    expectedTargetSource: true,
    notes: true,
  }),
});

export const ArbitrationCaseSchema = z.object({
  id: z.string(),
  /** Account-level RevenueState inputs (proximity reads the ACCOUNT tier). */
  accountEconomicTier: z.enum(["booked_cac", "cpl", "cpc"]),
  accountEffectiveTarget: z.number(),
  accountMeasurementTrusted: z.boolean().optional(),
  /** Optional REAL measurement-fix producer input (generateSignalHealthRecommendations). */
  signalBreaches: z
    .array(
      z.object({
        signal: z.enum(["pixel_dead", "ratio_low", "dedup_low", "freshness_stale"]),
        severity: z.enum(["critical", "warning"]),
        message: z.string(),
      }),
    )
    .optional(),
  campaigns: z.array(ArbitrationCampaignSchema).min(1),
  /** The single selected primary, or null when the cycle must produce none. */
  expectedPrimary: z.object({ campaignId: z.string(), action: z.string() }).nullable(),
  /** Set-membership over secondary actions (mirrors expectedActions convention). */
  expectedSecondaryActions: z.array(z.string()).optional(),
  expectedMeasurementFixAction: z.string().optional(),
  notes: z.string().optional(),
});
export type ArbitrationCase = z.infer<typeof ArbitrationCaseSchema>;

export interface ArbitrationDecision {
  primary: { campaignId: string; action: string } | null;
  secondaryActions: string[];
  measurementFixAction?: string;
}

export function loadArbitrationCases(dir: string): ArbitrationCase[] {
  const rows: ArbitrationCase[] = [];
  const seen = new Set<string>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  for (const file of files) {
    const lines = readFileSync(join(dir, file), "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      const parsed = ArbitrationCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`${file}:${i + 1} — schema violation: ${parsed.error.message}`);
      }
      if (seen.has(parsed.data.id)) throw new Error(`duplicate case id: ${parsed.data.id}`);
      seen.add(parsed.data.id);
      rows.push(parsed.data);
    }
  }
  return rows;
}

/** Minimal healthy report wrapper: generateSignalHealthRecommendations reads only
 * `breaches`, but the type requires the full shape (mirrors the abort-guard fixture). */
function makeSignalReport(breaches: Breach[]): SignalHealthReport {
  return {
    pixelId: "px_eval",
    score: breaches.some((b) => b.severity === "critical") ? "red" : "yellow",
    pixelHealth: {
      pixelId: "px_eval",
      name: "Eval pixel",
      lastFiredAt: "2026-05-07T00:00:00.000Z",
      isUnavailable: false,
      automaticMatchingFields: ["em"],
      isDead: false,
    },
    eventVolume: { events: [] },
    capiHealth: {
      serverToBrowserRatio: 0.95,
      dedupRate: 0.85,
      lastServerEventAt: "2026-05-07T00:00:00.000Z",
      freshnessMs: 60_000,
      isFresh: true,
    },
    daChecks: { checks: [], hasFailure: false },
    emqProxy: 0.8,
    breaches,
  };
}

/**
 * Drive the REAL producers (decideForCampaign per campaign + the signal-health rec
 * generator) and the REAL arbitrate() — no re-implementation. Candidate order mirrors
 * the audit-runner: per-campaign recs in campaign order, then signal-health recs.
 */
export function runArbitrationCase(c: ArbitrationCase): ArbitrationDecision {
  const candidates: RecommendationOutput[] = [];
  const currentInsights: { campaignId: string; spend: number }[] = [];
  for (const entry of c.campaigns) {
    const raw = decideRawForCase(
      entry.case,
      entry.campaignId,
      entry.campaignName ?? entry.campaignId.toUpperCase(),
    );
    candidates.push(...raw.recommendations);
    currentInsights.push({ campaignId: entry.campaignId, spend: entry.case.current.spend });
  }
  if (c.signalBreaches && c.signalBreaches.length > 0) {
    candidates.push(
      ...generateSignalHealthRecommendations(makeSignalReport(c.signalBreaches as Breach[]), {
        pixelId: "px_eval",
        accountId: "act_eval",
      }),
    );
  }
  const result = arbitrate({
    candidates,
    revenueState: assembleRevenueState({
      measurementTrusted: c.accountMeasurementTrusted ?? true,
      marginBasis: "unavailable",
      economicTier: c.accountEconomicTier,
      effectiveTarget: c.accountEffectiveTarget,
    }),
    currentInsights,
  });
  return {
    primary: result.primary
      ? { campaignId: result.primary.campaignId, action: result.primary.action }
      : null,
    secondaryActions: [...new Set(result.secondary.map((s) => s.action))].sort(),
    ...(result.measurementFix ? { measurementFixAction: result.measurementFix.action } : {}),
  };
}
```

(If the `Breach` type's `signal` union is wider than the fixture enum, the `as Breach[]` cast narrows safely — fixture signals are a subset. If TS still objects, map the fields explicitly.)

- [ ] **Step 5: fixtures/arbitration/cases.jsonl** — author the cases by RUNNING the producers first (`pnpm eval:riley` will print mismatches with actual values; pin actuals, never guesses). Target matrix, one JSONL line each (bodies below are drafts; the per-campaign `case` bodies REUSE proven fixture bodies from the existing top-level jsonl files — copy the exact metric blocks; verify each campaign's produced actions before pinning expectations):
  1. `arb-spend-share-picks-primary` — two campaigns, each yielding one mutating rec (reuse a proven single-action body, e.g. the durable-breach pause/add_creative case trimmed to a single-action variant if one exists; else any two proven bodies), distinct spends; `expectedPrimary` = higher-spend campaign's action.
  2. `arb-conflict-demotes-contested-campaign` — campaign A reuses the proven durable-breach body that yields BOTH `add_creative` + `pause` (hybrid tier-1 case in `hybrid.jsonl`); campaign B a single mutating rec with ~75% of A's spend; `expectedPrimary` = B's, `expectedSecondaryActions` ⊇ A's two actions.
  3. `arb-measurement-fix-not-starved` — one mutating campaign + `signalBreaches: [{signal: "ratio_low", severity: "warning", message: "..."}]`; expect primary = the mutating action AND `expectedMeasurementFixAction: "fix_signal_health"`.
  4. `arb-untrusted-account-no-primary` — `accountMeasurementTrusted: false` with campaign bodies whose mutating recs are all cost-driven or learning-resetting (the per-campaign gate suppresses them); `expectedPrimary: null` (honest abstention propagates).
  5. `arb-deterministic-tiebreak` — two campaigns with IDENTICAL bodies and spends; `expectedPrimary` = lexicographically-first campaignId.
  6. `arb-diagnostics-unranked` — campaigns yielding only `hold`/insights; `expectedPrimary: null`, no measurement fix.

- [ ] **Step 6: run-eval.ts third section** — mirror the source-reallocation block:

```ts
import { loadArbitrationCases, runArbitrationCase } from "./arbitration-eval.js";
// ...
const ARB_FIXTURES_DIR = join(FIXTURES_DIR, "arbitration");
const arbCases = loadArbitrationCases(ARB_FIXTURES_DIR);
console.log(`Loaded ${arbCases.length} arbitration cases from ${ARB_FIXTURES_DIR}`);
for (const c of arbCases) {
  const decision = runArbitrationCase(c);
  if (JSON.stringify(decision.primary) !== JSON.stringify(c.expectedPrimary)) {
    mismatches.push(
      `${c.id}: expected primary ${JSON.stringify(c.expectedPrimary)}, got ${JSON.stringify(decision.primary)}`,
    );
  }
  for (const action of c.expectedSecondaryActions ?? []) {
    if (!decision.secondaryActions.includes(action)) {
      mismatches.push(`${c.id}: expected secondary action ${action} missing`);
    }
  }
  if (
    c.expectedMeasurementFixAction !== undefined &&
    decision.measurementFixAction !== c.expectedMeasurementFixAction
  ) {
    mismatches.push(
      `${c.id}: expected measurement fix ${c.expectedMeasurementFixAction}, got ${decision.measurementFixAction ?? "none"}`,
    );
  }
}
```

Adapt variable names to the file's existing conventions (read it; it collects into a mismatch array and exits 1 on any). Update the final success line to include the arbitration count (e.g. `All 12 decideForCampaign + 10 source-reallocation + 6 arbitration cases match.`).

- [ ] **Step 7: **tests**/arbitration.test.ts** — mirror the existing matrix test:

```ts
import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArbitrationCases, runArbitrationCase } from "../arbitration-eval.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "arbitration");
const cases = loadArbitrationCases(FIXTURES_DIR);

describe("riley arbitration matrix (real decideForCampaign -> real arbitrate)", () => {
  it("loads a non-empty case set", () => {
    expect(cases.length).toBeGreaterThanOrEqual(1);
  });
  it.each(cases.map((c) => [c.id, c] as const))("%s selects its expected primary", (_id, c) => {
    const decision = runArbitrationCase(c);
    expect(decision.primary).toEqual(c.expectedPrimary);
    for (const action of c.expectedSecondaryActions ?? []) {
      expect(decision.secondaryActions).toContain(action);
    }
    if (c.expectedMeasurementFixAction !== undefined) {
      expect(decision.measurementFixAction).toBe(c.expectedMeasurementFixAction);
    }
  });
});
```

- [ ] **Step 8: Run everything**

```bash
pnpm --filter @switchboard/ad-optimizer build
pnpm exec vitest run --config evals/vitest.config.ts
pnpm eval:riley
```

Expected: vitest green (incl. drift guard untouched — the loader does not recurse); eval prints the extended all-match line with existing counts UNCHANGED.

- [ ] **Step 9: Commit**

```bash
git add evals/riley-recommendation packages/ad-optimizer/src/index.ts
git commit -m "feat(eval): multi-campaign arbitration sub-eval with expectedPrimary pin"
```

---

### Task 9: full verification + invariant greps

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm arch:check && pnpm test && pnpm eval:riley
```

Expected: all green. Known flakes (rerun once before investigating): pg_advisory_xact_lock db tests, api bootstrap-smoke npm warning, gateway-bridge-attribution timeout under full-suite load.

- [ ] **Step 2: Invariant greps (proof for the PR body)**

```bash
git diff origin/main -- packages/ad-optimizer | grep -nE "PlatformIngress|\.submit\(" || echo "OK: no ingress caller"
git diff origin/main -- packages/ad-optimizer | grep -nE "from ['\"].*(dashboard|next/|react)" || echo "OK: no UI import"
git diff origin/main -- packages/ad-optimizer/src/recommendation-sink.ts | grep -E "^\+" | grep -v "^+++" | grep -vE "import \{ ACTION_CONTRACT \}|const contract = ACTION_CONTRACT" || echo "OK: sink diff is exactly the re-point"
```

Expected: three OK lines (the sink's only + lines are the import and the lookup swap).

- [ ] **Step 3: Emission-unchanged statement for the PR** — cite: sink test + action-contract agreement test green (emitted booleans pinned for all 14 actions), arbitration integration test (emit count == candidate count, no arbitration key in payloads), eval per-campaign + source-reallocation counts unchanged.

---

## Self-Review (spec coverage)

- Spec 2.3 ActionContract (three maps -> one record + isMutating + elevation trap) -> Tasks 1-2; both elevated cases pinned (refresh_creative AND add_creative).
- Spec 3 arbitrator (deterministic score, mutating cap, measurement-fix bypass, additive metadata, runs at run() level over all candidates incl. reallocation) -> Tasks 3-4, 7.
- Spec 7.1 (eval blind to cross-campaign; bring own pin) -> Task 8 (expectedPrimary fixtures + vitest matrix + runner section).
- Spec 7.6 (materiality must be structured, not prose scrape) -> design decision 3 + Task 3 spend-share tests + Task 5 spendBySource plumbing.
- Spec 7.7 (ownership placement decision, no silent duplication) -> design decision 1 (deferred, recorded, nothing duplicated).
- Roadmap acceptance gate (exactly one deterministic primary; fixes survive; emission/handoff provably unchanged; existing eval unchanged; new assertion green) -> Tasks 7-9.
- Type consistency check: `RankedOpportunity`/`MeasurementFixRef`/`ArbitrationResult` (Task 4) match the Zod field (Task 6) and the eval reads (Task 8); `decideRawForCase` signature consistent between Task 8 steps 2/4; `ACCOUNT_CAMPAIGN_ID` exported once (Task 3) and imported (Task 4).
