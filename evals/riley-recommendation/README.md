# Riley-Recommendation Eval Harness

Deterministic regression matrix for Riley's per-campaign decision pipeline
(`decideForCampaign` in `packages/ad-optimizer/src/campaign-decision.ts`).

Like the governance-decision harness, this one is **model-free and DB-free**:
every case is resolved through the real `decideForCampaign` pipeline and reduced
to a single label (a recommendation action, `watch`, or `insight`), then compared
to the fixture's `expectedOutcome`. It needs **no `ANTHROPIC_API_KEY` and no
Postgres**, so it runs in CI as a plain vitest test and is fully reproducible
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
- **Learning lockout:** destructive actions held as a `watch` while an ad set is
  in its learning phase.

## How a case is reduced

`decideForCampaign` returns `{ insights, watches, recommendations }`. The harness
reduces that to one label with the priority **recommendation action > `watch` >
`insight`** (see `decide.ts`). The fixture's `expectedOutcome` is that label.

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

| Field                  | Required | Description                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------------- |
| `id`                   | yes      | Unique slug (kebab-case).                                                 |
| `current` / `previous` | yes/no   | Campaign metric snapshots; `previous` may be `null`.                      |
| `targetBreach`         | yes      | `{ periodsAboveTarget, granularity }` (weekly granularity = approximate). |
| `learningState`        | yes      | learning \| learning_limited \| success \| unknown.                       |
| `economicTier`         | yes      | booked_cac \| cpl \| cpc.                                                 |
| `effectiveTarget`      | yes      | The resolved per-tier target (CPA/CPL/CPC).                               |
| `targetROAS`           | yes      | Target ROAS.                                                              |
| `expectedOutcome`      | yes      | Reduced label: a recommendation action, `watch`, or `insight`.            |
| `notes`                | no       | Free-text justification.                                                  |

The code (`decideForCampaign`) is the source of truth: if a fixture's
`expectedOutcome` disagrees with what the pipeline returns, fix the fixture, not
the pipeline.
