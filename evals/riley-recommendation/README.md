# Riley-Recommendation Eval Harness

Deterministic regression matrix for Riley's per-campaign decision pipeline
(`decideForCampaign` in `packages/ad-optimizer/src/campaign-decision.ts`).

Like the governance-decision harness, this one is **model-free and DB-free**:
every case is resolved through the real `decideForCampaign` pipeline into a
structured result (a reduced `primary` label plus the full `actions` /
`watchPatterns` sets), then compared to the fixture's `expectedOutcome` and any
pinned `expectedActions` / `expectedWatchPatterns`. It needs **no `ANTHROPIC_API_KEY`
and no Postgres**, so it runs in CI as a plain vitest test and is fully reproducible
locally.

> Riley is not a universal media-buying brain. Riley is a context-calibrated decision pipeline for small/modest-budget Meta accounts where evidence sufficiency, learning stability, and revenue truth matter more than heavy optimization frameworks.

## Run locally

```bash
pnpm eval:riley                  # CLI runner (prints a report)
pnpm exec vitest run --config evals/vitest.config.ts riley-recommendation   # the matrix
```

(If you have not built ad-optimizer yet, run `pnpm --filter @switchboard/ad-optimizer build` first — the harness resolves it from `dist`.)

## What it covers

Riley's `decideForCampaign` outcome matrix:

- **Abstention floor:** insufficient/low-signal accounts fall through to a stable
  `insight` (no destructive recommendation) rather than over-optimizing.
- **Economic tiering:** how the resolved tier (`booked_cac` / `cpl` / `cpc`)
  gates a recommendation into a `watch` instead of a direct action when revenue
  truth is too weak to stand behind the change.
- **Learning lockout:** learning-RESETTING actions (e.g. `add_creative`) held as
  an `in_learning_phase` `watch` while an ad set is in learning; non-resetting
  actions (e.g. `pause`) still flow.
- **Measurement-trust hold (Gate 1):** when an account-wide conversion-denominator
  step-change is suspected (`measurementTrusted: false`), cost-driven /
  learning-resetting recs are demoted to a `measurement_untrusted` watch.
- **Durable-breach act:** durable + sufficient-volume breach yields BOTH
  `add_creative` AND `pause` — pinned via `expectedActions` so neither can be
  silently dropped.

### Test files in the gate

All three are run by `evals/vitest.config.ts` and block CI:

- `__tests__/riley-recommendation.test.ts` — the fixture matrix (one assertion per
  JSONL case).
- `__tests__/denominator-guard.test.ts` — the **denominator-regression guard**.
  Exercises the REAL `MetaCampaignInsightsProvider.getTargetBreachStatus` with daily
  rows whose aggregate `conversions` denominator and configured `action_type`
  denominator give DIFFERENT breach counts (aggregate ⇒ 0, action_type ⇒ 14). It
  asserts the action_type count, so it flips RED if anyone reverts the breach
  counter to Meta's unfiltered aggregate `conversions`. The matrix can't catch this
  because `targetBreach.periodsAboveTarget` is a fixture literal at the decide seam.
- `__tests__/drift-guard.test.ts` — the **fixture-coverage drift guard** (cloned from
  governance-decision). Fails if the fixture set stops covering an `economicTier`, a
  `learningState`, either `measurementTrusted` value, or any key advisory/abstention
  outcome (`add_creative`, `pause`, `insufficient_evidence`, `measurement_untrusted`,
  `in_learning_phase`, `burn`, `breach_building`, `insight`).

## How a case is reduced

`decideForCampaign` returns `{ insights, watches, recommendations }`. `decideForCase`
(see `decide.ts`) exposes a STRUCTURED result:

- `primary` — the single reduced label, priority **recommendation action > `watch` >
  `insight` > `none`**. Asserted against the fixture's `expectedOutcome`.
- `actions` / `watchPatterns` — the full sorted sets of produced rec actions / watch
  patterns. A fixture's optional `expectedActions` / `expectedWatchPatterns` are
  set-membership assertions (each listed value MUST be among the produced set). This
  closes the lossy single-label hole: the durable-breach case pins
  `expectedActions: ["add_creative", "pause"]`, so a dropped `pause` fails even
  though the reduced `primary` (recommendations[0]) would still read `add_creative`.
- `hasInsight` — whether a stable `insight` was emitted.

`decide.ts` derives the learning-phase lockout flag via the SAME exported
`deriveLearningPhaseActive` rule the live `audit-runner` uses, so the eval and the
live path can never drift on that rule.

## Add a case

One JSONL row in `fixtures/`:

```json
{
  "id": "smoke-healthy-stable",
  "current": {
    "impressions": 10000,
    "inlineLinkClicks": 300,
    "spend": 50,
    "conversions": 10,
    "revenue": 600,
    "frequency": 1.4
  },
  "previous": {
    "impressions": 10000,
    "inlineLinkClicks": 300,
    "spend": 50,
    "conversions": 10,
    "revenue": 600,
    "frequency": 1.4
  },
  "targetBreach": { "periodsAboveTarget": 0, "granularity": "daily" },
  "learningState": "success",
  "economicTier": "cpl",
  "effectiveTarget": 100,
  "targetROAS": 3,
  "expectedOutcome": "insight"
}
```

| Field                   | Required | Description                                                                          |
| ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| `id`                    | yes      | Unique slug (kebab-case).                                                            |
| `current` / `previous`  | yes/no   | Campaign metric snapshots; `previous` may be `null`.                                 |
| `targetBreach`          | yes      | `{ periodsAboveTarget, granularity }` (weekly granularity = approximate).            |
| `learningState`         | yes      | learning \| learning_limited \| success \| unknown.                                  |
| `economicTier`          | yes      | booked_cac \| cpl \| cpc.                                                            |
| `effectiveTarget`       | yes      | The resolved per-tier target (CPA/CPL/CPC).                                          |
| `targetROAS`            | yes      | Target ROAS.                                                                         |
| `measurementTrusted`    | no       | `false` models a suspected conversion-denominator step-change (Gate 1). Omit ⇒ true. |
| `expectedOutcome`       | yes      | Reduced primary label: a recommendation action, `watch`, `insight`, or `none`.       |
| `expectedActions`       | no       | Actions that MUST be among the produced recommendations (set membership).            |
| `expectedWatchPatterns` | no       | Watch patterns that MUST be among the produced watches (set membership).             |
| `notes`                 | no       | Free-text justification.                                                             |

The code (`decideForCampaign`) is the source of truth: if a fixture's
`expectedOutcome` disagrees with what the pipeline returns, fix the fixture, not
the pipeline.

## Coverage & deferrals (Phase-A spec §11)

The eval is **pass/fail, not numerically graded**. Per the Phase-A spec, eval-green
is the stated prerequisite for engine changes (and IS satisfied here). Numeric
lift-scoring (a graded score that future engine changes must improve) is a deferred
enhancement, not a gate today.

§11 lists nine required scenarios. Which are covered AT the per-campaign
`decideForCampaign` seam (and thus by this matrix) vs elsewhere:

| §11 scenario                           | Status                           | Where / why                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| thin-data → watch                      | covered-at-seam                  | `suff-thin-data-watch` (`insufficient_evidence`).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| within-noise → watch                   | covered-at-seam                  | `smoke-cpc-withheld` / thin-data — sub-floor signal does not act.                                                                                                                                                                                                                                                                                                                                                                                                             |
| durable-breach → PAUSE                 | covered-at-seam                  | `suff-durable-volume-act` pins `expectedActions: [add_creative, pause]`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| zero-conversion burn → PAUSE / watch   | covered-at-seam                  | `zero-conversion-burn.jsonl`: `burn-durable-zero-conversion-acts` (durable → pause, never silent), `burn-zero-conversion-not-a-good-insight` (targetROAS 0 → no positive "maintained ROAS" insight), `burn-sub-durable-zero-conversion-watch` (`burn` watch), `burn-below-click-floor-abstains` (12 clicks < 20-click floor → abstain). conversions=0 collapses cpa to 0; the burn rule self-gates on spend + click floors and bypasses the conversion evidence floor (D1-1). |
| breach building (sub-durable) → watch  | covered-at-seam                  | `breach-building.jsonl`: a 1..6/14-day daily breach above the add-creative multiple emits an informational `breach_building` watch instead of staying silent until day 7 (D1-2). The durable twin (`suff-durable-volume-act`, 9 days) still ACTS, so this is additive visibility below the threshold, not a new pause path.                                                                                                                                                   |
| recovering → watch                     | covered-at-seam                  | `recovering-holds-no-destructive` — engine genuinely yields a stable `insight` (the no-destructive-action abstention); fixtures encode actual behavior, not aspiration.                                                                                                                                                                                                                                                                                                       |
| learner → no action                    | covered-at-seam                  | `learn-holds-during-learning`, `learn-v2-holds-reset-class-no-pause` (`in_learning_phase`).                                                                                                                                                                                                                                                                                                                                                                                   |
| learning-limited → STRUCTURAL remedy   | documented-elsewhere             | The STRUCTURAL remedy (`expand_targeting`/`consolidate`/`review_budget`) is emitted in the **audit-runner ad-set loop** via `LearningPhaseGuardV2.diagnoseLearningLimited`, OUTSIDE `decideForCampaign`. Covered by audit-runner tests. The seam's `learning_limited` input dimension is still covered here (`learn-limited-holds-reset-class`).                                                                                                                              |
| just-exited learning → not scaled yet  | deferred (engine gap)            | `decideForCampaign` has NO exit-stability scale-hold: `exitStability` is set to `"pending"` on a freshly-exited ad set but never consulted, so the scale rule fires on current CPA regardless. Faking a fixture would assert behavior the engine does not have. Documented as a Phase-B engine enhancement.                                                                                                                                                                   |
| measurement-untrusted → abstain (+fix) | covered-at-seam (+ deferred fix) | `measurement-untrusted-holds-act` pins `expectedWatchPatterns: [measurement_untrusted]`. The paired `fix_signal_health` rec is emitted **account-level** by the audit-runner signal-health pre-check (Step 0), OUTSIDE `decideForCampaign` — covered by audit-runner tests, NOT faked here.                                                                                                                                                                                   |
| off-platform leak → diagnose-only      | deferred (Phase B)               | Requires the Phase-B funnel router / `analyzeFunnel` leak diagnosis with an authority class; not reachable from the per-campaign seam. Deferred to Phase B.                                                                                                                                                                                                                                                                                                                   |

No silent caps: every §11 scenario above is either covered at the seam, covered by
audit-runner-level tests, or explicitly deferred with a reason.
