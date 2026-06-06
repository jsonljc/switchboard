# Riley v3 Slice 4d: the corroborated arm of causalStrength (design)

**Date:** 2026-06-06
**Branch:** `feat/riley-4d-corroborated-outcomes`
**Type:** design spec (consumed by the same-PR implementation plan)
**Consumes:** spec `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md` (2.5 causalStrength honesty constraint, defer-list 4, risk 7.5); the 4c plan's Decision F (the recorded 4d deferral analysis); slices 3 (#886) and 4c (#915) as shipped.

> Verification note. Every "already exists" claim was re-read against `origin/main` at `2766270c` (the #934 merge, this branch's base). The outcome-path files are byte-identical between that SHA and the slice-3/4c shapes described here.

---

## 1. What this slice does, in one paragraph

Today the outcome ledger emits `causalStrength: directional | inconclusive`; `corroborated` is type-reserved, DB-legal, and pinned never-emitted by a sweep test. Spec 2.5 defines the only honest source of corroboration: _an independent second estimate agrees, read from the booked-value/CRM side_ ("a pause whose Meta spend fell AND whose booked-revenue-per-dollar held"). The 4c brainstorm proved the campaign-level form of that signal is mathematically degenerate for pause (post-pause spend → 0) and recorded the honest formulation: **org-level** windowed Meta spend against **org-level** windowed booked value, with sparse-booking floors. This slice wires exactly that: a CRM-side org-booking reader injected into the outcome orchestrator, an account-spend enrichment on the existing Meta window read (zero new Graph calls), a pure corroboration predicate with explicit judgeability floors, and the deliberate flip of the sweep test into positive pins (when corroborated IS emitted) plus no-fabrication negatives. Pause-only; `refresh_creative` corroboration is explicitly deferred with reasoning (section 6). Advisory throughout: nothing gates, executes, or re-scores.

## 2. The corroboration predicate (the load-bearing part)

An outcome row earns `corroborated` when **all** of the following hold. Any failure leaves the row at today's value (`directional` or `inconclusive`); corroboration only ever upgrades, never demotes.

**Preconditions (the first estimate must exist and be clean):**

- P1. `actionKind === "pause"` (the only kind this slice corroborates).
- P2. Zero visibility flags and a computed `deltaPct` (i.e. the row would be `directional` today). A flagged or sparse window has no clean first estimate to agree with.
- P3. The outcome is **favorable**: campaign spend fell (`deltaPct < 0`; pause's `favorableDirection` is `down`). An unfavorable pause (spend held or rose) failed on its own metric; there is no effect for the booking side to corroborate. Unfavorable directional rows stay `directional`.
- P4. `businessContextStable !== "unstable"`. Affirmative operator-confirmed disruption (mid-window promo flip, closure) confounds the booking-side estimate exactly as it confounds the Meta-side delta; claiming two confounded estimates "agree" would be fabricated confidence. `"unknown"` does NOT block: most orgs have no operational-state confirmations, and the booking signal's independence does not depend on operator attestation. (This also keeps the row coherent: 4c demotes `trustDelta` to `none` on unstable, and a `corroborated` row with no trust signal would contradict itself.)

**Judgeability floors (the second estimate must be derivable without fabrication):**

- F1. **Inputs present.** The org-booking reader is wired AND both Meta windows carry `accountSpendCents`. Absent either, the second estimate does not exist; the row is byte-identical to today.
- F2. **Sparse-booking floor.** `bookedCount >= 3` in **each** of the pre and post windows, where a counted booking is `type:"booked" AND value > 0` (the same predicate as the summed value, so the count can never be satisfied by zero-value rows the sum excludes). Echoes the repo's `MIN_SOURCE_BOOKINGS = 3`. A 0-booking window is unjudgeable by definition; this floor is the spec's "never fabricate corroborated from a 0-booking window" made literal, with margin.
- F3. **Spend-continuity band (the comparable-regime floor and ceiling).** `accountPreSpendCents > 0` AND `0.5 × accountPreSpendCents <= accountPostSpendCents <= 1.5 × accountPreSpendCents` (both bounds inclusive). The floor is Decision F's "multi-campaign-org restriction" in functional form: a single-campaign org's account spend collapses post-pause → floor fails → unjudgeable, and a multi-campaign org that paused its _dominant_ campaign also fails, correctly, because the residual traffic is a different regime and "bookings per ad dollar" is no longer the same statistic across the two windows. The ceiling is the same comparability argument in the other direction: a major post-anchor scale-up (another campaign launched or scaled hard) changes the statistic's regime just as surely, and a ratio that "held" across a doubled account is agreement about a different account. Bounding denominator drift to [0.5x, 1.5x] also bounds the relative noise amplification of the ratio comparison.

**The agreement test:**

- A1. `postRatio >= 0.8 × preRatio`, where `ratio = orgBookedValueCents / accountSpendCents` per window (both sides CENTS; the ratio is dimensionless; no unit conversion exists anywhere in this path). "The booking side agrees" = the org's booked revenue per ad dollar **held** (within a 20% tolerance) or improved while this campaign's spend fell. Pausing genuine waste mechanically _raises_ this ratio, so the predicate is reachable precisely in the success case it certifies; a >20% efficiency degradation cannot honestly be called "held". The 20% band is wider than the single-metric noise floors (5%/10%) because this is a ratio of ratios over two sparse windows; window-to-window booking variance at SMB volume comfortably exceeds single-metric variance. The pure module additionally guards `preBookedValueCents > 0` and `postBookedValueCents >= 0` explicitly (unreachable from the live reader, whose `value > 0` predicate makes F2 imply both, but the invariant must not depend on a store predicate surviving future schema changes).

**Recorded v1 limitations of the second estimate** (deliberate, documented in the module): the band checks the account-level denominator only; campaign-mix shift WITHIN the band (spend migrating between surviving campaigns), organic-demand spikes, cross-channel campaigns driving bookings, and in-window seasonality are not detected here. The operator-confirmed `unstable` block (P4) catches the operator-visible subset. `corroborated` therefore means **independent outcome-side agreement under floors, not causal proof**; the `CausalStrength` type carries a permanent comment saying exactly that, and no operator copy may strengthen it.

**Windows.** The org-booking reads use the **exact** instants of the Meta window reads: pre `[preStart, anchorAt)`, post `[anchorAt, postEnd)`, half-open per the engine's `startInclusive`/`endExclusive` convention (4c boundary doctrine). Note this is the two sub-windows, NOT the full `[windowStartedAt, windowEndedAt)` span the operational-state read uses: the second estimate compares pre vs post just like the first. Prisma predicate: `occurredAt: { gte: start, lt: end }` (a deliberate, pinned divergence from `queryBookedValueCentsByCampaign`'s inclusive `lte`, which would double-count an instant-of-anchor booking into both windows).

**Constants** (exported from the new pure module, each with a why-comment):

```
CORROBORATION_MIN_BOOKINGS_PER_WINDOW   = 3
CORROBORATION_SPEND_CONTINUITY_FLOOR    = 0.5
CORROBORATION_SPEND_CONTINUITY_CEILING  = 1.5
CORROBORATION_RATIO_HOLD_TOLERANCE      = 0.8
```

**The predicate returns a reasoned verdict, not a boolean** (rollout observability): `deriveCorroboration(input)` returns `{ causalStrengthUpgrade: "corroborated" | null, reason }` where `reason` is one of `corroborated | not_pause | visibility_flagged | missing_delta | unfavorable_direction | unstable_context | missing_booking_stats | missing_account_spend | sparse_bookings | spend_continuity_failed | invalid_booked_value | ratio_degraded`. Tests pin exact reasons per failure mode, and debugging a rollout never requires reconstructing why corroboration stayed off. `attributeOneRecommendation` consumes only `causalStrengthUpgrade`; the persisted row stores only `causalStrength` (no reason column, no summary breakdown in v1; per-row reason logging is a recorded follow-on if rollout needs it).

## 3. Why this is not an inert arm (the early-exit check, run and passed)

- F2 needs the org to book ≥3 valued bookings per 7-day window org-wide. The wedge customer (medspa, SG/MY) books 5–15/week; the repo's own floors assume this volume is real (`MIN_BOOKED_FOR_TIER1 = 10`, `MIN_SOURCE_BOOKINGS = 3`).
- F3 needs the paused campaign to be under ~half of account spend. Riley's pause candidates are underperformers surfaced by the audit, not the account's dominant campaign; multi-campaign accounts are the norm for the target customer.
- A1 is the _expected_ outcome of pausing waste (ratio improves). So the predicate is reachable in exactly the cases the product narrative needs ("Riley paused it, spend fell, bookings didn't blink, corroborated"). No fabrication is required to make it fire; therefore the arm ships.

## 4. Architecture (two seams, both precedented)

**Meta side: org spend rides the existing call (zero new Graph reads).** `createMetaInsightsProviderForOrg` already fetches account-wide `getCampaignInsights` per window and discards everything but the requested campaign. Core's `WindowMetrics` gains an optional `accountSpendCents?: number`; the adapter sums spend across ALL returned rows (same dollars→cents conversion as the campaign sum: `Math.round(total * 100)`) before filtering. The existing null contract is untouched and **hard-pinned**: requested campaign absent + other account rows present still returns `null` (account data alone never fabricates a campaign window; downstream must never see "campaign missing, account present" as judgeable). A second pin protects the zero-new-calls property itself: the adapter's Graph request carries NO campaign filter (`MetaAdsClient.getCampaignInsights` supports a `campaignId` filtering param; a future "optimization" passing it would silently turn `accountSpendCents` into campaign spend and destroy corroboration). No `MetaAdsClient` changes, no instance-lifecycle changes (the adapter already constructs a fresh client per call), no quota change.

**CRM side: an injected org-booking reader (the 4c reader pattern).** New interface in `outcome-attribution-types.ts`:

```ts
export interface OrgBookedStatsReader {
  getBookedStatsForOrgWindow(args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }): Promise<{ bookedValueCents: number; bookedCount: number }>;
}
```

Implementation: a new method of the **same name and shape** on `PrismaConversionRecordStore` (db, Layer 4), so the existing store instance satisfies the interface structurally and the bootstrap passes it directly (the `operationalStateReader: operationalStateStore` precedent). One `aggregate` over `organizationId + type:"booked" + value > 0 + occurredAt gte/lt`; returns `{_sum.value ?? 0, _count}`. Zeros are honest (they fail F2). `ConversionRecord.value` is CENTS; the method passes it through untouched and a test pins that no conversion happens at any boundary.

**Core derivation: a pure sibling module.** `packages/core/src/recommendations/outcome-corroboration.ts` exports `deriveCorroboration(input): boolean` plus the three constants. It internally re-checks every precondition and floor (self-contained honesty, mirroring `operational-stability.ts`'s defense-in-depth), so no caller can reach the agreement test with a flagged row or a missing input. `attributeOneRecommendation` gains an optional `orgBookedStats?: { preWindow: OrgBookedWindowStats; postWindow: OrgBookedWindowStats }` input and derives:

```ts
const causalStrength: CausalStrength =
  flags.length === 0 && deltaPct !== null
    ? corroborationHolds
      ? "corroborated"
      : "directional"
    : "inconclusive";
```

`inconclusive` and the directional/inconclusive boundary are untouched.

**Orchestrator threading.** `runRileyOutcomeAttribution` gains optional `orgBookedStatsReader`. For **pause candidates only** (pinned: refresh candidates never trigger the read, so a kind that cannot use the result never pays the DB cost or carries its failure risk), it fetches the two window stats after the operational-state read and **before** the quota-bearing Meta calls (the 4c cheap-DB-first ordering). The failure taxonomy is explicit: **no rows is not a failure** (the reader returns honest `{0, 0}` zeros, which fail the floors; pinned at the db layer); thrown errors (transient DB blips and code bugs alike) **propagate** (Inngest retries; persistent failures surface through the worker's onFailure alarm), the 4c outcome-path asymmetry: rows are insert-once, and freezing `directional` on a transient blip would permanently under-record an earnable corroboration. This matches every other provider in this loop (Meta provider, operationalStateReader); the cost is that a broken reader blocks the run, which is the correct trade for an insert-once ledger. `RileyOutcomeRunSummary` gains a `corroborated: number` counter (additive; the worker already logs the summary, giving rollout observability for free).

**apps/api wiring.** `bindRileyOutcomeOrchestrator` gains optional `orgBookedStatsReader`; `bootstrap/inngest.ts` passes the existing `PrismaConversionRecordStore` instance (already constructed at line ~302 for the audit's booked-value provider). The cron stays behind `RILEY_OUTCOME_ATTRIBUTION_ENABLED`; **no new env var** (the arm is an honest enrichment of an already-flagged path, not a behavior switch; rows simply start telling a richer truth, and the flag that governs whether rows are written at all is unchanged).

**Layer doctrine check.** core imports nothing new (the reader is an interface; the booking data arrives as plain input); ad-optimizer is untouched (zero diff); db implements the interface; apps/api wires. No UI diff anywhere.

## 5. The consumer sweep (every causalStrength reader, verified corroborated-safe)

Per the new-enum-value lesson (#860): grep every consumer for binary assumptions. The full reader set and verdicts:

| Consumer                                                       | Reads                                                           | Verdict                                                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `attributeOneRecommendation` derivation                        | writes the field                                                | the change itself                                                                                                                    |
| `PrismaRecommendationOutcomeStore.insert`                      | typed passthrough                                               | already three-valued (slice-3 type)                                                                                                  |
| DB CHECK constraint (slice-3 migration)                        | value set                                                       | already admits `'corroborated'` (verified in `20260604200000_recommendation_outcome_enrichment/migration.sql`) → **zero migrations** |
| `projectReadModel.narrowEnum`                                  | value set                                                       | already includes `"corroborated"` (slice 3 built the read side legal)                                                                |
| `translateOutcomeToActivityRow` (feed translator, both routes) | `trustDelta`/`copyTemplate` only, never `causalStrength`        | renders a corroborated row byte-identically; pinned by a new test                                                                    |
| trustDelta derivation                                          | `isFavorable` + `businessContextStable`, never `causalStrength` | unchanged; see section 7                                                                                                             |
| Legacy cockpit route `/api/cockpit/riley/outcomes`             | via the shared translator                                       | covered above; one fixture test added                                                                                                |

No binary ternary on `causalStrength` exists anywhere in the codebase (grep-verified across packages + apps). The sweep therefore lands as **tests that pin the already-three-valued consumers**, not as consumer code changes.

## 6. Per-kind decision: pause ships, refresh_creative defers (recorded)

`refresh_creative` is the other `V1_ATTRIBUTABLE_KIND`. Its campaign-level denominator is non-degenerate (spend continues post-action), so the 4c degeneracy argument does not apply, but its second estimate fails honesty on three independent grounds:

1. **Granularity sparsity.** The honest comparison for a creative refresh is the _campaign's_ bookings-per-dollar (org-level would dilute one campaign's creative change to vacuity). Per-campaign attributed bookings at SMB volume over 14-day windows rarely clear a 3-per-window floor in BOTH windows; the arm would be near-inert at exactly the volumes that matter, and lowering the floor to make it fire is fabrication by knob.
2. **Lag contamination without a differencing majority.** Post-window bookings of the refreshed campaign stem largely from pre-refresh clicks at medspa consideration timescales. The pause/org-level case differences this out (the unaffected campaigns dominate both windows); the same-campaign refresh case has no unaffected majority.
3. **Weak agreement semantics.** "CTR rose" (engagement proxy) and "bookings-per-dollar held" estimate different quantities; their agreement is materially weaker than the pause case, where both sides estimate the same thing (revenue-safety of removing spend).

Pinned by the sweep replacement: a refresh_creative directional outcome with complete, predicate-passing corroboration inputs still emits `directional`. If a future slice wants this arm, it starts from this analysis.

## 7. trustDelta and operator copy: deliberately untouched

`trustDelta` derives from direction × renderability × stability and never reads `causalStrength` (slice-3 code, verified). A corroborated outcome maps exactly as its directional twin: favorable → `up` (unfavorable and unstable are unreachable for corroborated rows by P3/P4). The 3-value `TrustDelta` cannot express magnitude, and widening it would reopen the #860 consumer sweep for no operator-visible gain; the seam for "corroborated counts for more" is Phase-C's trust-weighting consumer reading `causalStrength` directly off the row, which after this slice finally carries the value it needs. `renderTrustDeltaCopy`, its allowlist, and the tripwire test (bans causal/trust-state words in operator copy) are byte-untouched. Zero dashboard diffs; the deferred results dashboard stays deferred.

## 8. Phase-C executed pauses: separate slice, recorded

Phase-C (#931–#934) gave executed pauses WorkTrace provenance, but the executor never transitions the source `PendingActionRecord` to `status:"acted"` (verified: `riley-pause-execution-workflow.ts` records `recommendationId` in outputs only), and `findAttributableCandidates` requires `status:"acted" + resolvedAt`. So **executed pauses produce no outcome rows today**: they are invisible to attribution, corroborated or otherwise. Closing that loop (who transitions the record, what `resolvedAt` means for a machine execution, populating `executableWorkUnitId`, idempotency against the operator-act path) is lifecycle work orthogonal to the corroboration predicate and belongs with the Phase-C rollout decisions; bolting it on here would couple a derivation slice to approval-lifecycle semantics. This slice keeps `executableWorkUnitId: null` and changes nothing about candidate selection. Recorded as the natural 4f / Phase-C follow-on: **executed-action attribution linkage**; it is also what makes the earning story ("Riley's own pauses corroborate") measurable, so it should precede any pilot-org trust narrative.

## 9. Test doctrine (the sweep flip)

The slice-3 sweep test ("never emits corroborated") **flips deliberately in the same PR** as the derivation change, replaced by:

- **Positive pins:** corroborated emitted exactly when P1–P4 + F1–F3 + A1 hold; boundary pins at each constant (bookings exactly 3 → judgeable, 2 → not; continuity exactly 0.5 and exactly 1.5 → judgeable, just outside either bound → not; ratio exactly 0.8×pre → corroborated, just below → directional). Every pure-module assertion pins the exact `reason` code, not just the boolean.
- **No-fabrication negatives:** sparse bookings (0 and 2, either window), reader absent, `accountSpendCents` absent (either window), provider error (propagates, no row), zero-rows reader result is honest zeros not an error (db pin), misaligned-window impossibility (orchestrator pins the reader receives the exact Meta-window instants AND that `pre.endExclusive === post.startInclusive`, so an instant-of-anchor booking lands in exactly the post window and an instant-of-postEnd booking in neither), unfavorable direction, every visibility flag, unstable context, refresh_creative with passing inputs, zero pre-spend, post-spend above the continuity ceiling.
- **Adapter pins:** requested campaign absent + account rows present → `null`; campaign present + other campaigns present → campaign metrics + `accountSpendCents` summing ALL rows; the Graph request carries no campaign filter (the zero-new-calls property cannot be silently optimized away).
- **Byte-identity:** reader absent ⇒ row identical to today's output, field for field.
- **CENTS pin:** the db method passes `_sum.value` through unconverted; the predicate divides cents by cents.
- **Consumer pins:** corroborated row through the feed translator renders identically to its directional twin; read model narrows `"corroborated"` (already covered by slice-3 db tests, extended with one corroborated fixture).

Eval gates: `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26) byte-identical (baselines captured at this branch's clean state; the outcome path has no import contact with `evals/`; 4c proved the same property).

## 10. Scope fence

ONE PR. In: `WindowMetrics.accountSpendCents` + adapter enrichment; `OrgBookedStatsReader` + db method; pure `outcome-corroboration.ts`; derivation flip; orchestrator threading + summary counter; bootstrap wiring; sweep flip + the test doctrine above; this spec + the implementation plan. Out: any UI, any migration (none needed, proven), any new env var, refresh_creative corroboration, executed-pause linkage (4f), the 4e late-interval read, trust-weighting consumers, backfill (legacy rows keep their honest values).
