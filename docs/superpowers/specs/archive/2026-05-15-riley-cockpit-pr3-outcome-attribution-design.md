# Riley Cockpit — Wave B PR-3: Outcome Attribution Design

**Date:** 2026-05-15
**Status:** Spec — ready for writing-plans
**Parent spec:** [Riley Cockpit — Wave B Slicing Design](./2026-05-16-riley-wave-b-slicing-design.md) (PR-3 sketch at §"Slice B-Wave-3 — Outcome attribution")
**Sibling shipped:** [Riley Wave B PR-1 (WorkTrace mirror)](./2026-05-16-riley-wave-b-slicing-design.md) — PRs #538/#541/#543 merged 2026-05-15
**Alex parallel:** [Agent-Infra Parity PR-3 series](./2026-05-13-agent-infra-parity-design.md) — outcome-informed memory loop pattern

---

## Summary

Closes the first user-visible outcome loop for Riley: once an operator approves a Riley recommendation, a daily cron observes Meta metric movement in the post-action window and writes a `RecommendationOutcome` row. The /riley activity feed renders a delayed `"observed"` row with deterministic, allowlist-only copy when the outcome is unambiguous.

The slice is deliberately narrow:

- **Anchor:** `Recommendation.actedAt` (= `PendingActionRecord.resolvedAt`). No dependency on PR-2's `ExecutableWorkUnit` substrate; `executableWorkUnitId` is nullable and populated later.
- **Methodology:** directional only. The cron computes pre/post deltas, but never claims causation. The B.2 honest-impact guardrail remains in force across every Riley surface except the one new `"observed"` activity row.
- **Scope:** `pause` (medium confidence) and `refresh_creative` (low confidence) only. `scale` deferred to v1.1; `shift_budget_to_source` to v1.2.
- **Visibility:** write-but-hide — every contaminated, sparse, zero-baseline, or below-noise-floor outcome is still persisted for auditability with `cockpitRenderable=false`. Only clean rows render in the activity feed.
- **Surface:** one new activity-row kind (`"observed"`); no KPI strip / ROI bar / approval-card / composer copy changes.

---

## Decision context — why PR-3 ahead of PR-2

The parent spec sequences PR-2 (PlatformIngress + ExecutableWorkUnit) before PR-3 (outcome attribution). PR-2 is itself gated on volume preconditions that, at pilot scale and the weekly Riley emitter cadence, are months away from clearing organically. Re-evaluating against current reality:

- Riley emits Monday 09:00 UTC (`packages/ad-optimizer/src/inngest-functions.ts:169`). Pilot-scale volume to ≥100 emissions × ≥3 orgs ≈ ~8 months.
- PR-3's anchor — "operator accepted at time T, did metrics move after T?" — does not strictly require `ExecutableWorkUnit`. It needs an acted-timestamp, which `PendingActionRecord.resolvedAt` already provides.
- Decoupling the schema so `RecommendationOutcome` carries a required `recommendationId` and a nullable `executableWorkUnitId` lets PR-3 ship now and PR-2 enrich later without re-keying.

**`recommendationId` is the initial attribution anchor, not the canonical execution anchor.** Once PR-2 lands, new outcomes should prefer `ExecutableWorkUnit` timestamps where available while preserving `recommendationId` for product lineage.

---

## Data model

New Prisma model under the existing "AI Agent System: Outcome Tracking" header in `packages/db/prisma/schema.prisma` (line 576).

```prisma
model RecommendationOutcome {
  id String @id @default(cuid())

  // PendingActionRecord.id for intent="recommendation.*".
  // Product-facing name; the FK target is PendingActionRecord because
  // "Recommendation" is not its own table.
  recommendationId     String  @unique
  executableWorkUnitId String?

  organizationId String
  agentRole      String // "riley" v1; "alex" reserved
  actionKind     String // "pause" | "refresh_creative"

  anchorAt        DateTime // = PendingActionRecord.resolvedAt
  windowStartedAt DateTime // = anchorAt - windowDays  (matched-length pre-window)
  windowEndedAt   DateTime // = anchorAt + windowDays
  observedAt      DateTime @default(now())

  attributionMethod String // "directional" v1
  confidence        String // "low" | "medium"

  cockpitRenderable Boolean @default(false)

  metricSummary    Json    // { preWindowDays, postWindowDays, preWindow, postWindow, deltas }
  copyTemplate     String? // allowlisted template id; null when not renderable
  copyValues       Json?   // { deltaPct, windowDays } when renderable
  visibilityFlags  Json    // string[] reasons; non-empty ⇒ cockpitRenderable=false

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  recommendation PendingActionRecord @relation(
    fields: [recommendationId],
    references: [id],
    onDelete: Cascade
  )

  @@index([organizationId, agentRole, actionKind, windowEndedAt])
  @@index([organizationId, agentRole, cockpitRenderable, windowEndedAt])
  @@index([executableWorkUnitId])
}
```

**Notes:**

- `recommendationId` is unique → one outcome per acted recommendation. Idempotent re-runs short-circuit cheaply on the unique constraint.
- `visibilityFlags` is named broader than "contamination" because `below_noise_floor` is not contamination, just weak signal. Store writes `[]` rather than relying on a JSON default (Prisma JSON defaults are provider-fragile).
- `observedAt` separates attribution lifecycle from DB lifecycle (`createdAt`). If backfill ever happens, `observedAt` reflects when the row was attributed, not inserted.
- `metricSummary` captures pre/post window days explicitly so v1.1 can reinterpret historical rows if methodology changes.
- `executableWorkUnitId` is nullable in v1, populated by future workers once PR-2 lands. The migration when PR-2 lands is a column-fill, not a re-key.

---

## Methodology — directional only

The cron computes pre/post window deltas but labels them directionally. The /riley cockpit may say "CTR rose 12% in the 14 days after the creative refresh was accepted." It may **not** say "Riley caused CTR to recover" or "Riley saved $X."

### Per-kind configuration

Lives in `packages/core/src/recommendations/outcome-attribution-config.ts` so it is import-testable in isolation.

```ts
export const SETTLEMENT_LAG_HOURS = 24;

export const V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"] as const;

export const KIND_CONFIG = {
  pause: {
    windowDays: 7,
    confidence: "medium",
    primaryMetric: "spend",
    favorableDirection: "down",
    noiseFloorPct: 5,
    minimumAbsoluteMovementCents: 500, // $5 — protects against pct-on-tiny-baseline
  },
  refresh_creative: {
    windowDays: 14,
    confidence: "low",
    primaryMetric: "ctr",
    favorableDirection: "up",
    noiseFloorPct: 10,
  },
} as const;
```

### Window semantics

- Pre-window: `[anchorAt - windowDays, anchorAt)`
- Post-window: `[anchorAt, anchorAt + windowDays)`
- Matched-length pre-window is the v1 rule: easy to explain, easy to test, no method arguments about asymmetric baselines. If v1.1 changes it, `metricSummary.preWindowDays` / `postWindowDays` carry the lineage.

### Eligibility filter

A candidate `PendingActionRecord` is attributable when **all** hold:

1. `intent LIKE 'recommendation.%'`
2. `sourceAgent = 'riley'`
3. `status = 'acted'`
4. `resolvedAt IS NOT NULL`
5. Action kind (parsed from `parameters.__recommendation.action`) ∈ `V1_ATTRIBUTABLE_KINDS`
6. `resolvedAt + windowDays + SETTLEMENT_LAG_HOURS <= now()`
7. No existing `RecommendationOutcome` row keyed on this `id`

Settlement-lag exists because Meta's prior-day delivery data continues to settle for several hours after midnight. Attribution is best-effort; 24h is a pragmatic floor that avoids pulling incomplete data.

### Delta computation

For each candidate:

```
preWindow  = meta_insights(campaignId, [anchorAt - windowDays, anchorAt))
postWindow = meta_insights(campaignId, [anchorAt, anchorAt + windowDays))

pause:
  deltaPct          = ((postWindow.spend - preWindow.spend) / preWindow.spend) * 100
  deltaAmountCents  = postWindow.spend - preWindow.spend

refresh_creative:
  deltaPct = ((postWindow.ctr - preWindow.ctr) / preWindow.ctr) * 100
```

All raw values land in `metricSummary` for audit. Cockpit copy uses absolute `deltaPct` only; sign drives template selection.

### Visibility flags

Any flag ⇒ `cockpitRenderable = false`, `copyTemplate = null`, `confidence = "low"`. The row is still inserted for auditability.

| Flag                    | Trigger                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta_data_missing`     | Either window returned null or <50% of expected daily rows                                                                                                                                                                                                                          |
| `zero_pre_baseline`     | `preWindow.spend = 0` (pause) or `preWindow.ctr = 0` (refresh)                                                                                                                                                                                                                      |
| `below_noise_floor`     | `\|deltaPct\| < KIND_CONFIG[kind].noiseFloorPct` _or_ (pause-only) `\|deltaAmountCents\| < minimumAbsoluteMovementCents`                                                                                                                                                            |
| `same_campaign_overlap` | Another acted Riley recommendation on the same campaign exists with `resolvedAt ∈ [windowStartedAt - windowDays, windowEndedAt]` AND `other.id !== candidate.id`                                                                                                                    |
| `same_kind_retry`       | Subset of `same_campaign_overlap` where the other action shares this kind — additive metadata; does not change render rules beyond the parent flag. Intentionally not counted as its own bucket in `hiddenByFlag` since the parent `same_campaign_overlap` already drives the hide. |

### Template selection

When `cockpitRenderable = true`:

- Sign of `deltaPct` matches `KIND_CONFIG[kind].favorableDirection` → **favorable** template
- Sign opposes favorable direction → **changed** template ("changed" intentionally avoids implying performance; "moved" was rejected as too close to a claim)

---

## Copy contract

Lives in `packages/schemas/src/recommendation-outcome-copy.ts` so the allowlist is authoritative across API + future surfaces.

```ts
export const ALLOWLISTED_TEMPLATES = {
  "pause.spend.fell": "Spend fell {deltaPct}% in {windowDays}d after pause.",
  "pause.spend.changed": "Spend changed {deltaPct}% in {windowDays}d after pause.",
  "refresh.ctr.rose": "CTR rose {deltaPct}% in {windowDays}d after refresh.",
  "refresh.ctr.changed": "CTR changed {deltaPct}% in {windowDays}d after refresh.",
} as const;

export function renderOutcomeCopy(
  template: string,
  values: { deltaPct: number; windowDays: number },
): string | null {
  if (!(template in ALLOWLISTED_TEMPLATES)) return null; // fail-closed
  const fmt = ALLOWLISTED_TEMPLATES[template as keyof typeof ALLOWLISTED_TEMPLATES];
  return fmt
    .replace("{deltaPct}", Math.abs(values.deltaPct).toFixed(1))
    .replace("{windowDays}", String(values.windowDays));
}
```

**Rules:**

- Hard allowlist. Unknown template ⇒ `null` ⇒ row is dropped from `ActivityRow[]` at the API layer. The cockpit cannot render off-allowlist copy even if the DB drifts.
- 1-decimal absolute pct; sign carried by the template choice.
- `deltaPct` rendered as `|x|.x%`. `windowDays` as integer.

### Prohibited (B.2 guardrail stays in force)

- "Riley saved $X"
- "Riley improved CTR"
- "The refresh recovered fatigued creative"
- "Pause prevented wasted spend"
- Anything implying causation, attribution to Riley, or savings

---

## Cron architecture

Two-tier Inngest function set, matching the Riley emitter's dispatch/worker split.

### Dispatch (ad-optimizer)

`riley-outcome-attribution-dispatch` in `packages/ad-optimizer/src/inngest-functions.ts`:

- Trigger: `cron: "0 7 * * *"` (daily 07:00 UTC — 2h after the existing `daily-signal-health` cron; gives prior-day Meta delivery data settlement time, treated as best-effort).
- Body: enumerate active orgs with Riley deployments; emit `riley.outcome.attribute` events per org. Same fan-out shape as `ad-optimizer-weekly-dispatch`.

### Per-org worker (apps/api/inngest)

`processRileyOutcomeAttribution` lives in app layer because it must import both `@switchboard/db` (Layer 4, for `RecommendationOutcomeStore` + recommendation reads) and `@switchboard/ad-optimizer` (Layer 2, for `meta-campaign-insights-provider`). `apps/api` is the only place that legitimately bridges those.

### Kill-switch

The worker is guarded by `RILEY_OUTCOME_ATTRIBUTION_ENABLED`. Default `false` in production until rollout. When disabled the worker logs `{ skipped: "disabled" }` and returns without querying Meta or writing rows. The Inngest dashboard remains the emergency operational stop.

This is a deploy-controllable rollback path. The cron writes persistent rows and queries an external API — disabling via code/config is preferable to relying on dashboard intervention.

### Worker logic

```
Per (orgId, agentRole="riley"):

1. If RILEY_OUTCOME_ATTRIBUTION_ENABLED !== "true": log skipped:disabled; return.

2. Run summary counters initialized:
   { orgId, candidatesScanned, skippedExisting, notSettlementReady,
     outcomesWritten, renderable, hidden,
     hiddenByFlag: { meta_data_missing, zero_pre_baseline, below_noise_floor,
                     same_campaign_overlap } }

3. SELECT candidate PendingActionRecord rows per the eligibility filter above.

4. For each candidate:
   a. Cheap pre-check: SELECT 1 FROM RecommendationOutcome WHERE recommendationId = id.
      If exists → skippedExisting++; continue.
   b. Resolve actionKind from parameters.__recommendation.action.
      If kind ∉ V1_ATTRIBUTABLE_KINDS → skip silently (not a counter).
   c. Compute window bounds (matched-length pre/post).
   d. Query meta-campaign-insights-provider for campaignId from targetEntities,
      both pre and post windows.
   e. If meta returned sparse/missing → row with cockpitRenderable=false,
      visibilityFlags=["meta_data_missing"], confidence="low",
      copyTemplate=null. Insert; hidden++; hiddenByFlag.meta_data_missing++.
   f. Run overlap detection (same_campaign_overlap, same_kind_retry).
   g. Check zero_pre_baseline.
   h. Compute deltas; check below_noise_floor (per-kind threshold + pause-only
      absolute floor).
   i. If any flag set → write hidden row; bump per-flag counter.
   j. Otherwise: pick favorable vs changed template by sign, write renderable row;
      renderable++; outcomesWritten++.

5. Emit run-summary log.

Race-condition handling:
- Pre-check + DB @unique(recommendationId). On P2002 catch: log info,
  treat as skippedExisting, continue.
```

### Failure semantics

| Failure                                        | Behavior                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Meta provider throws / 5xx                     | Per-org worker fails; Inngest retries with backoff. No row written. Other orgs unaffected.          |
| Meta returns sparse data (<50% of window days) | Hidden audit row, `visibilityFlags=["meta_data_missing"]`.                                          |
| Pre-window zero baseline                       | Hidden audit row, `visibilityFlags=["zero_pre_baseline"]`.                                          |
| Below noise floor                              | Hidden audit row, `visibilityFlags=["below_noise_floor"]`.                                          |
| Overlap detected                               | Hidden audit row, `visibilityFlags=["same_campaign_overlap"]` (+ `"same_kind_retry"` if same kind). |
| Concurrent worker race                         | DB unique catches; `skippedExisting++`, continue.                                                   |
| Unknown copyTemplate at render                 | `renderOutcomeCopy` returns `null`; API drops the row. Fail-closed.                                 |
| Recommendation deleted                         | Cascade removes the Outcome.                                                                        |

The matrix deliberately distinguishes transient provider failure (retry, no row) from structurally missing data (hidden audit row).

---

## Cockpit surface

### Activity-row kind

Extend `ActivityKindSchema` in `packages/schemas/src/cockpit-activity.ts`:

```ts
export const ActivityKindSchema = z.enum([
  // ...existing kinds
  "observed", // RecommendationOutcome rendered into the activity feed
]);
```

UI treatment is **quiet** — no trophy, no success icon. The icon vocabulary should pick something neutral (eye, dot, chart-line) consistent with existing kinds. Treatment is the implementation's call, not the spec's, but it must not read as celebratory.

### Translation

The API returns `ActivityRow[]` already translated. The dashboard merges + sorts; it does not see `RecommendationOutcome` rows.

**Layering**:

```
packages/db/src/recommendation-outcome-store.ts
  RecommendationOutcomeStore.listRenderableForOrg({ orgId, agentRole, sinceMs, limit })
    → returns ONLY rows where cockpitRenderable = true (DB-level filter)

packages/schemas/src/recommendation-outcome-copy.ts
  ALLOWLISTED_TEMPLATES + renderOutcomeCopy()

apps/api/src/routes/cockpit/riley/outcomes.ts
  Fetches renderable outcomes via store
  Renders via renderOutcomeCopy() (fail-closed on unknown template)
  Returns ActivityRow[]

apps/dashboard/src/.../activity-feed (existing)
  Merges activityRows + outcomeRows; sorts by timestampIso desc
```

The translation is API-side, not dashboard-side, because the dashboard already imports `ActivityRow` from `@switchboard/schemas` and the wire-shape contract is `ActivityRow[]`. No new dashboard-side translator file.

### Activity-row shape per outcome

```ts
{
  id: `outcome:${outcome.id}`,          // identity only; not a deep-link carrier
  time: formatTime(outcome.windowEndedAt),
  timestampIso: outcome.windowEndedAt.toISOString(),
  kind: "observed",
  head: renderOutcomeCopy(outcome.copyTemplate, outcome.copyValues),
  body: campaignName
    ? `after ${actionLabel} · ${campaignName}`
    : `after ${actionLabel}`,
  // actionLabel = "pause" | "creative refresh"
  // campaignName resolved API-side from PendingActionRecord.targetEntities
  // (same source the emitter uses for humanSummary). If absent, body falls
  // back to the actionLabel-only form — no extra Meta call.
}
```

**`ActivityRow.id` is row identity only.** Deep-link metadata is explicitly not parsed from the prefix. If a future PR adds a "View original action" affordance, it adds an explicit optional `sourceRecommendationId` field to `ActivityRowSchema`. The DB already carries `recommendationId`; v1 is not boxed out.

**Confidence is not shown to the operator.** Showing "medium confidence" / "low confidence" in the visible body creates more questions than trust. Confidence stays in the DB row / `metricSummary` / audit layer.

### Chronological framing

The "observed" row renders at `windowEndedAt` in the feed, not back-dated to `anchorAt`:

```
Day 0  11:42  paused      Campaign X — over-target CPA, $420 dollars-at-risk
Day 7  07:00  observed    Spend fell 92.0% in 7d after pause
                          after pause · Campaign X
```

This matches the directional methodology: the observation is its own event, not retroactive context on the action row.

### B.2 honest-impact gate — exact scope of the flip

Wave A's B.2 guardrail blocked causal language. PR-3 introduces one narrow exception:

- The new `"observed"` activity row may render allowlisted directional copy from `ALLOWLISTED_TEMPLATES`.
- **All other Riley surfaces remain under the B.2 guardrail unchanged** — KPI strip, ROI bar, approval cards, recommendation cards, composer responses, palette toasts.
- The B.2 spec text gets a one-paragraph amendment referencing this allowlist file.

No copy in existing /riley views changes. No new components ship. The approval-card UI renders byte-identical pre/post-PR.

---

## Migration

Per CLAUDE.md `feedback_prisma_migrate_dev_tty` and `feedback_prisma_index_name_63_char_limit`:

1. Hand-author migration SQL via `pnpm prisma migrate diff --from-empty --to-schema-datamodel --script` to capture canonical Prisma-truncated index names.
2. `pnpm db:migrate` in dev; `pnpm db:check-drift` before commit (requires Postgres).
3. Migration filename: `<timestamp>_riley_recommendation_outcome`.

No data migration required — the table is new. `executableWorkUnitId` stays null for all v1 rows.

---

## Test plan

Layered tests; pure logic dominates.

1. **`packages/schemas/src/__tests__/recommendation-outcome-copy.test.ts`** — allowlist enforcement, render output for each template, fail-closed on unknown template, formatting (1-decimal abs, integer windowDays).

2. **`packages/db/src/__tests__/recommendation-outcome-store.test.ts`** — mocked Prisma (mirrors `prisma-workflow-store.test.ts` per `feedback_api_test_mocked_prisma`). Insert + listRenderableForOrg filtering on `cockpitRenderable=true` + unique-constraint race behavior.

3. **`packages/core/src/recommendations/__tests__/outcome-attribution.test.ts`** — pure logic:
   - Settlement-lag eligibility filter (boundary cases at `now - 24h ± 1m`)
   - Pre/post delta math for both kinds
   - Noise-floor gates: pause 5% + 500-cent absolute floor; refresh 10%
   - Overlap detection: same campaign / same kind / current-rec exclusion (`other.id !== candidate.id`) / zero baseline
   - Template selection: favorable vs changed by sign

4. **`apps/api/src/__tests__/api-cockpit-riley-outcomes.test.ts`** — integration with `buildTestServer`. Verifies:
   - Mocked store rows → `ActivityRow[]` out
   - `cockpitRenderable=false` rows never reach the wire (DB-level + belt-and-suspenders)
   - Fail-closed on bad `copyTemplate` (row dropped from response)
   - `body` content (no confidence shown; campaign-name fallback)

5. **`apps/api/src/__tests__/api-cockpit-riley-outcome-cron.test.ts`** — worker integration:
   - Mocked Prisma + mocked `meta-campaign-insights-provider`
   - Full eligibility → Meta query → write path for both kinds
   - Meta-failure retry semantics (per-org isolation)
   - Run-summary log emitted with per-flag counters
   - Kill-switch path: env `false` → no Meta calls, no writes

No dashboard-side tests. Dashboard only merges + sorts existing `ActivityRow[]`; covered by existing activity-feed tests.

---

## Observability

Worker emits a structured run-summary log on completion:

```ts
{
  orgId: string;
  candidatesScanned: number;
  skippedExisting: number;
  notSettlementReady: number;
  outcomesWritten: number;
  renderable: number;
  hidden: number;
  hiddenByFlag: {
    meta_data_missing: number;
    zero_pre_baseline: number;
    below_noise_floor: number;
    same_campaign_overlap: number;
  }
}
```

`hiddenByFlag` is the diagnostic that answers "is the system working but hiding everything?" — useful when the first cron appears to do nothing in pilot.

Errors flow through existing Sentry wiring once it covers ad-optimizer cron paths.

---

## Rollout

1. Land migration + schema + store (no behavior change in prod).
2. Land cron + worker + API route, `RILEY_OUTCOME_ATTRIBUTION_ENABLED=false` in prod.
3. Verify in staging with seeded historical acted recommendations.
4. Flip `RILEY_OUTCOME_ATTRIBUTION_ENABLED=true` in prod after sanity checks.
5. Monitor run-summary logs for first weeks. Tune noise floors if `hiddenByFlag.below_noise_floor` dominates and the hidden rows look like legitimate signal.

If the cron misbehaves: set env back to `false` and redeploy, or disable the Inngest function manually for immediate stop.

---

## Out of scope (explicitly deferred)

- **`scale` and `shift_budget_to_source` action kinds** — v1.1 and v1.2. Shift in particular needs source-level breakdown queries and is the highest-fragility surface; not appropriate for the first attribution PR.
- **Counterfactual modeling** (matched control, synthetic baseline, projected counterfactual for pause) — v2. v1 is directional only.
- **Pattern extraction / learning memory** — PR-4. Outcome rows accumulate; PR-4 reads them.
- **KPI strip / ROI bar copy changes** — B.2 guardrail stays in force everywhere except the `"observed"` row.
- **Causal claims** anywhere ("Riley saved", "refresh recovered", "pause prevented") — never v1; possibly v2 once counterfactuals exist.
- **Deep-link from "observed" row to original action row** — follow-up. ActivityRow shape is forward-compatible via an explicit `sourceRecommendationId` field if needed.
- **`executableWorkUnitId` population** — auto-fills when PR-2 lands. PR-3 leaves the column nullable.
- **Dashboard-side translation** — API returns `ActivityRow[]` already rendered. Translator lives in API + schemas.
- **Outcome dashboard / report** — out. Activity-row line is the entire UI surface.
- **Emitter-side metric snapshots** — out. Adding writes to the act/sink path before the directional loop has proven its shape would mix measurement into the approval path prematurely.

---

## Acceptance criteria

PR-3 ships when:

1. `RecommendationOutcome` table migrated; `pnpm db:check-drift` clean.
2. Cron dispatch + per-org worker registered; `RILEY_OUTCOME_ATTRIBUTION_ENABLED` env honored.
3. Eligibility filter respects settlement lag, kind allowlist, and existence pre-check.
4. Per-kind delta math + noise-floor + overlap detection covered by pure-logic tests with documented boundary cases.
5. `ALLOWLISTED_TEMPLATES` allowlist enforced; unknown template ⇒ row dropped from API response.
6. `/api/cockpit/riley/outcomes` returns `ActivityRow[]` with `kind="observed"`; `cockpitRenderable=false` rows never reach the wire.
7. Existing /riley activity feed merges + sorts the new rows; no other surfaces change.
8. Run-summary log emitted with full per-flag counters.
9. Kill-switch verified: env `false` ⇒ no Meta calls, no DB writes, log `skipped:disabled`.
10. B.2 spec amendment landed referencing this design.
