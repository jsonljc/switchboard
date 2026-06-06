# Riley v3 Slice 4d: Corroborated Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The outcome ledger earns the type-reserved `corroborated` arm of `causalStrength` honestly: a pause outcome is corroborated when the org-level booking-side second estimate agrees (booked revenue per ad dollar held across the same half-open windows), behind explicit judgeability floors; the corroborated-never-emitted sweep test flips deliberately into positive pins plus no-fabrication negatives.

**Architecture:** Two estimate sources stay independent: org-level Meta spend rides the EXISTING per-window Graph call as an optional `WindowMetrics.accountSpendCents` (the apps/api adapter already fetches account-wide data and discards it; zero new Graph calls), and org-level booked value/count arrives through a new injected `OrgBookedStatsReader` (implemented by a same-shaped method on `PrismaConversionRecordStore`, the `operationalStateReader` wiring precedent). A pure `outcome-corroboration.ts` module in core owns the predicate (P1 pause-only, P2 clean directional, P3 favorable, P4 not-unstable; F1 inputs present, F2 ≥3 valued bookings per window, F3 account post-spend ≥ 0.5 × pre-spend; A1 post ratio ≥ 0.8 × pre ratio); `attributeOneRecommendation` upgrades `directional` to `corroborated` when it holds. Reader failures propagate (insert-once rows, Inngest retries); reader absent is byte-identical to today. Pause-only; `refresh_creative` deferral is pinned. Zero migrations (the slice-3 CHECK already admits `'corroborated'`), zero new env vars, zero UI diffs.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/core` (Layer 3, pure derivation + orchestrator), `packages/db` (Layer 4, reader implementation), `apps/api` (adapter + DI wiring); Vitest (mocked Prisma in db tests; CI has no Postgres); `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26) byte-unchanged gates.

**Consumes:** `docs/superpowers/specs/2026-06-06-riley-v3-slice4d-corroborated-outcomes-design.md` (in this PR). Spec section references below (P1-P4, F1-F3, A1) are to that document's section 2.

**Scope fence (4d only):** NO migration (proven: `20260604200000_recommendation_outcome_enrichment` already constrains `causalStrength IN ('directional','corroborated','inconclusive')`), NO new env var (the cron stays behind `RILEY_OUTCOME_ATTRIBUTION_ENABLED`), NO UI diff, NO `packages/ad-optimizer` diff, NO PlatformIngress caller, NO trustDelta/copy changes (`renderTrustDeltaCopy` + tripwire byte-untouched), NO candidate-selection changes (Phase-C executed-pause linkage recorded as a separate slice, spec section 8).

---

## Baselines (captured pre-change in this worktree)

- `/tmp/slice4d-baselines/eval-riley-baseline.txt` (exit 0; "All 12 decideForCampaign + 10 source-reallocation + 6 arbitration cases match.")
- `/tmp/slice4d-baselines/eval-governance-baseline.txt` (exit 0; "All 26 governance decisions match the live gate.")

Re-run + byte-diff after Tasks 2, 3 and in Task 8. The outcome path has no import-graph contact with `evals/` (4c proved the property; this slice adds none).

## File structure

```
docs/superpowers/specs/2026-06-06-riley-v3-slice4d-corroborated-outcomes-design.md (committed)
docs/superpowers/plans/2026-06-06-riley-v3-slice4d-corroborated-outcomes.md        (this file, Task 0)
packages/core/src/recommendations/outcome-attribution-types.ts                     (modify: +accountSpendCents, +OrgBookedWindowStats, +OrgBookedStatsReader)
packages/core/src/recommendations/outcome-corroboration.ts                         (create ~120 lines: constants + deriveCorroboration)
packages/core/src/recommendations/__tests__/outcome-corroboration.test.ts          (create ~260 lines)
packages/core/src/recommendations/outcome-attribution.ts                           (modify: input, derivation, orchestrator, summary)
packages/core/src/recommendations/__tests__/outcome-attribution.test.ts            (modify: sweep flip + pins + threading)
packages/core/src/recommendations/index.ts                                         (modify: +2 type re-exports)
packages/db/src/stores/prisma-conversion-record-store.ts                           (modify: +getBookedStatsForOrgWindow)
packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts            (modify: +aggregate mock + 3 tests)
packages/db/src/__tests__/recommendation-outcome-store.test.ts                     (modify: +corroborated read fixture)
apps/api/src/services/cron/meta-insights-adapter.ts                                (modify: +accountSpendCents)
apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts                 (modify: +2 tests)
apps/api/src/services/cron/riley-outcome-attribution.ts                            (modify: +orgBookedStatsReader dep)
apps/api/src/__tests__/riley-outcome-bind.test.ts                                  (create ~80 lines: bind passthrough)
apps/api/src/__tests__/outcome-activity-row.test.ts                                (modify: +corroborated-renders-identically test)
apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts                          (modify: flip one fixture to corroborated)
apps/api/src/bootstrap/inngest.ts                                                  (modify: +1 wiring line)
```

All files stay under the 600-line arch ceiling (`outcome-attribution.ts` goes ~323 → ~365; the arch check skips test files). ESM `.js` relative imports; no `any`; typed spy implementations everywhere (arg-less `vi.fn()` breaks the package BUILD via tsc-over-tests).

---

## Task 0: Commit the approved plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-06-riley-v3-slice4d-corroborated-outcomes.md` (this document)

- [ ] **Step 0.1: Verify branch context, then commit**

```bash
git branch --show-current   # expect: feat/riley-4d-corroborated-outcomes
git status --short          # expect: only this plan doc
git add docs/superpowers/plans/2026-06-06-riley-v3-slice4d-corroborated-outcomes.md
git commit -m "docs(plans): riley v3 slice 4d corroborated-outcomes implementation plan"
```

Note: lint-staged may reformat markdown on commit; if the commit reports modified files, `git add` again and re-commit.

---

## Task 1: Types + the pure corroboration module (`packages/core`)

**Files:**

- Modify: `packages/core/src/recommendations/outcome-attribution-types.ts`
- Create: `packages/core/src/recommendations/__tests__/outcome-corroboration.test.ts`
- Create: `packages/core/src/recommendations/outcome-corroboration.ts`
- Modify: `packages/core/src/recommendations/index.ts`

- [ ] **Step 1.1: Add the two type seams to `outcome-attribution-types.ts` and the not-causal-proof comment**

REPLACE the existing `CausalStrength` doc comment block (currently "Slice-3 enrichment enums... must never emit it before that signal exists (honesty floor, spec section 7.5).") with:

```ts
/**
 * Slice-3 enrichment enums (Riley v3 OutcomeLedger, spec section 2.5).
 *
 * causalStrength: "corroborated" (emitted since slice 4d) means a SECOND,
 * INDEPENDENT booked-value estimate agrees with the directional outcome
 * under explicit judgeability floors (outcome-corroboration.ts). It does
 * NOT mean causal proof: no consumer, copy surface, or future scoring
 * change may treat it as one (the whole system's bar is not overclaiming).
 */
```

In the `WindowMetrics` interface, add after `dailyRowCount: number;`:

```ts
  /**
   * Slice-4d: org-level (ad-account-level) spend for the SAME window, in
   * cents. Populated when the provider fetches account-scope data (the
   * apps/api adapter does: its Graph call already returns every campaign and
   * this is the sum BEFORE the campaign filter). Optional: a provider that
   * cannot supply it leaves the corroboration predicate unjudgeable (honest
   * absence, never fabricated; spec 4d F1).
   */
  accountSpendCents?: number;
```

Directly after the `OperationalStateReader` interface, add:

```ts
/**
 * Slice-4d: org-level windowed booked stats, the CRM-side independent second
 * estimate for the corroboration predicate (spec 2.5: "read from the
 * booked-value/CRM side"). Implementation is
 * PrismaConversionRecordStore.getBookedStatsForOrgWindow in @switchboard/db,
 * injected at the app layer (core is Layer 3 and cannot import db). A counted
 * booking is type:"booked" AND value > 0 (the same predicate as the summed
 * value, so the count can never be satisfied by zero-value rows the sum
 * excludes); the window is HALF-OPEN [startInclusive, endExclusive),
 * mirroring the engine's Meta window queries. Values are CENTS end to end.
 * Zeros are honest absence: they fail the corroboration floors, they are
 * never an error.
 */
export interface OrgBookedWindowStats {
  bookedValueCents: number;
  bookedCount: number;
}

export interface OrgBookedStatsReader {
  getBookedStatsForOrgWindow(args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }): Promise<OrgBookedWindowStats>;
}
```

- [ ] **Step 1.2: Write the failing tests for the pure predicate**

Every assertion pins the exact `reason` code, not just the upgrade (rollout debugging never reconstructs why corroboration stayed off). Create `packages/core/src/recommendations/__tests__/outcome-corroboration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CORROBORATION_MIN_BOOKINGS_PER_WINDOW,
  CORROBORATION_RATIO_HOLD_TOLERANCE,
  CORROBORATION_SPEND_CONTINUITY_CEILING,
  CORROBORATION_SPEND_CONTINUITY_FLOOR,
  deriveCorroboration,
  type DeriveCorroborationInput,
} from "../outcome-corroboration.js";

/**
 * Baseline passing input (every test perturbs exactly one dimension):
 * pause, clean favorable delta, context unknown, account spend 100000c pre /
 * 80000c post (continuity 0.8, inside [0.5, 1.5]), bookings 5/5, booked
 * value 50000c pre (ratio 0.5) / 45000c post (ratio 0.5625 >= 0.8 * 0.5 = 0.4).
 */
function passing(): DeriveCorroborationInput {
  return {
    actionKind: "pause",
    visibilityFlagCount: 0,
    deltaPct: -92,
    businessContextStable: "unknown",
    preAccountSpendCents: 100000,
    postAccountSpendCents: 80000,
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  };
}

const CORROBORATED = { causalStrengthUpgrade: "corroborated", reason: "corroborated" } as const;

function rejected(reason: string): { causalStrengthUpgrade: null; reason: string } {
  return { causalStrengthUpgrade: null, reason };
}

describe("deriveCorroboration: constants", () => {
  it("pins the floors, band, and tolerance (spec 4d section 2)", () => {
    expect(CORROBORATION_MIN_BOOKINGS_PER_WINDOW).toBe(3);
    expect(CORROBORATION_SPEND_CONTINUITY_FLOOR).toBe(0.5);
    expect(CORROBORATION_SPEND_CONTINUITY_CEILING).toBe(1.5);
    expect(CORROBORATION_RATIO_HOLD_TOLERANCE).toBe(0.8);
  });
});

describe("deriveCorroboration: the passing case and the agreement boundary", () => {
  it("corroborates the baseline (favorable pause, floors met, ratio held)", () => {
    expect(deriveCorroboration(passing())).toEqual(CORROBORATED);
  });

  it("corroborates when booking efficiency IMPROVED (the expected waste-pause outcome)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = 90000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("corroborates at exactly the hold boundary (post ratio = 0.8 x pre ratio)", () => {
    const input = passing();
    // pre ratio 0.5; threshold 0.4; post spend 80000 => booked exactly 32000.
    input.orgBookedStats!.postWindow.bookedValueCents = 32000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("degrades just below the hold boundary (the second estimate does not agree)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = 31999;
    expect(deriveCorroboration(input)).toEqual(rejected("ratio_degraded"));
  });
});

describe("deriveCorroboration: preconditions (P1-P4)", () => {
  it("never corroborates refresh_creative, even with passing inputs (recorded deferral, spec 4d section 6)", () => {
    expect(deriveCorroboration({ ...passing(), actionKind: "refresh_creative" })).toEqual(
      rejected("not_pause"),
    );
  });

  it("never corroborates a flagged row (no clean first estimate)", () => {
    expect(deriveCorroboration({ ...passing(), visibilityFlagCount: 1 })).toEqual(
      rejected("visibility_flagged"),
    );
  });

  it("never corroborates without a computed delta", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: null })).toEqual(
      rejected("missing_delta"),
    );
  });

  it("never corroborates an unfavorable pause (spend rose: nothing to corroborate)", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: 10 })).toEqual(
      rejected("unfavorable_direction"),
    );
  });

  it("never corroborates a zero delta (not favorable)", () => {
    expect(deriveCorroboration({ ...passing(), deltaPct: 0 })).toEqual(
      rejected("unfavorable_direction"),
    );
  });

  it("never corroborates over an operator-confirmed unstable window (both estimates confounded)", () => {
    expect(deriveCorroboration({ ...passing(), businessContextStable: "unstable" })).toEqual(
      rejected("unstable_context"),
    );
  });

  it("corroborates over a stable window (operator confirmation strengthens, never blocks)", () => {
    expect(deriveCorroboration({ ...passing(), businessContextStable: "stable" })).toEqual(
      CORROBORATED,
    );
  });
});

describe("deriveCorroboration: judgeability floors (F1-F3, the no-fabrication set)", () => {
  it("unjudgeable when the booking reader was absent (F1)", () => {
    expect(deriveCorroboration({ ...passing(), orgBookedStats: undefined })).toEqual(
      rejected("missing_booking_stats"),
    );
  });

  it("unjudgeable when pre-window account spend is missing (F1)", () => {
    expect(deriveCorroboration({ ...passing(), preAccountSpendCents: undefined })).toEqual(
      rejected("missing_account_spend"),
    );
  });

  it("unjudgeable when post-window account spend is missing (F1)", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: undefined })).toEqual(
      rejected("missing_account_spend"),
    );
  });

  it("unjudgeable from a 0-booking window (the spec's literal floor)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow = { bookedValueCents: 0, bookedCount: 0 };
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("unjudgeable below the booking floor in the PRE window (2 < 3)", () => {
    const input = passing();
    input.orgBookedStats!.preWindow.bookedCount = 2;
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("unjudgeable below the booking floor in the POST window (2 < 3)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedCount = 2;
    expect(deriveCorroboration(input)).toEqual(rejected("sparse_bookings"));
  });

  it("judgeable at exactly the booking floor (3 per window)", () => {
    const input = passing();
    input.orgBookedStats!.preWindow.bookedCount = 3;
    input.orgBookedStats!.postWindow.bookedCount = 3;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable with zero pre-window account spend (no ratio exists)", () => {
    expect(deriveCorroboration({ ...passing(), preAccountSpendCents: 0 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("unjudgeable when account spend collapsed past the continuity floor (the 4c degeneracy, F3)", () => {
    // Single-campaign org: post account spend ~ post campaign spend ~ 0.
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 800 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("judgeable at exactly the continuity floor (post = 0.5 x pre)", () => {
    const input = passing();
    input.postAccountSpendCents = 50000;
    // Keep the ratio held: pre ratio 0.5, threshold 0.4; post 50000c spend
    // needs >= 20000c booked; baseline post booked 45000c passes.
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable just below the continuity floor", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 49999 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });

  it("judgeable at exactly the continuity ceiling (post = 1.5 x pre)", () => {
    const input = passing();
    input.postAccountSpendCents = 150000;
    // Ratio must still hold at the bigger denominator: threshold 0.4 of pre
    // ratio 0.5 needs >= 60000c booked on 150000c post spend.
    input.orgBookedStats!.postWindow.bookedValueCents = 60000;
    expect(deriveCorroboration(input)).toEqual(CORROBORATED);
  });

  it("unjudgeable just above the continuity ceiling (a scaled-up account is a different regime)", () => {
    expect(deriveCorroboration({ ...passing(), postAccountSpendCents: 150001 })).toEqual(
      rejected("spend_continuity_failed"),
    );
  });
});

describe("deriveCorroboration: explicit ratio guards (defensive; unreachable from the live reader)", () => {
  it("unjudgeable when pre-window booked value is non-positive (preRatio > 0 must not depend on a store predicate)", () => {
    const input = passing();
    // bookedCount stays 5: only schema/store drift could produce this shape.
    input.orgBookedStats!.preWindow.bookedValueCents = 0;
    expect(deriveCorroboration(input)).toEqual(rejected("invalid_booked_value"));
  });

  it("unjudgeable when post-window booked value is negative (corrupt data must not certify)", () => {
    const input = passing();
    input.orgBookedStats!.postWindow.bookedValueCents = -100;
    expect(deriveCorroboration(input)).toEqual(rejected("invalid_booked_value"));
  });
});

describe("deriveCorroboration: cents discipline", () => {
  it("compares cents over cents (a dollars-vs-cents mixup on one side would flip the verdict)", () => {
    const input = passing();
    // If post booked value were misread as dollars (45000 -> 450), the ratio
    // would collapse 100x and the verdict would flip. Pin the true cents
    // reading and the flipped misreading.
    expect(deriveCorroboration(input).causalStrengthUpgrade).toBe("corroborated");
    input.orgBookedStats!.postWindow.bookedValueCents = 450;
    expect(deriveCorroboration(input)).toEqual(rejected("ratio_degraded"));
  });
});
```

- [ ] **Step 1.3: Run, verify failure on the missing module**

```bash
pnpm --filter @switchboard/core test -- outcome-corroboration
```

Expected: FAIL with a module-resolve error for `../outcome-corroboration.js`.

- [ ] **Step 1.4: Write the module**

Create `packages/core/src/recommendations/outcome-corroboration.ts`:

```ts
import type { AttributableKind } from "./outcome-attribution-config.js";
import type {
  BusinessContextStability,
  OrgBookedWindowStats,
} from "./outcome-attribution-types.js";

/**
 * The corroboration predicate for the outcome ledger (Riley v3 slice 4d;
 * spec docs/superpowers/specs/2026-06-06-riley-v3-slice4d-corroborated-
 * outcomes-design.md section 2; v3 spec 2.5 and risk 7.5).
 *
 * "Corroborated" means an INDEPENDENT second estimate agrees with the
 * Meta-side delta, read from the booked-value/CRM side: the org's booked
 * revenue per ad dollar held (or improved) across the same two half-open
 * windows while this campaign's spend fell. The campaign-level form of this
 * signal is mathematically degenerate for pause (post-pause campaign spend
 * tends to zero), so the comparison is org-level on BOTH sides: account
 * spend from the Meta window read, org-wide booked value from the
 * conversion ledger.
 *
 * The predicate only ever UPGRADES a row that is already directional; every
 * failure mode below leaves today's value untouched. It never demotes, and
 * its absence is never an error: unjudgeable means "stay honest, say
 * directional".
 */

/**
 * Minimum valued bookings (type:"booked", value > 0) in EACH window for the
 * booking-side estimate to be judgeable. Echoes the repo's
 * MIN_SOURCE_BOOKINGS = 3. A 0-booking window is unjudgeable by definition
 * (the spec's "never fabricate corroborated from a 0-booking window" made
 * literal, with margin): one lucky booking must not certify agreement.
 */
export const CORROBORATION_MIN_BOOKINGS_PER_WINDOW = 3;

/**
 * The anti-degeneracy floor: post-window account spend must be at least this
 * fraction of pre-window account spend for "bookings per ad dollar" to be
 * the same statistic across the two windows. A single-campaign org's account
 * spend collapses with the pause (the 4c Decision-F degeneracy) and fails
 * here; so does pausing a campaign that dominated account spend, where the
 * residual traffic is a different regime. Bounding denominator shrinkage at
 * 2x also bounds the ratio comparison's noise amplification.
 */
export const CORROBORATION_SPEND_CONTINUITY_FLOOR = 0.5;

/**
 * The anti-mix-shift ceiling, the floor's mirror: a major post-anchor
 * scale-up (another campaign launched or scaled hard) changes the
 * statistic's regime just as surely as a collapse, and a ratio that "held"
 * across a doubled account is agreement about a different account. v1
 * limitation, recorded: the band checks the account-level denominator only;
 * campaign-mix shift WITHIN the band, organic-demand spikes, cross-channel
 * campaigns, and in-window seasonality are not detected here (the
 * operator-confirmed unstable block catches the operator-visible subset).
 */
export const CORROBORATION_SPEND_CONTINUITY_CEILING = 1.5;

/**
 * "Held" tolerance: the post-window booked-revenue-per-dollar ratio must be
 * at least this fraction of the pre-window ratio. Wider than the
 * single-metric noise floors (5%/10%) because this is a ratio of ratios over
 * two sparse windows; window-to-window booking variance at SMB volume
 * comfortably exceeds single-metric variance. A >20% efficiency degradation
 * cannot honestly be called "held".
 */
export const CORROBORATION_RATIO_HOLD_TOLERANCE = 0.8;

/**
 * Why corroboration did or did not hold. "corroborated" is the only reason
 * that upgrades; every other value names the first gate that rejected, in
 * evaluation order. Exists so tests pin exact failure modes and rollout
 * debugging never reconstructs why corroborated stayed off.
 */
export type CorroborationReason =
  | "corroborated"
  | "not_pause"
  | "visibility_flagged"
  | "missing_delta"
  | "unfavorable_direction"
  | "unstable_context"
  | "missing_booking_stats"
  | "missing_account_spend"
  | "sparse_bookings"
  | "spend_continuity_failed"
  | "invalid_booked_value"
  | "ratio_degraded";

export interface CorroborationVerdict {
  /** "corroborated" when the second estimate agrees under floors; null otherwise. */
  causalStrengthUpgrade: "corroborated" | null;
  reason: CorroborationReason;
}

export interface DeriveCorroborationInput {
  actionKind: AttributableKind;
  /** Number of visibility flags on the row (any flag means no clean first estimate). */
  visibilityFlagCount: number;
  /** The campaign-level delta; null when not computable. */
  deltaPct: number | null;
  businessContextStable: BusinessContextStability;
  /** Org-level Meta spend for the pre window, cents; undefined when the provider cannot supply it. */
  preAccountSpendCents: number | undefined;
  /** Org-level Meta spend for the post window, cents; undefined when the provider cannot supply it. */
  postAccountSpendCents: number | undefined;
  /** Org-level booked stats for both windows; undefined when no reader is wired. */
  orgBookedStats: { preWindow: OrgBookedWindowStats; postWindow: OrgBookedWindowStats } | undefined;
}

function reject(reason: Exclude<CorroborationReason, "corroborated">): CorroborationVerdict {
  return { causalStrengthUpgrade: null, reason };
}

/**
 * The reasoned corroboration verdict. Self-contained honesty: every
 * precondition and floor is re-checked here (defense in depth, mirroring
 * operational-stability.ts), so no caller can reach the agreement test with
 * a flagged row or a missing input. Callers that persist consume only
 * causalStrengthUpgrade; the reason is for tests and rollout debugging.
 */
export function deriveCorroboration(input: DeriveCorroborationInput): CorroborationVerdict {
  // P1: pause-only. refresh_creative is a recorded deferral (spec 4d
  // section 6): per-campaign booking sparsity, lag contamination without a
  // differencing majority, and weak agreement semantics.
  if (input.actionKind !== "pause") return reject("not_pause");
  // P2: the first estimate must exist and be clean (the row would be
  // directional today).
  if (input.visibilityFlagCount > 0) return reject("visibility_flagged");
  if (input.deltaPct === null) return reject("missing_delta");
  // P3: favorable only (pause's favorableDirection is "down"). An
  // unfavorable pause failed on its own metric; there is no effect for the
  // booking side to corroborate.
  if (input.deltaPct >= 0) return reject("unfavorable_direction");
  // P4: affirmative operator-confirmed disruption confounds the booking-side
  // estimate exactly as it confounds the Meta-side delta. "unknown" does NOT
  // block: the booking signal's independence does not depend on operator
  // attestation.
  if (input.businessContextStable === "unstable") return reject("unstable_context");
  // F1: both inputs must exist; absence is unjudgeable, never an error.
  if (input.orgBookedStats === undefined) return reject("missing_booking_stats");
  if (input.preAccountSpendCents === undefined || input.postAccountSpendCents === undefined) {
    return reject("missing_account_spend");
  }
  const { preWindow, postWindow } = input.orgBookedStats;
  // F2: sparse-booking floor, each window independently.
  if (
    preWindow.bookedCount < CORROBORATION_MIN_BOOKINGS_PER_WINDOW ||
    postWindow.bookedCount < CORROBORATION_MIN_BOOKINGS_PER_WINDOW
  ) {
    return reject("sparse_bookings");
  }
  // F3: spend continuity, both directions (the comparable-regime band).
  if (input.preAccountSpendCents <= 0) return reject("spend_continuity_failed");
  if (
    input.postAccountSpendCents <
      CORROBORATION_SPEND_CONTINUITY_FLOOR * input.preAccountSpendCents ||
    input.postAccountSpendCents >
      CORROBORATION_SPEND_CONTINUITY_CEILING * input.preAccountSpendCents
  ) {
    return reject("spend_continuity_failed");
  }
  // Explicit ratio guards (defensive: the live reader's value > 0 predicate
  // makes these unreachable via F2, but the invariant preRatio > 0 must not
  // depend on a store predicate surviving future schema changes).
  if (preWindow.bookedValueCents <= 0 || postWindow.bookedValueCents < 0) {
    return reject("invalid_booked_value");
  }
  // A1: the agreement test. Cents over cents on both sides; dimensionless.
  const preRatio = preWindow.bookedValueCents / input.preAccountSpendCents;
  const postRatio = postWindow.bookedValueCents / input.postAccountSpendCents;
  if (postRatio < CORROBORATION_RATIO_HOLD_TOLERANCE * preRatio) {
    return reject("ratio_degraded");
  }
  return { causalStrengthUpgrade: "corroborated", reason: "corroborated" };
}
```

- [ ] **Step 1.5: Re-export the two reader types from the recommendations barrel**

In `packages/core/src/recommendations/index.ts`, inside the existing `export type { ... } from "./outcome-attribution-types.js";` block, add after `OperationalStateReader,`:

```ts
  OrgBookedStatsReader,
  OrgBookedWindowStats,
```

(`deriveCorroboration` and the constants stay module-internal to the recommendations dir, the `deriveBusinessContextStability` precedent: no external consumer.)

- [ ] **Step 1.6: Run, verify green**

```bash
pnpm --filter @switchboard/core test -- outcome-corroboration && pnpm --filter @switchboard/core build && pnpm typecheck
```

Expected: all new tests PASS; build + typecheck clean (the types-only edits in Step 1.1/1.5 break nothing).

- [ ] **Step 1.7: Commit**

```bash
git branch --show-current   # expect: feat/riley-4d-corroborated-outcomes
git add packages/core/src/recommendations/outcome-attribution-types.ts \
        packages/core/src/recommendations/outcome-corroboration.ts \
        packages/core/src/recommendations/__tests__/outcome-corroboration.test.ts \
        packages/core/src/recommendations/index.ts
git commit -m "feat(core): corroboration predicate + org-booked reader types (riley v3 slice 4d)"
```

---

## Task 2: The derivation flip (`attributeOneRecommendation`) and the deliberate sweep flip

**Files:**

- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution.ts`

- [ ] **Step 2.1: Flip the sweep test and add the row-level pins (failing first)**

In `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`:

(a) Extend the `w()` helper with an optional account-spend arg (existing calls unchanged):

```ts
function w(
  spendCents: number,
  ctr: number,
  dailyRowCount = 7,
  accountSpendCents?: number,
): WindowMetrics {
  return {
    spendCents,
    ctr,
    dailyRowCount,
    ...(accountSpendCents !== undefined ? { accountSpendCents } : {}),
  };
}
```

(b) REPLACE the entire `it("never emits corroborated (reserved for the slice-4 corroboration signal)", ...)` test (the slice-3 sweep, deliberately flipped this slice) with:

```ts
it("emits corroborated only for a favorable pause whose booking-side estimate is judgeable and agrees (slice 4d)", () => {
  const row = attributeOneRecommendation({
    candidate: REC,
    preWindow: w(10000, 0.02, 7, 100000),
    postWindow: w(800, 0.02, 7, 80000),
    overlaps: [],
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  });
  expect(row.causalStrength).toBe("corroborated");
  // The corroborated row is otherwise its directional twin: renderability,
  // copy, and the trust signal are untouched by the upgrade.
  expect(row.cockpitRenderable).toBe(true);
  expect(row.copyTemplate).toBe("pause.spend.fell");
  expect(row.trustDelta).toBe("up");
});

it("never fabricates corroborated when the booking side is absent or unjudgeable (the slice-3 sweep, strengthened)", () => {
  const judgeableBookings = {
    preWindow: { bookedValueCents: 50000, bookedCount: 5 },
    postWindow: { bookedValueCents: 45000, bookedCount: 5 },
  };
  const fixtures: Array<{ name: string; input: Parameters<typeof attributeOneRecommendation>[0] }> =
    [
      {
        name: "no reader wired (today's callers, byte-identical)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
        },
      },
      {
        name: "reader wired but account spend missing (provider cannot supply)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02),
          postWindow: w(800, 0.02),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "sparse bookings (2 < 3 in the post window)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 45000, bookedCount: 2 },
          },
        },
      },
      {
        name: "zero-booking post window (the spec's literal no-fabrication case)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 0, bookedCount: 0 },
          },
        },
      },
      {
        name: "account spend collapsed past continuity (single-campaign degeneracy)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 10000),
          postWindow: w(800, 0.02, 7, 800),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "booking efficiency degraded past the hold tolerance (the second estimate DISAGREES)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [],
          orgBookedStats: {
            preWindow: { bookedValueCents: 50000, bookedCount: 5 },
            postWindow: { bookedValueCents: 10000, bookedCount: 5 },
          },
        },
      },
      {
        name: "unfavorable pause (spend rose: nothing to corroborate)",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(11000, 0.02, 7, 110000),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "flagged row (overlap): no clean first estimate",
        input: {
          candidate: REC,
          preWindow: w(10000, 0.02, 7, 100000),
          postWindow: w(800, 0.02, 7, 80000),
          overlaps: [{ id: "rec-2", actionKind: "pause" as const }],
          orgBookedStats: judgeableBookings,
        },
      },
      {
        name: "refresh_creative with passing inputs (recorded per-kind deferral)",
        input: {
          candidate: { ...REC, actionKind: "refresh_creative" as const },
          preWindow: w(50000, 0.02, 14, 100000),
          postWindow: w(50000, 0.024, 14, 100000),
          overlaps: [],
          orgBookedStats: judgeableBookings,
        },
      },
    ];
  for (const { name, input } of fixtures) {
    const row = attributeOneRecommendation(input);
    expect(["directional", "inconclusive"], name).toContain(row.causalStrength);
  }
});

it("never corroborates over an operator-confirmed unstable window (both estimates confounded)", () => {
  const row = attributeOneRecommendation({
    candidate: REC,
    preWindow: w(10000, 0.02, 7, 100000),
    postWindow: w(800, 0.02, 7, 80000),
    overlaps: [],
    operationalStateConfirmations: [
      osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL),
      osConfirm("2026-05-02T09:00:00.000Z", { ...OS_FULL_NORMAL, staffing: "shortfall" }),
    ],
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  });
  expect(row.businessContextStable).toBe("unstable");
  expect(row.causalStrength).toBe("directional");
  expect(row.trustDelta).toBe("none");
});

it("keeps the corroborated row byte-identical to its directional twin everywhere but causalStrength", () => {
  const base = {
    candidate: REC,
    preWindow: w(10000, 0.02, 7, 100000),
    postWindow: w(800, 0.02, 7, 80000),
    overlaps: [],
  };
  const directionalTwin = attributeOneRecommendation(base);
  const corroborated = attributeOneRecommendation({
    ...base,
    orgBookedStats: {
      preWindow: { bookedValueCents: 50000, bookedCount: 5 },
      postWindow: { bookedValueCents: 45000, bookedCount: 5 },
    },
  });
  expect(directionalTwin.causalStrength).toBe("directional");
  expect(corroborated.causalStrength).toBe("corroborated");
  expect({ ...corroborated, causalStrength: "x" }).toEqual({
    ...directionalTwin,
    causalStrength: "x",
  });
});
```

Notes: `osConfirm` and `OS_FULL_NORMAL` already exist lower in this file (slice-4c helpers); the new tests live inside the existing `describe("attributeOneRecommendation — slice-3 enrichments (honesty floors)")` block, which sits above those helper definitions; `const` function declarations hoist fine because `osConfirm`/`OS_FULL_NORMAL` are referenced only at test RUN time, not module-evaluation time.

- [ ] **Step 2.2: Run, verify the new tests fail**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution
```

Expected: FAIL. `orgBookedStats` is not a known `AttributeOneInput` property (type error surfaces as a test-file compile failure) or `causalStrength` is `"directional"` where `"corroborated"` is expected.

- [ ] **Step 2.3: Implement the derivation flip**

In `packages/core/src/recommendations/outcome-attribution.ts`:

(a) Add the import after the `deriveBusinessContextStability` import:

```ts
import { deriveCorroboration } from "./outcome-corroboration.js";
```

(b) Add to the type-only import from `./outcome-attribution-types.js`: `OrgBookedWindowStats,` and `OrgBookedStatsReader,` (alphabetical placement beside `OperationalStateReader`).

(c) In `AttributeOneInput`, add after the `operationalStateConfirmations` member:

```ts
  /**
   * Slice-4d: org-level booked stats for the two attribution sub-windows
   * (pre [preStart, anchorAt), post [anchorAt, postEnd), the exact instants
   * of the Meta window reads). undefined = no reader wired; the corroborated
   * arm is unjudgeable and the row is byte-identical to slice-4c output.
   */
  orgBookedStats?: { preWindow: OrgBookedWindowStats; postWindow: OrgBookedWindowStats };
```

(d) Replace the slice-3 derivation block. Currently:

```ts
// 7. Slice-3 enrichments (advisory; spec sections 2.5, 7.4, 7.5).
// causalStrength is derived from the flags/delta directly, not from
// cockpitRenderable, so a future renderability change cannot silently
// change causal semantics. "corroborated" requires the slice-4
// CRM/booking-agreement signal and is never emitted here.
const causalStrength: CausalStrength =
  flags.length === 0 && deltaPct !== null ? "directional" : "inconclusive";
// Slice 4c: real verdict from the operator operational-state confirmations
// overlapping the FULL attribution window (pre+post span). No source / no
// confirmations ⇒ "unknown" (honest absence), never a fabricated "stable".
// "corroborated" stays unemitted: the CRM/booking-agreement signal is
// deferred (plan Decision F); a stable window is context, not an
// independent second estimate.
const businessContextStable: BusinessContextStability = deriveBusinessContextStability({
  confirmations: input.operationalStateConfirmations ?? [],
  windowStartedAt,
  windowEndedAt,
});
```

Replace with (stability must now be derived FIRST because the corroboration predicate reads it):

```ts
// 7. Slice-3 enrichments (advisory; spec sections 2.5, 7.4, 7.5).
// Slice 4c: real stability verdict from the operator operational-state
// confirmations overlapping the FULL attribution window (pre+post span).
// No source / no confirmations ⇒ "unknown" (honest absence), never a
// fabricated "stable". Derived before causalStrength because the slice-4d
// corroboration predicate refuses to certify agreement over a window with
// affirmative disruption evidence.
const businessContextStable: BusinessContextStability = deriveBusinessContextStability({
  confirmations: input.operationalStateConfirmations ?? [],
  windowStartedAt,
  windowEndedAt,
});
// causalStrength is derived from the flags/delta directly, not from
// cockpitRenderable, so a future renderability change cannot silently
// change causal semantics. Slice 4d: a clean favorable pause delta whose
// org-level booking-side second estimate is judgeable and AGREES earns
// "corroborated" (spec 2.5's independent-agreement bar); every absence,
// floor failure, or disagreement leaves the slice-3 value untouched (the
// verdict's reason field exists for tests and debugging; only the upgrade
// is consumed here). The directional/inconclusive boundary is unchanged.
const corroboration = deriveCorroboration({
  actionKind: candidate.actionKind,
  visibilityFlagCount: flags.length,
  deltaPct,
  businessContextStable,
  preAccountSpendCents: preWindow?.accountSpendCents,
  postAccountSpendCents: postWindow?.accountSpendCents,
  orgBookedStats: input.orgBookedStats,
});
const causalStrength: CausalStrength =
  flags.length === 0 && deltaPct !== null
    ? (corroboration.causalStrengthUpgrade ?? "directional")
    : "inconclusive";
```

- [ ] **Step 2.4: Run, verify green (full core suite)**

```bash
pnpm --filter @switchboard/core test && pnpm typecheck
```

Expected: PASS, zero regressions (every pre-existing fixture passes no `orgBookedStats` and no `accountSpendCents`, so every pre-existing row derives exactly as before).

- [ ] **Step 2.5: Eval byte-check**

```bash
pnpm eval:riley > /tmp/slice4d-task2-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4d-baselines/eval-riley-baseline.txt /tmp/slice4d-task2-eval-riley.txt && echo "riley BYTE-UNCHANGED"
pnpm eval:governance > /tmp/slice4d-task2-eval-gov.txt 2>&1; echo "exit: $?"
diff /tmp/slice4d-baselines/eval-governance-baseline.txt /tmp/slice4d-task2-eval-gov.txt && echo "governance BYTE-UNCHANGED"
```

Expected: both exit 0, both diffs empty.

- [ ] **Step 2.6: Commit**

```bash
git branch --show-current   # expect: feat/riley-4d-corroborated-outcomes
git add packages/core/src/recommendations/outcome-attribution.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution.test.ts
git commit -m "feat(core): emit corroborated causal strength on agreeing booking-side estimate (riley v3 slice 4d)"
```

---

## Task 3: Orchestrator threading + summary counter

**Files:**

- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution.ts`

- [ ] **Step 3.1: Write the failing orchestrator tests**

In `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`, append a new describe block at the end of the file (after the slice-4c reader-threading describe). It reuses `makeOrchestratorDeps` from the slice-4c describe? No: that helper is scoped inside the 4c `describe`. Define a sibling describe with its own helper:

```ts
describe("runRileyOutcomeAttribution: org-booked-stats reader threading (slice 4d)", () => {
  function makeDeps(candidates: AttributableRecommendation[]) {
    const inserted: RileyOutcomeRow[] = [];
    const recommendationStore: AttributableRecommendationStore = {
      findAttributableCandidates: vi.fn().mockResolvedValue(candidates),
      findOverlapsForCampaign: vi.fn().mockResolvedValue([]),
    };
    const outcomeStore: RecommendationOutcomeStore = {
      insert: vi.fn(async (row: RileyOutcomeRow) => {
        inserted.push(row);
      }),
      existsByRecommendationId: vi.fn().mockResolvedValue(false),
    };
    const insightsProvider: MetaInsightsProvider = {
      getWindowMetrics: vi
        .fn()
        .mockResolvedValueOnce(w(10000, 0.02, 7, 100000))
        .mockResolvedValueOnce(w(800, 0.02, 7, 80000)),
    };
    return { recommendationStore, outcomeStore, insightsProvider, inserted };
  }

  function makeReader(stats: OrgBookedWindowStats) {
    return {
      getBookedStatsForOrgWindow: vi.fn(
        async (_args: { organizationId: string; startInclusive: Date; endExclusive: Date }) =>
          stats,
      ),
    };
  }

  it("queries the reader with the EXACT Meta sub-window instants for a pause candidate and threads a corroborated verdict", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeDeps([REC]);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    const summary = await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    // REC (pause, windowDays 7, resolvedAt 2026-05-01T12:00Z):
    // pre [2026-04-24T12:00Z, 2026-05-01T12:00Z), post [2026-05-01T12:00Z, 2026-05-08T12:00Z).
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenCalledTimes(2);
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenNthCalledWith(1, {
      organizationId: "org-1",
      startInclusive: new Date("2026-04-24T12:00:00Z"),
      endExclusive: new Date("2026-05-01T12:00:00Z"),
    });
    expect(reader.getBookedStatsForOrgWindow).toHaveBeenNthCalledWith(2, {
      organizationId: "org-1",
      startInclusive: new Date("2026-05-01T12:00:00Z"),
      endExclusive: new Date("2026-05-08T12:00:00Z"),
    });
    // The two reads PARTITION at the anchor (pre.endExclusive ===
    // post.startInclusive): with the store's half-open gte/lt predicate an
    // instant-of-anchor booking lands in exactly the post window, and an
    // instant-of-postEnd booking in neither. No double-count, no gap.
    const calls = (reader.getBookedStatsForOrgWindow as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]?.endExclusive).toEqual(calls[1]?.[0]?.startInclusive);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.causalStrength).toBe("corroborated");
    expect(summary.corroborated).toBe(1);
  });

  it("does not query the reader for refresh_creative candidates (pause-only arm)", async () => {
    const refreshRec: AttributableRecommendation = { ...REC, actionKind: "refresh_creative" };
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([refreshRec]);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-20T12:00:00Z"),
    });

    expect(reader.getBookedStatsForOrgWindow).not.toHaveBeenCalled();
  });

  it("records directional with no reader wired (back-compat byte-identity) and counts zero corroborated", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeDeps([REC]);

    const summary = await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.causalStrength).toBe("directional");
    expect(summary.corroborated).toBe(0);
  });

  it("propagates reader failures so Inngest retries (insert-once rows must not freeze an earnable corroboration)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([REC]);
    const reader = {
      getBookedStatsForOrgWindow: vi.fn(
        async (_args: { organizationId: string; startInclusive: Date; endExclusive: Date }) => {
          throw new Error("db blip");
        },
      ),
    };

    await expect(
      runRileyOutcomeAttribution({
        recommendationStore,
        insightsProvider,
        outcomeStore,
        orgBookedStatsReader: reader,
        orgId: "org-1",
        now: new Date("2026-05-10T12:00:00Z"),
      }),
    ).rejects.toThrow("db blip");
    expect(outcomeStore.insert).not.toHaveBeenCalled();
  });

  it("does not query the reader for candidates skipped by the idempotency pre-check", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeDeps([REC]);
    (outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const reader = makeReader({ bookedValueCents: 50000, bookedCount: 5 });

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgBookedStatsReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(reader.getBookedStatsForOrgWindow).not.toHaveBeenCalled();
  });
});
```

Also add `OrgBookedWindowStats` to the test file's type-only import from `../outcome-attribution-types.js`.

- [ ] **Step 3.2: Run, verify the new tests fail**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution
```

Expected: FAIL. `orgBookedStatsReader` is not a known `RunRileyOutcomeAttributionInput` property / `summary.corroborated` is undefined.

- [ ] **Step 3.3: Implement threading + counter**

In `packages/core/src/recommendations/outcome-attribution.ts`:

(a) In `RileyOutcomeRunSummary`, add after `renderable: number;`:

```ts
/** Slice-4d: rows whose causalStrength earned "corroborated" this run. */
corroborated: number;
```

(b) In `RunRileyOutcomeAttributionInput`, add after the `operationalStateReader` member:

```ts
  /**
   * Optional (slice 4d). Org-level windowed booked stats, the CRM-side
   * second estimate for the corroboration predicate. Absent ⇒ the
   * corroborated arm is unjudgeable and every row derives exactly as
   * slice 4c. Read failures PROPAGATE (Inngest retries): outcome rows are
   * insert-once, and freezing "directional" on a transient blip would
   * permanently under-record an earnable corroboration (the 4c
   * operationalStateReader asymmetry, same loop, same reasoning).
   */
  orgBookedStatsReader?: OrgBookedStatsReader;
```

(c) In `runRileyOutcomeAttribution`, destructure it (`orgBookedStatsReader,` after `operationalStateReader,`), and add `corroborated: 0,` to the summary literal after `renderable: 0,`.

(d) Inside the candidate loop, directly after the `operationalStateConfirmations` fetch and BEFORE the Meta `Promise.all`, add:

```ts
// Slice 4d: org-level booked stats for the two sub-windows, the exact
// instants of the Meta window reads below. Pause-only (the refresh
// corroboration arm is a recorded deferral). Cheap indexed DB reads
// placed before the quota-bearing Meta calls; failures propagate like
// every other provider in this loop.
const orgBookedStats =
  orgBookedStatsReader && candidate.actionKind === "pause"
    ? {
        preWindow: await orgBookedStatsReader.getBookedStatsForOrgWindow({
          organizationId: orgId,
          startInclusive: preStart,
          endExclusive: anchorAt,
        }),
        postWindow: await orgBookedStatsReader.getBookedStatsForOrgWindow({
          organizationId: orgId,
          startInclusive: anchorAt,
          endExclusive: postEnd,
        }),
      }
    : undefined;
```

(e) In the `attributeOneRecommendation` call, add after the `operationalStateConfirmations` spread:

```ts
      ...(orgBookedStats !== undefined ? { orgBookedStats } : {}),
```

(f) In the post-insert accounting, add after `summary.outcomesWritten++;`:

```ts
if (row.causalStrength === "corroborated") summary.corroborated++;
```

- [ ] **Step 3.4: Run the full core suite + typecheck**

```bash
pnpm --filter @switchboard/core test && pnpm typecheck
```

Expected: PASS. Pre-existing orchestration tests build summaries via `toMatchObject` and pass no reader: unaffected.

- [ ] **Step 3.5: Eval byte-check**

```bash
pnpm eval:riley > /tmp/slice4d-task3-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4d-baselines/eval-riley-baseline.txt /tmp/slice4d-task3-eval-riley.txt && echo "riley BYTE-UNCHANGED"
```

Expected: exit 0, diff empty.

- [ ] **Step 3.6: Commit**

```bash
git branch --show-current
git add packages/core/src/recommendations/outcome-attribution.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution.test.ts
git commit -m "feat(core): thread org-booked-stats reader through outcome attribution (riley v3 slice 4d)"
```

---

## Task 4: The db reader implementation (`PrismaConversionRecordStore`)

**Files:**

- Modify: `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`
- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`

- [ ] **Step 4.1: Write the failing tests (mocked Prisma; CI has no Postgres)**

In `packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts`:

(a) In `makePrisma()`, add `aggregate: vi.fn(),` inside the `conversionRecord` object (after `count: vi.fn(),`).

(b) Append inside the top-level `describe("PrismaConversionRecordStore")`:

```ts
describe("getBookedStatsForOrgWindow (riley v3 slice 4d)", () => {
  it("aggregates valued bookings org-wide over the HALF-OPEN window (gte/lt, the engine's Meta-window convention)", async () => {
    (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: 45000 },
      _count: { _all: 5 },
    });

    const result = await store.getBookedStatsForOrgWindow({
      organizationId: "org-1",
      startInclusive: new Date("2026-04-24T12:00:00Z"),
      endExclusive: new Date("2026-05-01T12:00:00Z"),
    });

    expect(prisma.conversionRecord.aggregate).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        type: "booked",
        value: { gt: 0 },
        occurredAt: {
          gte: new Date("2026-04-24T12:00:00Z"),
          lt: new Date("2026-05-01T12:00:00Z"),
        },
      },
      _sum: { value: true },
      _count: { _all: true },
    });
    // CENTS passthrough: the stored value is already cents; no conversion here.
    expect(result).toEqual({ bookedValueCents: 45000, bookedCount: 5 });
  });

  it("returns honest zeros for an org with no valued bookings in the window (fails the floors, never an error)", async () => {
    (prisma.conversionRecord.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: null },
      _count: { _all: 0 },
    });

    const result = await store.getBookedStatsForOrgWindow({
      organizationId: "org-1",
      startInclusive: new Date("2026-05-01T12:00:00Z"),
      endExclusive: new Date("2026-05-08T12:00:00Z"),
    });

    expect(result).toEqual({ bookedValueCents: 0, bookedCount: 0 });
  });

  it("satisfies @switchboard/core's OrgBookedStatsReader structurally (the DI seam)", () => {
    // Type-level pin: assignment compiles only while the method name and
    // shape match the core interface the bootstrap injects this store into.
    const reader: import("@switchboard/core").OrgBookedStatsReader = store;
    expect(typeof reader.getBookedStatsForOrgWindow).toBe("function");
  });
});
```

- [ ] **Step 4.2: Run, verify failure**

```bash
pnpm --filter @switchboard/db test -- prisma-conversion-record-store
```

Expected: FAIL. `store.getBookedStatsForOrgWindow is not a function`.

- [ ] **Step 4.3: Implement the method**

In `packages/db/src/stores/prisma-conversion-record-store.ts`, add after `queryBookedStatsByCampaign` (before the class's closing brace):

```ts
  /**
   * Org-level windowed booked stats for the outcome ledger's corroboration
   * predicate (Riley v3 slice 4d). Sum and count aggregate over the SAME
   * predicate (`type:"booked"` AND `value > 0`), org-wide: campaign
   * attribution is deliberately NOT required, because the CRM-side second
   * estimate must be independent of Meta attribution and
   * partially-attributed orgs still book real revenue.
   *
   * The window is HALF-OPEN [startInclusive, endExclusive), mirroring the
   * attribution engine's Meta window queries so an instant-of-anchor booking
   * lands in exactly one sub-window (deliberate divergence from
   * queryBookedValueCentsByCampaign's inclusive `lte`).
   *
   * Values stay in CENTS (ConversionRecord.value); zeros are honest absence
   * (they fail the corroboration floors upstream), never an error.
   * Structurally satisfies @switchboard/core's OrgBookedStatsReader.
   */
  async getBookedStatsForOrgWindow(args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }): Promise<{ bookedValueCents: number; bookedCount: number }> {
    const result = await this.prisma.conversionRecord.aggregate({
      where: {
        organizationId: args.organizationId,
        type: "booked",
        value: { gt: 0 },
        occurredAt: { gte: args.startInclusive, lt: args.endExclusive },
      },
      _sum: { value: true },
      _count: { _all: true },
    });
    return {
      bookedValueCents: result._sum.value ?? 0,
      bookedCount: result._count._all,
    };
  }
```

- [ ] **Step 4.4: Run db tests + typecheck**

```bash
pnpm --filter @switchboard/db test -- prisma-conversion-record-store && pnpm --filter @switchboard/db build && pnpm typecheck
```

Expected: PASS. (Full `pnpm --filter @switchboard/db test` locally also hits the known local-PG trio in work-trace/ledger/greeting files; gate = no NEW failures.)

- [ ] **Step 4.5: Commit**

```bash
git branch --show-current
git add packages/db/src/stores/prisma-conversion-record-store.ts \
        packages/db/src/stores/__tests__/prisma-conversion-record-store.test.ts
git commit -m "feat(db): org-level windowed booked stats read for outcome corroboration (riley v3 slice 4d)"
```

---

## Task 5: Account spend rides the existing Meta window read (apps/api adapter)

**Files:**

- Modify: `apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts`
- Modify: `apps/api/src/services/cron/meta-insights-adapter.ts`

- [ ] **Step 5.1: Write the failing tests**

In `apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts`, append a new describe (reusing the file's existing `getCampaignInsightsSpy`, `makeFakePrisma`, `makeQuery` helpers and mocks):

```ts
describe("createMetaInsightsProviderForOrg — account-level spend enrichment (riley v3 slice 4d)", () => {
  beforeEach(() => {
    getCampaignInsightsSpy.mockReset();
  });

  it("sums accountSpendCents across ALL campaigns in the same Graph response (zero extra calls)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-42", spend: 10.5, inlineLinkClickCtr: 0.02 },
      { campaignId: "camp-42", spend: 4.5, inlineLinkClickCtr: 0.03 },
      { campaignId: "camp-99", spend: 5.25, inlineLinkClickCtr: 0.01 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    const metrics = await provider.getWindowMetrics(makeQuery());

    expect(getCampaignInsightsSpy).toHaveBeenCalledTimes(1);
    // Campaign-level: 10.50 + 4.50 dollars = 1500 cents (unchanged behavior).
    expect(metrics?.spendCents).toBe(1500);
    // Account-level: 10.50 + 4.50 + 5.25 dollars = 2025 cents, summed BEFORE
    // the campaign filter (the same dollars-to-cents conversion).
    expect(metrics?.accountSpendCents).toBe(2025);
  });

  it("never narrows the Graph request to one campaign (accountSpendCents depends on the account-wide fetch)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-42", spend: 10.5, inlineLinkClickCtr: 0.02 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    await provider.getWindowMetrics(makeQuery());

    // MetaAdsClient.getCampaignInsights SUPPORTS a campaignId filtering
    // param; a future "optimization" passing it would silently turn
    // accountSpendCents into campaign spend and destroy corroboration.
    const callArgs = getCampaignInsightsSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("campaignId");
    expect(callArgs).not.toHaveProperty("filtering");
  });

  it("still returns null when the requested campaign has no rows even if account rows exist (account data alone never fabricates a campaign window)", async () => {
    getCampaignInsightsSpy.mockResolvedValue([
      { campaignId: "camp-99", spend: 5.25, inlineLinkClickCtr: 0.01 },
    ]);
    const provider = createMetaInsightsProviderForOrg("org-1", makeFakePrisma());

    const metrics = await provider.getWindowMetrics(makeQuery());

    expect(metrics).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run, verify failure**

```bash
pnpm --filter api test -- meta-insights-adapter
```

Expected: FAIL on `accountSpendCents` being `undefined`.

- [ ] **Step 5.3: Implement**

In `apps/api/src/services/cron/meta-insights-adapter.ts`, replace:

```ts
// Filter to the requested campaign
const rows = insights.filter((i) => i.campaignId === query.campaignId);
if (rows.length === 0) return null;

const spendCents = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100);
const ctr = rows.reduce((sum, r) => sum + r.inlineLinkClickCtr, 0) / rows.length;
const dailyRowCount = rows.length;

return { spendCents, ctr, dailyRowCount };
```

with:

```ts
// Slice 4d: org-level spend rides the SAME Graph response (this call
// already returns every campaign; the sum happens BEFORE the campaign
// filter). Same dollars-to-cents conversion as the campaign sum.
const accountSpendCents = Math.round(insights.reduce((sum, r) => sum + r.spend, 0) * 100);

// Filter to the requested campaign
const rows = insights.filter((i) => i.campaignId === query.campaignId);
if (rows.length === 0) return null;

const spendCents = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100);
const ctr = rows.reduce((sum, r) => sum + r.inlineLinkClickCtr, 0) / rows.length;
const dailyRowCount = rows.length;

return { spendCents, ctr, dailyRowCount, accountSpendCents };
```

- [ ] **Step 5.4: Run, verify green**

```bash
pnpm --filter api test -- meta-insights-adapter && pnpm typecheck
```

Expected: PASS (existing adapter tests assert on the call shape and null paths; both unchanged).

- [ ] **Step 5.5: Commit**

```bash
git branch --show-current
git add apps/api/src/services/cron/meta-insights-adapter.ts \
        apps/api/src/services/cron/__tests__/meta-insights-adapter.test.ts
git commit -m "feat(api): account-level spend on the outcome window read (riley v3 slice 4d)"
```

---

## Task 6: Bind + bootstrap wiring (apps/api DI)

**Files:**

- Create: `apps/api/src/__tests__/riley-outcome-bind.test.ts`
- Modify: `apps/api/src/services/cron/riley-outcome-attribution.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

- [ ] **Step 6.1: Write the failing bind passthrough test**

Create `apps/api/src/__tests__/riley-outcome-bind.test.ts` (api tests are flat in `__tests__`):

```ts
import { describe, it, expect, vi } from "vitest";
import type {
  MetaInsightsProvider,
  OrgBookedStatsReader,
  RunRileyOutcomeAttributionInput,
} from "@switchboard/core";

// Partial passthrough mock: spy on the orchestrator so the bind layer's
// dependency threading is observable without running real attribution.
const { runSpy } = vi.hoisted(() => ({
  runSpy: vi.fn((_input: unknown) =>
    Promise.resolve({
      orgId: "org-1",
      candidatesScanned: 0,
      skippedExisting: 0,
      outcomesWritten: 0,
      renderable: 0,
      corroborated: 0,
      hidden: 0,
      hiddenByFlag: {
        meta_data_missing: 0,
        zero_pre_baseline: 0,
        below_noise_floor: 0,
        same_campaign_overlap: 0,
      },
    }),
  ),
}));

vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@switchboard/core")>();
  return { ...actual, runRileyOutcomeAttribution: runSpy };
});

import { bindRileyOutcomeOrchestrator } from "../services/cron/riley-outcome-attribution.js";

function makeDeps() {
  const insightsProvider: MetaInsightsProvider = {
    getWindowMetrics: vi.fn(async () => null),
  };
  return {
    recommendationStore: {
      findAttributableCandidates: vi.fn(async () => []),
      findOverlapsForCampaign: vi.fn(async () => []),
    },
    createInsightsProvider: vi.fn(() => insightsProvider),
    outcomeStore: {
      insert: vi.fn(async () => undefined),
      existsByRecommendationId: vi.fn(async () => false),
    },
  };
}

describe("bindRileyOutcomeOrchestrator (riley v3 slice 4d)", () => {
  it("threads the org-booked-stats reader into the orchestrator", async () => {
    const reader: OrgBookedStatsReader = {
      getBookedStatsForOrgWindow: vi.fn(async () => ({ bookedValueCents: 0, bookedCount: 0 })),
    };
    const run = bindRileyOutcomeOrchestrator({ ...makeDeps(), orgBookedStatsReader: reader });

    await run({ orgId: "org-1", now: new Date("2026-06-06T07:00:00Z") });

    const input = runSpy.mock.calls[0]?.[0] as RunRileyOutcomeAttributionInput;
    expect(input.orgBookedStatsReader).toBe(reader);
  });

  it("omits the reader when not provided (back-compat: rows stay byte-identical)", async () => {
    const run = bindRileyOutcomeOrchestrator(makeDeps());

    await run({ orgId: "org-1", now: new Date("2026-06-06T07:00:00Z") });

    const input = runSpy.mock.calls.at(-1)?.[0] as RunRileyOutcomeAttributionInput;
    expect("orgBookedStatsReader" in input).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run, verify failure**

```bash
pnpm --filter api test -- riley-outcome-bind
```

Expected: FAIL. `orgBookedStatsReader` is not a known `BindRileyOutcomeOrchestratorDeps` property (compile error in the test file).

- [ ] **Step 6.3: Implement the bind dep**

In `apps/api/src/services/cron/riley-outcome-attribution.ts`:

(a) Add `OrgBookedStatsReader` to the type-only import from `@switchboard/core` (beside `OperationalStateReader`).

(b) In `BindRileyOutcomeOrchestratorDeps`, add after the `operationalStateReader` member:

```ts
  /** Slice 4d: org-level windowed booked stats (PrismaConversionRecordStore).
   * Absent ⇒ the corroborated arm is unjudgeable; rows are byte-identical. */
  orgBookedStatsReader?: OrgBookedStatsReader;
```

(c) In `bindRileyOutcomeOrchestrator`'s returned call, add after the `operationalStateReader` spread:

```ts
      ...(deps.orgBookedStatsReader ? { orgBookedStatsReader: deps.orgBookedStatsReader } : {}),
```

- [ ] **Step 6.4: Wire the bootstrap**

In `apps/api/src/bootstrap/inngest.ts`, in the `bindRileyOutcomeOrchestrator({ ... })` construction (the `rileyOutcomeWorker` block), add after `operationalStateReader: operationalStateStore,`:

```ts
      // Slice 4d: the CRM-side second estimate for outcome corroboration.
      // The store instance already exists for the audit's booked-value
      // provider; its getBookedStatsForOrgWindow satisfies the core reader
      // interface structurally.
      orgBookedStatsReader: bookedValueByCampaignStore,
```

- [ ] **Step 6.5: Run, verify green**

```bash
pnpm --filter api test -- riley-outcome-bind && pnpm --filter api test -- api-cockpit-riley-outcome-cron && pnpm typecheck
```

Expected: PASS (the cron worker tests inject their own summaries; the additive field changes nothing).

- [ ] **Step 6.6: Commit**

```bash
git branch --show-current
git add apps/api/src/services/cron/riley-outcome-attribution.ts \
        apps/api/src/__tests__/riley-outcome-bind.test.ts \
        apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): wire org-booked-stats reader into outcome attribution (riley v3 slice 4d)"
```

---

## Task 7: Consumer-sweep pins (every causalStrength reader stays three-valued)

The sweep finding (spec section 5): the read side was built corroborated-legal in slice 3; no consumer code changes exist. This task pins that with tests so a regression (or a future binary ternary) breaks CI.

**Files:**

- Modify: `apps/api/src/__tests__/outcome-activity-row.test.ts`
- Modify: `packages/db/src/__tests__/recommendation-outcome-store.test.ts`
- Modify: `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`

- [ ] **Step 7.1: Pin the feed translator (shared by the activity feed and the legacy route)**

In `apps/api/src/__tests__/outcome-activity-row.test.ts`, the file defines `const BASE: RecommendationOutcomeReadModel = { ... causalStrength: "directional" ... }` at the top. Append inside the existing `describe("translateOutcomeToActivityRow")`:

```ts
it("renders a corroborated row byte-identically to its directional twin (causalStrength is not operator copy; riley v3 slice 4d)", () => {
  const directional = translateOutcomeToActivityRow(BASE);
  const corroborated = translateOutcomeToActivityRow({
    ...BASE,
    causalStrength: "corroborated",
  });
  expect(corroborated).toEqual(directional);
});
```

- [ ] **Step 7.2: Pin the read model narrowing**

In `packages/db/src/__tests__/recommendation-outcome-store.test.ts`, append inside `describe("PrismaRecommendationOutcomeStore.listRenderableForOrg")`, directly after the `it("narrows unexpected enrichment strings to null (fail-closed)")` test, mirroring its structure exactly:

```ts
it("projects corroborated through the read model (the slice-4d writer value is legal on the read side)", async () => {
  const prisma = buildPrismaMock();
  (prisma.recommendationOutcome.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      id: "outcome-corroborated",
      recommendationId: "rec-11",
      actionKind: "pause",
      windowEndedAt: new Date("2026-05-08T12:00:00Z"),
      copyTemplate: "pause.spend.fell",
      copyValues: { deltaPct: -92, windowDays: 7 },
      causalStrength: "corroborated",
      businessContextStable: "unknown",
      trustDelta: "up",
      recommendation: { targetEntities: { campaignId: "camp-A" }, parameters: {} },
    },
  ]);
  const store = new PrismaRecommendationOutcomeStore(prisma as never);
  const out = await store.listRenderableForOrg({ orgId: "org-1", agentRole: "riley", limit: 50 });
  expect(out[0]).toMatchObject({
    causalStrength: "corroborated",
    businessContextStable: "unknown",
    trustDelta: "up",
  });
});
```

- [ ] **Step 7.3: Pin the legacy route end to end**

In `apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`, flip the first `SAMPLE_ROWS` fixture's `causalStrength: "directional"` to `causalStrength: "corroborated"`. The existing assertions (row renders, head carries the trust suffix) now prove a corroborated row flows the route unchanged. Add a one-line comment above the flipped field:

```ts
    // Slice 4d: corroborated read models flow the legacy route unchanged.
    causalStrength: "corroborated",
```

- [ ] **Step 7.4: Run, verify green**

```bash
pnpm --filter api test -- outcome-activity-row && pnpm --filter api test -- api-cockpit-riley-outcomes && pnpm --filter @switchboard/db test -- recommendation-outcome-store
```

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git branch --show-current
git add apps/api/src/__tests__/outcome-activity-row.test.ts \
        apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts \
        packages/db/src/__tests__/recommendation-outcome-store.test.ts
git commit -m "test(api,db): pin corroborated through every causal-strength consumer (riley v3 slice 4d)"
```

---

## Task 8: Full verification gates + PR

- [ ] **Step 8.1: Full build + suites + static gates**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm format:check && pnpm arch:check && pnpm lint
```

Expected: all green. Known local noise (NOT blockers, verify they are the only failures): the local-PG trio in `@switchboard/db` (work-trace integrity, ledger, greeting) when Postgres is unreachable; chat `gateway-bridge-attribution` under parallel turbo load (passes in isolation).

- [ ] **Step 8.2: Eval byte-identity (final)**

```bash
pnpm eval:riley > /tmp/slice4d-final-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4d-baselines/eval-riley-baseline.txt /tmp/slice4d-final-eval-riley.txt && echo "riley BYTE-UNCHANGED"
pnpm eval:governance > /tmp/slice4d-final-eval-gov.txt 2>&1; echo "exit: $?"
diff /tmp/slice4d-baselines/eval-governance-baseline.txt /tmp/slice4d-final-eval-gov.txt && echo "governance BYTE-UNCHANGED"
```

Expected: both exit 0, both diffs empty.

- [ ] **Step 8.3: Advisory-surface + hygiene greps (all must be clean)**

```bash
# No new mutating surface: zero PlatformIngress contact in this diff.
git diff origin/main...HEAD | grep -i "PlatformIngress" ; echo "ingress grep exit: $? (expect 1 = no matches)"
# No new intents.
git diff origin/main...HEAD | grep -E '^\+.*intent.*:' | grep -v "^+++" ; echo "intent grep exit: $? (expect 1)"
# No env-var additions (the allowlist stays untouched).
git diff origin/main...HEAD -- scripts/env-allowlist.local-readiness.json .env.example | head -5
# No schema/migration/UI diffs (scope-fence proof).
git diff origin/main...HEAD --stat -- packages/db/prisma apps/dashboard packages/ad-optimizer
# Route governance (no route changes expected).
CI=1 npx tsx scripts/local-verify-fast.ts 2>&1 | tail -5
```

Expected: no PlatformIngress/intent matches; empty stats for prisma/dashboard/ad-optimizer; local-verify clean.

- [ ] **Step 8.4: Push and open the PR**

```bash
git push -u origin feat/riley-4d-corroborated-outcomes
gh pr create --title "feat(core,db,api): riley v3 slice 4d corroborated outcome arm" --body "$(cat <<'EOF'
## Summary
- The outcome ledger earns the type-reserved `corroborated` arm of `causalStrength`: a favorable directional pause outcome upgrades when the org-level booking-side second estimate is judgeable and agrees (spec 2.5's independent-agreement bar; the 4c Decision-F formulation).
- Predicate (pure `outcome-corroboration.ts`, returns a REASONED verdict for rollout debugging; rows store only causalStrength): pause-only; clean favorable delta; not operator-confirmed unstable; reader + account spend present; >=3 valued bookings in EACH sub-window; account post-spend inside [0.5x, 1.5x] of pre-spend (the comparable-regime band: collapse AND scale-up both unjudgeable); explicit booked-value guards; booked-revenue-per-ad-dollar held within 0.8x. "Corroborated" = independent outcome-side agreement under floors, NOT causal proof (pinned in the type docs).
- Org spend rides the EXISTING Meta window read (summed before the campaign filter; zero new Graph calls); org bookings via a new `OrgBookedStatsReader` implemented on `PrismaConversionRecordStore` (half-open gte/lt windows, CENTS passthrough).
- The slice-3 corroborated-never-emitted sweep test flips DELIBERATELY into positive pins + no-fabrication negatives (sparse bookings, absent reader/spend, degenerate continuity, disagreement, unfavorable, flagged, unstable, refresh_creative).
- Consumer sweep pinned: feed translator, read model, legacy route, summary counter; trustDelta derivation and operator copy byte-untouched.
- Deferred with recorded reasoning: refresh_creative corroboration (spec section 6), Phase-C executed-pause attribution linkage (spec section 8), 4e late-interval read.

## Proofs
- Zero migrations: slice-3 CHECK already admits 'corroborated' (migration comment says exactly this).
- Zero env vars; cron stays behind RILEY_OUTCOME_ATTRIBUTION_ENABLED.
- Advisory-only: diff has zero PlatformIngress contact, zero new intents, zero ad-optimizer/dashboard/prisma diffs.
- Evals byte-identical: 12+10+6 riley + 26 governance (baseline diffs empty).
- Reader absent => rows byte-identical to slice 4c (twin-equality test).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.5: CI green, then squash-merge and teardown**

Known CI flakes (rerun before investigating): api-auth prod-hardening, pg_advisory_xact_lock trio, bootstrap-smoke npm-warn, chat gateway-bridge-attribution under parallel load, Eval Claim Classifier 401 (informational, broken secret, fails on every main push).

```bash
gh pr checks --watch
gh pr merge --squash
cd /Users/jasonli/switchboard
git worktree remove .claude/worktrees/riley-4d-corroborated && git worktree prune
```

---

## Self-review notes (run post-write)

- Spec coverage: section 2 (predicate) → Tasks 1-2; section 4 (two seams + wiring) → Tasks 4-6; section 5 (consumer sweep) → Task 7; section 9 (test doctrine incl. sweep flip, byte-identity, CENTS pin, window instants) → Tasks 1.2, 2.1, 3.1, 4.1; section 10 (scope fence) → Task 8.3 proofs. Sections 6/7/8 are recorded decisions, no tasks by design.
- Type consistency: `OrgBookedWindowStats { bookedValueCents, bookedCount }`, `getBookedStatsForOrgWindow({ organizationId, startInclusive, endExclusive })`, `orgBookedStats: { preWindow, postWindow }`, `summary.corroborated` used identically across Tasks 1-7.
- Placeholders: Task 7.1/7.2 reference the consumer test files' existing fixture names with explicit instructions to mirror the adjacent test's structure; everything else is verbatim code.
