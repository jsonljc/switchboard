# Riley source-reallocation: wire the orphaned per-source economics into an advisory budget-shift rec

Date: 2026-06-03
Status: approved-for-implementation (autonomous slice; user pre-authorized — no interactive approval gate)
Branch: `worktree-riley-reallocation`
Layer: backend only (`@switchboard/ad-optimizer` + `@switchboard/schemas` + `evals/`). No dashboard, no mutating path.

## Problem (verified against live `origin/main` @ `b5248744`)

Riley computes a cross-source economic comparison and then **discards it before any decision** — the
9-domain audit's "computes intelligence, orphans it before a decision" meta-finding. Confirmed by
reading the real code (not memory):

- `compareSources` (`packages/ad-optimizer/src/analyzers/source-comparator.ts:39`) computes per-source
  `trueRoas` / `closeRate` / `costPerBooked` (CTWA vs Instant Form, **account-level** — aggregated
  across campaigns).
- `audit-runner.ts:496-503` computes `sourceComparison` at **Step 8b, _after_ the per-campaign loop
  closes (line 479)**, and only spreads it into the returned report (`audit-runner.ts:586`).
- The per-campaign loop calls `decideForCampaign` (`audit-runner.ts:460-475`) **without** `sourceComparison`.
- `decideForCampaign` _would_ forward it to `generateRecommendations` (`campaign-decision.ts:161`), and
  `generateRecommendations` _has_ a fully-built, economics-driven `shift_budget_to_source` branch
  (`recommendation-engine.ts:314-334`, ranked by `findShiftCandidates`, 93-113: `bestRoas ≥ 2×worstRoas`
  - winner `closeRate ≥ 5%`). But `sourceComparison` is never populated on that path.

**Verdict:** the `shift_budget_to_source` rule is fully-classified **dead code** (evidence-floor `scale`
family at `evidence-floor.ts:21`; reset class `conditional`; risk contract financial+external →
not-swipe-approvable at `recommendation-sink.ts:131`; sink labels/humanize already present). The only
missing piece is that the account-level source economics never reach a decision. This is the bullseye
"wiring, not new ML" orphan.

## Goal

Make Riley emit **one** evidence-gated, eval-covered, **advisory** `shift_budget_to_source`
recommendation when the live per-source economics materially differ with sufficient evidence on both
sides — driven by the truth it already computes — and **abstain to a watch** when thin, tied, or
measurement-untrusted. Surface the economic basis at the approval moment via the existing
`presentation.dataLines` channel, honest-null.

## Non-goals / deferrals (flagged, not silently dropped)

- **Advisory-only.** No execution, no PlatformIngress, no Meta write, zero new mutating callers. The
  output is a `RecommendationOutput` through the existing sink → queue → approval surface (the
  `act_on_recommendation` path submits only `{recommendationId, action, note}`; nothing here changes that).
- **Cross-campaign reallocation deferred.** `analyzeBudgetDistribution` imbalances + `campaignEconomics`
  cross-campaign ranking are _also_ orphaned, but wiring them needs a **new** action type
  (`reallocate_budget` does not exist), new evidence-family/reset/swipe classification, and new sink
  labels — that balloons. Deferred with this note; source-level reuses everything that already exists.
- **No new ML.** Reuse the existing `findShiftCandidates` ranking + `meetsEvidenceFloor`; the only new
  rule is a per-source minimum-evidence floor (a threshold, not a model).

## Why account-level (the key architectural decision)

`sourceComparison` is **account-level**. A "shift budget from Instant Form to CTWA" decision is a single
account-level action. The existing branch lives inside the **per-campaign** `generateRecommendations`, so
naively threading `sourceComparison` into the loop would emit **N duplicate** source-shift cards (one per
campaign), each mis-tagged to whichever campaign the loop was on. Therefore:

1. Relocate the shift logic to a **new account-level pure function** that fires **once** per audit.
2. Remove the now-redundant, never-reached per-campaign branch (no corpse / no dead-trap; a future dev
   wiring `sourceComparison` into `decideForCampaign` must not resurrect the duplication bug).

Precedent for account-level recs with a non-campaign identity already exists: signal-health recs use a
sentinel `campaignId` (`recommendation-engine.ts:408`), and the coverage abstention insight uses
`campaignId: "account"` (`audit-runner.ts:281`).

## Design

### 1. New module: `packages/ad-optimizer/src/analyzers/source-reallocation.ts`

Pure, deterministic, model-free, DB-free. Exported from the package entry so the eval can import it
(same way it imports `decideForCampaign`).

```
decideSourceReallocation(input: {
  sourceComparison: { rows: SourceComparisonRow[] };   // ranking metric (trueRoas/closeRate)
  bySource: Record<string, SourceFunnel>;              // per-source evidence (received/booked)
  accountEvidence: { clicks: number; conversions: number; days: number }; // scale-family floor
  measurementTrusted: boolean;                         // Gate-1 account-wide step-change
  nextCycleDate: string;                               // checkBackDate for abstentions
}): RecommendationOutput | WatchOutput | null
```

Decision flow (each branch pinned by an eval fixture):

1. `candidate = findShiftCandidates(rows)` (relocated). No candidate (≥2 eligible, `bestRoas ≥ 2×worstRoas`,
   winner `closeRate ≥ 5%`) → **`null`** (tied / sub-threshold / <2 sources → no signal, no abstention noise).
2. `measurementTrusted === false` → **`measurement_untrusted` watch** (shift is cost-driven; mirrors
   `campaign-decision.ts:179-192`).
3. Per-source evidence floor — BOTH `candidate.from` and `candidate.to` must clear
   `received ≥ MIN_SOURCE_LEADS` AND `booked ≥ MIN_SOURCE_BOOKINGS` (named config, not magic numbers,
   per `evidence-floor.ts` §11 convention; starting values `MIN_SOURCE_LEADS = 10`,
   `MIN_SOURCE_BOOKINGS = 3` — `booked` is the `trueRoas` revenue denominator, so it carries the floor;
   `3` mirrors the `scale` family's `conversions: 3`; tune via the eval, never silently). Either side
   thin → **`insufficient_evidence` watch**. This is the "sufficient evidence on BOTH sides" requirement;
   eligibility already implies `spend>0`/`received>0` (via `trueRoasFromCents`/`safeDiv` null-on-zero),
   so this adds a _minimum volume_, not just non-zero.
4. Account-level scale floor — `meetsEvidenceFloor("shift_budget_to_source", accountEvidence)`. Fails →
   **`insufficient_evidence` watch** (reuses the existing floor; the "wiring" thesis).
5. Otherwise → **`shift_budget_to_source` recommendation** (confidence 0.6, urgency `this_week`),
   `campaignId: "account"`, `campaignName: "${from} → ${to}"`, `params: { from, to, fromTrueRoas,
toTrueRoas }` (strings — the idiomatic `params` carrier), `estimatedImpact` = "`${to} trueRoas is
${ratio}x ${from} — consider shifting budget`", honest steps incl. the existing "source attribution is
   heuristic — validate before large reallocations" caveat.

Watches are pushed to the report's `watches[]` (honest abstention record) and are **not** queued as
approvals — matching `decideForCampaign`'s watch semantics. Only the rec flows to the sink.

### 2. Wire into `audit-runner.ts` (≤8 net lines; cap is 600, file is 590)

After Step 8b computes `sourceComparison` (and `bySource`/`spendBySource` are in scope), call
`decideSourceReallocation` once and push the rec/watch into the existing `recommendations`/`watches`
arrays before Step 9 (the sink). `accountEvidence.clicks/conversions` = sums already available from
`currentInsights`. If the addition risks the 600-line cap, offset by extracting the Step-8b/
`campaignEconomics` computation block (lines ~496-526) into a sibling helper — pre-cleared by the spec.

### 3. Remove the dead per-campaign branch (relocation, net reduction)

- `recommendation-engine.ts`: delete the `shift_budget_to_source` branch (314-334), `findShiftCandidates`
  (93-113), `SHIFT_*` constants (90-91), and the `sourceComparison` field on `RecommendationInput` (46).
- `campaign-decision.ts`: delete the `sourceComparison` field (59) + its forwarding (161).
- Migrate the existing shift unit tests from `recommendation-engine.test.ts` to the new module's
  co-located test. The existing eval matrix never covered `shift_budget_to_source` (it was unreachable),
  so no fixture or drift-guard breaks.

### 4. Surface the economic basis (#841 dataLines pattern), honest-null

Add `sourceReallocationCells(params)` to `recommendation-sink.ts` (sibling to `economicsCells`): renders
one honest-null dataLine from `params.fromTrueRoas`/`toTrueRoas` — e.g. `["Instant Form 1.6x true ROAS",
"CTWA 3.8x true ROAS"]` (joined by " · " by the approval sheet). `buildPresentation` appends it when
`rec.action === "shift_budget_to_source"` and the params are present; omitted otherwise.
`economicBasisLine` returns null for this rec (no per-campaign `targetSource`) — correct, no misleading
per-campaign line. **Units: compare/format only.** `trueRoas` is already a major ratio (`.toFixed(1)`);
nothing is re-divided; `bookedValueCents` is never touched here.

### 5. Extend the eval (`evals/riley-recommendation`)

The harness covers the `decideForCampaign` seam; this rule lives at a **new account-level seam**, so add
a parallel mini-harness in the same dir (the existing `loadRileyCases` reads only `*.jsonl` directly
under `fixtures/`, so a subdir is invisible to it):

- `source-reallocation-schema.ts` — `SourceReallocationCaseSchema` (sources[] with `trueRoas`/`closeRate`/
  `received`/`booked`, `measurementTrusted?`, `accountEvidence`, `expectedOutcome`, `expectedWatchPattern?`).
- `source-reallocation-decide.ts` — `decideSourceReallocationForCase(c)` calling the **REAL**
  `decideSourceReallocation` (engine is the source of truth; harness never re-implements logic).
- `fixtures/source-reallocation/*.jsonl` — discriminating cases: (a) reallocate (clear winner + evidence
  both sides), (b) abstain-tied (ratio < 2×), (c) abstain-thin-source (winner under per-source floor),
  (d) abstain-untrusted (`measurementTrusted:false`).
- `__tests__/source-reallocation.test.ts` — vitest gate (already globbed by `evals/vitest.config.ts:14`).
- `run-eval.ts` — also load + assert the source-reallocation cases so `pnpm eval:riley` covers them.

No new external dependency (the suite already imports `@switchboard/ad-optimizer`), so the "build in all
eval CI jobs" gotcha is already satisfied on main — nothing in `.github/workflows/ci.yml` needs editing.

## Honest-null & advisory-only invariants

- Any `null` `trueRoas`/`closeRate` → source ineligible (existing); <2 eligible → `null` (no rec).
- Thin/tied/untrusted → a **watch**, never a fabricated rec.
- No `PlatformIngress`, no Meta write, no execution. Grep-proven in the PR (diff adds zero mutating callers).

## Files touched

| File                                              | Change                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `analyzers/source-reallocation.ts` (new)          | account-level generator + relocated `findShiftCandidates` + floors          |
| `analyzers/source-reallocation.test.ts` (new)     | co-located TDD tests                                                        |
| `audit-runner.ts`                                 | call generator once after Step 8b; push rec/watch (≤8 lines; guard 600 cap) |
| `recommendation-engine.ts`                        | remove dead branch + `findShiftCandidates` + `sourceComparison` input       |
| `campaign-decision.ts`                            | remove `sourceComparison` field + forwarding                                |
| `recommendation-engine.test.ts`                   | migrate shift tests out                                                     |
| `recommendation-sink.ts`                          | `sourceReallocationCells` + append in `buildPresentation`                   |
| `recommendation-sink.test.ts`                     | dataLine test                                                               |
| ad-optimizer package entry                        | export `decideSourceReallocation` (+ types)                                 |
| eval: schema/decide/loader/fixtures/test/run-eval | new source-reallocation coverage                                            |

## Risks & mitigations

- **audit-runner 600-line cap (at 590).** Keep the addition ≤8 lines; offset by extracting the Step-8b
  economics block if needed. Verify with `pnpm arch:check` (the raw-line gate, not just lint).
- **Dead-branch removal blast radius.** Contained to `recommendation-engine.test.ts`; the eval matrix
  never covered the action. Fallback: if removal proves risky mid-execution, leave the branch with a
  deprecation comment rather than expand scope (default: remove).
- **Sentinel `campaignId: "account"`.** Established precedent (coverage insight; signal-health sentinels).
  Backend/surface-agnostic; the rec still renders (descriptive `campaignName`). Dashboard grouping of the
  sentinel is a downstream nicety, out of scope.
- **Pre-existing `apps/chat` TS7006 + absent Prisma client.** Not a regression — the fresh worktree has no
  generated Prisma client, degrading a Prisma query result to `any`. Run `pnpm db:generate` (or
  `pnpm reset`) before the final gate. My layers (ad-optimizer/schemas/evals) don't need Prisma.
- **`Eval — Claim Classifier`** is a known baking flake on main; ignore if red on main itself.

## Verification gate (before PR)

`pnpm test` + `pnpm --filter @switchboard/dashboard build` + `pnpm typecheck` + `pnpm arch:check` +
`pnpm lint` + `pnpm format:check` + `pnpm eval:riley`. `pnpm reset` first if a stale-Prisma cross-package
false alarm appears after rebase.
