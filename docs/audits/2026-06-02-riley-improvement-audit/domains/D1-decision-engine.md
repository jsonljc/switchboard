# D1 — Autonomous Decision Engine & Recommendation Quality (the heuristic "Brain")

> Raw domain audit. Evidence cited as `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).
> Note: #792 ("Eyes") touched only the provider/client/cron-wiring — **not** the engine/analyzers below, so these findings are accurate for post-Eyes `main`.

## 1. CURRENT STATE (verified by reading)

**Pipeline trace** (`audit-runner.ts` `AuditRunner.run`):

- Step 0: signal-health pre-check; red score short-circuits everything → returns only `fix_signal_health` recs (`audit-runner.ts:236-279`).
- Steps 1-4: pull current/previous campaign insights, CRM funnel, aggregate metrics, `comparePeriods` deltas (`:250-319`).
- Step 5 (per-campaign loop, `:333-420`): (5a) learning check; (5c) `diagnose(campaignDeltas)`; (5d) skip if `isPerformingWell && diagnoses.length===0`; (5e) `getTargetBreachStatus`; (5f) `generateRecommendations(...)`; (5g) `learningGuard.gate()` → push to `watches` or `recommendations`.
- Steps 6-8: V2 ad-set learning, trends, budget-distribution, source-comparison (all attached to report).
- Step 9: if `recommendationEmitter` wired, `runRecommendationSink` → per-rec `emit()` → `routeRecommendation` → queue/shadow/dropped (`:527-544`).

**Scoring/ranking reality**: There is **no ranking**. Each rec is independently routed by `routeRecommendation` (`packages/core/src/recommendations/router.ts:21-35`) on `(confidence, dollarsAtRisk, action)` only. No sort, no top-N, no dedup, no cross-rec prioritization. `confidence`/`urgency` are **hardcoded constants per rule**, not computed:

- pause `0.9`/`immediate` (`recommendation-engine.ts:140-141`); add_creative `0.8`/`this_week` (`:116-117`); review_budget `0.65`/`this_week` (`:160-161`); scale `0.7`/`this_week` (`:218-220`); refresh_creative `0.85` fatigue / `0.7` saturation (`:236,253`); restructure `0.65`/`next_cycle` (`:269-271`); shift_budget `0.6` (`:286`); switch_event `0.75` (`:308`); harden_capi `0.7` (`:327`); hold `0.75` (`:347`). LearningLimited rec `0.75` hardcoded (`audit-runner.ts:451-452`).
- `urgency→risk` and `urgency→expiry` are also fixed maps (`recommendation-sink.ts:79-94`).

**Thresholds** (all magic constants): `ADD_CREATIVE_CPA_MULTIPLIER=2`, `PAUSE_CPA_MULTIPLIER=3`, `KILL_DAYS_THRESHOLD=7`, `MAX_BUDGET_INCREASE_PERCENT=20` (`recommendation-engine.ts:19-22`); significance = fixed `0.15` relative (`period-comparator.ts:21`); learning `LEARNING_DAYS=7`/`LEARNING_EVENTS_REQUIRED=50` (`learning-phase-guard.ts:15-16`); budget imbalance `spendShare>0.4`/`<0.1` (`budget-analyzer.ts:39,53`); creative `spendShare>0.6`, CPA `>2× avg` (`creative-analyzer.ts:109,124`); saturation decay `0.3` over `4` weeks (`saturation-detector.ts:5,45-51`).

**Eyes (PR #792) actually changed**: only `meta-campaign-insights-provider.ts` (real daily-breach via `time_increment=1`, ad-set-edge learning derivation), `meta-ads-client.ts`, `inngest.ts` wiring (real provider), and a comment + Nova→Riley rename in `recommendation-engine.ts`/`audit-runner.ts`. Diff confirms **zero scoring/analyzer/threshold changes**. PR2/PR3 are genuinely unbuilt.

## 2. GAPS / WEAKNESSES vs north star

**G1 — Production cron passes neither `getAdSetInsights` nor `getTrendData`, so the entire V2 block is dead.** `adOptimizerDeps` (`apps/api/src/bootstrap/inngest.ts`) has no such keys → in `audit-runner.ts:298-305` both `adSetData` and `trendRawData` are always `null` → Steps 6 (ad-set learning + LearningLimited recs `:427-468`), 7 (trends `:471-487`) never execute in production. Verified by grep: no non-test caller passes these. Ad-set-level learning protection and the only `expand_targeting/consolidate` recs are inert via the cron.

**G2 — `sourceComparison` is computed but never fed to the engine.** Step 8b builds it (`audit-runner.ts:511-516`) and attaches it to the report, but `generateRecommendations` (Step 5f) is called **without** `sourceComparison`. `findShiftCandidates` — the engine's _only_ multi-signal trueROAS-fusion path (`recommendation-engine.ts:82-102,280-301`) — therefore never runs autonomously. `shift_budget_to_source` can never fire from the cron.

**G3 — 5 of 9 diagnoses are dead weight.** The engine consumes only `creative_fatigue`, `audience_saturation`, `ctwa_drive_by_clickers`, `landing_page_drop` (`recommendation-engine.ts:232,248,265,304,343`). `competition_increase`, `lead_quality_issue`, `audience_offer_mismatch`, `lead_quality_degradation`, `account_level_issue` (`metric-diagnostician.ts:53-152`) are computed but **no rule reads them** → neither recommendation nor watch nor insight. Notably `lead_quality_degradation` (CPL down but cost-per-booked up — the exact "cheap junk leads" pattern) is computed and discarded.

**G4 — No sample-size / minimum-traffic gate anywhere.** Spec §3.2 requires "≥20 clicks, ≥7 days data" for a kill/cut. Grep confirms **zero** `clicks`/`sampleSize`/min-traffic guard in `recommendation-engine.ts`. A campaign with 1 click, 0 conversions, $50 spend over 7 days → 7 thin no-conversion days → `periodsAboveTarget=7` → pause at 0.9 confidence on essentially no data. **Statistically unsound.**

**G5 — Single-rule triggering; no multi-signal fusion.** Every action fires from one predicate. Pause requires only `aggregate7dCPA > 3×target AND dailyBreachDays ≥ 7` — two views of the _same_ CPA metric, not independent signals. Contradictory diagnoses can co-emit (saturation → both refresh_creative AND restructure, `:246-277`).

**G6 — Confidence is uncalibrated.** Constants hand-picked, never validated against outcomes. Yet `routeRecommendation` gates routing on `confidence ≥ 0.85` shadow / `≥ 0.5` queue (`router.ts:7-11`). Since every rule's confidence is fixed, the threshold partitions _action types_, not _evidence strength_ — a 0.9 pause on 1 day of data == a 0.9 pause on 30 days.

**G7 — `routeRecommendation` stale action set + dollars-at-risk hole.** `REVERSIBLE_ACTIONS = {"pause","reduce_budget"}` (`router.ts:13`) but `reduce_budget` is not in `AdRecommendationActionSchema` (`schemas/ad-optimizer.ts:16-31`) — dead entry. `estimateRisk` scrapes `$N` from `estimatedImpact` (`recommendation-sink.ts:297-301`), but no engine `estimatedImpact` contains a `$` figure → `dollarsAtRisk` always 0 → every reversible high-confidence pause routes to `shadow_action`. Inert today (Phase 1) but a live foot-gun the moment Phase 2 wires execution.

**G8 — Abstention is binary and lossy.** Only `watch` path is learning-phase gating (`learning-phase-guard.ts:68-93`) + the dead V2 ad-set gate. No `watch` for "breach not durable" (a 5-of-14-day breach produces silence), thin data, or dropped diagnoses. Spec §3 says "never silence" — today these are silent. The `dropped` surface (`router.ts:34`, confidence < 0.5) is also silent.

**G9 — Rationale fails the §3.5 "operator-explainable" contract.** Rationale `steps` are static templates with an interpolated multiplier (`:120-125`). They don't name the economic tier (schema has no such field, `schemas/ad-optimizer.ts:168-181`), don't state margin basis, and the multiplier shown is the 7-day aggregate while the day-count is the 14-day window — two denominators presented as one fact. No evidence object attached.

**G10 — Breach driver mixes time windows.** `getCPA(deltas)` is 7-day aggregate (`:47-49`); `periodsAboveTarget` is the 14-day daily count. Their AND (`:188-197`) is a reasonable fail-safe, but a campaign bad 7 of 14 days yet recovering in the last 7 is silently dropped (G8), and the number reported ("Nx target for D days") conflates the two windows.

## 3. RANKED RECOMMENDATIONS

**R1 — Wire `sourceComparison` and the V2 data feeds into the autonomous path. [extends:PR3]** Pass `sourceComparison` into `generateRecommendations` (`audit-runner.ts:400-409`); add `getAdSetInsights`/`getTrendData` to `adOptimizerDeps`. Effort M, risk M. PR3 as written does NOT call out that `sourceComparison`/V2 deps are unwired — add to scope.

**R2 — Minimum-traffic / sample-size gate. [already-planned:PR3 — verify lands in ENGINE]** Thread per-campaign clicks + days-of-data; require `clicks ≥ 20 && daysData ≥ 7` before any pause/add_creative; below → `watch`. `RecommendationInput` carries `currentSpend` but not clicks (`:26-43`). Effort S. Kills the "pause on 1-click noise" failure (G4) — the single most dangerous unsoundness.

**R3 — Explicit abstention `watch` for non-durable / thin / dropped-diagnosis cases. [extends:PR3]** Where the breach AND fails (`:188`), where R2's gate fails, and for the 5 dead diagnoses (G3), push a typed `watch` instead of silence. Surfaces `lead_quality_degradation` even pre-PR2. Effort S-M.

**R4 — Switch kill/scale driver to cost-per-booked + fallback ladder + tier on schema. [already-planned:PR2]** Replace `getCPA(deltas)` (`:47-49,180`); add `economicTier`/`marginBasis`/evidence to `RecommendationOutputSchema` (absent today). Effort L. Flag: the schema fields §3/§5 require do not exist yet.

**R5 — Lightweight statistical gating (no ML). [net-new — beyond PR3]** (a) Significance by sample not fixed 15% (`period-comparator.ts:21`) — Poisson/normal-approx CI on conversion rate. (b) Beta-Binomial breach confidence instead of `periodsAboveTarget ≥ 7` (`:191`) — encodes "7 of 7" ≫ "7 of 14". (c) Robust median+MAD outliers instead of `cpa > 2× mean` (`creative-analyzer.ts:124`, non-robust). Effort M. The strongest beyond-PR3 case: the spec ships hard thresholds that act on counts as small as 1.

**R6 — Calibrate confidence; fix `routeRecommendation` action set + risk producer. [extends:PR4 / net-new]** Fix `REVERSIBLE_ACTIONS` (`router.ts:13`), add structured `dollarsAtRisk` so `estimateRisk` stops returning 0 (G7); derive confidence from R5 statistics. Effort S+M.

**R7 — Multi-signal corroboration before destructive actions. [net-new]** Require pause to be corroborated by ≥2 independent signals (durable CPA breach AND rising frequency OR falling CTR OR negative trend), not two views of CPA (G5, G10). Resolve contradictory saturation diagnoses into one ranked action. Effort M.

## 4. VERIFICATION LOG

Confirmed by reading: full pipeline trace + all confidence/urgency/threshold constants are hardcoded (`audit-runner.ts`, `recommendation-engine.ts`, `learning-phase-guard.ts`, `metric-diagnostician.ts`, `period-comparator.ts`, `recommendation-sink.ts`, `router.ts`, `emit.ts` read in full). G1 (V2 feeds unwired), G2 (sourceComparison not fed), G3 (5 dead diagnoses), G4 (no sample gate), G7 (`reduce_budget` not a real action; `$` absent from estimatedImpact) — all grep-confirmed. Eyes diff scope (provider/client/wiring only) — diff-confirmed. Schema lacks `economicTier`/`marginBasis`/`candidateAction`/evidence/sample fields — read `schemas/ad-optimizer.ts:168-181`.
Inferred/uncertain: G7 routing-to-shadow consequence — confirmed `dollarsAtRisk=0` routes a 0.9 pause to `shadow_action`; did not fully trace whether any Phase-1 path makes `shadow_action` execute a Meta write (read `act.ts` — `confirm`/`undo` only change status). PR4's no-ghost-execution assertion is the right lock. R5 statistics are a design proposal (net-new).
Cross-domain (noted): the `metrics-riley.ts` cost-per-lead mislabel (`:100-106`) is PR2/agent-home surface (see D3/D9).
