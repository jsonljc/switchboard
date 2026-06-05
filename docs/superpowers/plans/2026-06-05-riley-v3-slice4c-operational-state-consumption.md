# Riley v3 Slice 4c: Operational-State Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two reserved unknowns become real, honestly: `RevenueState.businessContextFreshness` derives from the org's latest operational-state confirmation, and `RecommendationOutcome.businessContextStable` derives from the confirmation set overlapping the full past attribution window; the `corroborated` arm of `causalStrength` is explicitly DEFERRED with reasoning (see Decision F) and its never-emitted sweep test stays intact (strengthened).

**Architecture:** A staleness-policy constant in `@switchboard/schemas` (Layer 1, the only home both consumers may import); a pure freshness derivation in `packages/ad-optimizer/src/revenue-state.ts` fed by an optional injected provider on `AuditRunner` (read post-abort only); a pure window-overlap stability derivation in a new `packages/core/src/recommendations/operational-stability.ts` consumed by `attributeOneRecommendation` via an optional confirmations input, fetched by the orchestrator through an optional injected reader; both injections wired at the app layer in `apps/api/src/bootstrap/inngest.ts` with `PrismaOperationalStateStore` (the first and only app construction of the 4a store). Zero schema/store/editor/dashboard diffs; zero migrations (the slice-3 CHECK constraints already permit `stable`/`unstable`).

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/schemas` (Layer 1), `packages/ad-optimizer` (Layer 2), `packages/core` (Layer 3), `apps/api` (DI wiring); Vitest; `pnpm eval:riley` + `pnpm eval:governance` golden harnesses (byte-unchanged gates).

**Consumes:** spec `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (2.1 net-new paragraph, 2.5 incl. the causalStrength honesty constraint, 7.4, 7.5); roadmap `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md` (Slice 4c); the shipped 4a plan (Decision B derived validity + the `getConfirmationsOverlappingWindow` contract), the shipped 4b plan (editor + real-app evidence), the shipped slice-3 plan (derivation + render seam). Slices 1 (#867), 2 (#876), 3 (#886), 4a (#895), 4b (#906) are merged and consumed as-is.

**Scope fence (4c only):** consumption + tests. NO operational-state schema changes (`packages/schemas/src/operational-state.ts` byte-untouched; the new policy constant lives in a SIBLING file), NO `packages/db` diff of any kind (no migration; none is needed, see Decision G; no store changes; `getConfirmationsOverlappingWindow` is consumed exactly as shipped), NO editor/UI changes (zero diff under `apps/dashboard`), NO PlatformIngress caller, NO cockpit revival, NO Phase-C wiring. Riley stays advisory-only: the diff adds reads, never a mutating caller.

---

## Settled design decisions (the load-bearing part)

All anchors re-derived against live `origin/main` at `2951510b` (2026-06-05, the TY4 merge).

### Decision A: one staleness constant, two distinct questions

Slice 4a deliberately did not encode staleness ("how old a confirmation may be and still vouch" is a 4c policy knob). Settled: a single policy constant, **`OPERATIONAL_STATE_VOUCH_DAYS = 14`**, applied at two different anchor points because the two consumers ask different questions of the same substrate:

- **"Fresh enough to act"** (RevenueState, point-in-time): age of the latest confirmation **at the moment the weekly audit runs**. `<= 14d` → `"fresh"`; `> 14d` → `"stale"`; no confirmation → `"unknown"`.
- **"Governed the window"** (outcome path, past-window): age of the **governing** confirmation **at the moment the attribution window opened** (`windowStartedAt - confirmedAt`). A governing row older than 14 days at window entry cannot certify `"stable"` (verdict degrades to `"unknown"`); disruption evidence still yields `"unstable"` regardless of staleness (evidence of disruption does not expire the way a vouch does).

**Why 14 days:** (1) the audit cron is weekly (`0 9 * * 1`), so 14 days = two full re-confirmation opportunities missed; (2) it equals the longest attribution half-window (refresh_creative `windowDays: 14`); (3) medspa operational tempo (promos run 2-6 weeks, closures and staffing changes turn over in days-to-weeks) makes a >2-week-old attestation genuinely weak; (4) the 4b editor ships a one-click "Everything still accurate" re-confirm, so a 14-day expectation is operationally cheap to meet. One constant, not two, because divergent thresholds would make the two surfaces disagree about the same row for no articulable reason.

**Where it lives:** a new sibling file `packages/schemas/src/operational-state-policy.ts` (Layer 1). Both consumers need it and neither may import the other (ad-optimizer is Layer 2, core is Layer 3, and Layer 2 cannot import core). It is deliberately NOT in `operational-state.ts`: the scope fence keeps the 4a schema module byte-untouched, and policy-vs-contract separation is real (the row contract is 4a's; the vouch policy is 4c's).

### Decision B: stability semantics (the differencing principle with a closure carve-out)

`businessContextStable` answers: **was the business context comparable across the FULL attribution window** (`windowStartedAt..windowEndedAt`, which spans BOTH the pre and post sub-windows: the engine computes them as `anchorAt ± windowDays`)? The window itself is **half-open `[windowStartedAt, windowEndedAt)`**: the engine's Meta window queries are `startInclusive` at `preStart` and `endExclusive` at `postEnd` (`outcome-attribution.ts` window fetch), so the instant `windowEndedAt` is never measured. Interval geometry follows: an interval starting exactly at `windowEndedAt` does NOT overlap the window, and an interval ending exactly at `windowEndedAt` covers every measured instant (both pinned by boundary tests). The settled rule set:

- **Constant context does not confound a delta.** A pre/post comparison differences out anything that held steady across both sub-windows. A promo running throughout the entire window, or a staffing shortfall in force the whole time, is constant background, hence comparable.
- **Transitions confound.** A promo starting or ending inside the window, a closure interval overlapping it, any scalar dimension flipping value mid-window (including recovery: shortfall→normal), or the window-overlapping subset of a declared interval list changing mid-window: all of these break pre/post comparability → `"unstable"`.
- **Closure carve-out:** `operatingStatus: "temporarily_closed"` in force over any part of the window, or a `closures` interval overlapping it, is `"unstable"` even when constant. A closed business transacts nothing; spec 2.5's bar is "stable enough for the result to mean anything," and constancy does not rescue a result that cannot mean anything.
- **Disrupted state first confirmed mid-window** (e.g. an in-window confirmation declares `staffing: "shortfall"` and no earlier row in the set ever declared staffing): the onset is unknowable, so constancy cannot be certified, and affirmative disruption evidence exists → `"unstable"`. (A NORMAL value first confirmed mid-window is not disruption evidence; it just leaves the governing knowledge incomplete → `"unknown"` at certification time.)
- **Re-confirmation is not a transition.** The 4b "Everything still accurate" flow re-records the same state with a fresh `confirmedAt`; identical consecutive declarations never trip the transition detector (pinned by test).
- **`"stable"` is an affirmative certification**, requiring ALL of: (1) a governing row exists (`confirmedAt <= windowStartedAt`; without it the window opened ungoverned); (2) it is fresh at window entry per Decision A; (3) it confirms **all five operational dimensions** (`operatingStatus`, `staffing`, `inventory`, `promoWindows`, `closures`); an unconfirmed dimension is "operator never said," and silence must not vouch (the 4a honesty floor: absent ≠ "open"/"normal"); explicit `[]` ("operator confirmed none") is a POSITIVE signal and satisfies the requirement, `undefined` does not; (4) nothing disrupts per the rules above. Everything that neither disrupts nor certifies → `"unknown"`.
- **Empty confirmation set → `"unknown"`** (honest absence; legacy orgs have zero rows by construction). The store already degrades malformed rows to absence with a warning; nothing here resurrects them.

**The read is exactly `getConfirmationsOverlappingWindow(org, windowStartedAt, windowEndedAt)`**: the 4a contract, called nowhere until now. One honest limitation, documented rather than papered over: a confirmation recorded AFTER `windowEndedAt` but before the cron evaluates (the settlement lag is 24h, the cron daily) is invisible to this read even if its declared promo/closure intervals reach back into the window. The 4a plan's prose example ("operator confirming June 16 'promo ran June 1-15' must let 4c see the overlap with a June 8-14 window") is therefore only satisfied when the confirmation lands in-window or pre-window. Widening the read to `now` would require teaching the derivation to treat post-window rows asymmetrically (their scalar regimes must NOT count as in-window transitions; only their explicit intervals reach back), and outcome rows are insert-once anyway, so most late confirmations miss the evaluation regardless of the read shape. That asymmetric-read enhancement is an explicit non-goal of this slice; the pinned read is honest in the safe direction (it can only under-claim, never fabricate). It is tracked as a NAMED follow-on rather than buried: **slice 4e, asymmetric late-interval read support** (post-window confirmations contribute their explicit interval declarations only, never scalar-transition inference), because the operator workflow gap ("I confirmed after the fact that a promo ran during the period, but Riley still says unknown") will show up in real usage.

### Decision C: carry-only for RevenueState; trustDelta demotion is the one derivation change

- **`businessContextFreshness` is carried, not gated.** Nothing in the decision layer reads it in this slice (the spec's 4c acceptance is "RevenueState carries a real businessContextFreshness"; gating would be a behavior change the existing eval cannot pin; `eval:riley` drives `decideForCampaign`/source-reallocation/arbitration, none of which read freshness). It is the designed input for slice-5/Phase-C gating and for a future deliberate arbitrator change, each of which must bring its own pin when it flips.
- **`businessContextStable` does demote `trustDelta`**: a renderable directional outcome over an `"unstable"` window records `trustDelta: "none"` instead of up/down. Defense: spec 2.5 defines `businessContextStable` as "whether the business was stable enough for the result to mean anything," and `trustDelta` as "should trust move, given the outcome and its causal strength." An outcome whose window the context disrupted must not render "This outcome is a positive signal for this action."; that would be exactly the fabricated confidence the honesty floors exist to prevent. The factual outcome line (e.g. "Spend fell 92.0% in 7d after pause.") still renders; only the trust suffix is suppressed (the slice-3 copy path already renders no suffix for `"none"`). `"unknown"` context preserves slice-3 behavior byte-for-byte (no operator source = no demotion), so legacy orgs and the no-reader path are unchanged.
- `causalStrength` stays orthogonal to stability (it measures measurement cleanliness: flags + delta). A clean delta over an unstable window is `directional` + `unstable` + `trustDelta none`; each field tells its own truth.

### Decision D: layering and DI seams (mirroring the shipped patterns exactly)

- **ad-optimizer (Layer 2, schemas only):** `AuditRunner` gains an optional `operationalStateProvider?: { getLatest(organizationId): Promise<{ confirmedAt: Date } | null> }` dependency (structural type; freshness needs only the anchor). `CronDependencies` gains the matching optional `getLatestOperationalState`. The read happens POST-ABORT only, immediately before `assembleRevenueState`: the Gate-0 and signal-red abort paths never touch it, pinned by extending the existing abort-guard test (`packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts`); a seam test (partial passthrough mock of `decideForCampaign`) additionally pins that the DERIVED value reaches the RevenueState the decision layer reads, not merely that the provider was called. A read failure degrades to `"unknown"` with a warning rather than sinking the weekly audit: freshness is advisory carry, and the audit re-runs weekly so a transient blip self-heals.
- **core (Layer 3, cannot import db):** `RunRileyOutcomeAttributionInput` gains an optional `operationalStateReader` interface (typed against `OperationalStateConfirmation` from `@switchboard/schemas`); the orchestrator fetches confirmations per candidate (cheap indexed DB read placed BEFORE the quota-bearing Meta calls) and passes them into the pure `attributeOneRecommendation`. A read failure PROPAGATES (Inngest retries): outcome rows are insert-once, so writing `"unknown"` on a transient blip would freeze it forever. This is the deliberate asymmetry with the audit path; each side is defended by its own persistence model.
- **apps/api (Layer 5):** `bootstrap/inngest.ts` constructs `PrismaOperationalStateStore` once (the first app-layer construction; 4a's "constructed nowhere" grep was a 4a-scope proof, deliberately flipped here) and injects it at both seams. `PrismaOperationalStateStore.getLatest` / `.getConfirmationsOverlappingWindow` structurally satisfy both interfaces with zero adapters.
- **Inngest JSON-memoization gotcha honored:** the provider rides `deps`/closure and is called inside the per-deployment `step.run` closure; confirmation objects (which carry `Date`s) never cross a step boundary.

### Decision E: render surface stays machine-only, by design

`businessContextStable` is recorded and projected (the slice-3 read model already narrows `"stable"`/`"unstable"`; shipped, no change needed) but gets NO new operator copy in this slice. The only operator-visible effect is the Decision-C demotion: unstable-window outcomes stop claiming a trust signal (suffix absent). Defense: the slice-3 copy system is a deliberately allowlisted, tripwire-tested surface (`recommendation-outcome-copy.test.ts` bans causal/trust-state words); adding "context changed during this window" copy is an operator-UX decision that belongs with the loop's UX owner, and the demotion already prevents the only actively-misleading rendering. The tripwire test is byte-untouched. Zero dashboard diffs.

### Decision F: the corroborated arm is DEFERRED (the honest-availability analysis)

Spec 2.5's bar: `corroborated` means _an independent second estimate agrees_, and the only honest source is the CRM/booking side ("a pause whose Meta spend fell AND whose booked-revenue-per-dollar held"). The brainstorm proved this signal **cannot be wired honestly in this slice**:

1. **Campaign-level booked-revenue-per-dollar is mathematically degenerate for pause**, the one kind the spec's example names. The outcome row is per-campaign; a pause that takes effect drives the campaign's post-window spend toward zero, so post `bookedValueCents / spendCents` divides by ~0, and the campaign's attributed bookings also collapse (no traffic → no new attributed conversions). The per-campaign provider that exists today (`PrismaConversionRecordStore.queryBookedValueCentsByCampaign`, the audit's `bookedValueByCampaignProvider`) cannot express the spec's example at the only granularity the outcome path has.
2. **The honest formulation is org-level** ("did the ACCOUNT's booked revenue per ad dollar hold while this campaign's spend fell?"), which requires org-level Meta spend for two arbitrary past windows: a provider surface that does not exist in the outcome path (`MetaInsightsProvider.getWindowMetrics` is per-campaign; `getAccountSummary` is a current snapshot). Building it means new Graph calls per candidate (quota), a new adapter method, and new DI.
3. **Sparse-booking noise needs designed floors.** SMB orgs book single digits per week; a 7-day window with one $50 booking would "agree" by luck. Honest corroboration needs volume floors (the repo's count floors such as `MIN_SOURCE_BOOKINGS = 3` don't transfer directly to a value-based signal) and probably a multi-campaign-org restriction (a single-campaign org's account spend goes to ~0 post-pause, reproducing the degeneracy).

Each of (2) and (3) is a design decision deserving its own brainstorm + eval consideration; bolting them onto this slice would either fabricate agreement from degenerate math or balloon the slice past review-ability. **Deferred to a follow-on slice (4d) with this analysis as its starting spec.** Per the DoD's explicit alternative: the never-emits-corroborated sweep test stays intact and is STRENGTHENED (it now also covers inputs WITH operational-state confirmations present), and the `corroborated` enum value stays type-reserved with the DB CHECK already permitting it (slice-3 migration), so 4d needs no migration either.

### Decision G: no migration, proven

The slice-3 migration (`20260604200000_recommendation_outcome_enrichment`) already constrains `businessContextStable` to `('stable', 'unstable', 'unknown')` and `causalStrength` to `('directional', 'corroborated', 'inconclusive')`; the writer this slice enables emits only already-legal values. The read model already narrows all three values. Therefore: zero `packages/db` diff, zero migrations, `pnpm db:check-drift` trivially clean. The DoD's "zero schema/store/editor diffs" is grep-proven in Task 8.

### Eval gates and the alex-eval environmental blocker

- `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26): baselines captured GREEN pre-change in this worktree (`/tmp/slice4c-baselines/eval-riley-baseline.txt`, `/tmp/slice4c-baselines/eval-governance-baseline.txt`); re-run + byte-diff after every behavior-bearing task and at the end. Safety argument: the eval constructs RevenueState via `assembleRevenueState({...})` WITHOUT the new optional input (verified: `evals/riley-recommendation/decide.ts:156`, `arbitration-eval.ts:161`, `source-reallocation-eval.ts:164,188`), which defaults `businessContextFreshness: "unknown"` (identical to today's constant); no decision/arbitration function reads the field; the outcome path has zero import-graph contact with `evals/`.
- `pnpm eval:alex-conversation`: environmentally blocked in this worktree (verified 2026-06-05: exits 0, "alex-conversation eval skipped: ANTHROPIC_API_KEY is not available"). Static proof chain: `BusinessFactsSchema`, `PrismaBusinessFactsStore`, the alex builder, and `evals/` are byte-untouched (diff-proven in Task 8); core suite green; build green. Re-attempt post-change to record the same skip line.

### Known pre-existing failures (not blockers, not ours)

`pnpm --filter @switchboard/db test` fails 9 tests in exactly 3 files at this worktree's clean baseline `2951510b` (work-trace integrity 6, ledger 2, greeting 1): the known local-PG trio. Gate = no NEW failures. Known CI noise: chat gateway-bridge-attribution flake, api-auth prod-hardening flake (rerun before investigating), Eval Claim Classifier 401 on every main push (informational, broken Actions secret).

---

## File structure

```
packages/schemas/src/operational-state-policy.ts                          (create ~45 lines)
packages/schemas/src/__tests__/operational-state-policy.test.ts           (create ~25 lines)
packages/schemas/src/index.ts                                             (modify +3 lines)
packages/schemas/src/__tests__/index-exports.test.ts                      (modify +5 lines)
packages/ad-optimizer/src/revenue-state.ts                                (modify +~70 lines)
packages/ad-optimizer/src/revenue-state.test.ts                           (modify +~85 lines)
packages/ad-optimizer/src/audit-runner.ts                                 (modify +~20 lines; 655→~675, eslint-disable max-lines present → arch-check warn-tier, not error)
packages/ad-optimizer/src/inngest-functions.ts                            (modify +~12 lines)
packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts      (modify +~85 lines)
packages/core/src/recommendations/operational-stability.ts                (create ~215 lines)
packages/core/src/recommendations/__tests__/operational-stability.test.ts (create ~500 lines)
packages/core/src/recommendations/outcome-attribution-types.ts            (modify +~25 lines)
packages/core/src/recommendations/outcome-attribution.ts                  (modify +~30 lines)
packages/core/src/recommendations/__tests__/outcome-attribution.test.ts   (modify +~150 lines)
packages/core/src/recommendations/index.ts                                (modify +1 line)
apps/api/src/services/cron/riley-outcome-attribution.ts                   (modify +~8 lines)
apps/api/src/bootstrap/inngest.ts                                         (modify +~10 lines)
docs/superpowers/plans/2026-06-05-riley-v3-slice4c-operational-state-consumption.md (this file; rides in the PR per slice precedent)
```

All files under the 600-line arch ceiling except `audit-runner.ts`, which already carries the `eslint-disable max-lines` legacy-debt marker (arch-check classifies it 🟡 warn, verified in `scripts/arch-check.ts:14-23`: error tier is ">600 lines WITHOUT eslint-disable"); this slice adds ~20 lines of glue there and no more. ESM `.js` relative imports throughout; no `any`; core/ad-optimizer tests co-located per package convention. `packages/core/src/recommendations/index.ts` gains exactly one type re-export (`OperationalStateReader`, consumed by the apps/api binding in Task 6); `deriveBusinessContextStability` stays module-internal (no external consumer).

---

## Task 0: Commit the approved plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-05-riley-v3-slice4c-operational-state-consumption.md` (this document)

- [ ] **Step 0.1: Verify branch context, then commit the plan doc**

```bash
git branch --show-current   # expect: worktree-riley-v3-slice4c
git status --short          # expect: only this plan doc (do NOT stage .claude/settings.local.json)
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4c-operational-state-consumption.md
git commit -m "docs(plans): riley v3 slice 4c operational-state consumption plan"
```

Note: lint-staged may reformat the markdown on commit; if the commit fails with reformatted files, `git add` again and re-commit.

---

## Task 1: The staleness-policy constant (`@switchboard/schemas`)

**Files:**

- Create: `packages/schemas/src/__tests__/operational-state-policy.test.ts`
- Create: `packages/schemas/src/operational-state-policy.ts`
- Modify: `packages/schemas/src/index.ts` (directly after the `export * from "./operational-state.js";` line, ~line 77)
- Modify: `packages/schemas/src/__tests__/index-exports.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/schemas/src/__tests__/operational-state-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_STATE_VOUCH_DAYS,
  OPERATIONAL_STATE_VOUCH_MS,
} from "../operational-state-policy.js";

describe("operational-state staleness policy (riley v3 slice 4c)", () => {
  it("pins the vouch window at 14 days (two weekly-audit cycles; the longest attribution half-window)", () => {
    expect(OPERATIONAL_STATE_VOUCH_DAYS).toBe(14);
  });

  it("derives the millisecond form from the day form (single source of truth)", () => {
    expect(OPERATIONAL_STATE_VOUCH_MS).toBe(OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 1.2: Run the test, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/schemas test -- operational-state-policy
```

Expected: FAIL with `Cannot find module '../operational-state-policy.js'` (or equivalent resolve error).

- [ ] **Step 1.3: Write the policy module**

Create `packages/schemas/src/operational-state-policy.ts`:

```ts
/**
 * Staleness policy for operational-state CONSUMPTION (Riley v3 slice 4c;
 * spec 2026-06-03-riley-v3-control-plane sections 2.1 net-new paragraph
 * and 7.4).
 *
 * Slice 4a deliberately did not encode staleness in the data: confirmation
 * rows record who confirmed what when, and "how old a confirmation may be
 * and still vouch" is a consumption-side policy. This module is that
 * policy's single home. It lives in Layer 1 because BOTH consumers need it
 * and neither may import the other: packages/ad-optimizer (Layer 2,
 * RevenueState.businessContextFreshness) and packages/core (Layer 3,
 * RecommendationOutcome.businessContextStable).
 *
 * The two consumers ask DIFFERENT questions against the same constant:
 * - "fresh enough to act": age of the LATEST confirmation at the moment the
 *   weekly audit runs (point-in-time, ad-optimizer).
 * - "governed the window": age of the GOVERNING confirmation at the moment a
 *   PAST attribution window opened (window-anchored, core). Disruption
 *   evidence is exempt from the vouch window; evidence of disruption does
 *   not expire the way an attestation of normalcy does.
 *
 * Why 14 days: the audit cron is weekly, so 14 days means two full
 * re-confirmation opportunities were missed; it equals the longest
 * attribution half-window (refresh_creative windowDays = 14); medspa
 * operational tempo (promos 2-6 weeks, closures/staffing days-to-weeks)
 * makes an attestation older than two weeks genuinely weak; and the 4b
 * editor's one-click "Everything still accurate" re-confirm makes the
 * expectation operationally cheap to meet.
 */
export const OPERATIONAL_STATE_VOUCH_DAYS = 14;

/** Millisecond form of OPERATIONAL_STATE_VOUCH_DAYS (single source of truth). */
export const OPERATIONAL_STATE_VOUCH_MS = OPERATIONAL_STATE_VOUCH_DAYS * 24 * 60 * 60 * 1000;
```

Modify `packages/schemas/src/index.ts`: directly after the `export * from "./operational-state.js";` line, add:

```ts
// Operational-state staleness policy (consumption-side; Riley v3 slice 4c)
export * from "./operational-state-policy.js";
```

Modify `packages/schemas/src/__tests__/index-exports.test.ts`: add inside the existing `describe`:

```ts
it("exports the operational-state staleness policy (riley v3 slice 4c)", () => {
  expect(schemas.OPERATIONAL_STATE_VOUCH_DAYS).toBe(14);
  expect(schemas.OPERATIONAL_STATE_VOUCH_MS).toBe(14 * 24 * 60 * 60 * 1000);
});
```

- [ ] **Step 1.4: Run schemas tests, verify green; build so downstream packages see the export**

```bash
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/schemas build
pnpm typecheck
```

Expected: all schemas tests PASS (750 baseline + 3 new), build + typecheck clean.

- [ ] **Step 1.5: Commit**

```bash
git add packages/schemas/src/operational-state-policy.ts \
        packages/schemas/src/__tests__/operational-state-policy.test.ts \
        packages/schemas/src/index.ts \
        packages/schemas/src/__tests__/index-exports.test.ts
git commit -m "feat(schemas): operational-state vouch-window policy constant (riley v3 slice 4c)"
```

---

## Task 2: Freshness derivation (`packages/ad-optimizer/src/revenue-state.ts`, pure)

**Files:**

- Modify: `packages/ad-optimizer/src/revenue-state.test.ts`
- Modify: `packages/ad-optimizer/src/revenue-state.ts`

- [ ] **Step 2.1: Write the failing tests**

In `packages/ad-optimizer/src/revenue-state.test.ts`, replace the import block with:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  assembleRevenueState,
  deriveBusinessContextFreshness,
  resolveBusinessContextFreshness,
  withSpendAttributionCoverage,
  type RevenueState,
} from "./revenue-state.js";
```

Append two describe blocks at the end of the file:

```ts
describe("deriveBusinessContextFreshness (riley v3 slice 4c)", () => {
  const NOW = new Date("2026-06-05T09:00:00.000Z");

  it("returns unknown when no confirmation exists (honest absence, never fabricated)", () => {
    expect(deriveBusinessContextFreshness(null, NOW)).toBe("unknown");
  });

  it("returns fresh inside the vouch window", () => {
    const confirmedAt = new Date("2026-05-25T09:00:00.000Z"); // 11d old
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });

  it("returns fresh at exactly the vouch boundary (a 14-day-old confirmation still vouches)", () => {
    const confirmedAt = new Date("2026-05-22T09:00:00.000Z"); // exactly 14d
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });

  it("returns stale just past the vouch boundary", () => {
    const confirmedAt = new Date("2026-05-22T08:59:59.999Z"); // 14d + 1ms
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("stale");
  });

  it("treats a future-dated confirmedAt (clock skew) as fresh, never stale", () => {
    const confirmedAt = new Date("2026-06-05T10:00:00.000Z");
    expect(deriveBusinessContextFreshness({ confirmedAt }, NOW)).toBe("fresh");
  });
});

describe("resolveBusinessContextFreshness (provider wrapper)", () => {
  const NOW = new Date("2026-06-05T09:00:00.000Z");

  it("returns unknown when no provider is wired (eval harness / analysis-only callers)", async () => {
    expect(await resolveBusinessContextFreshness(undefined, "org-1", NOW)).toBe("unknown");
  });

  it("derives freshness from the provider's latest confirmation", async () => {
    const provider = {
      getLatest: vi.fn().mockResolvedValue({ confirmedAt: new Date("2026-06-01T00:00:00.000Z") }),
    };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("fresh");
    expect(provider.getLatest).toHaveBeenCalledWith("org-1");
  });

  it("returns unknown for an org with no confirmations", async () => {
    const provider = { getLatest: vi.fn().mockResolvedValue(null) };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("unknown");
  });

  it("degrades a read failure to unknown with a warning instead of sinking the weekly audit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = { getLatest: vi.fn().mockRejectedValue(new Error("db down")) };
    expect(await resolveBusinessContextFreshness(provider, "org-1", NOW)).toBe("unknown");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("assembleRevenueState: slice-4c freshness input", () => {
  it("passes an explicit freshness through", () => {
    const state = assembleRevenueState({
      measurementTrusted: true,
      businessContextFreshness: "fresh",
    });
    expect(state.businessContextFreshness).toBe("fresh");
  });

  it("defaults to unknown when absent (eval harness and analysis-only callers byte-unchanged)", () => {
    const state = assembleRevenueState({ measurementTrusted: true });
    expect(state.businessContextFreshness).toBe("unknown");
  });
});
```

(The four pre-existing tests in this file pin the absent-input → `"unknown"` default and stay untouched.)

- [ ] **Step 2.2: Run, verify the new tests fail**

```bash
pnpm --filter @switchboard/ad-optimizer test -- revenue-state
```

Expected: FAIL; `deriveBusinessContextFreshness` is not exported.

- [ ] **Step 2.3: Implement**

In `packages/ad-optimizer/src/revenue-state.ts`:

Replace the import block at the top:

```ts
import { OPERATIONAL_STATE_VOUCH_MS } from "@switchboard/schemas";
import type {
  EconomicTierSchema as EconomicTier,
  MarginBasisSchema as MarginBasis,
} from "@switchboard/schemas";
```

Replace the `BusinessContextFreshness` type (currently `/** Slice-4 reserved... */ export type BusinessContextFreshness = "unknown";`):

```ts
/**
 * Slice-4c: freshness of the operator-confirmed operational-state source
 * (the 4a substrate; spec 7.4 "staleness of the input itself").
 * - "fresh": the latest confirmation is at most OPERATIONAL_STATE_VOUCH_DAYS old.
 * - "stale": a confirmation exists but is older than the vouch window.
 * - "unknown": no confirmation exists (honest absence; legacy orgs and orgs
 *   that never confirmed stay "unknown" forever) or no source is wired (the
 *   eval harness and analysis-only callers).
 * Advisory CARRY in this slice: nothing in the decision layer gates on it.
 * It is the designed input for slice-5/Phase-C gating, which must bring its
 * own pin when it flips.
 */
export type BusinessContextFreshness = "fresh" | "stale" | "unknown";
```

In `AssembleRevenueStateInput`, add after `signalHealthScore?: SignalHealthScore;`:

```ts
  /** Slice-4c: derived freshness. Absent (eval harness, analysis-only callers) ⇒ "unknown". */
  businessContextFreshness?: BusinessContextFreshness;
```

In `assembleRevenueState`, replace the literal `businessContextFreshness: "unknown",` line with:

```ts
    businessContextFreshness: input.businessContextFreshness ?? "unknown",
```

Append at the end of the file:

```ts
/**
 * Derive freshness from the latest operator confirmation (spec 7.4: the
 * anchor is when the operator last confirmed, immune to unrelated writes by
 * the 4a append-only design). Structural input; only confirmedAt matters.
 * Boundary: age <= the vouch window is fresh (a confirmation made exactly
 * OPERATIONAL_STATE_VOUCH_DAYS ago still vouches). A future-dated
 * confirmedAt (clock skew) is fresh, never stale.
 */
export function deriveBusinessContextFreshness(
  latest: { confirmedAt: Date } | null,
  now: Date,
): BusinessContextFreshness {
  if (latest === null) return "unknown";
  return now.getTime() - latest.confirmedAt.getTime() <= OPERATIONAL_STATE_VOUCH_MS
    ? "fresh"
    : "stale";
}

/**
 * Async wrapper the audit runner calls: resolve the latest confirmation from
 * the injected provider and derive freshness. Degrades a read failure to
 * "unknown" with a warning rather than sinking the weekly audit: freshness
 * is an advisory carry field (not a gate), and the audit re-runs weekly so a
 * transient blip self-heals. (Deliberate asymmetry with the outcome path,
 * which PROPAGATES read failures: outcome rows are insert-once, so a blip
 * written there would freeze "unknown" forever.)
 */
export async function resolveBusinessContextFreshness(
  provider:
    | { getLatest(organizationId: string): Promise<{ confirmedAt: Date } | null> }
    | undefined,
  organizationId: string,
  now: Date,
): Promise<BusinessContextFreshness> {
  if (!provider) return "unknown";
  try {
    return deriveBusinessContextFreshness(await provider.getLatest(organizationId), now);
  } catch (err) {
    console.warn(
      `[ad-optimizer] operational-state read failed for org=${organizationId}; ` +
        `businessContextFreshness=unknown this run: ${String(err)}`,
    );
    return "unknown";
  }
}
```

- [ ] **Step 2.4: Run, verify green (including the four pre-existing tests, untouched)**

```bash
pnpm --filter @switchboard/ad-optimizer test -- revenue-state && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2.5: Eval byte-check (the type widening + default must change nothing)**

```bash
pnpm eval:riley > /tmp/slice4c-task2-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4c-baselines/eval-riley-baseline.txt /tmp/slice4c-task2-eval-riley.txt && echo "riley BYTE-UNCHANGED"
```

Expected: exit 0, diff empty.

- [ ] **Step 2.6: Commit**

```bash
git add packages/ad-optimizer/src/revenue-state.ts packages/ad-optimizer/src/revenue-state.test.ts
git commit -m "feat(ad-optimizer): business-context freshness derivation from operational-state (riley v3 slice 4c)"
```

---

## Task 3: AuditRunner + cron threading (post-abort read, abort-guard extended)

**Files:**

- Modify: `packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts`
- Modify: `packages/ad-optimizer/src/inngest-functions.ts`

- [ ] **Step 3.1: Extend the abort-guard test (failing first)**

In `packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts`:

First, add a partial PASSTHROUGH mock of the campaign-decision module so the new seam test can read the `RevenueState` that actually reaches the per-campaign decision (call-placement spies alone cannot prove the resolved freshness value is carried, only that the provider was called). `vi.fn` wraps the REAL implementation, so every existing test in this file is behaviorally unchanged. Directly after the existing imports, add:

```ts
import { decideForCampaign } from "../campaign-decision.js";

// Slice 4c: partial passthrough mock; the freshness seam test reads the
// RevenueState handed to the per-campaign decision. Wraps the REAL
// implementation, so all other tests in this file behave identically.
vi.mock("../campaign-decision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../campaign-decision.js")>();
  return { ...actual, decideForCampaign: vi.fn(actual.decideForCampaign) };
});
```

Then extend `buildSpiedDeps`'s return type and body; add an operational-state provider. Replace the function signature line and the `return` statement:

```ts
function buildSpiedDeps(): {
  deps: AuditDependencies;
  adsClient: AdsClientInterface;
  crmDataProvider: CrmDataProvider;
  insightsProvider: CampaignInsightsProvider;
  bookedValueProvider: BookedValueByCampaignProvider;
  operationalStateProvider: { getLatest: ReturnType<typeof vi.fn> };
} {
```

and directly above the `const config: AuditConfig = {` line, add:

```ts
const operationalStateProvider = {
  getLatest: vi.fn().mockResolvedValue({ confirmedAt: new Date("2026-03-25T00:00:00.000Z") }),
};
```

then include it in `deps` and the return:

```ts
  const deps: AuditDependencies = {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config,
    bookedValueByCampaignProvider: bookedValueProvider,
    operationalStateProvider,
  };
  return {
    deps,
    adsClient,
    crmDataProvider,
    insightsProvider,
    bookedValueProvider,
    operationalStateProvider,
  };
}
```

Then extend the three existing tests. In EACH of the Gate-0, signal-health-red, and happy-path tests, add `operationalStateProvider` to the `buildSpiedDeps()` destructuring:

```ts
const {
  deps,
  adsClient,
  crmDataProvider,
  insightsProvider,
  bookedValueProvider,
  operationalStateProvider,
} = buildSpiedDeps();
```

At the END of the Gate-0 test, add:

```ts
// Slice 4c: the operational-state read is a post-abort producer.
expect(operationalStateProvider.getLatest).not.toHaveBeenCalled();
```

At the END of the signal-health-red test, add:

```ts
// Slice 4c: skipped at this abort too (it sits with the late producers).
expect(operationalStateProvider.getLatest).not.toHaveBeenCalled();
```

At the END of the happy-path test, add:

```ts
// Slice 4c: read exactly once on the happy path, keyed by the org.
expect(operationalStateProvider.getLatest).toHaveBeenCalledTimes(1);
expect(operationalStateProvider.getLatest).toHaveBeenCalledWith("org-1");
```

Append two new tests inside the same describe (read-failure degradation, and the seam pin proving the resolved VALUE is carried, not just that the provider was called):

```ts
it("completes the audit with freshness degraded when the operational-state read fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { deps, operationalStateProvider } = buildSpiedDeps();
  operationalStateProvider.getLatest.mockRejectedValue(new Error("db down"));
  const runner = new AuditRunner(deps);

  const report = await runner.run(RANGE);

  // The weekly audit must not sink on an advisory read: report still produced.
  expect(report.accountId).toBe("act-123");
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it("threads the DERIVED freshness into the RevenueState the decision layer reads (seam pin)", async () => {
  const { deps, operationalStateProvider } = buildSpiedDeps();
  // Relative to the runner's real clock: 370 days old is unambiguously
  // past the 14-day vouch window. "stale" discriminates against BOTH
  // failure modes: a dropped value (would default "unknown") and a
  // hardcoded constant (would read "fresh"/"unknown").
  operationalStateProvider.getLatest.mockResolvedValue({
    confirmedAt: new Date(Date.now() - 370 * 24 * 60 * 60 * 1000),
  });
  const decideMock = vi.mocked(decideForCampaign);
  decideMock.mockClear();
  const runner = new AuditRunner(deps);

  await runner.run(RANGE);

  expect(decideMock).toHaveBeenCalledTimes(1);
  expect(decideMock.mock.calls[0]?.[0]?.revenueState.businessContextFreshness).toBe("stale");
});
```

- [ ] **Step 3.2: Run, verify the new assertions fail**

```bash
pnpm --filter @switchboard/ad-optimizer test -- audit-runner-abort-guard
```

Expected: FAIL; `operationalStateProvider` is not a known `AuditDependencies` property (typecheck) / `getLatest` never called on the happy path.

- [ ] **Step 3.3: Implement the AuditRunner dependency**

In `packages/ad-optimizer/src/audit-runner.ts`:

Extend the revenue-state import (line ~49):

```ts
import {
  assembleRevenueState,
  resolveBusinessContextFreshness,
  type RevenueState,
} from "./revenue-state.js";
```

Add after the `BookedValueByCampaignProvider` interface (~line 130):

```ts
/**
 * Slice-4c: latest operator operational-state confirmation (the 4a
 * substrate). Implementation is PrismaOperationalStateStore.getLatest in
 * @switchboard/db, injected at the app layer (ad-optimizer is Layer 2 and
 * cannot import db). Structural type: freshness needs only the anchor.
 */
export interface OperationalStateProvider {
  getLatest(organizationId: string): Promise<{ confirmedAt: Date } | null>;
}
```

In `AuditDependencies`, add after `recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;`:

```ts
  /** Optional (slice 4c). Feeds RevenueState.businessContextFreshness; read
   * POST-ABORT only. Absent ⇒ freshness stays "unknown" (back-compat: the
   * eval harness and analysis-only callers are unaffected). */
  operationalStateProvider?: OperationalStateProvider;
```

In the class fields, add after `private readonly recommendationHandoffSubmitter?: ...`:

```ts
  private readonly operationalStateProvider?: OperationalStateProvider;
```

In the constructor, add after `this.recommendationHandoffSubmitter = deps.recommendationHandoffSubmitter;`:

```ts
this.operationalStateProvider = deps.operationalStateProvider;
```

In `run()`, replace the `const revenueState: RevenueState = assembleRevenueState({` block (~line 436) with:

```ts
// Riley v3 slice 4c: freshness of the operator operational-state source,
// read POST-ABORT only (the Gate-0 and signal-red abort paths never touch
// it; pinned by the abort-guard test). Advisory CARRY: nothing gates on
// it in this slice; a read failure degrades to "unknown" inside the
// resolver rather than sinking the weekly audit.
const businessContextFreshness = await resolveBusinessContextFreshness(
  this.operationalStateProvider,
  this.config.orgId,
  new Date(),
);
const revenueState: RevenueState = assembleRevenueState({
  measurementTrusted,
  economicTier,
  effectiveTarget,
  marginBasis,
  businessContextFreshness,
  ...(coverageReport
    ? { coverage: { coveragePct: coverageReport.coveragePct, sufficient: true } }
    : {}),
  ...(signalHealthReport ? { signalHealthScore: signalHealthReport.score } : {}),
});
```

(The existing "Riley v3 slice 1: consolidate..." comment block above the call stays; the new comment sits below it, directly above the `resolveBusinessContextFreshness` call.)

- [ ] **Step 3.4: Thread the cron dependency**

In `packages/ad-optimizer/src/inngest-functions.ts`:

In `CronDependencies`, add after `recommendationHandoffSubmitter?: RecommendationHandoffSubmitter;`:

```ts
  /**
   * Optional (slice 4c). Latest operator operational-state confirmation per
   * org, feeding RevenueState.businessContextFreshness in the weekly audit.
   * Wired in apps/api/src/bootstrap/inngest.ts with
   * PrismaOperationalStateStore.getLatest; ad-optimizer (Layer 2) never
   * imports the store. Absent ⇒ freshness stays "unknown" (back-compat).
   */
  getLatestOperationalState?: (organizationId: string) => Promise<{ confirmedAt: Date } | null>;
```

In `executeWeeklyAudit`, inside the `new AuditRunner({...})` construction, add after the `recommendationHandoffSubmitter` spread:

```ts
        ...(deps.getLatestOperationalState
          ? { operationalStateProvider: { getLatest: deps.getLatestOperationalState } }
          : {}),
```

- [ ] **Step 3.5: Run the full ad-optimizer suite + typecheck, verify green**

```bash
pnpm --filter @switchboard/ad-optimizer test && pnpm typecheck
```

Expected: PASS (539 baseline + new abort-guard assertions + Task-2 additions; zero regressions; existing audit-runner tests construct runners WITHOUT the provider and remain unchanged).

- [ ] **Step 3.6: Eval byte-check**

```bash
pnpm eval:riley > /tmp/slice4c-task3-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4c-baselines/eval-riley-baseline.txt /tmp/slice4c-task3-eval-riley.txt && echo "riley BYTE-UNCHANGED"
```

Expected: exit 0, diff empty.

- [ ] **Step 3.7: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts \
        packages/ad-optimizer/src/inngest-functions.ts \
        packages/ad-optimizer/src/__tests__/audit-runner-abort-guard.test.ts
git commit -m "feat(ad-optimizer): wire operational-state freshness into the weekly audit (riley v3 slice 4c)"
```

---

## Task 4: Window-overlap stability derivation (`packages/core`, pure)

**Files:**

- Create: `packages/core/src/recommendations/__tests__/operational-stability.test.ts`
- Create: `packages/core/src/recommendations/operational-stability.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `packages/core/src/recommendations/__tests__/operational-stability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveBusinessContextStability } from "../operational-stability.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";

// Window under test: [June 1 .. June 15] (a 14-day full attribution window).
const WINDOW_START = new Date("2026-06-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-06-15T00:00:00.000Z");

/** Operator confirmed every dimension non-disruptive ([] = "confirmed none" is a POSITIVE signal). */
const FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let seq = 0;
function confirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  seq += 1;
  return {
    id: `osc_${seq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

function derive(confirmations: OperationalStateConfirmation[]) {
  return deriveBusinessContextStability({
    confirmations,
    windowStartedAt: WINDOW_START,
    windowEndedAt: WINDOW_END,
  });
}

describe("deriveBusinessContextStability: honest absence", () => {
  it("returns unknown for an empty confirmation set (legacy orgs; never fabricated)", () => {
    expect(derive([])).toBe("unknown");
  });

  it("returns unknown when only in-window confirmations exist (the window opened ungoverned)", () => {
    expect(derive([confirm("2026-06-03T10:00:00.000Z", FULL_NORMAL)])).toBe("unknown");
  });
});

describe("deriveBusinessContextStability: affirmative stability (the governing-row-before-window case)", () => {
  it("certifies stable from a fresh, complete, non-disruptive governing row", () => {
    // Governing row 4 days before window entry, all five dimensions confirmed.
    expect(derive([confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("certifies stable at exactly the vouch boundary (14 days at window entry)", () => {
    expect(derive([confirm("2026-05-18T00:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("degrades to unknown just past the vouch boundary (stale governing row cannot certify)", () => {
    expect(derive([confirm("2026-05-17T23:59:59.999Z", FULL_NORMAL)])).toBe("unknown");
  });

  it("treats a governing row confirmed exactly at windowStart as governing (store lte contract)", () => {
    expect(derive([confirm("2026-06-01T00:00:00.000Z", FULL_NORMAL)])).toBe("stable");
  });

  it("returns unknown when the governing row leaves a dimension unconfirmed (silence must not vouch)", () => {
    const partial: OperationalState = {
      operatingStatus: "open",
      staffing: "normal",
      inventory: "normal",
      promoWindows: [],
      // closures: ABSENT; never confirmed, distinct from [] "confirmed none"
    };
    expect(derive([confirm("2026-05-28T09:00:00.000Z", partial)])).toBe("unknown");
  });

  it("stays stable when an identical re-confirm lands mid-window (the 4b 'everything still accurate' flow is not a transition)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: mid-window regime changes (the mid-window-change case)", () => {
  it("flags a scalar flip mid-window (normal → shortfall)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("flags a recovery mid-window too (shortfall → normal is also a transition)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
        confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL),
      ]),
    ).toBe("unstable");
  });

  it("flags a disrupted scalar first confirmed mid-window with no prior knowledge (onset unknowable + disruption evidence)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", { operatingStatus: "open", promoWindows: [] }),
        confirm("2026-06-05T09:00:00.000Z", { inventory: "outage" }),
      ]),
    ).toBe("unstable");
  });

  it("does NOT flag a normal value first confirmed mid-window, but cannot certify either (incomplete governing)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          operatingStatus: "open",
          promoWindows: [],
          closures: [],
          inventory: "normal",
        }),
        confirm("2026-06-05T09:00:00.000Z", { staffing: "normal" }),
      ]),
    ).toBe("unknown");
  });

  it("flags an in-window disruption even when the governing row is stale (disruption evidence does not expire)", () => {
    expect(
      derive([
        confirm("2026-04-01T09:00:00.000Z", FULL_NORMAL), // stale governing
        confirm("2026-06-05T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" }),
      ]),
    ).toBe("unstable");
  });

  it("flags an in-window disruption with no governing row at all", () => {
    expect(
      derive([confirm("2026-06-05T09:00:00.000Z", { operatingStatus: "temporarily_closed" })]),
    ).toBe("unstable");
  });
});

describe("deriveBusinessContextStability: constant context differences out", () => {
  it("certifies stable under a CONSTANT staffing shortfall (a stably-degraded context does not confound a delta)", () => {
    expect(
      derive([confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" })]),
    ).toBe("stable");
  });

  it("certifies stable under a constant inventory outage", () => {
    expect(
      derive([confirm("2026-05-28T09:00:00.000Z", { ...FULL_NORMAL, inventory: "outage" })]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: closure carve-out (constancy does not rescue a closed business)", () => {
  it("flags temporarily_closed governing the window even when constant", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          operatingStatus: "temporarily_closed",
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags a closure interval overlapping the window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-06-03T00:00:00.000Z", end: "2026-06-06T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags an open-ended closure starting before the window (until further notice)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-05-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("ignores a closure interval entirely outside the window (operator-declared bounds carry their own dates)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a closure starting exactly at windowEnd (half-open window; that instant is never measured)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          closures: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: promo comparability", () => {
  it("flags a promo starting mid-window (partial overlap breaks pre/post comparability)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-06-08T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("flags a promo ending mid-window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-08T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("certifies stable when a promo RUNS THROUGHOUT the entire window (constant background)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("certifies stable when a declared promo lies entirely outside the window", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-07-01T00:00:00.000Z", end: "2026-07-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("flags a mid-window change to the window-overlapping promo set (a covering promo appearing where none was declared)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL), // promoWindows: []; confirmed none
        confirm("2026-06-05T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-20T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("unstable");
  });

  it("does not flag a mid-window declaration of an out-of-window promo (overlapping subset unchanged)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL),
        confirm("2026-06-05T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-07-01T00:00:00.000Z", end: "2026-07-10T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: half-open boundary edges (the measured span is [windowStart, windowEnd))", () => {
  it("ignores a promo starting exactly at windowEnd (that instant is never measured)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-06-15T00:00:00.000Z", end: "2026-06-25T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("ignores a promo ending exactly at windowStart (half-open interval excludes its own end)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-20T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });

  it("certifies stable when a covering promo ends exactly at windowEnd (covers every measured instant)", () => {
    expect(
      derive([
        confirm("2026-05-28T09:00:00.000Z", {
          ...FULL_NORMAL,
          promoWindows: [{ start: "2026-05-25T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" }],
        }),
      ]),
    ).toBe("stable");
  });
});

describe("deriveBusinessContextStability: order independence (defensive sort)", () => {
  it("derives the same verdicts from a shuffled confirmation set (sorted by confirmedAt, createdAt, id internally)", () => {
    const governing = confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
    const reconfirm = confirm("2026-06-05T09:00:00.000Z", FULL_NORMAL);
    const flip = confirm("2026-06-08T09:00:00.000Z", { ...FULL_NORMAL, staffing: "shortfall" });
    // Governing row passed LAST both times: positional assumptions would
    // misidentify it and mis-walk the transitions.
    expect(derive([reconfirm, governing])).toBe("stable");
    expect(derive([flip, reconfirm, governing])).toBe("unstable");
  });

  it("selects the LATEST governing row when multiple pre-window rows arrive unsorted (the discriminating case)", () => {
    // The store contract returns at most ONE at-or-before row, so this input
    // is contract-violating by construction; the derivation must still pick
    // the regime that actually governed window entry. The May-20 closure was
    // superseded May 28, entirely before the window: it must not disrupt.
    const superseded = confirm("2026-05-20T09:00:00.000Z", {
      ...FULL_NORMAL,
      operatingStatus: "temporarily_closed",
    });
    const governing = confirm("2026-05-28T09:00:00.000Z", FULL_NORMAL);
    // Reverse order: positional .at(-1) without the sort would pick the
    // superseded closed row and falsely report unstable.
    expect(derive([governing, superseded])).toBe("stable");
  });
});
```

- [ ] **Step 4.2: Run, verify it fails on the missing module**

```bash
pnpm --filter @switchboard/core test -- operational-stability
```

Expected: FAIL with `Cannot find module '../operational-stability.js'`.

- [ ] **Step 4.3: Implement the derivation**

Create `packages/core/src/recommendations/operational-stability.ts`:

```ts
import {
  OPERATIONAL_STATE_VOUCH_MS,
  type OperationalInterval,
  type OperationalState,
  type OperationalStateConfirmation,
} from "@switchboard/schemas";
import type { BusinessContextStability } from "./outcome-attribution-types.js";

/**
 * Derive businessContextStable for a PAST attribution window from the
 * operator operational-state confirmations overlapping it (Riley v3 slice
 * 4c; spec sections 2.5 and 7.4).
 *
 * Input contract (the 4a store's getConfirmationsOverlappingWindow): the
 * latest confirmation at-or-before windowStart (the regime governing entry,
 * at most one) plus every confirmation inside (windowStart, windowEnd],
 * oldest first, ties by (confirmedAt, createdAt, id). The derivation
 * re-sorts defensively by the same triple, so its verdict is independent of
 * caller ordering. Malformed rows were already degraded to absence by the
 * store with a warning; nothing here resurrects them. The window spans BOTH
 * attribution sub-windows (anchorAt ± windowDays) and is HALF-OPEN
 * [windowStartedAt, windowEndedAt): the engine's Meta window queries are
 * endExclusive at postEnd, so the verdict covers exactly the measured
 * pre/post span.
 *
 * The verdict applies the DIFFERENCING principle: a pre/post delta is
 * comparable when the context did not CHANGE across the window. A condition
 * constant across the whole window (a promo running throughout, a staffing
 * shortfall in force the entire time) differences out; a condition that
 * starts, ends, or flips inside the window confounds the delta. The one
 * carve-out is closure: a temporarily_closed regime or a closure interval
 * overlapping any part of the window voids the result outright (spec 2.5:
 * "stable enough for the result to mean anything"; a closed business
 * transacts nothing, so constancy does not rescue comparability).
 *
 * Output:
 * - "unstable": affirmative disruption evidence (closure overlap,
 *   temporarily_closed in force, a promo partially overlapping the window,
 *   a scalar value flipping mid-window, the window-overlapping subset of a
 *   declared interval list changing mid-window, or a disrupted scalar first
 *   confirmed mid-window with no prior knowledge). Disruption evidence is
 *   exempt from the vouch window; evidence does not expire the way an
 *   attestation of normalcy does.
 * - "stable": an affirmative certification requiring a governing row that
 *   is fresh at window entry (windowStart - confirmedAt <=
 *   OPERATIONAL_STATE_VOUCH_MS), confirms ALL FIVE operational dimensions
 *   (an unconfirmed dimension is "operator never said" and silence must not
 *   vouch; explicit [] = "confirmed none" is a POSITIVE signal and counts),
 *   and no disruption per the rules above.
 * - "unknown": everything else, meaning an empty set, no governing row, a
 *   stale governing row, or unconfirmed dimensions (honest absence; never a
 *   fabricated "stable").
 */
export interface DeriveBusinessContextStabilityInput {
  /** Confirmations overlapping the window (governing + in-window, oldest first). */
  confirmations: OperationalStateConfirmation[];
  windowStartedAt: Date;
  windowEndedAt: Date;
}

type ScalarDimension = "operatingStatus" | "staffing" | "inventory";
const SCALAR_DIMENSIONS: readonly ScalarDimension[] = ["operatingStatus", "staffing", "inventory"];

/** Scalar values that are themselves disruption evidence when first seen mid-window. */
const DISRUPTED_SCALAR_VALUES: ReadonlySet<string> = new Set([
  "temporarily_closed",
  "shortfall",
  "outage",
]);

type IntervalDimension = "promoWindows" | "closures";
const INTERVAL_DIMENSIONS: readonly IntervalDimension[] = ["promoWindows", "closures"];

function intervalBoundsMs(interval: OperationalInterval): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(interval.start),
    // Open-ended ("until further notice") runs forever. Bounds are half-open
    // [start, end) per the 4b editor's org-timezone day-boundary conversion.
    endMs: interval.end !== undefined ? Date.parse(interval.end) : Number.POSITIVE_INFINITY,
  };
}

function overlapsWindow(interval: OperationalInterval, wsMs: number, weMs: number): boolean {
  const { startMs, endMs } = intervalBoundsMs(interval);
  // Both sides are half-open: intervals are [start, end) (the 4b day-boundary
  // conversion) and the window is [windowStartedAt, windowEndedAt) (the
  // engine's Meta window queries are endExclusive at postEnd, so the instant
  // windowEndedAt is never measured). Therefore an interval starting exactly
  // at windowEnd does not overlap, and one ending exactly at windowStart
  // does not either.
  return startMs < weMs && endMs > wsMs;
}

function coversWindow(interval: OperationalInterval, wsMs: number, weMs: number): boolean {
  const { startMs, endMs } = intervalBoundsMs(interval);
  // Covers every MEASURED instant of the half-open window: an interval
  // ending exactly at windowEnd still covers through the last measured
  // instant, so end >= windowEnd suffices (not strictly greater).
  return startMs <= wsMs && endMs >= weMs;
}

/**
 * Stable serialization of the WINDOW-OVERLAPPING subset of a declared
 * interval list. Used to detect mid-window declaration changes while
 * ignoring out-of-window intervals (announcing a future promo mid-window is
 * not a regime change inside this window) and tolerating identical
 * re-confirms (the 4b "everything still accurate" flow).
 */
function overlappingSubsetKey(
  intervals: OperationalInterval[],
  wsMs: number,
  weMs: number,
): string {
  return intervals
    .filter((interval) => overlapsWindow(interval, wsMs, weMs))
    .map((interval) => `${interval.start}|${interval.end ?? "open"}`)
    .sort()
    .join(",");
}

export function deriveBusinessContextStability(
  input: DeriveBusinessContextStabilityInput,
): BusinessContextStability {
  const { confirmations, windowStartedAt, windowEndedAt } = input;
  if (confirmations.length === 0) return "unknown";

  const wsMs = windowStartedAt.getTime();
  const weMs = windowEndedAt.getTime();

  // Sort defensively by the 4a tie-break triple (confirmedAt, createdAt, id)
  // instead of trusting caller order: governing-row selection and the
  // transition walk below are order-sensitive, and this is a pure exported
  // unit whose correctness must not depend on the store contract having been
  // honored upstream. Contract-shaped input is already sorted, so this is a
  // no-op there (pinned by the order-independence test).
  const sorted = [...confirmations].sort(
    (a, b) =>
      a.confirmedAt.getTime() - b.confirmedAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Partition by confirmedAt, not array position: the governing row may be
  // absent entirely (org first confirmed mid-window). Bucketing follows the
  // STORE contract (governing at-or-before windowStart; in-window rows in
  // (windowStart, windowEnd]), which governs which ROWS are candidates;
  // interval geometry against the measured half-open span lives in the
  // helpers above.
  const atOrBefore = sorted.filter((c) => c.confirmedAt.getTime() <= wsMs);
  const governing = atOrBefore.at(-1) ?? null;
  const inWindow = sorted.filter((c) => {
    const t = c.confirmedAt.getTime();
    return t > wsMs && t <= weMs;
  });
  const ordered = [...(governing ? [governing] : []), ...inWindow];

  let disrupted = false;

  for (const c of ordered) {
    // 1. Closure carve-out. Every row in the set has derived validity
    //    overlapping the window (the store contract), so any
    //    temporarily_closed declaration was in force over part of it; a
    //    closure interval is checked against its own operator-declared
    //    bounds (it may lie entirely outside the window).
    if (c.state.operatingStatus === "temporarily_closed") disrupted = true;
    for (const closure of c.state.closures ?? []) {
      if (overlapsWindow(closure, wsMs, weMs)) disrupted = true;
    }
    // 2. Promo comparability: overlapping the window is fine ONLY when the
    //    promo covers the ENTIRE window (running throughout pre and post);
    //    starting or ending inside it breaks the delta.
    for (const promo of c.state.promoWindows ?? []) {
      if (overlapsWindow(promo, wsMs, weMs) && !coversWindow(promo, wsMs, weMs)) {
        disrupted = true;
      }
    }
  }

  // 3. Mid-window regime changes. Walk declarations in order; a dimension
  //    declared with a DIFFERENT value than its previous declaration flipped
  //    mid-window (re-confirming the same value is NOT a change). A
  //    disrupted scalar first declared by an in-window row with no prior
  //    declaration is disruption evidence whose onset is unknowable.
  const lastScalar: Partial<Record<ScalarDimension, string>> = {};
  const lastIntervalKey: Partial<Record<IntervalDimension, string>> = {};
  for (const c of ordered) {
    const isInWindowRow = c.confirmedAt.getTime() > wsMs;
    for (const dim of SCALAR_DIMENSIONS) {
      const value = c.state[dim];
      if (value === undefined) continue;
      const prior = lastScalar[dim];
      if (isInWindowRow) {
        if (prior !== undefined && prior !== value) disrupted = true;
        if (prior === undefined && DISRUPTED_SCALAR_VALUES.has(value)) disrupted = true;
      }
      lastScalar[dim] = value;
    }
    for (const dim of INTERVAL_DIMENSIONS) {
      const list = c.state[dim];
      if (list === undefined) continue;
      const key = overlappingSubsetKey(list, wsMs, weMs);
      const prior = lastIntervalKey[dim];
      if (isInWindowRow && prior !== undefined && prior !== key) disrupted = true;
      lastIntervalKey[dim] = key;
    }
  }

  if (disrupted) return "unstable";

  // 4. Affirmative certification: the window must have OPENED under fresh,
  //    complete, confirmed knowledge. No governing row (the window's start
  //    is uncovered), a stale governing row, or unconfirmed dimensions leave
  //    the verdict "unknown": honest absence, never fabricated stability.
  if (!governing) return "unknown";
  if (wsMs - governing.confirmedAt.getTime() > OPERATIONAL_STATE_VOUCH_MS) return "unknown";
  const state: OperationalState = governing.state;
  const allDimensionsConfirmed =
    state.operatingStatus !== undefined &&
    state.staffing !== undefined &&
    state.inventory !== undefined &&
    state.promoWindows !== undefined &&
    state.closures !== undefined;
  if (!allDimensionsConfirmed) return "unknown";

  return "stable";
}
```

- [ ] **Step 4.4: Run, verify green**

```bash
pnpm --filter @switchboard/core test -- operational-stability && pnpm typecheck
```

Expected: PASS (all ~23 new tests).

- [ ] **Step 4.5: Commit**

```bash
git add packages/core/src/recommendations/operational-stability.ts \
        packages/core/src/recommendations/__tests__/operational-stability.test.ts
git commit -m "feat(core): window-overlap business-context stability derivation (riley v3 slice 4c)"
```

---

## Task 5: Engine + orchestrator consumption (the deliberate test flips)

**Files:**

- Modify: `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution-types.ts`
- Modify: `packages/core/src/recommendations/outcome-attribution.ts`

- [ ] **Step 5.1: Flip the constant-unknown pin DELIBERATELY and add the failing 4c tests**

In `packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`:

Extend the type imports at the top of the file:

```ts
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  MetaInsightsProvider,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  WindowMetrics,
} from "../outcome-attribution-types.js";
import type { OperationalState, OperationalStateConfirmation } from "@switchboard/schemas";
```

REPLACE the test `"records businessContextStable as unknown on every row across kinds and window states (slice-4 gate, never fabricated)"` (inside the slice-3 enrichments describe) with the following. This is the deliberate flip of the slice-3 constant pin into the 4c honest-absence pin:

```ts
it("records businessContextStable as unknown when no operational-state source is wired (honest absence)", () => {
  const kinds = ["pause", "refresh_creative"] as const;
  for (const actionKind of kinds) {
    const candidate: AttributableRecommendation = { ...REC, actionKind };
    const clean = attributeOneRecommendation({
      candidate,
      preWindow: w(10000, 0.02, 14),
      postWindow: w(800, 0.024, 14),
      overlaps: [],
    });
    const contaminated = attributeOneRecommendation({
      candidate,
      preWindow: null,
      postWindow: null,
      overlaps: [{ id: "rec-2", actionKind }],
    });
    // Reader wired but zero confirmations for the window = same honest unknown.
    const emptySet = attributeOneRecommendation({
      candidate,
      preWindow: w(10000, 0.02, 14),
      postWindow: w(800, 0.024, 14),
      overlaps: [],
      operationalStateConfirmations: [],
    });
    expect(clean.businessContextStable, `${actionKind} clean`).toBe("unknown");
    expect(contaminated.businessContextStable, `${actionKind} contaminated`).toBe("unknown");
    expect(emptySet.businessContextStable, `${actionKind} empty set`).toBe("unknown");
  }
});
```

Append a new describe block at the end of the file. The REC pause window is `2026-04-24T12:00Z .. 2026-05-08T12:00Z` (anchor 2026-05-01T12:00Z ± 7d), so the fixtures anchor to those dates:

```ts
// ---------------------------------------------------------------------------
// Slice 4c: businessContextStable from operational-state confirmations
// overlapping the full attribution window, and the trustDelta demotion.
// REC (pause) window: 2026-04-24T12:00Z .. 2026-05-08T12:00Z.
// ---------------------------------------------------------------------------
const OS_FULL_NORMAL: OperationalState = {
  operatingStatus: "open",
  staffing: "normal",
  inventory: "normal",
  promoWindows: [],
  closures: [],
};

let osSeq = 0;
function osConfirm(confirmedAt: string, state: OperationalState): OperationalStateConfirmation {
  osSeq += 1;
  return {
    id: `osc_${osSeq}`,
    organizationId: "org-1",
    state,
    confirmedBy: null,
    confirmedAt: new Date(confirmedAt),
    createdAt: new Date(confirmedAt),
  };
}

describe("attributeOneRecommendation: slice-4c stability consumption", () => {
  it("records stable from a fresh, complete, non-disruptive governing confirmation; trust signal unchanged", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL)],
    });
    expect(row.businessContextStable).toBe("stable");
    expect(row.causalStrength).toBe("directional");
    expect(row.trustDelta).toBe("up");
  });

  it("records unstable on a mid-window regime change and demotes trustDelta to none (a confounded outcome claims no trust signal)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: w(10000, 0.02),
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [
        osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL),
        osConfirm("2026-05-02T09:00:00.000Z", { ...OS_FULL_NORMAL, staffing: "shortfall" }),
      ],
    });
    expect(row.businessContextStable).toBe("unstable");
    // The factual outcome line still renders; only the trust claim is suppressed.
    expect(row.causalStrength).toBe("directional");
    expect(row.cockpitRenderable).toBe(true);
    expect(row.copyTemplate).toBe("pause.spend.fell");
    expect(row.trustDelta).toBe("none");
  });

  it("keeps causalStrength and stability orthogonal (flagged window + unstable context)", () => {
    const row = attributeOneRecommendation({
      candidate: REC,
      preWindow: null,
      postWindow: w(800, 0.02),
      overlaps: [],
      operationalStateConfirmations: [
        osConfirm("2026-04-26T09:00:00.000Z", {
          ...OS_FULL_NORMAL,
          operatingStatus: "temporarily_closed",
        }),
      ],
    });
    expect(row.causalStrength).toBe("inconclusive");
    expect(row.businessContextStable).toBe("unstable");
    expect(row.trustDelta).toBe("none");
  });
});
```

EXTEND the existing `"never emits corroborated (reserved for the slice-4 corroboration signal)"` sweep test: the deferral keeps it intact and STRENGTHENS it. Replace its `fixtures` array with:

```ts
const stableSet = [osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL)];
const unstableSet = [
  osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL),
  osConfirm("2026-05-02T09:00:00.000Z", { ...OS_FULL_NORMAL, inventory: "outage" }),
];
const fixtures = [
  { preWindow: w(10000, 0.02), postWindow: w(800, 0.02), overlaps: [] },
  { preWindow: w(10000, 0.02), postWindow: w(11000, 0.02), overlaps: [] },
  { preWindow: null, postWindow: w(800, 0.02), overlaps: [] },
  { preWindow: w(0, 0.02), postWindow: w(800, 0.02), overlaps: [] },
  { preWindow: w(10000, 0.02), postWindow: w(9700, 0.02), overlaps: [] },
  {
    preWindow: w(10000, 0.02),
    postWindow: w(800, 0.02),
    overlaps: [{ id: "rec-2", actionKind: "pause" as const }],
  },
  // Slice 4c: the corroborated honesty floor holds WITH operational-state
  // confirmations present too; a stable window is still not an
  // independent second estimate (Decision F defers the CRM/booking arm).
  {
    preWindow: w(10000, 0.02),
    postWindow: w(800, 0.02),
    overlaps: [],
    operationalStateConfirmations: stableSet,
  },
  {
    preWindow: w(10000, 0.02),
    postWindow: w(800, 0.02),
    overlaps: [],
    operationalStateConfirmations: unstableSet,
  },
];
```

(its assertion loop stays exactly as is: `expect(["directional", "inconclusive"]).toContain(row.causalStrength);`).

Note: the `stableSet`/`unstableSet` constants are declared INSIDE that test, above the fixtures array.

Append a second new describe for the orchestrator threading:

```ts
describe("runRileyOutcomeAttribution: operational-state reader threading (slice 4c)", () => {
  function makeOrchestratorDeps(candidates: AttributableRecommendation[]) {
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
        .mockResolvedValueOnce(w(10000, 0.02))
        .mockResolvedValueOnce(w(800, 0.02)),
    };
    return { recommendationStore, outcomeStore, insightsProvider, inserted };
  }

  it("queries the reader with the FULL attribution window and threads the verdict into the inserted row", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeOrchestratorDeps([
      REC,
    ]);
    const reader = {
      getConfirmationsOverlappingWindow: vi
        .fn()
        .mockResolvedValue([osConfirm("2026-04-20T09:00:00.000Z", OS_FULL_NORMAL)]),
    };

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      operationalStateReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    // The read is the 4a contract verbatim: (org, windowStartedAt, windowEndedAt),
    // the full pre+post span (anchor ± windowDays).
    expect(reader.getConfirmationsOverlappingWindow).toHaveBeenCalledWith(
      "org-1",
      new Date("2026-04-24T12:00:00Z"),
      new Date("2026-05-08T12:00:00Z"),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.businessContextStable).toBe("stable");
  });

  it("records unknown when no reader is wired (back-compat, honest absence)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider, inserted } = makeOrchestratorDeps([
      REC,
    ]);

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.businessContextStable).toBe("unknown");
  });

  it("propagates reader failures so Inngest retries (insert-once rows must not freeze a transient blip as permanent unknown)", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeOrchestratorDeps([REC]);
    const reader = {
      getConfirmationsOverlappingWindow: vi.fn().mockRejectedValue(new Error("db blip")),
    };

    await expect(
      runRileyOutcomeAttribution({
        recommendationStore,
        insightsProvider,
        outcomeStore,
        operationalStateReader: reader,
        orgId: "org-1",
        now: new Date("2026-05-10T12:00:00Z"),
      }),
    ).rejects.toThrow("db blip");
    expect(outcomeStore.insert).not.toHaveBeenCalled();
  });

  it("does not read confirmations for candidates skipped by the idempotency pre-check", async () => {
    const { recommendationStore, outcomeStore, insightsProvider } = makeOrchestratorDeps([REC]);
    (outcomeStore.existsByRecommendationId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const reader = { getConfirmationsOverlappingWindow: vi.fn() };

    await runRileyOutcomeAttribution({
      recommendationStore,
      insightsProvider,
      outcomeStore,
      operationalStateReader: reader,
      orgId: "org-1",
      now: new Date("2026-05-10T12:00:00Z"),
    });

    expect(reader.getConfirmationsOverlappingWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run, verify the new/flipped tests fail**

```bash
pnpm --filter @switchboard/core test -- outcome-attribution
```

Expected: FAIL; `operationalStateConfirmations` is not a known property of `AttributeOneInput` (typecheck) and `operationalStateReader` not a known property of the orchestrator input.

- [ ] **Step 5.3: Extend the types**

In `packages/core/src/recommendations/outcome-attribution-types.ts`:

Add the schemas import at the top (first schemas import in this file):

```ts
import type { OperationalStateConfirmation } from "@switchboard/schemas";
```

Add after the `MetaInsightsProvider` interface:

```ts
/**
 * Slice-4c: the 4a store's window read. Implementation is
 * PrismaOperationalStateStore in @switchboard/db, injected at the app layer
 * (core is Layer 3 and cannot import db). Contract: the latest confirmation
 * at-or-before windowStart (the governing regime) plus every confirmation in
 * (windowStart, windowEnd], oldest first; [] = honest unknown.
 */
export interface OperationalStateReader {
  getConfirmationsOverlappingWindow(
    organizationId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OperationalStateConfirmation[]>;
}
```

- [ ] **Step 5.4: Implement engine + orchestrator consumption**

In `packages/core/src/recommendations/outcome-attribution.ts`:

Extend the imports:

```ts
import { KIND_CONFIG, type AttributableKind } from "./outcome-attribution-config.js";
import { deriveBusinessContextStability } from "./operational-stability.js";
import type { OperationalStateConfirmation } from "@switchboard/schemas";
import type {
  AttributableRecommendation,
  AttributableRecommendationStore,
  BusinessContextStability,
  CausalStrength,
  MetaInsightsProvider,
  OperationalStateReader,
  RecommendationOutcomeStore,
  RileyOutcomeRow,
  TrustDelta,
  VisibilityFlag,
  WindowMetrics,
} from "./outcome-attribution-types.js";
```

Extend `AttributeOneInput`:

```ts
export interface AttributeOneInput {
  candidate: AttributableRecommendation;
  preWindow: WindowMetrics | null;
  postWindow: WindowMetrics | null;
  overlaps: { id: string; actionKind: AttributableKind }[];
  /**
   * Slice-4c: operator operational-state confirmations overlapping the FULL
   * attribution window (the getConfirmationsOverlappingWindow contract:
   * governing + in-window, oldest first). undefined = no source wired; [] =
   * source wired, zero confirmations. Both derive "unknown" (honest absence).
   */
  operationalStateConfirmations?: OperationalStateConfirmation[];
}
```

In `attributeOneRecommendation`, replace the two slice-3 enrichment lines

```ts
// Always "unknown" until the slice-4 operational-state source exists.
const businessContextStable: BusinessContextStability = "unknown";
```

with:

```ts
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

In the renderable block, replace the existing two-line noise-floor comment AND the `trustDelta = isFavorable ? "up" : "down";` assignment together with:

```ts
// The noise floor guarantees |deltaPct| >= noiseFloorPct on a clean row,
// so a directional outcome always has a definite direction. Slice 4c: an
// outcome whose window the business context disrupted must not claim a
// trust signal; the delta is real but its causal reading is confounded
// (spec 2.5: "stable enough for the result to mean anything"). "unknown"
// context preserves the slice-3 behavior (no operator source, no demotion).
trustDelta = businessContextStable === "unstable" ? "none" : isFavorable ? "up" : "down";
```

In `RunRileyOutcomeAttributionInput`, add after `outcomeStore: RecommendationOutcomeStore;`:

```ts
  /**
   * Optional (slice 4c). The 4a operational-state window read; absent ⇒
   * every row records businessContextStable "unknown" (honest absence).
   */
  operationalStateReader?: OperationalStateReader;
```

In `runRileyOutcomeAttribution`, update the destructuring line:

```ts
const { recommendationStore, insightsProvider, outcomeStore, operationalStateReader, orgId, now } =
  input;
```

and inside the candidate loop, directly after the `findOverlapsForCampaign` call (and BEFORE the Meta `Promise.all`), add:

```ts
// Slice 4c: operational-state confirmations overlapping the FULL
// attribution window; fetched BEFORE the quota-bearing Meta calls (cheap
// indexed DB read first). A read failure PROPAGATES like every other
// provider error here: outcome rows are insert-once, so writing "unknown"
// on a transient blip would freeze it forever; the Inngest retry derives
// it right instead.
const operationalStateConfirmations = operationalStateReader
  ? await operationalStateReader.getConfirmationsOverlappingWindow(orgId, preStart, postEnd)
  : undefined;
```

and extend the `attributeOneRecommendation` call:

```ts
const row = attributeOneRecommendation({
  candidate,
  preWindow,
  postWindow,
  overlaps,
  ...(operationalStateConfirmations !== undefined ? { operationalStateConfirmations } : {}),
});
```

(`preStart`/`postEnd` are the existing locals computed above the overlap query; they equal the engine's `windowStartedAt`/`windowEndedAt` by construction, since both sides compute `anchorAt - windowDays` and `anchorAt + windowDays`.)

- [ ] **Step 5.5: Run core tests + typecheck, verify green**

```bash
pnpm --filter @switchboard/core test && pnpm typecheck
```

Expected: PASS (3806 baseline + ~30 new/extended; every other slice-3 test (trustDelta up/down, legacy copy, etc.) is unchanged because the no-confirmations input preserves "unknown" and no demotion fires).

- [ ] **Step 5.6: Eval byte-check (outcome path has no eval contact; prove it anyway)**

```bash
pnpm eval:riley > /tmp/slice4c-task5-eval-riley.txt 2>&1; echo "exit: $?"
diff /tmp/slice4c-baselines/eval-riley-baseline.txt /tmp/slice4c-task5-eval-riley.txt && echo "riley BYTE-UNCHANGED"
pnpm eval:governance > /tmp/slice4c-task5-eval-gov.txt 2>&1; echo "exit: $?"
diff /tmp/slice4c-baselines/eval-governance-baseline.txt /tmp/slice4c-task5-eval-gov.txt && echo "governance BYTE-UNCHANGED"
```

Expected: both exit 0, both diffs empty.

- [ ] **Step 5.7: Commit**

```bash
git add packages/core/src/recommendations/outcome-attribution-types.ts \
        packages/core/src/recommendations/outcome-attribution.ts \
        packages/core/src/recommendations/__tests__/outcome-attribution.test.ts
git commit -m "feat(core): consume operational-state confirmations for business-context stability (riley v3 slice 4c)"
```

---

## Task 6: App-layer DI wiring (`apps/api`)

**Files:**

- Modify: `apps/api/src/services/cron/riley-outcome-attribution.ts`
- Modify: `apps/api/src/bootstrap/inngest.ts`

- [ ] **Step 6.1: Extend the orchestrator binding**

In `apps/api/src/services/cron/riley-outcome-attribution.ts`:

Extend the core type import:

```ts
import {
  makeOnFailureHandler,
  runRileyOutcomeAttribution,
  type AsyncFailureContext,
  type AttributableRecommendationStore,
  type MetaInsightsProvider,
  type OperationalStateReader,
  type RecommendationOutcomeStore,
  type RileyOutcomeRunSummary,
} from "@switchboard/core";
```

In `BindRileyOutcomeOrchestratorDeps`, add after `outcomeStore: RecommendationOutcomeStore;`:

```ts
  /** Slice 4c: the 4a operational-state window read (PrismaOperationalStateStore).
   * Absent ⇒ every outcome row records businessContextStable "unknown". */
  operationalStateReader?: OperationalStateReader;
```

In `bindRileyOutcomeOrchestrator`, extend the `runRileyOutcomeAttribution` call:

```ts
export function bindRileyOutcomeOrchestrator(deps: BindRileyOutcomeOrchestratorDeps) {
  return (args: { orgId: string; now: Date }) =>
    runRileyOutcomeAttribution({
      recommendationStore: deps.recommendationStore,
      insightsProvider: deps.createInsightsProvider(args.orgId),
      outcomeStore: deps.outcomeStore,
      ...(deps.operationalStateReader
        ? { operationalStateReader: deps.operationalStateReader }
        : {}),
      orgId: args.orgId,
      now: args.now,
    });
}
```

Note: `OperationalStateReader` must be exported from core's package surface. In `packages/core/src/recommendations/index.ts`, extend the existing `export type {...} from "./outcome-attribution-types.js";` list with `OperationalStateReader,` (one line, after `MetaInsightsProvider,`). Verify `packages/core/src/index.ts` re-exports `./recommendations/index.js` (it does; `makeOnFailureHandler` and `RileyOutcomeRunSummary` already flow through it).

- [ ] **Step 6.2: Wire the store at bootstrap**

In `apps/api/src/bootstrap/inngest.ts`:

Add `PrismaOperationalStateStore,` to the `@switchboard/db` import list (after `PrismaBusinessFactsStore,`, ~line 32).

Directly after the existing store constructions at ~line 254-255 (`recommendationOutcomeStore` / `attributableRecommendationStore`), add:

```ts
// Riley v3 slice 4c: operational-state reads (the 4a substrate; first and
// only app-layer construction of this store). One store, two injection
// points: getLatest feeds RevenueState.businessContextFreshness in the
// weekly audit; the window read feeds businessContextStable in the
// outcome-attribution worker. Read-only; Riley stays advisory.
const operationalStateStore = new PrismaOperationalStateStore(app.prisma);
```

In `adOptimizerDeps` (the `CronDependencies` literal at ~line 309), add after `recommendationHandoffSubmitter,`:

```ts
    getLatestOperationalState: (organizationId) => operationalStateStore.getLatest(organizationId),
```

In the `bindRileyOutcomeOrchestrator({...})` call (~line 860), add after `outcomeStore: recommendationOutcomeStore,`:

```ts
      operationalStateReader: operationalStateStore,
```

(`PrismaOperationalStateStore` structurally satisfies both interfaces; verified signatures: `getLatest(organizationId): Promise<OperationalStateConfirmation | null>`, `getConfirmationsOverlappingWindow(organizationId, windowStart, windowEnd): Promise<OperationalStateConfirmation[]>`.)

- [ ] **Step 6.3: Build + typecheck + api suite, verify green**

```bash
pnpm build && pnpm typecheck
pnpm --filter @switchboard/api test
```

Expected: build 10/10, typecheck 21/21, api suite green (1489 baseline; the bind passthrough is pinned by typecheck; the structural interfaces; and exercised end-to-end in Task 7; known flakes: api-auth prod-hardening + bootstrap-smoke npm-warn, rerun before investigating).

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/services/cron/riley-outcome-attribution.ts \
        apps/api/src/bootstrap/inngest.ts \
        packages/core/src/recommendations/index.ts
git commit -m "feat(api): inject operational-state store into audit + outcome-attribution crons (riley v3 slice 4c)"
```

---

## Task 7: Real-engine end-to-end proof (scratch DB; the 4b discipline)

**Files:** none committed (evidence recorded in this doc; the verify script is created, run, and deleted)

Rationale: mocked-Prisma tests cannot see SQL-predicate or generated-client drift (the 4a "drift gate" lesson). This proof runs the REAL store + REAL orchestrator against a real Postgres: seeded confirmations → `getConfirmationsOverlappingWindow` → derivation → inserted outcome row. NEVER touch the shared dev DB (billing state, zero-confirmation assumption); use a scratch database and drop it.

- [ ] **Step 7.1: Create + migrate the scratch DB**

```bash
PGPASSWORD=switchboard psql -h localhost -U switchboard -d postgres -c 'CREATE DATABASE switchboard_4c;'
cd packages/db && DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard_4c" npx prisma migrate deploy; cd ../..
```

Expected: all migrations applied (incl. `20260604233000_operational_state_confirmation` and `20260604200000_recommendation_outcome_enrichment`). Do NOT use `pnpm db:migrate` (needs a TTY); do NOT `source .env`.

- [ ] **Step 7.2: Cross-check the candidate seed shape, write the verify script**

First re-derive the `PendingActionRecord` insert fields against `scripts/seed-recommendation.ts` and `packages/db/src/recommendation-outcome-store.ts` (`projectBaseCandidate` reads `parameters.__recommendation.action` and `targetEntities.campaignId`; `findAttributableCandidates` filters `sourceAgent: "riley"`, `status: "acted"`, `intent: { startsWith: "recommendation." }`, `resolvedAt <= now - windowDays - 24h`, no existing outcome row). Then create `scripts/tmp-verify-4c.ts` (UNTRACKED; deleted in Step 7.4):

```ts
/**
 * Slice-4c real-engine proof (scratch DB only; see plan Task 7).
 * Seeds three acted pause recommendations + operational-state confirmations,
 * runs the REAL orchestrator with the REAL stores (stubbed Meta provider),
 * and asserts the three stability verdicts: stable / unstable / unknown.
 * Then proves the freshness leg on the same rows: the REAL getLatest SQL +
 * the vouch-window math (the in-runner derivation itself is pinned by the
 * Task 3 seam test; this leg covers the real store read it consumes).
 */
import { PrismaClient } from "@prisma/client";
import {
  PrismaAttributableRecommendationStore,
  PrismaOperationalStateStore,
  PrismaRecommendationOutcomeStore,
} from "@switchboard/db";
import { runRileyOutcomeAttribution } from "@switchboard/core";
import { OPERATIONAL_STATE_VOUCH_MS } from "@switchboard/schemas";

const prisma = new PrismaClient();
const NOW = new Date(); // resolvedAt anchors are computed relative to now

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  const osStore = new PrismaOperationalStateStore(prisma);

  // One candidate per org: confirmations are org-scoped, so the three
  // verdicts need three isolated orgs. Each pause candidate's window is
  // fully settled (resolvedAt 9 days ago → window [16d ago .. 2d ago],
  // +24h settlement lag satisfied at evaluation time).
  const anchor = daysAgo(9);

  const cases = [
    { org: "org-4c-stable", rec: "rec-4c-s", verdictWanted: "stable" },
    { org: "org-4c-unstable", rec: "rec-4c-u", verdictWanted: "unstable" },
    { org: "org-4c-unknown", rec: "rec-4c-n", verdictWanted: "unknown" },
  ] as const;

  for (const c of cases) {
    await prisma.pendingActionRecord.create({
      data: {
        id: c.rec,
        idempotencyKey: `4c-proof:${c.rec}`,
        status: "acted",
        intent: "recommendation.pause",
        targetEntities: { campaignId: `camp-${c.org}` },
        parameters: { __recommendation: { action: "pause" } },
        humanSummary: "4c proof candidate",
        confidence: 0.9,
        riskLevel: "low",
        approvalRequired: "none",
        sourceAgent: "riley",
        organizationId: c.org,
        resolvedAt: anchor,
      },
    });
  }

  const FULL_NORMAL = {
    operatingStatus: "open",
    staffing: "normal",
    inventory: "normal",
    promoWindows: [],
    closures: [],
  } as const;

  // stable org: fresh full-normal governing row 3 days before windowStart (19d ago).
  await osStore.recordConfirmation("org-4c-stable", FULL_NORMAL, { confirmedAt: daysAgo(19) });
  // unstable org: same governing row + a mid-window staffing flip (12d ago, inside [16d..2d]).
  await osStore.recordConfirmation("org-4c-unstable", FULL_NORMAL, { confirmedAt: daysAgo(19) });
  await osStore.recordConfirmation(
    "org-4c-unstable",
    { ...FULL_NORMAL, staffing: "shortfall" },
    { confirmedAt: daysAgo(12) },
  );
  // unknown org: zero confirmations (honest absence).

  // Pre/post must clear the noise floor for a renderable directional row:
  // the orchestrator requests pre then post per candidate, so alternate by
  // call order (pre 10000c → post 800c = a favorable -92% spend fall).
  let call = 0;
  const insightsProvider = {
    getWindowMetrics: async () => {
      call += 1;
      return call % 2 === 1
        ? { spendCents: 10_000, ctr: 0.02, dailyRowCount: 7 } // pre
        : { spendCents: 800, ctr: 0.02, dailyRowCount: 7 }; // post (favorable fall)
    },
  };

  for (const c of cases) {
    const summary = await runRileyOutcomeAttribution({
      recommendationStore: new PrismaAttributableRecommendationStore(prisma),
      insightsProvider,
      outcomeStore: new PrismaRecommendationOutcomeStore(prisma),
      operationalStateReader: new PrismaOperationalStateStore(prisma),
      orgId: c.org,
      now: NOW,
    });
    const row = await prisma.recommendationOutcome.findUnique({
      where: { recommendationId: c.rec },
    });
    const got = row?.businessContextStable ?? "(no row)";
    const trust = row?.trustDelta ?? "(no row)";
    const ok = got === c.verdictWanted;
    console.error(
      `[4c-proof] ${c.org}: businessContextStable=${got} trustDelta=${trust} ` +
        `(wanted ${c.verdictWanted}) ${ok ? "OK" : "FAIL"} ` +
        `[written=${summary.outcomesWritten}]`,
    );
    if (!ok) process.exitCode = 1;
  }

  // Freshness leg: REAL getLatest SQL + the vouch-window math on the same
  // seeded rows. org-4c-stable's only confirmation is 19d old (stale at NOW);
  // org-4c-unstable's latest is 12d old (fresh); org-4c-unknown has none.
  const freshnessChecks = [
    { org: "org-4c-stable", wantLatest: true, wantFresh: false },
    { org: "org-4c-unstable", wantLatest: true, wantFresh: true },
    { org: "org-4c-unknown", wantLatest: false, wantFresh: false },
  ] as const;
  for (const f of freshnessChecks) {
    const latest = await osStore.getLatest(f.org);
    const hasLatest = latest !== null;
    const isFresh =
      latest !== null && NOW.getTime() - latest.confirmedAt.getTime() <= OPERATIONAL_STATE_VOUCH_MS;
    const ok = hasLatest === f.wantLatest && isFresh === f.wantFresh;
    console.error(
      `[4c-proof] freshness ${f.org}: latest=${hasLatest ? "found" : "none"} ` +
        `fresh=${isFresh} ${ok ? "OK" : "FAIL"}`,
    );
    if (!ok) process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(If the Step 7.2 cross-check against `seed-recommendation.ts` / `schema.prisma` reveals additional required `PendingActionRecord` fields, adapt the insert; the assert surface is the three verdicts, not the seed shape.)

- [ ] **Step 7.3: Run the proof against the scratch DB**

```bash
DATABASE_URL="postgresql://switchboard:switchboard@localhost:5432/switchboard_4c" npx tsx scripts/tmp-verify-4c.ts
```

Expected output (stderr):

```
[4c-proof] org-4c-stable: businessContextStable=stable trustDelta=up (wanted stable) OK [written=1]
[4c-proof] org-4c-unstable: businessContextStable=unstable trustDelta=none (wanted unstable) OK [written=1]
[4c-proof] org-4c-unknown: businessContextStable=unknown trustDelta=up (wanted unknown) OK [written=1]
[4c-proof] freshness org-4c-stable: latest=found fresh=false OK
[4c-proof] freshness org-4c-unstable: latest=found fresh=true OK
[4c-proof] freshness org-4c-unknown: latest=none fresh=false OK
```

exit 0. This proves, on the real engine: the 4a SQL window predicates AND the getLatest read, the stability derivation, the trustDelta demotion, the vouch-window math on real rows, the DB CHECK acceptance of `stable`/`unstable`, and the full DI chain. (The in-runner freshness derivation itself is pinned by the Task 3 seam test; together the two cover the whole freshness path.)

- [ ] **Step 7.4: Drop the scratch DB, delete the script, record evidence**

```bash
rm scripts/tmp-verify-4c.ts
PGPASSWORD=switchboard psql -h localhost -U switchboard -d postgres -c 'DROP DATABASE switchboard_4c;'
git status --short   # expect: clean (no stray files)
```

Record the three proof lines in this plan's "Verification evidence" section, then:

```bash
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4c-operational-state-consumption.md
git commit -m "docs(plans): record slice-4c real-engine verification evidence"
```

---

## Task 8: Full verification sweep (gates, scope-fence proofs, evals)

- [ ] **Step 8.1: Full build + typecheck + suites**

```bash
pnpm build && pnpm typecheck
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/db test          # gate: no NEW failures beyond the PG trio
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/ad-optimizer test
pnpm --filter @switchboard/api test
```

Expected: green everywhere except the known db PG trio (work-trace 6, ledger 2, greeting 1). The api run is the store-tightening insurance.

- [ ] **Step 8.2: Eval gates, byte-comparison against the pre-change baselines**

```bash
pnpm eval:riley > /tmp/slice4c-post-eval-riley.txt 2>&1; echo "exit: $?"
pnpm eval:governance > /tmp/slice4c-post-eval-governance.txt 2>&1; echo "exit: $?"
diff /tmp/slice4c-baselines/eval-riley-baseline.txt /tmp/slice4c-post-eval-riley.txt && echo "riley BYTE-UNCHANGED"
diff /tmp/slice4c-baselines/eval-governance-baseline.txt /tmp/slice4c-post-eval-governance.txt && echo "governance BYTE-UNCHANGED"
pnpm eval:alex-conversation > /tmp/slice4c-post-eval-alex.txt 2>&1; echo "exit: $?"; tail -3 /tmp/slice4c-post-eval-alex.txt
```

Expected: riley + governance exit 0 and BYTE-UNCHANGED. Alex: if still env-blocked, record the skip line and rely on the static proof chain (alex substrate byte-untouched, proven below).

- [ ] **Step 8.3: Scope-fence + honesty grep proofs (record outputs in the PR body)**

```bash
git fetch origin main
# 1. The complete diff surface; must list ONLY the files in "File structure":
git diff --stat origin/main...HEAD
# 2. Zero diff under db, dashboard, evals, and the 4a/4b surfaces (fence):
git diff origin/main...HEAD -- packages/db apps/dashboard evals | head -5            # expect empty
# 3. The 4a schema module and the alex substrate byte-untouched:
git diff origin/main...HEAD -- packages/schemas/src/operational-state.ts packages/schemas/src/marketplace.ts packages/db/src/stores/prisma-business-facts-store.ts | head -5   # expect empty
# 4. Riley stays advisory-only; no new mutating caller, no ingress. Docs are
#    excluded because this plan doc legitimately mentions the word in prose;
#    the code diff must be machine-checkably empty:
git diff origin/main...HEAD -- ':!docs' | grep -i "platformingress"                  # expect empty (exit 1)
# 5. corroborated still never emitted; the only engine mentions are the type,
#    the CHECK comment, and negative assertions:
grep -rn "corroborated" packages/core/src/recommendations --include="*.ts" | grep -v "__tests__" | grep -v "never\|reserved\|deferred\|not.*emit\|CausalStrength"   # expect empty
# 6. The trust-copy tripwire and the dashboard render path untouched:
git diff origin/main...HEAD -- packages/schemas/src/recommendation-outcome-copy.ts apps/api/src/lib/outcome-activity-row.ts | head -5   # expect empty
# 7. Freshness is carry-only; nothing in the decision layer reads it. The
#    exclusion list is the sanctioned derive/thread surface (inngest-functions
#    only THREADS the provider; its doc comment names the field):
grep -rn "businessContextFreshness" packages/ad-optimizer/src --include="*.ts" | grep -v "revenue-state\|audit-runner\|inngest-functions\|test"   # expect empty
```

- [ ] **Step 8.4: Lint, format, arch-check, route-class (separate CI jobs local lint does not cover)**

```bash
pnpm lint
pnpm format:check
pnpm arch:check
CI=1 pnpm exec tsx .agent/tools/check-routes.ts --mode=error
```

Expected: all green (audit-runner.ts stays 🟡 legacy-debt warn in arch-check; it carries the eslint-disable marker; no error tier).

- [ ] **Step 8.5: Commit the evidence**

```bash
git add docs/superpowers/plans/2026-06-05-riley-v3-slice4c-operational-state-consumption.md
git commit -m "docs(plans): record slice-4c verification evidence"
```

---

## Task 9: Code review

- [ ] **Step 9.1:** Invoke `superpowers:requesting-code-review` against `git diff origin/main...HEAD` (three-dot). Review focus: honesty floors (empty/absent/malformed all degrade to "unknown"; "stable" requires fresh + complete + non-disruptive governing knowledge; no fabrication anywhere), the differencing-principle semantics (constant context stable, transitions unstable, closure carve-out), the deliberate test flips (constant-unknown pin → honest-absence pin; sweep test strengthened not flipped), the failure-semantics asymmetry (audit degrades, outcome propagates), layer rules (no db import in ad-optimizer/core; DI at the app seam), abort-contract preservation, scope fence.
- [ ] **Step 9.2:** Address findings or push back with reasoning (receiving-code-review discipline). Re-run Task 8 gates after any change.

## Task 10: Land the PR

- [ ] **Step 10.1:** `git fetch origin main`; rebase onto live `origin/main`; re-run `pnpm build && pnpm typecheck` + the Task 8.1 suites + the eval byte-diffs after any rebase with upstream movement. Three-dot diffs only.
- [ ] **Step 10.2:** Push the branch; open ONE focused PR titled `feat(core,ad-optimizer,api,schemas): riley v3 slice 4c operational-state consumption (freshness + stability)`. Body: Decisions A-G summary (staleness policy + defense, differencing semantics, carry-only freshness, trustDelta demotion, machine-only render, the corroborated deferral analysis, no-migration proof), honesty-floor proofs, scope-fence grep outputs, eval byte-unchanged results incl. the alex-eval env blocker + static chain, the real-engine three-verdict + freshness proof, "corroborated arm = follow-on slice 4d with Decision F as its starting spec; post-window late-interval read = follow-on slice 4e".
- [ ] **Step 10.3:** Enable auto-merge (squash). Watch required checks. Known noise: chat gateway-bridge-attribution flake, api-auth prod-hardening flake (rerun before investigating), Eval Claim Classifier 401 (informational, not required).
- [ ] **Step 10.4:** Post-merge: verify the first NON-CANCELLED completed main CI run whose tree contains the squash commit.

## Task 11: Teardown + memory + report

- [ ] **Step 11.1:** Same-day teardown: exit + remove the worktree, `git worktree prune`, delete the branch local + remote.
- [ ] **Step 11.2:** Update memory: 4c shipped ⇒ slice-4 sub-project CLOSED (freshness + stability real; staleness policy = 14d vouch constant in schemas; half-open window geometry; trustDelta demotes on unstable; corroborated explicitly deferred to 4d with the degeneracy analysis; late-interval retroactive read tracked as 4e); next decision point = slice 5 Phase-C seam vs the deferred deriveOwnership consolidation (with optional 4d/4e arms).
- [ ] **Step 11.3:** Final report to the user.

---

## Self-review (spec/handoff coverage)

- Spec 2.1 net-new paragraph (businessContextFreshness derived from the operational-state source and carried through RevenueState, per Decision C): Task 2 derivation + Task 3 wiring incl. the seam pin; "unknown" preserved by honest absence and by no-source default (eval harness).
- Spec 7.4 (freshness = staleness of the input itself; stability = validity interval overlaps the FULL past attribution window, never "edited recently"): Decision A two-anchor policy; Decision B window-overlap semantics; the read is `getConfirmationsOverlappingWindow(org, windowStartedAt, windowEndedAt)` verbatim (Task 5 orchestrator test pins the exact call).
- Spec 2.5 (businessContextStable "whether the business was stable across the attribution window"; trustDelta advisory, rendered, never auto-applied): Decision B + C; demotion is display-honesty, not auto-application (no scoring/governance consumer; Task 8.3 proofs).
- Spec 2.5 / 7.5 (causalStrength honesty: corroborated ONLY from an independent second estimate; never fabricated): Decision F defers with the degeneracy analysis; sweep test intact + strengthened (Task 5); grep proof (Task 8.3 #5).
- Roadmap Slice 4c lines: revenue-state consumption ✓ (Tasks 2-3); outcome derivation real with window overlap ✓ (Tasks 4-5); "wire the CRM/booking-agreement signal" explicitly NOT done: Decision F says so plainly and splits it (the DoD's sanctioned alternative).
- 4a handoff (Decision B derived validity + the window-read contract, oldest-first, ties, [] = honest unknown): consumed verbatim; the derivation is robust to a missing governing row and genuinely order-independent (Task 4 defensive sort by the 4a tie-break triple + the order-independence test).
- 4b handoff (org-tz half-open intervals): interval math treats bounds as half-open `[start, end)` with open-ended = ∞ (Task 4 helpers + boundary tests).
- DoD-named test cases: governing-row-before-window case ✓ (Task 4 "affirmative stability" describe); mid-window-change case ✓ (Task 4 + Task 5 engine-level); [] positive signal ✓ (FULL_NORMAL uses explicit [] and the partial-dimension case contrasts absent); empty set = unknown ✓.
- Honesty floors: no fabricated freshness/stability/corroboration (defaults + certification requirements + sweep); absence = unknown forever (empty-set tests at every layer); malformed rows degrade at the store and are not resurrected (input contract documented; store behavior already pinned by 4a tests).
- Eval safety: byte-unchanged proven per-task and at the end against pre-change baselines; the assemble-default keeps eval fixtures identical; arbitration/source-reallocation/decideForCampaign untouched.
- Placeholder scan: every code step shows complete code; the one execution-time adaptation (Task 7 seed shape) is bounded and named, with the assert surface fixed.
- Type consistency: `OperationalStateProvider` (ad-optimizer) vs `OperationalStateReader` (core) are deliberately distinct names for distinct contracts (getLatest vs window read); `deriveBusinessContextFreshness` / `resolveBusinessContextFreshness` / `deriveBusinessContextStability` / `operationalStateConfirmations` / `getLatestOperationalState` used identically across tasks; `OPERATIONAL_STATE_VOUCH_DAYS`/`_MS` consistent.

## Verification evidence (recorded 2026-06-05 at execution)

Task 7 real-engine proof (scratch DB `switchboard_4c`: migrate deploy clean, all migrations applied; script run from `apps/api/` for workspace resolution, with `PrismaClient` imported via the `@switchboard/db` re-export because the root manifest lacks db/core deps; DB dropped + script deleted after, tree clean):

```
[4c-proof] org-4c-stable: businessContextStable=stable trustDelta=up (wanted stable) OK [written=1]
[4c-proof] org-4c-unstable: businessContextStable=unstable trustDelta=none (wanted unstable) OK [written=1]
[4c-proof] org-4c-unknown: businessContextStable=unknown trustDelta=up (wanted unknown) OK [written=1]
[4c-proof] freshness org-4c-stable: latest=found fresh=false OK
[4c-proof] freshness org-4c-unstable: latest=found fresh=true OK
[4c-proof] freshness org-4c-unknown: latest=none fresh=false OK
```

exit 0. Proven on the real engine: the 4a SQL window predicates and getLatest read, the stability derivation, the trustDelta demotion (none on the unstable window, up on stable/unknown), the DB CHECK acceptance of `stable`/`unstable`, and the full DI chain.

Task 8 verification sweep (recorded 2026-06-05, branch HEAD post-Task-7, base `2951510b`):

- Full build green (10 turbo tasks); `pnpm typecheck` green (21 tasks).
- schemas: 753 passed (750 baseline + 3). core: 3845 passed (3806 baseline + 39: 32 stability matrix + 7 outcome additions). ad-optimizer: 552 passed (539 baseline + 13). api: 201 files passed (1489 tests). db: 9 failed in exactly the pre-existing PG trio (work-trace 6, ledger 2, greeting 1); one extra full-suite-load flake (`lead-intake-store` concurrent-upsert) passed 6/6 on isolated rerun, zero `packages/db` diff in this branch (fence proof 2).
- `pnpm eval:riley` exit 0, BYTE-IDENTICAL to the pre-change baseline (12+10+6). `pnpm eval:governance` exit 0, BYTE-IDENTICAL (26). `pnpm eval:alex-conversation` exit 0, same environmental skip as baseline ("ANTHROPIC_API_KEY is not available"); static proof chain holds (fence proof 3: alex substrate byte-untouched; core suite green; build green).
- Diff surface = exactly the 18 planned files (17 code/test + this plan doc), 3483 insertions, 17 deletions.
- Fence proofs: (2) zero diff under `packages/db`, `apps/dashboard`, `evals/`; (3) `operational-state.ts`, `marketplace.ts`, `prisma-business-facts-store.ts` byte-untouched; (4) zero ADDED non-docs lines mention PlatformIngress (the one raw-grep hit was an unchanged context line of the pre-existing handoff comment adjacent to the new dep); (5) `corroborated` appears in non-test engine code only as comments asserting the negative plus the reserved type union (comment-stripped grep empty); (6) trust-copy tripwire + `outcome-activity-row.ts` byte-untouched; (7) `businessContextFreshness` referenced in ad-optimizer only by revenue-state/audit-runner/inngest-functions(threading)/tests.
- `pnpm lint` green; `pnpm format:check` green; `pnpm arch:check` exit 0 (`audit-runner.ts` 687 lines = 🟡 legacy-debt warn via its eslint-disable marker, as planned; 🔴 package file-count lines are pre-existing informational); `check-routes --mode=error` exit 0 (8 pre-existing §12 advisories, tracked #654, none from this branch).

Task 9 code review (adversarial reviewer subagent against the full three-dot diff): verdict READY TO MERGE; zero Critical, zero Important; reviewer could not construct a fabricated-stability or fabricated-freshness input ("honesty floors are airtight under adversarial probing"). Three Minor notes: (1) NaN interval bounds were silently non-disruptive in the pure unit (unreachable via the store, which schema-validates bounds) — FIXED post-review with a `hasParseableBounds` guard routing unparseable declared bounds to disruption evidence (fail-safe toward "unstable", never fabricated "stable") + two pinning tests (34/34 green); (2) `temporarily_closed` disrupting unconditionally on any walked row — intentional and documented, no change; (3) a covering promo replaced by a different covering promo mid-window flags unstable — intentional over-flag per the differencing principle, no change.
