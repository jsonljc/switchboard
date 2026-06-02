# Riley PR2 · Target — Aim at Booked Customers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip Riley's weekly audit from rewarding cheap leads (cost-per-lead) to chasing paying customers (cost-per-booked), behind a strict 3-tier fallback ladder, with **zero mutating paths**.

**Architecture:** Riley is a deterministic rules engine in `packages/ad-optimizer` (Layer 2, imports `@switchboard/schemas` only), run by a weekly Inngest cron. `AuditRunner` is a class with `AuditConfig` injected at construction; `generateRecommendations` is a pure function taking the target per-call. PR2 computes a single account-level **economic tier** + booking-calibrated target once per audit, threads that target into the existing per-campaign threshold checks, and post-processes each recommendation through a pure `applyTier` that lowers confidence/urgency and constrains the allowed action family. No `MetaAdsClient` mutating method gains a caller.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), pnpm + Turborepo, Vitest, Zod schemas. Layer rule: `ad-optimizer` imports `schemas` only.

**Baseline:** off `main` `1f2f94a8` (PR1 "Eyes" `897647ce` merged). Worktree `.claude/worktrees/riley-pr2-target`, branch `feat/riley-pr2-target`. Run `pnpm worktree:init` from the worktree root before implementing (CLAUDE.md).

---

## ⚑ Resolved decisions & assumptions (READ FIRST — review-gate fodder)

These are the judgment calls baked into this plan. Push back on any before implementation starts.

1. **Attribution fork → Option A (account-level calibration).** Verified: `PrismaCrmFunnelStore.queryFunnelCounts` *does* attribute per-campaign correctly (filters `attribution.sourceCampaignId ∈ campaignIds`, `crm-funnel-store.ts:104-156`) and surfaces real `booked` counts — so per-campaign (B) is feasible. But at medspa pilot volume per-campaign bookings sit below the §5 Tier-1 threshold (10), so B pays N CRM calls to mostly land in Tier 2/3 anyway. A pools bookings across the audited campaign set (one funnel call, already fetched), is statistically robust, and the §5 ladder makes it self-protecting. **Trade-off (accepted):** A applies one blended booking rate to every campaign — two campaigns with identical raw metrics get the same rec; booking differentiation acts through the account target moving. The strong per-campaign acceptance form is the documented **Hybrid** upgrade path (A floor + true per-campaign cost-per-booked for any campaign that itself clears ≥10 booked), deferred as a fast-follow when volume grows.

2. **`targetCostPerBooked` must be added as optional config (the decisive new finding).** The audit has **no** target-cost-per-booked, margin, AOV, or break-even value anywhere in its reach — `targetCPA` (default 100, from `deployment.inputConfig`) is semantically cost-per-*lead* (`inngest-functions.ts:109-120`; confirmed across `AuditConfig`, `inputConfig`, the wizard, and the seed). Option A's `effectiveTargetCPL = targetCostPerBooked × bookingRate` therefore needs an input that does not exist. **Decision:** add an optional `targetCostPerBooked` to `AuditConfig` + `inputConfig`. When present *and* calibration yields a usable target → Tier 1 booked-CAC. When absent → Tier 2 CPL: the engine keeps the **same legacy `targetCPA` threshold**, then `applyTier` marks the recommendation as proxy-based by lowering confidence and urgency — the *threshold* is unchanged, the *output* is honestly flagged (**not** byte-identical). *Rejected:* reinterpreting the live `targetCPA` as cost-per-booked — it would silently tighten every existing deployment ~10× (flood of pauses).

3. **`marginBasis` is always `"unavailable"` in PR2 — honest, not silent.** No margin/AOV/break-even source is plumbed into the audit, so margin-awareness is reported *unavailable*, never silently satisfied (spec §3.4). The field is threaded as a real value (seam to become `"configured"` when an AOV/margin source lands), not a hardcoded literal buried in logic. Note: `economicTier="booked_cac"` with `marginBasis="unavailable"` is a valid combination — a bare cost-per-booked target is not margin-derived.

4. **`candidateAction` is NOT added in PR2.** It does not exist anywhere yet (verified) and has no consumer until the Phase-2 governed-execution sequel. The user's PR2 brief ("keep candidateAction inert") is satisfied by adding **no** mutating path and **no** spend scrape. The descriptor is naturally added in PR3/PR4 alongside the budget-reallocation recs that carry a `reversibleChange`. (Deviates from spec §6's "carried in Phase 1" — flagged; adding an always-null field now is low-value. Override if you want the empty seam in PR2.)

5. **Producer population (the `[[feedback_safety_gate_needs_producer_population]]` scar).** Booked-CAC is inert in production until a deployment sets `targetCostPerBooked`. Because absence is reported *honestly* (`economicTier="cpl"` in the rec), this is principled abstention, not a silent safety hole — but to prove PR2 on real data, **Task 7 (optional, flagged)** seeds `targetCostPerBooked` on the dev Riley deployment so a live audit exercises Tier 1. The TDD tests exercise Tier 1 regardless via fixtures.

6. **metrics-riley + dashboard relabel is the separable tail (Task 6).** `MetricsSignalStore.countBookingsCreated` *is* available (`metrics-types.ts:94-99`), so Riley's home/agent-panel ROI can surface a real cost-per-booked-vs-target instead of cost-per-lead. This touches `packages/core` + hardcoded dashboard copy (`key-result.tsx`, `this-week.tsx`) — independent of the engine change. If it makes PR2 too wide, split it into PR2b. Note: its target (`targetCpbCents` from `AgentRoster.config`) is a *different* config surface from the audit's `targetCostPerBooked`; unifying them is out of scope.

7. **Tiering scope.** `applyTier` is applied to the campaign **economic** recs (`generateRecommendations` output). Signal-health recs and Step-6 ad-set learning-limited recs are a different decision family (run before/without CRM economics) and do not carry `economicTier` in PR2 — the field stays optional. PR4's contract test asserts the tag on economic recs.

---

## Verified ground truth (citations the tasks rely on)

- **Production CRM path:** `inngest.ts:225-226` wires `RealCrmDataProvider(new PrismaCrmFunnelStore(prisma))` — real bookings. (The `bookingCount=0` `PrismaCrmDataProvider` is unused by the audit.)
- **Audit fetches one aggregate funnel** across all `campaignIds` (`audit-runner.ts:291-304`); `crmData.bookings` is currently consumed by nothing.
- **`generateRecommendations`** is pure, takes `targetCPA` per-call (`recommendation-engine.ts:26-43`, `:178`). Single rec factory `makeRec` (`:55-77`).
- **Three target sites** in the loop, all reading `this.config.targetCPA`: `isPerformingWell` (`audit-runner.ts:379`), `getTargetBreachStatus` (`:403`), `generateRecommendations` (`:414`).
- **Gate loop** at `audit-runner.ts:421-428` splits recs vs watches — the `applyTier` insertion point.
- **Account conversions** already summed as `totalLeads` (`audit-runner.ts:267`, `:557`); aggregate `crmData.bookings` available (`real-provider.ts:137`).
- **Safety:** zero mutating callers today; `candidateAction`/`economicTier`/`marginBasis` absent; ad-optimizer imports `@switchboard/schemas` only. Keep green: swipe-contract (`recommendation-sink.test.ts:123-185`), SAFETY/PAUSED (`meta-ads-client.test.ts:214-329`).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/schemas/src/ad-optimizer.ts` | `EconomicTier`/`MarginBasis` enums + 2 optional fields on `RecommendationOutputSchema` | Modify |
| `packages/schemas/src/ad-optimizer.test.ts` | parse round-trip incl. new fields | Create/extend |
| `packages/ad-optimizer/src/analyzers/economic-target.ts` | **Pure** tier selection, booking calibration, `applyTier` | Create |
| `packages/ad-optimizer/src/analyzers/economic-target.test.ts` | unit tests, all branches | Create |
| `packages/ad-optimizer/src/audit-runner.ts` | `targetCostPerBooked` on `AuditConfig`; compute tier/effective-target once; thread into 3 sites; `applyTier` post-process | Modify |
| `packages/ad-optimizer/src/inngest-functions.ts` | read `inputConfig.targetCostPerBooked` into `AuditConfig` | Modify |
| `packages/ad-optimizer/src/__tests__/audit-runner.test.ts` | integration: Tier 1/2/3 + booking-outcome differentiation | Extend |
| `packages/core/src/agent-home/metrics-riley.ts` | ROI relabel + real CAC-vs-target via `countBookingsCreated` | Modify (Task 6) |
| `packages/core/src/agent-home/__tests__/metrics-riley.test.ts` | update 5 ROI assertions | Modify (Task 6) |
| `apps/dashboard/src/components/agent-panel/key-result.tsx`, `home/this-week.tsx` | dashboard copy coherence | Modify (Task 6) |
| `packages/db/prisma/seed-marketplace.ts` | seed dev `targetCostPerBooked` (producer pop) | Modify (Task 7, optional) |

---

## Task 1: Schema — `economicTier` + `marginBasis` (back-compat, optional)

**Files:**
- Modify: `packages/schemas/src/ad-optimizer.ts:34` (after `UrgencySchema`), `:168-181` (`RecommendationOutputSchema`)
- Test: `packages/schemas/src/ad-optimizer.test.ts`

- [ ] **Step 1: Write the failing test.** Create or append to `packages/schemas/src/ad-optimizer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RecommendationOutputSchema, EconomicTierSchema, MarginBasisSchema } from "./ad-optimizer.js";

const base = {
  type: "recommendation" as const,
  action: "pause" as const,
  campaignId: "c1",
  campaignName: "C1",
  confidence: 0.9,
  urgency: "immediate" as const,
  estimatedImpact: "x",
  steps: ["a"],
  learningPhaseImpact: "no impact",
};

describe("RecommendationOutputSchema economic fields", () => {
  it("parses without the new fields (back-compat)", () => {
    expect(RecommendationOutputSchema.parse(base).economicTier).toBeUndefined();
  });
  it("parses with economicTier + marginBasis", () => {
    const r = RecommendationOutputSchema.parse({
      ...base,
      economicTier: "booked_cac",
      marginBasis: "unavailable",
    });
    expect(r.economicTier).toBe("booked_cac");
    expect(r.marginBasis).toBe("unavailable");
  });
  it("rejects an unknown economic tier", () => {
    expect(() => RecommendationOutputSchema.parse({ ...base, economicTier: "roas" })).toThrow();
  });
  it("exposes the enums", () => {
    expect(EconomicTierSchema.options).toEqual(["booked_cac", "cpl", "cpc"]);
    expect(MarginBasisSchema.options).toEqual(["configured", "unavailable"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/schemas test ad-optimizer`
Expected: FAIL — `EconomicTierSchema` is not exported.

- [ ] **Step 3: Add the enums** after `UrgencySchema` (`ad-optimizer.ts:35`):

```ts
export const EconomicTierSchema = z.enum(["booked_cac", "cpl", "cpc"]);
export type EconomicTierSchema = z.infer<typeof EconomicTierSchema>;

export const MarginBasisSchema = z.enum(["configured", "unavailable"]);
export type MarginBasisSchema = z.infer<typeof MarginBasisSchema>;
```

- [ ] **Step 4: Add the optional fields** to `RecommendationOutputSchema` (after `params` at `:179`, before the closing `})`):

```ts
  // PR2 (Target): the economic basis this recommendation was judged against, and
  // whether the target was margin-derived. Optional for back-compat; populated
  // by the audit's applyTier post-processor going forward.
  economicTier: EconomicTierSchema.optional(),
  marginBasis: MarginBasisSchema.optional(),
```

No Prisma migration: these are Zod runtime-output fields, not persisted columns.

- [ ] **Step 5: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/schemas test ad-optimizer`
Expected: PASS. Then confirm the enums are re-exported from the package root: `grep -n "ad-optimizer" packages/schemas/src/index.ts` — if it `export *`s, you're done; otherwise add the two enums to the explicit export list.

- [ ] **Step 6: Build the schema package** (downstream packages import from `dist`):

Run: `pnpm --filter @switchboard/schemas build`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/schemas/src/ad-optimizer.ts packages/schemas/src/ad-optimizer.test.ts
git commit -m "feat(schemas): add economicTier + marginBasis to recommendation output"
```

---

## Task 2: Pure module `economic-target.ts` — tier, calibration, applyTier

**Files:**
- Create: `packages/ad-optimizer/src/analyzers/economic-target.ts`
- Test: `packages/ad-optimizer/src/analyzers/economic-target.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `economic-target.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  selectEconomicTier,
  calibrateTargetFromBooking,
  applyTier,
  MIN_BOOKED_FOR_TIER1,
  MIN_LEADS_FOR_TIER2,
  TIER2_CONFIDENCE_PENALTY,
} from "./economic-target.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { WatchOutputSchema } from "@switchboard/schemas";

function rec(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  return {
    type: "recommendation",
    action: "pause",
    campaignId: "c1",
    campaignName: "C1",
    confidence: 0.9,
    urgency: "immediate",
    estimatedImpact: "over target",
    steps: ["pause it"],
    learningPhaseImpact: "no impact",
    ...overrides,
  };
}

describe("selectEconomicTier", () => {
  it("Tier 1 booked_cac when a booked target exists and bookings >= MIN_BOOKED_FOR_TIER1", () => {
    expect(
      selectEconomicTier({ bookings: MIN_BOOKED_FOR_TIER1, leads: 200, hasBookedTarget: true }),
    ).toBe("booked_cac");
  });
  it("falls to cpl when no booked target is configured, even with bookings", () => {
    expect(selectEconomicTier({ bookings: 50, leads: 200, hasBookedTarget: false })).toBe("cpl");
  });
  it("Tier 2 cpl when bookings sparse but leads >= MIN_LEADS_FOR_TIER2", () => {
    expect(selectEconomicTier({ bookings: 3, leads: MIN_LEADS_FOR_TIER2, hasBookedTarget: true })).toBe(
      "cpl",
    );
  });
  it("Tier 3 cpc when both bookings and leads are sparse", () => {
    expect(selectEconomicTier({ bookings: 2, leads: 10, hasBookedTarget: true })).toBe("cpc");
  });
});

describe("calibrateTargetFromBooking", () => {
  it("converts cost-per-booked into the equivalent per-conversion target", () => {
    // $200/booked × (20 booked / 100 conversions = 0.2 booked/conv) = $40/conversion
    expect(
      calibrateTargetFromBooking({ targetCostPerBooked: 200, accountBookings: 20, accountConversions: 100 }),
    ).toBe(40);
  });
  it("returns null when there are no conversions (no rate)", () => {
    expect(
      calibrateTargetFromBooking({ targetCostPerBooked: 200, accountBookings: 20, accountConversions: 0 }),
    ).toBeNull();
  });
});

describe("applyTier", () => {
  it("Tier 1 keeps strength, stamps tier + marginBasis", () => {
    const out = applyTier({ recommendation: rec(), tier: "booked_cac", marginBasis: "unavailable" });
    expect(out.recommendation?.confidence).toBe(0.9);
    expect(out.recommendation?.urgency).toBe("immediate");
    expect(out.recommendation?.economicTier).toBe("booked_cac");
    expect(out.recommendation?.marginBasis).toBe("unavailable");
    expect(out.recommendation?.estimatedImpact).toContain("booked-CAC"); // rationale names the basis (#6)
    expect(out.watch).toBeUndefined();
  });
  it("Tier 2 lowers confidence by the penalty and urgency one band", () => {
    const out = applyTier({ recommendation: rec({ confidence: 0.8, urgency: "immediate" }), tier: "cpl", marginBasis: "unavailable" });
    expect(out.recommendation?.confidence).toBe(0.8 - TIER2_CONFIDENCE_PENALTY); // 0.65, no float drift
    expect(out.recommendation?.urgency).toBe("this_week");
    expect(out.recommendation?.economicTier).toBe("cpl");
    expect(out.recommendation?.estimatedImpact).toContain("CPL proxy"); // rationale names the basis (#6)
  });
  it("Tier 2 floors urgency at next_cycle and confidence at 0", () => {
    const out = applyTier({ recommendation: rec({ confidence: 0.1, urgency: "next_cycle" }), tier: "cpl", marginBasis: "unavailable" });
    expect(out.recommendation?.urgency).toBe("next_cycle");
    expect(out.recommendation?.confidence).toBe(0);
  });
  it("Tier 3 converts a destructive recommendation into a watch", () => {
    const out = applyTier({ recommendation: rec({ action: "pause" }), tier: "cpc", marginBasis: "unavailable", checkBackDate: "2026-06-09" });
    expect(out.recommendation).toBeUndefined();
    expect(out.watch?.type).toBe("watch");
    expect(out.watch?.checkBackDate).toBe("2026-06-09");
    expect(out.watch?.pattern).toContain("cpc");
    expect(() => WatchOutputSchema.parse(out.watch)).not.toThrow(); // #3: lock the watch shape vs schema
  });
  it("Tier 3 keeps fix_signal_health as a recommendation", () => {
    const out = applyTier({ recommendation: rec({ action: "fix_signal_health" }), tier: "cpc", marginBasis: "unavailable" });
    expect(out.recommendation?.action).toBe("fix_signal_health");
    expect(out.recommendation?.economicTier).toBe("cpc");
    expect(out.watch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test economic-target`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module.** Create `packages/ad-optimizer/src/analyzers/economic-target.ts`. (Watch shape, must-fix #3: before hand-building the Tier-3 watch, `grep -rn 'type: "watch"' packages/ad-optimizer/src` for an existing watch constructor and reuse it if present. The object below includes all six `WatchOutputSchema` fields — `type, campaignId, campaignName, pattern, message, checkBackDate` (`ad-optimizer.ts:158-166`) — and is locked by the `WatchOutputSchema.parse` assertion in Step 1.)

```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
  RecommendationOutputSchema as RecommendationOutput,
  UrgencySchema as Urgency,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

// ── Tunable thresholds (spec §5; defaults, not magic constants buried in logic) ──
export const MIN_BOOKED_FOR_TIER1 = 10;
export const MIN_LEADS_FOR_TIER2 = 30;
export const TIER2_CONFIDENCE_PENALTY = 0.15;

// Tier 3 (cpc) forbids every destructive or spend-influencing action — only
// delivery-hygiene survives as a recommendation; everything else becomes a watch.
const TIER3_ALLOWED_ACTIONS = new Set<AdRecommendationAction>(["fix_signal_health"]);

const URGENCY_ORDER: Urgency[] = ["immediate", "this_week", "next_cycle"];

function lowerUrgencyOneBand(u: Urgency): Urgency {
  const i = URGENCY_ORDER.indexOf(u);
  return URGENCY_ORDER[Math.min(i + 1, URGENCY_ORDER.length - 1)] ?? u;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Operator-facing one-liner naming the economic basis (spec §3.5). No "$" so it
// never perturbs the recommendation-sink dollars-at-risk scrape.
function basisNote(tier: EconomicTier, marginBasis: MarginBasis): string {
  if (tier === "booked_cac") {
    return marginBasis === "configured"
      ? "Judged on booked-CAC basis (margin-aware)."
      : "Judged on booked-CAC basis.";
  }
  if (tier === "cpl") {
    return "Booking data is thin, so this is judged on a CPL proxy with reduced confidence.";
  }
  return "Signal too thin to act; delivery-hygiene only.";
}

export interface TierSelectionInput {
  bookings: number;
  leads: number;
  hasBookedTarget: boolean;
  minBooked?: number;
  minLeads?: number;
}

/**
 * Pick the economic tier for this audit window from account-level volume.
 * Tier 1 (booked_cac) requires BOTH a configured cost-per-booked target AND
 * enough realized bookings; otherwise CPL if leads are sufficient, else CPC.
 */
export function selectEconomicTier(input: TierSelectionInput): EconomicTier {
  const minBooked = input.minBooked ?? MIN_BOOKED_FOR_TIER1;
  const minLeads = input.minLeads ?? MIN_LEADS_FOR_TIER2;
  if (input.hasBookedTarget && input.bookings >= minBooked) return "booked_cac";
  if (input.leads >= minLeads) return "cpl";
  return "cpc";
}

export interface CalibrationInput {
  targetCostPerBooked: number; // dollars per booked customer
  accountBookings: number;
  accountConversions: number; // Meta-reported conversions (the engine's CPL denominator)
}

/**
 * Convert a cost-per-booked target into the equivalent per-conversion (CPL)
 * target using the account's realized bookings-per-conversion rate, so it is
 * directly comparable to the engine's CPL = spend / Meta-conversions. Returns
 * null when the rate is undefined (no conversions) — callers must fall back,
 * never divide by zero.
 */
export function calibrateTargetFromBooking(input: CalibrationInput): number | null {
  if (input.accountConversions <= 0) return null;
  const bookingsPerConversion = input.accountBookings / input.accountConversions;
  return round2(input.targetCostPerBooked * bookingsPerConversion);
}

export interface ApplyTierInput {
  recommendation: RecommendationOutput;
  tier: EconomicTier;
  marginBasis: MarginBasis;
  confidencePenalty?: number;
  checkBackDate?: string;
}

export interface TieredResult {
  recommendation?: RecommendationOutput;
  watch?: WatchOutput;
}

/**
 * Post-process a single recommendation for its economic tier (spec §5). The
 * tier gates the allowed action *family*, not just confidence:
 *  - Tier 1 (booked_cac): full strength; stamp tier + marginBasis.
 *  - Tier 2 (cpl): confidence − penalty (floored at 0), urgency one band lower.
 *  - Tier 3 (cpc): any non-hygiene action is withheld and downgraded to a watch.
 * Every surviving recommendation also gets a plain-language basis clause appended
 * to its rationale (spec §3.5) so the operator sees the basis, not just the field.
 */
export function applyTier(input: ApplyTierInput): TieredResult {
  const { recommendation: rec, tier, marginBasis } = input;
  const penalty = input.confidencePenalty ?? TIER2_CONFIDENCE_PENALTY;

  if (tier === "cpc" && !TIER3_ALLOWED_ACTIONS.has(rec.action)) {
    return {
      watch: {
        type: "watch",
        campaignId: rec.campaignId,
        campaignName: rec.campaignName,
        pattern: `economic-tier-cpc-withheld`,
        message: `Withheld "${rec.action}": downstream booking/lead signal too thin to act (tier cpc). ${rec.estimatedImpact}`,
        checkBackDate: input.checkBackDate ?? "",
      },
    };
  }

  let confidence = rec.confidence;
  let urgency = rec.urgency;
  if (tier === "cpl") {
    confidence = Math.max(0, round2(rec.confidence - penalty));
    urgency = lowerUrgencyOneBand(rec.urgency);
  }

  return {
    recommendation: {
      ...rec,
      confidence,
      urgency,
      economicTier: tier,
      marginBasis,
      estimatedImpact: `${rec.estimatedImpact}. ${basisNote(tier, marginBasis)}`,
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test economic-target`
Expected: PASS (all branches).

- [ ] **Step 5: Commit.**

```bash
git add packages/ad-optimizer/src/analyzers/economic-target.ts packages/ad-optimizer/src/analyzers/economic-target.test.ts
git commit -m "feat(ad-optimizer): economic-target module — tier selection, booking calibration, applyTier"
```

---

## Task 3: Config — optional `targetCostPerBooked`

**Files:**
- Modify: `packages/ad-optimizer/src/audit-runner.ts:56-69` (`AuditConfig`)
- Modify: `packages/ad-optimizer/src/inngest-functions.ts:14-19` (inputConfig type), `:109-120` (`AuditConfig` build)

- [ ] **Step 1: Add the optional field to `AuditConfig`** (`audit-runner.ts`, after `targetROAS` at `:60`):

```ts
  /**
   * PR2 (Target): optional cost-per-booked-customer target (dollars). When set,
   * and booking volume is sufficient, the audit judges against a booking-grounded
   * effective target (economic tier "booked_cac"). When absent, the audit uses
   * cost-per-lead against `targetCPA` exactly as before (tier "cpl").
   */
  targetCostPerBooked?: number;
```

- [ ] **Step 2: Thread it through the cron** in `inngest-functions.ts`. Extend the `inputConfig` type (`:14-19`) with `targetCostPerBooked?: number;` (narrow — stored as a number; the seed in Task 7 writes a number), then in the `AuditConfig` build (`:109-120`) add it with a runtime `typeof number` guard that degrades safely (a malformed/string value omits the field → Tier 2 CPL, never NaN-poisons the target):

```ts
  const cpb = deployment.inputConfig.targetCostPerBooked;
  const config: AuditConfig = {
    accountId: creds.accountId,
    orgId: deployment.organizationId,
    targetCPA: deployment.inputConfig.targetCPA ?? 100,
    targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
    ...(typeof cpb === "number" && cpb > 0 ? { targetCostPerBooked: cpb } : {}),
    mediaBenchmarks: { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 },
    ...(pixelId ? { pixelId } : {}),
  };
```

(Absent or malformed → field omitted → Tier 2 CPL: the engine keeps the unchanged `targetCPA` threshold and `applyTier` flags the proxy by lowering confidence/urgency — see decision #2 (threshold unchanged, output honestly marked, **not** byte-identical). If a future wizard writes string values, coerce at the wizard or widen the guard here.)

- [ ] **Step 3: Typecheck.**

Run: `pnpm --filter @switchboard/ad-optimizer build`
Expected: PASS (additive optional field).

- [ ] **Step 4: Commit.**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/inngest-functions.ts
git commit -m "feat(ad-optimizer): optional targetCostPerBooked config for booked-CAC tier"
```

---

## Task 4: Wire the tier into the audit (compute once, thread, post-process)

**Files:**
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (imports; after Step 4 `:328`; sites `:379`, `:403`, `:414`; gate loop `:421-428`)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`

- [ ] **Step 1: Write the failing integration tests.** Append to `audit-runner.test.ts`. These reuse the existing helpers (`makeCampaignInsight` `:19`, `makeFunnelData` `:52`, `buildMockDeps` `:105`) and override `config.targetCostPerBooked`, `crmData` bookings, and the mocked `getTargetBreachStatus`. Add this block (it constructs the runner directly so it can set `config` + a durable breach):

```ts
function runnerWith(opts: {
  targetCostPerBooked?: number;
  bookings: number;
  conversions: number; // account = single campaign here
  campaignSpend: number;
  breachDays: number;
}) {
  const insight = makeCampaignInsight({
    campaignId: "c1",
    spend: opts.campaignSpend,
    conversions: opts.conversions,
    revenue: 0,
  });
  const deps = buildMockDeps({ currentInsights: [insight], previousInsights: [insight] });
  // override the funnel bookings/leads for this account
  (deps.crmDataProvider.getFunnelData as ReturnType<typeof vi.fn>).mockResolvedValue({
    ...makeFunnelData(),
    campaignIds: ["c1"],
    leads: opts.conversions,
    bookings: opts.bookings,
  });
  // durable daily breach so the engine's pause/add-creative gates can fire
  (deps.insightsProvider.getTargetBreachStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
    periodsAboveTarget: opts.breachDays,
    granularity: "daily",
    isApproximate: false,
  });
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 50,
    targetROAS: 2,
    mediaBenchmarks: makeMediaBenchmarks(),
    ...(opts.targetCostPerBooked !== undefined ? { targetCostPerBooked: opts.targetCostPerBooked } : {}),
  };
  return new AuditRunner({ ...deps, config });
}

const RANGE = {
  dateRange: { since: "2026-05-25", until: "2026-06-01" },
  previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
};

describe("PR2 economic tiering", () => {
  it("Tier 1: booked-CAC calibration produces a pause and tags the rec", async () => {
    // Campaign CPL = 6000/30 = $200. Tier 1 (bookings 10 ≥ 10, booked target set).
    // bookingsPerConversion = 10/30 = 0.333 → effectiveTargetCPL = 100 × 0.333 = $33.33.
    // CPL $200 > 3 × $33.33 ($100) → pause gate fires (daily breach present).
    const report = await runnerWith({
      targetCostPerBooked: 100,
      bookings: 10,
      conversions: 30,
      campaignSpend: 6000,
      breachDays: 9,
    }).run(RANGE);
    const pause = report.recommendations.find((r) => r.action === "pause");
    expect(pause).toBeDefined();
    expect(pause?.economicTier).toBe("booked_cac");
    expect(pause?.marginBasis).toBe("unavailable");
  });

  it("identical campaign metrics yield different recs when the account booking rate changes (account-level acceptance)", async () => {
    const common = { targetCostPerBooked: 100, conversions: 30, campaignSpend: 6000, breachDays: 9 };
    const poorBooking = await runnerWith({ ...common, bookings: 10 }).run(RANGE); // effTarget $33.3 → pause
    const healthyBooking = await runnerWith({ ...common, bookings: 30 }).run(RANGE); // rate 1.0 → effTarget $100, CPL $200 not > 3×100
    expect(poorBooking.recommendations.some((r) => r.action === "pause")).toBe(true);
    expect(healthyBooking.recommendations.some((r) => r.action === "pause")).toBe(false);
  });

  it("Tier 2 (no booked target): cpl basis, lowered confidence, behavior matches legacy target", async () => {
    const report = await runnerWith({
      bookings: 10, // irrelevant: no targetCostPerBooked → cannot be booked_cac
      conversions: 40, // >= MIN_LEADS_FOR_TIER2 → cpl tier
      campaignSpend: 8000, // CPL $200 vs targetCPA $50 → > 3× → pause gate fires
      breachDays: 9,
    }).run(RANGE);
    const pause = report.recommendations.find((r) => r.action === "pause");
    expect(pause?.economicTier).toBe("cpl");
    expect(pause?.confidence).toBeCloseTo(0.9 - 0.15, 5); // pause base 0.9, Tier-2 penalty
  });

  it("Tier 3 (sparse leads): a would-be pause is withheld as a watch", async () => {
    const report = await runnerWith({
      bookings: 1,
      conversions: 10, // < MIN_LEADS_FOR_TIER2 and no booked target → cpc
      campaignSpend: 6000,
      breachDays: 9,
    }).run(RANGE);
    expect(report.recommendations.some((r) => r.action === "pause")).toBe(false);
    expect(report.watches.some((w) => w.pattern.includes("cpc"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test audit-runner`
Expected: FAIL — recs lack `economicTier`; no tiering applied.

- [ ] **Step 3: Add imports** at the top of `audit-runner.ts` (with the other `./analyzers/*` imports):

```ts
import {
  selectEconomicTier,
  calibrateTargetFromBooking,
  applyTier,
} from "./analyzers/economic-target.js";
import type { MarginBasisSchema as MarginBasis } from "@switchboard/schemas";
```

- [ ] **Step 4: Compute the tier + effective target once** — insert immediately after Step 4 (`audit-runner.ts:328`, after `const periodDeltas = comparePeriods(...)`), before Step 5:

```ts
    // Step 4b: Calibrate the booking-grounded target and select the economic tier
    // ONCE for this audit (account-level — see the PR2 plan, decision #1). Account
    // conversions = Σ Meta conversions (the engine's CPL denominator); account
    // bookings come from the CRM funnel.
    //
    // INVARIANT (review must-fix #1): calibrate FIRST, then derive the tier from
    // whether calibration actually produced a usable target. This makes it
    // impossible to stamp a recommendation "booked_cac" while judging it against
    // the legacy CPL target (e.g. bookings ≥ 10 but Meta conversions = 0).
    // booked_cac ⟺ calibratedTarget is a positive number ⟹ effectiveTarget === calibratedTarget.
    const accountBookings = crmData.bookings ?? 0;
    const accountConversions = currentInsights.reduce((sum, i) => sum + i.conversions, 0);
    const configuredCpb =
      typeof this.config.targetCostPerBooked === "number" && this.config.targetCostPerBooked > 0
        ? this.config.targetCostPerBooked
        : null;
    const calibratedTarget =
      configuredCpb !== null
        ? calibrateTargetFromBooking({
            targetCostPerBooked: configuredCpb,
            accountBookings,
            accountConversions,
          })
        : null;
    const bookedCacAvailable = calibratedTarget !== null && calibratedTarget > 0;
    const economicTier = selectEconomicTier({
      bookings: accountBookings,
      leads: accountConversions,
      hasBookedTarget: bookedCacAvailable,
    });
    // booked_cac (only reachable when bookedCacAvailable) uses the calibrated
    // target; cpl/cpc keep the legacy targetCPA threshold. applyTier then marks
    // the cpl proxy by lowering confidence/urgency — the threshold is unchanged,
    // the output is honestly flagged (not byte-identical).
    const effectiveTarget =
      economicTier === "booked_cac" ? calibratedTarget! : this.config.targetCPA;
    // PR2: no profit-margin / AOV source is plumbed into the audit, so margin
    // awareness is reported unavailable, never silently satisfied (spec §3.4).
    const marginBasis: MarginBasis = "unavailable";
    const nextCycleDate =
      new Date(new Date(dateRange.until).getTime() + 7 * 86_400_000).toISOString().split("T")[0] ??
      dateRange.until;
```

- [ ] **Step 5: Thread `effectiveTarget` into the three target sites.**

`:379` — performance check:
```ts
      const performanceTargets = {
        targetCPA: effectiveTarget,
        targetROAS: this.config.targetROAS,
      };
```

`:403` — breach status (so the durable-breach count is measured against the same target):
```ts
        targetCPA: effectiveTarget,
```

`:414` — recommendation engine:
```ts
        targetCPA: effectiveTarget,
```

- [ ] **Step 6: Post-process recs with `applyTier`** — replace the gate loop (`:421-428`):

```ts
      // 5g: Apply the economic tier (confidence/urgency/action-family), THEN
      // gate through the learning phase. Tier-3 withholds destructive actions
      // as watches; everything else flows into the learning-phase gate.
      for (const rec of campaignRecs) {
        const tiered = applyTier({
          recommendation: rec,
          tier: economicTier,
          marginBasis,
          checkBackDate: nextCycleDate,
        });
        if (tiered.watch) {
          watches.push(tiered.watch);
          continue;
        }
        const gated = this.learningGuard.gate(tiered.recommendation!, learningStatus);
        if (gated.type === "watch") {
          watches.push(gated);
        } else {
          recommendations.push(gated);
        }
      }
```

- [ ] **Step 7: Run to verify it passes.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test audit-runner`
Expected: PASS (Tier 1 pause tagged; booking-outcome differentiation; Tier 2 lowered confidence; Tier 3 → watch).

- [ ] **Step 8: Full package + build gate.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build`
Expected: PASS — all prior tests (≥335) + new, 0 failures. If schema exports look stale, `pnpm reset` first (CLAUDE.md).

- [ ] **Step 9: Commit.**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/audit-runner.test.ts
git commit -m "feat(ad-optimizer): judge campaigns on booking-calibrated target behind the tier ladder"
```

---

## Task 5: API typecheck (the stub→config swap reaches the app)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the API** (it constructs `AuditConfig` via the cron path):

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS — `targetCostPerBooked` is optional; the inngest build compiles.

- [ ] **Step 2: No commit** (no change). If it fails, the inputConfig type extension in Task 3 is incomplete — fix there.

---

## Task 6: metrics-riley + dashboard ROI relabel (SEPARABLE — may split to PR2b)

> This surfaces a real cost-per-booked on Riley's home/agent-panel ROI bar. Independent of Tasks 1–5. If PR2 is getting wide, ship this as PR2b.

**Files:**
- Modify: `packages/core/src/agent-home/metrics-riley.ts:96-152`
- Modify: `packages/core/src/agent-home/__tests__/metrics-riley.test.ts` (the 5 ROI assertions)
- Modify: `apps/dashboard/src/components/agent-panel/key-result.tsx`, `apps/dashboard/src/components/home/this-week.tsx` (hardcoded "per lead" copy)

- [ ] **Step 1: Update the failing ROI tests** in `metrics-riley.test.ts`. For the live case, provide a booked count via the existing `store.countBookingsCreated` mock and assert the booked basis. Example for the "rule 4 live" block (`:343-348`) — adapt the other four similarly:

```ts
// store mock: countBookingsCreated resolves to e.g. 8 for the week window
// spendCents 20000 ($200), bookings 8 → CAC $25 → "cost per booked"
expect(vm.roi).toEqual({
  degraded: true,
  degradedHint: "",
  label: "cost per booked",
  comparator: { value: "$25 per booked", target: "target $10" },
});
```

For the spend-null and zero-volume branches, keep them degraded but relabel `"cost per lead"` → `"cost per booked"` and the hint `"Connect Meta Ads to see cost per lead"` → `"Connect Meta Ads to see cost per booked"`. Leave `qualifiedPct === 0` (`:359`) and the hero/spark/stats/tiles assertions untouched.

- [ ] **Step 2: Run to verify they fail.**

Run: `CI=true pnpm --filter @switchboard/core test metrics-riley`
Expected: FAIL — still emits `"cost per lead"`.

- [ ] **Step 3: Implement the CAC surface** in `metrics-riley.ts`. Add a booked-count fetch alongside the existing `Promise.all` (`:34`), mirroring Alex's use of `countBookingsCreated` (`metrics-alex.ts`):

```ts
  const bookingsP = store.countBookingsCreated({
    orgId,
    excludeStatuses: ["cancelled", "no_show"],
    from: week.weekStart,
    to: week.weekEnd,
  });
```

Add `bookings` to the destructured `await Promise.all([...])`. Then replace the CPL block (`:96-99`) and the ROI IIFE (`:123-152`) to compute cost-per-booked when bookings are present:

```ts
  const cac =
    spendCents !== null && bookings > 0 ? Math.round(spendCents / 100 / bookings) : null;
  let cacDisplay = "—";
  if (cac !== null) cacDisplay = cac === 0 ? "<$1 per booked" : `$${cac} per booked`;
  // targetCpbCents is genuinely "target cost per booking" (shared with Alex);
  // use it as such now that Riley reads the booked count.
  const targetDollars =
    targets.targetCpbCents !== null ? Math.round(targets.targetCpbCents / 100) : null;
  const targetLabel = targetDollars !== null ? `target $${targetDollars}` : "—";

  const roi: RoiBar = (() => {
    if (spendCents === null) {
      return {
        degraded: true,
        degradedHint: "Connect Meta Ads to see cost per booked",
        label: "cost per booked",
        comparator: { value: "—", target: targetLabel },
      };
    }
    if (bookings <= 0) {
      return {
        degraded: true,
        degradedHint: "",
        label: "cost per booked",
        comparator: { value: "—", target: targetLabel },
      };
    }
    return {
      degraded: true,
      degradedHint: "",
      label: "cost per booked",
      comparator: { value: cacDisplay, target: targetLabel },
    };
  })();
```

Remove the now-unused `cpl`/`cplDisplay` locals and the stale "reinterprets targetCpbCents as target cost per lead" comment block (`:100-106`).

- [ ] **Step 4: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/core test metrics-riley`
Expected: PASS.

- [ ] **Step 5: Update dashboard copy** so the read-model relabel doesn't drift from hardcoded UI strings. In `key-result.tsx` (`composeRileyCplComparator`, ~`:262-270`) and `this-week.tsx` (`:115-118`), change "per lead" copy to "per booked" / "cost per booked" to match the new `roi.label`. Verify with `grep -rn "per lead" apps/dashboard/src/components/agent-panel apps/dashboard/src/components/home`.

- [ ] **Step 6: Build + typecheck the touched packages.**

Run: `CI=true pnpm --filter @switchboard/core test && pnpm --filter @switchboard/dashboard build`
Expected: PASS. (`next build` is the only thing that catches dashboard `.js`-suffix / import gaps — CLAUDE.md.)

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/agent-home/metrics-riley.ts packages/core/src/agent-home/__tests__/metrics-riley.test.ts apps/dashboard/src/components/agent-panel/key-result.tsx apps/dashboard/src/components/home/this-week.tsx
git commit -m "feat(core): surface Riley cost-per-booked vs target on the home ROI bar"
```

---

## Task 7: (OPTIONAL — flagged) Seed dev `targetCostPerBooked` so Tier 1 runs live

> Producer population for the `[[feedback_safety_gate_needs_producer_population]]` scar: without this, booked-CAC is inert in dev/pilot until someone sets the field. Honest (tier reported as `cpl`), but it won't exercise on real data. Include only if you want the live path active in PR2.

**Files:** Modify `packages/db/prisma/seed-marketplace.ts` (the dev Riley deployment `inputConfig`, ~`:747-752`)

- [ ] **Step 1:** Add `targetCostPerBooked: 200` — a **number**, not the string `"200"` — to the Riley deployment's `inputConfig` object alongside `targetCPA`. (The Task 3 cron guard is `typeof cpb === "number"`; a string would be dropped and booked-CAC would never activate. The JSON column preserves the number type on read-back.)
- [ ] **Step 2:** `pnpm --filter @switchboard/db build` (no migration — JSON column value).
- [ ] **Step 3:** Commit `feat(db): seed dev Riley targetCostPerBooked to exercise booked-CAC tier`.

---

## Task 8: Close-out — full verification & safety locks

**Files:** none (verification)

- [ ] **Step 1: Full suite + build + typecheck + lint + format.**

```bash
CI=true pnpm --filter @switchboard/ad-optimizer test
CI=true pnpm --filter @switchboard/core test
pnpm --filter @switchboard/ad-optimizer build && pnpm --filter @switchboard/api typecheck
pnpm lint && pnpm format:check
```
Expected: all PASS. (`format:check` — CI runs prettier; local lint doesn't — CLAUDE.md.)

- [ ] **Step 2: Prove zero mutating paths** (the PR2 non-negotiable):

```bash
grep -rn "updateCampaignStatus\|updateCampaignBudget\|createDraft\|uploadCreativeAsset\|apply_ad_action\|PlatformIngress" \
  packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/recommendation-engine.ts \
  packages/ad-optimizer/src/analyzers/economic-target.ts
```
Expected: NO matches (other than doc-comments). Confirms no mutating method gained a caller.

- [ ] **Step 3: Regression locks green** (the swipe-contract + SAFETY tests must not have moved):

```bash
CI=true pnpm --filter @switchboard/ad-optimizer test recommendation-sink
CI=true pnpm --filter @switchboard/ad-optimizer test meta-ads-client
```
Expected: PASS — `financialEffect`/`externalEffect` mapping and SAFETY/PAUSED guards intact.

- [ ] **Step 4: Open PR** `feat/riley-pr2-target` → `main`. Title: `feat(ad-optimizer): aim Riley at booked customers — economic-tier ladder (Phase 1 PR2)`. Body: link the spec + this plan; note "no mutating paths; account-level booking calibration behind the §5 tier ladder; targetCostPerBooked opt-in, back-compat."

---

## Self-Review (against spec `2026-06-01-riley-phase1-superhuman-advice-design.md`)

- **§3.1 economically targeted** → Task 2 `selectEconomicTier` + Task 4 calibration (cost-per-booked when signal sufficient). ✓
- **§3.2 evidence-gated** → unchanged engine durable-breach gates; `effectiveTarget` threads into `getTargetBreachStatus` (Task 4 Step 5) so the breach count tracks the active target. ✓
- **§3.3 learning-phase protected** → learning gate still runs, now *after* `applyTier` (Task 4 Step 6). ✓
- **§3.4 margin-aware / marginBasis** → Task 1 field + Task 4 `marginBasis="unavailable"` (honest; no margin source). ✓
- **§3.5 operator-explainable / names tier** → Task 1 `economicTier` field **plus** a plain-language basis clause appended to the rationale by `applyTier` (`basisNote`, Task 2), stamped in Task 4. ✓
- **§3.6 non-mutating** → Task 8 Step 2 grep + Step 3 regression locks. ✓
- **§5 fallback ladder** → Task 2 `applyTier` constrains confidence **and** action family (Tier 3 → watch); `selectEconomicTier` thresholds named + tunable. ✓
- **§4·PR2 files** → `recommendation-engine.ts` target driver swapped via `effectiveTarget` (Task 4); `audit-runner.ts` (Task 4); `metrics-riley.ts` (Task 6); schema (Task 1). ✓
- **§6 candidateAction** → **deferred to PR3/PR4** (decision #4) — flagged deviation, not silent.
- **Placeholder scan:** Task 6 fixtures reference existing helpers by file:line; Task 4 shows real numbers. No TBDs.
- **Type consistency:** `economicTier`/`marginBasis`/`EconomicTier`/`MarginBasis` used identically across Tasks 1, 2, 4; `effectiveTarget` is the single threaded value; `applyTier` returns `{recommendation?, watch?}` consumed exactly in Task 4 Step 6.
- **Calibration-consistency invariant (review #1):** `economicTier==='booked_cac'` is only reachable when `calibratedTarget` is a positive number, and `effectiveTarget` is then that calibrated value — a booked-CAC stamp can never accompany the legacy CPA target (Task 4 Step 4). Locked structurally, not by test alone.
- **Watch-shape lock (review #3):** the Tier-3 watch carries all six `WatchOutputSchema` fields and is verified by `WatchOutputSchema.parse` in Task 2's test.

---

## Execution Handoff

Plan complete and review-patched (must-fixes #1–#5 + the rationale nice-fix applied 2026-06-02). **Locked execution scope** (partner decision): core PR2 = **Tasks 1–5 + Task 8**; **Task 6 splits to PR2b**; **Task 7 optional**. Execute via **subagent-driven-development** — fresh subagent per task, two-stage (spec + quality) review between tasks, starting at Task 1.
