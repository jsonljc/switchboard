# Riley Improvement Audit — Findings & Prioritized Backlog

**Date:** 2026-06-02
**Baseline:** `origin/main` @ `38f0129d` — **post-#792 ("Eyes"), which merged 2026-06-02 01:41 UTC.**
**Subject:** Riley = the `ad-optimizer` agent (`packages/ad-optimizer/` + its `packages/core` surfaces + the weekly-audit Inngest cron + its conversational runtime).
**North star:** Riley's judgment outperforms a human media buyer, then (later) executes under governance.
**Method:** 9 parallel domain auditors, each citing `file:line` evidence and tagging every recommendation `already-planned` / `extends` / `net-new`, then cross-verified against live `main`. Full per-domain evidence in [`domains/`](./domains/).

---

## 0. How to read this

This is decision support for _"what to do next to make Riley outperform a human media buyer."_ It is deliberately opinionated about sequence.

- **§1** — the one-paragraph thesis.
- **§2** — corrected current state (post-Eyes).
- **§3** — the meta-finding: _computed, then discarded._ This is the most important section.
- **§4** — cross-cutting themes.
- **§5** — the prioritized backlog (the actionable part).
- **§6** — recommended sequence.
- **§7** — reconciliation with the existing Phase-1/Phase-2 roadmap (what this audit **adds** or **corrects**).
- **§8** — verification log & corrections to stale assumptions.
- **§9** — open decisions for you.

---

## 1. Thesis

**Riley's brain is already far smarter than its behaviour — it computes intelligence it then throws away.** Five independent auditors converged on the same pattern: capabilities are _built and tested_, then _orphaned before they reach a decision_. The "Eyes" PR (#792, merged today) is the first correction of exactly this pattern — it reconnected the perception layer that a prod stub had severed. The highest-leverage next moves are **not** new ML or bigger models. They are, in order:

1. **Finish reconnecting what already exists** — aim at booked customers (not cheap leads), wire the orphaned analyzers, surface the diagnoses Riley already computes and drops.
2. **Make "outperform human" _measurable_** — a deterministic, model-free eval gate so every subsequent change is provably non-regressive. This repo already has a copy-ready template for it.
3. **Close the flywheel's open legs** — learning-from-outcomes (Riley currently learns _nothing_ across audits) and Riley→Mira propagation (no link exists).
4. **Give Riley a voice** — it has **no conversational surface at all** today; you cannot ask it a question.
5. **Only then, execution** — Phase-2 writes, behind the measurement gate and one critical governance fix.

The cheapest, highest-confidence work (correctness + safety floor + measurement) should land _before_ the next capability PR, because Riley can now _see_ (post-Eyes) and will start producing confident recommendations on data it doesn't yet weigh soundly.

---

## 2. Current state of Riley (corrected to post-Eyes `main`)

| Layer                         | State on `main` today                                                                                                                                                                                                           | Evidence |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Perception ("Eyes")**       | **Newly sighted (#792).** Weekly audit now uses the real `MetaCampaignInsightsProvider` (`inngest.ts:242`): daily-incremented CPA breach (`time_increment=1`, trailing 14d) + ad-set learning phase from `learning_stage_info`. | D2, D8   |
| **Decision engine ("Brain")** | **Pure deterministic heuristics, no LLM.** Hardcoded thresholds + hardcoded per-rule confidences. No ranking, no sample-size gate, no statistical significance, single-rule triggering.                                         | D1       |
| **Economic target**           | **Optimizes cost-per-LEAD, not cost-per-booked.** A campaign flooding cheap junk leads that never book scores as a _win_. Booked-CAC/trueROAS economics exist but don't drive decisions.                                        | D1, D3   |
| **Attribution closure**       | Lead→campaign attribution works; the `booked` event has `value:0` and **no campaign id**; CAPI send-back is flag-off; the reconciliation runner is a **hardcoded "healthy" stub**.                                              | D3       |
| **Learning loop**             | **Riley learns nothing across audits.** The "outcome attribution loop" is a display-only spend/CTR sparkline; outcomes are never read back into judgment. Default-off in prod.                                                  | D4       |
| **Execution / autonomy**      | **Advisory only — verified.** No code path reaches any `MetaAdsClient` mutating method. Even a human "approve" executes nothing on Meta. `#788` spend-approval lever is real but has no Riley producer.                         | D5       |
| **Cross-agent**               | **No Riley→Mira or Riley→Alex link.** Riley computes "fatigue → brief fresh creative" and dead-ends it as an operator card.                                                                                                     | D6       |
| **Measurement**               | **No living recommendation-quality benchmark, no CI gate, no no-ghost-execution test.** #781's golden-scenario suite does not cover Riley at all.                                                                               | D7       |
| **Scale / ops**               | Serial audit loop, ~4 Graph calls/campaign × a **60 s/call** fixed rate limit ⇒ ~4 min/campaign; ~hours at modest org/campaign counts. `onFailure alert:false`; no zero-output alert. `coverage-validator` orphaned.            | D2, D8   |
| **Conversational runtime**    | **None.** Riley is unwired in `SkillMode` — any chat request returns `SKILL_NOT_FOUND`. The interactive tools + builder exist but have been dead since #252.                                                                    | D9       |

**One-line summary:** post-Eyes, Riley can finally _see_; it still _aims at the wrong target_, _doesn't use the sharp tools it owns_, _can't be talked to_, _doesn't learn_, and _can't yet prove_ it's any good.

---

## 3. The meta-finding: _computed, then discarded_

The single strongest pattern, surfaced independently by D1, D2, D3, D4, D6, D8 and D9. Riley repeatedly builds and tests a capability, then drops the result before it changes a decision or reaches a user. This reframes "improve Riley": **much of the highest-leverage work is wiring, not building.**

| Capability (built + tested)                                                                           | Where it's computed                                                          | Where it's discarded                                                 | Consequence                                                             | Domain     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| Per-**source** booked-CAC / trueROAS economics                                                        | `source-comparator.ts:34-51`                                                 | Never passed into `generateRecommendations` (audit-runner Step 5f)   | The only customer-economics fusion path is dead in the autonomous audit | D1, D3     |
| Per-**campaign** booked-CAC (the data)                                                                | `crm-funnel-store.ts:42` (rows keyed `sourceType::sourceCampaignId::stage`)  | Collapsed to one aggregate in `real-provider.ts:121-133`             | The "hard fork" PR2 feared — actually a one-function projection away    | D3         |
| Creative-dedup / saturation / breach-forecast analyzers                                               | `creative-analyzer.ts`, `saturation-detector.ts`, `trend-engine.ts`          | Never called by `audit-runner` (only `analyzeBudgetDistribution` is) | Weekly audit is far weaker than Riley's (also-orphaned) chat tools      | D1, D2     |
| 5 of 9 diagnoses, incl. `lead_quality_degradation` (the literal "cheap leads that never book" signal) | `metric-diagnostician.ts:53-152`                                             | No engine rule consumes them                                         | The exact junk-lead pattern is detected and silently dropped            | D1, D6     |
| Cross-campaign budget imbalance                                                                       | `budget-analyzer.ts:38-67`                                                   | `audit-runner` builds `budgetDistribution` then never emits a rec    | Detected reallocation opportunities discarded                           | D1, D7, D8 |
| V2 ad-set learning + trend forecasting (whole block)                                                  | `audit-runner.ts:431-496`                                                    | `getAdSetInsights` / `getTrendData` deps never wired in `inngest.ts` | Ad-set-level protection + early-warning forecasting dead in prod        | D1, D2     |
| Outcome-attribution loop                                                                              | `outcome-attribution.ts` + cron                                              | Only consumer is the cockpit activity feed (display string)          | Riley learns nothing from what happened after a rec                     | D4         |
| `injectedPatternIds` (per-pattern lift substrate)                                                     | written to `WorkTrace`                                                       | only read by hash-exclusion lists — never aggregated                 | Per-pattern lift is unmeasurable; flywheel PROOF leg open               | D4         |
| Riley's creative-fatigue trigger ("Trigger PCD for fresh creative")                                   | `recommendation-engine.ts:231-262`                                           | dead-ends as an operator card                                        | No Riley→Mira propagation though the handoff substrate exists           | D6         |
| Interactive `ads-data` / `ads-analytics` tools + builder                                              | `apps/api/src/tools/ad-optimizer/*` + `builders/ad-optimizer-interactive.ts` | Never registered in `skill-mode.ts` (dead since #252)                | Riley can't be asked anything (`SKILL_NOT_FOUND`)                       | D9         |
| Account-level daily Graph data                                                                        | fetched once                                                                 | re-queried & `.find()`'d **per campaign**, N×                        | Hours-long audits; redundant Graph spend                                | D8         |
| `coverage-validator` (data-sufficiency gate)                                                          | `onboarding/coverage-validator.ts` (tested)                                  | instantiated nowhere                                                 | Audit runs (and emits confident recs) on zero-data orgs                 | D8         |

> If you do nothing else strategic, internalize this: **Riley's intelligence is mostly already paid for. It is sitting one wire away from the decision.**

---

## 4. Cross-cutting themes

- **A — Wrong target.** Cost-per-lead, not cost-per-booked, drives every kill/scale decision (`recommendation-engine.ts:48`, `audit-runner.ts:146`). This is PR2's premise; the audit **sharpens** it (see keystone in §5).
- **B — Statistical unsoundness.** No minimum-traffic floor (spec requires ≥20 clicks; absent in code), so Riley will `pause` a 1-click/0-conversion campaign at `0.9` confidence. Confidences are hardcoded constants, uncorrelated with evidence strength. (D1, D7)
- **C — Silence instead of abstention.** Thin-data, non-durable-breach, and dropped-diagnosis cases produce _nothing_ — violating the spec's "never silence" abstention contract. (D1, D7)
- **D — Unmeasurable.** "Outperform human" is asserted, never tested. No benchmark, no regression gate, no no-mutation invariant. A model-free CI template (`evals/governance-decision/`) is copy-ready. (D7)
- **E — Won't scale.** 60 s/call fixed limit × ~4 serial calls/campaign, serial across deployments, single long Inngest step. Batching makes most per-campaign calls _unnecessary_. (D2, D8)
- **F — Open learning loop.** No IMPROVE leg. The cheapest learning substrate — the operator's approve/reject verdict on each rec — is discarded. (D4)
- **G — Execution footgun waiting.** The obvious Phase-2 registration path (`system_auto_approved`) **bypasses** #788, risk scoring, and spend caps. Must be closed _before_ any write path. (D5)
- **H — No voice.** Riley has no conversational surface; the spec even assumes a chat path that doesn't exist. (D9)
- **I — No propagation.** The flywheel's cross-agent leg (Riley→Mira creative refresh; Riley→Alex lead-quality) has zero substrate on Riley's side, though the `delegate`/`submitChildWork`/`pastPerformance` plumbing all exists. (D6)

---

## 5. Prioritized recommendation backlog

Ranked by **(impact on the north star × confidence) ÷ effort**, deduped across domains, grouped into tiers that also form the recommended sequence. Effort: S ≤ ~1 day, M ≈ a few days, L ≈ a week+. Tags: `[planned]` already in the roadmap, `[extends]` sharpens a planned PR, `[new]` net-new.

### Tier 0 — Correctness & safety floor (do _now_, with/just after Eyes; cheap, high-confidence)

| #   | Recommendation                                                                                                                                              | Why now                                                                                                                         | Effort | Tag                            | Key location                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ | --------------------------------------------------------------------- |
| 0.1 | **Fix the breach denominator** — fetch the specific result action (attribution-windowed Lead/Purchase) instead of Meta's unfiltered aggregate `conversions` | Eyes just turned the daily-breach signal on; that signal sits on an ambiguous denominator → false-fire risk on every kill/scale | M      | `[extends PR1]`                | `meta-ads-client.ts:327,346`; `meta-campaign-insights-provider.ts:94` |
| 0.2 | **Minimum-traffic / sample-size gate** (≥20 clicks, ≥7d) before any pause/cut; else `watch`                                                                 | Today Riley pauses 1-click noise at 0.9 confidence — the most dangerous unsoundness                                             | S      | `[planned PR3 → pull forward]` | `recommendation-engine.ts:187-197` (no floor today)                   |
| 0.3 | **Explicit abstention `watch`** for non-durable breach / thin data / dropped diagnoses                                                                      | Satisfies the spec's "never silence"; surfaces junk-lead signal even pre-PR2                                                    | S–M    | `[extends PR3]`                | `recommendation-engine.ts:188`; `metric-diagnostician.ts`             |
| 0.4 | **No-ghost-execution invariant test** — assert a Phase-1 audit calls no `MetaAdsClient` mutating method / dispatches no ad action                           | Turns "advisory only" from caller-absence into a guarded invariant before Phase-2 work begins                                   | S      | `[planned PR4]`                | new test beside `audit-runner.test.ts`                                |
| 0.5 | **Observability**: flip weekly-audit `onFailure alert:true`; alert on zero-output audits                                                                    | A silent regression back to "blind" (or a stub creeping in) is currently invisible                                              | S–M    | `[new]`                        | `inngest.ts:785`; `audit-runner.ts:533-553`                           |

### Tier 1 — Make "outperform human" measurable (foundation for everything after)

| #   | Recommendation                                                                                                                                                                                                                 | Why                                                                                                                                                    | Effort | Tag              | Key location                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------- | ------------------------------------------------------------------------------------------ |
| 1.1 | **Build `evals/ad-optimizer-recommendation/`** — a model-free, DB-free, CI-gated scenario benchmark (campaign fixtures → expected recommendation set, _including expected refusals_), cloned from `evals/governance-decision/` | The only way "outperform human" becomes a tracked metric; lets every later PR prove non-regression. `AuditRunner` is already fully dependency-injected | M      | `[promotes PR4]` | new `evals/ad-optimizer-recommendation/`; template `evals/governance-decision/run-eval.ts` |
| 1.2 | **Baseline + regression-count gate** on 1.1 (deterministic ⇒ blocking from day one, no bake)                                                                                                                                   | Guards against silent quality drift when thresholds are retuned                                                                                        | S      | `[new]`          | mirror `claim-classifier/score.ts`                                                         |

### Tier 2 — PR2 "Target": aim at customers (sharpened by the keystone)

| #   | Recommendation                                                                                                                                                  | Why                                                                                    | Effort | Tag                           | Key location                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ | ----------------------------- | ----------------------------------------------------------------------- |
| 2.1 | **KEYSTONE: expose per-campaign booked-CAC from the provider** — add a `byCampaign` projection (second group-by key; the rows already carry `sourceCampaignId`) | Dissolves the roadmap's feared "hard fork" into a one-function fix; unlocks all of PR2 | **S**  | `[extends PR2 — corrects it]` | `real-provider.ts:121-133` (data confirmed at `crm-funnel-store.ts:42`) |
| 2.2 | **Drive breach/kill/scale off cost-per-booked** + the strict fallback ladder (booked-CAC→CPL→CPC), tag `economicTier` on every rec                              | The core north-star fix: cheap-junk-leads stop scoring as wins                         | L      | `[planned PR2]`               | `recommendation-engine.ts:48,180`; `audit-runner.ts:366`                |
| 2.3 | **Stamp attribution + real value onto the `booked` event** (`sourceCampaignId`, price/AOV, not `value:0`)                                                       | Makes per-campaign trueROAS real _and_ makes the booked event CAPI-dispatchable        | S–M    | `[extends PR2 / CAPI]`        | `calendar-book.ts:286,289-295`                                          |
| 2.4 | **Fix `metrics-riley` + cockpit** to show booked-CAC/trueROAS (not "cost per lead", `qualifiedPct=0`, always-degraded ROI)                                      | The operator currently can't even _see_ customer economics                             | M      | `[planned PR2]`               | `metrics-riley.ts:57,100-152`                                           |

### Tier 3 — PR3 "Brain": use the sharp tools (with the specific unwired pieces named)

| #   | Recommendation                                                                                                                                                          | Effort | Tag                  | Key location                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------- | ------------------------------------------------------------------------------------------- |
| 3.1 | Wire `sourceComparison` **into** `generateRecommendations` (today computed, never passed)                                                                               | M      | `[extends PR3]`      | `audit-runner.ts:400-409, 511-516`                                                          |
| 3.2 | Wire the V2 cron deps `getAdSetInsights` / `getTrendData` so ad-set learning + breach-forecast actually run                                                             | M      | `[extends PR3]`      | `inngest.ts:199-262`; `audit-runner.ts:431-496`                                             |
| 3.3 | Add an **ad-level fetch** method and feed the orphaned creative analyzer (dedup, per-ad CPA, quality rankings)                                                          | M–L    | `[extends PR3]`      | new `getAdInsights` in `meta-ads-client.ts`; `creative-analyzer.ts`                         |
| 3.4 | Fetch `reach`, wire `detectSaturation` (audience burnout — a top medspa failure mode)                                                                                   | M      | `[extends PR3]`      | `ad-optimizer.ts:48-82`; `audit-runner.ts:431`                                              |
| 3.5 | Convert detected budget imbalance into an actual `shift_budget` reallocation (materiality-gated)                                                                        | M      | `[planned PR3]`      | `audit-runner.ts:489-507`                                                                   |
| 3.6 | **Lightweight statistics, no ML**: rate-aware significance (replace fixed 15%), Beta-Binomial breach confidence (distinguish 7/7 from 7/14), robust median+MAD outliers | M      | `[new — beyond PR3]` | `period-comparator.ts:21`; `meta-campaign-insights-provider.ts`; `creative-analyzer.ts:124` |
| 3.7 | Placement/device breakdown → surgical "exclude placement" recs instead of blunt "pause campaign"                                                                        | M      | `[new]`              | `audit-runner.ts:258-263` (reuse `breakdowns` plumbing)                                     |

### Tier 4 — Scale & operational robustness (gates production beyond a handful of orgs)

| #   | Recommendation                                                                                                                                                | Effort | Tag             | Key location                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | --------------------------------------------------------------- |
| 4.1 | **Batch Graph calls** — fetch account-level once, index by campaign (the data is already over-fetched and discarded N×). Rank this _above_ the rate-limit fix | M      | `[new]`         | `meta-campaign-insights-provider.ts`; `audit-runner.ts:342-429` |
| 4.2 | Replace the fixed 60 s rate limit with **header-aware adaptive throttling + 429/Retry-After backoff**                                                         | M      | `[new]`         | `meta-ads-client.ts:9,246-254`                                  |
| 4.3 | **Per-deployment step fan-out** (the dispatcher shape already exists, unused) so orgs run concurrently, not serially                                          | M      | `[new]`         | `inngest-functions.ts:95-183, 274-302`                          |
| 4.4 | Gate audit/activation on **`coverage-validator`** (don't run on zero-data orgs)                                                                               | M      | `[extends PR2]` | wire `coverage-validator.ts` into activation + Step 0           |
| 4.5 | **Token lifecycle**: classify auth errors as `NonRetriableError`; add a token-health probe                                                                    | S–M    | `[new]`         | `meta-ads-client.ts:230-244`; `facebook-oauth.ts`               |
| 4.6 | Instantiate the **real `ReconciliationRunner`** (today hardcoded "healthy")                                                                                   | S      | `[new]`         | `inngest.ts:394-404`                                            |

### Tier 5 — Close the flywheel (the strategic moat; mostly net-new beyond Phase 1)

| #   | Recommendation                                                                                                                                | Effort        | Tag                    | Key location                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------- | ------------------------------------------------------------------------------- |
| 5.1 | **Booking-aware attribution** — measure realized booked-CAC delta, not the tautological spend-fell-after-pause                                | M             | `[new]`                | `meta-insights-adapter.ts:50-71`; `outcome-attribution.ts`                      |
| 5.2 | **Capture operator approve/reject** as Riley's first learning substrate (per-org, per-action-kind approval rate → confidence modifier)        | M             | `[new]`                | `interfaces.ts:57-64`; `recommendation-engine.ts:26-43`                         |
| 5.3 | **Per-pattern/per-kind lift rollup** + turn the loop on (close the PROOF leg)                                                                 | S (after 5.1) | `[new]`                | new aggregate on `recommendation-outcome-store.ts`; flag `inngest.ts:701`       |
| 5.4 | **Riley→Mira creative-refresh handoff** on detected fatigue — reuse `submitChildWork` + `creative.concept.draft` + the `pastPerformance` slot | M             | `[new]`                | `audit-runner.ts` emit point; `delegation-targets.ts:45`; `creative-job.ts:191` |
| 5.5 | Turn **CAPI on** (env) after 2.3 stamps value/attribution                                                                                     | S             | `[new]`                | `conversion-bus-bootstrap.ts:54-57`                                             |
| 5.6 | **Riley→Alex junk-lead signal** (stop dropping `lead_quality_*`)                                                                              | M–L           | `[new + needs-design]` | `recommendation-engine.ts` (add branches); needs an Alex-side inbox             |

### Tier 6 — Give Riley a voice (the missing "Mouth/Ears")

| #   | Recommendation                                                                                                                           | Effort | Tag                   | Key location                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------- | ------------------------------------------------------------------- |
| 6.1 | **Wire an interactive Riley skill into `SkillMode`** (load skill, register builder + `ads-data`/`ads-analytics` tools, route the intent) | M–L    | `[new]`               | `skill-mode.ts:121-122, 316-321, 562` (tools/builder already exist) |
| 6.2 | **Narrate the weekly audit conversationally** ("here's what I'd recommend and why") over the persisted recs                              | M      | `[new]`               | new read tool over `PrismaRecommendationStore`                      |
| 6.3 | Author Riley **persona/voice + advisor reference patterns**; fix executor to inject `SkillDefinition.references` (also helps Alex)       | S–M    | `[new]`               | new skill md; `skill-executor.ts`                                   |
| 6.4 | Ride the **A2 ModelRouter** activation (set Riley's floor to premium for analytic reasoning)                                             | S      | `[shared w/ Alex A2]` | `skill-mode.ts:547`                                                 |
| 6.5 | **PII projection** on the ad-optimizer chat path (port Alex's #775)                                                                      | S      | `[new]`               | `pii.ts`; ad-optimizer tools                                        |

### Tier 7 — Execution (Phase 2): the leash gets a hand — _last_, behind Tiers 0–1

| #   | Recommendation                                                                                                                                                                         | Effort | Tag                        | Key location                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- | ----------------------------------------------------------- |
| 7.1 | **CRITICAL: forbid `system_auto_approved` for financial intents**; force `apply_ad_action` through `approvalMode:"policy"` (else it bypasses #788 + spend caps)                        | S      | `[Phase-2 prereq]`         | `operator-intents.ts:99-117`; `governance-gate.ts:98-106`   |
| 7.2 | Implement the `candidateAction` seam on the schema + sink (the deferred Phase-1 descriptor; `params` is `Record<string,string>` — can't carry a numeric budget delta today)            | M      | `[planned §6 → finish]`    | `schemas/ad-optimizer.ts:168-181`; `recommendation-sink.ts` |
| 7.3 | **Minimal safe first auto-action**: a ≤20% reversible daily-budget _nudge_ via `operator.apply_ad_action`, reusing PlatformIngress claim-first idempotency + `checkSpendLimits` + #788 | M–L    | `[Phase-2 MVP]`            | new `updateCampaignBudget`; `operator-mutation-mode.ts`     |
| 7.4 | Enforce the reversibility-tagging contract; **keep the trust-score ramp dead pre-launch** (auto-promoting rubber-stamped advisory approvals to budget autonomy is a footgun)           | S      | `[Phase-2 safety / defer]` | `spend-approval-threshold.ts`; `governance-gate.ts:91-93`   |

---

## 6. Recommended sequence

```
NOW  ── Tier 0 (correctness + safety floor + no-ghost test + alerting)  ← ride right behind Eyes
  │
  └──► Tier 1 (the eval benchmark)        ← build the ruler before you measure improvement
          │
          └──► Tier 2 "Target" (keystone first: 2.1 → 2.2 → 2.3/2.4)   ← the next capability PR
                   │
                   ├──► Tier 3 "Brain" (wire the orphans; add 3.6 statistics)
                   │
                   ├──► Tier 4 (scale) — needed once >~10 orgs or >~5 campaigns/org
                   │
                   ├──► Tier 5 (close the flywheel: learning + Riley→Mira)
                   │
                   └──► Tier 6 (conversational Riley)
                            │
                            └──► Tier 7 (Phase-2 execution) — last, behind 7.1 + the eval gate
```

**If you want one next increment** (respecting the "prove it sees before it aims" cadence): a small bundle of **0.1 + 0.2 + 0.4 + 1.1**, then **2.1 (the keystone)**. That makes Riley's _new_ sight trustworthy, makes its quality measurable, and lands the cheapest, highest-leverage step of "Target" — all before committing to the full PR2.

---

## 7. Reconciliation with the existing roadmap

The Phase-1 spec (`docs/superpowers/specs/2026-06-01-riley-phase1-superhuman-advice-design.md`) sequences **Eyes → Target → Brain → Verify**, with Phase-2 = governed execution. This audit largely **validates** that sequence and **adds precision**:

**What the audit confirms in the roadmap:** wrong-target (PR2), orphaned analyzers (PR3), verify-on-real-data (PR4), and the Phase-2 execution seam all check out against live code.

**What the audit corrects or sharpens:**

- **PR2's "hard fork" is not hard.** The spec treats per-campaign booking attribution as an open problem (N `getFunnelData` calls vs account-level calibration). It's a **one-function `byCampaign` projection** — the store already groups by `sourceCampaignId` (2.1). This is the single most valuable correction here.
- **The ≥20-click evidence floor (spec §3.2) does not exist in code.** Pull it forward to Tier 0 (0.2) — Eyes makes it urgent.
- **The breach denominator is ambiguous** (unfiltered `conversions`). Eyes turned the signal on; the denominator needs fixing or the signal can mislead (0.1). Arguably a PR1 correctness follow-up.
- **PR3 wires the _analyzers_ but not the _data they need_.** Several are starved: no ad-level fetch (3.3), no `reach` (3.4), no V2 cron deps (3.2), and `sourceComparison` is never passed to the engine (3.1). PR3 as written would wire starved analyzers.
- **PR4 should be a _living gate_, not a one-time snapshot** (1.1/1.2).
- **The spec calls the Graph rate-limit cost "negligible." It isn't** (~4 calls/campaign × 60 s; D8 quantifies hours at scale). Tier 4.

**What the audit adds (not in any current PR):**

- The whole **measurement foundation** (Tier 1).
- The **learning loop** (Tier 5) — Phase 1 explicitly defers calibration; but Riley learning _nothing_ is the gap between "good advice" and "outperforms humans over time."
- **Cross-agent propagation** (Riley→Mira / Riley→Alex, Tier 5) — the flywheel leg.
- **Conversational Riley** (Tier 6) — the spec is cron-only and assumes a chat path that is actually unwired.
- The **Phase-2 `system_auto_approved` footgun** (7.1) — a safety landmine on the obvious execution path.

---

## 8. Verification log & corrections to stale assumptions

- **Corrected: "Riley is blind on `main`."** PR #792 ("Eyes") **merged 2026-06-02 01:41 UTC** (commit `897647ce`). The local working branch (`docs/production-env-checklist`) and a freshly-cut worktree from before the merge still showed the prod stub at `inngest.ts:241` — which is why 8 of 9 auditors reported "blind." Verified on current `origin/main` @ `38f0129d`: the weekly audit now wires the real `MetaCampaignInsightsProvider` (`inngest.ts:242`) with daily `time_increment` breach + `learning_stage_info` entity-edge learning. **This document is written against post-Eyes `main`.**
- **Confirmed: #788 spend-approval-threshold is on `main`** (`packages/core/src/platform/governance/spend-approval-threshold.ts`), real, opt-in, deny-respecting — but has **no Riley producer** (the recommendation schema can't carry a numeric budget delta).
- **Confirmed keystone (2.1):** `crm-funnel-store.ts:42` keys rows by `sourceType::sourceCampaignId::stage`; the per-campaign data exists and is discarded only at `real-provider.ts:121-133`.
- **Confirmed: Riley is advisory-only** — no recommendation→`MetaAdsClient`-mutating-method path exists anywhere (D5 grep).
- **Confirmed: Riley has no live conversational surface** — `skill-mode.ts` loads only Alex; the ad-optimizer tools/builder are unregistered (D9 read `skill-mode.ts` in full).
- **Engine/analyzer findings are accurate for current `main`:** #792's diff touched only the provider, the client, and the cron wiring (+ an integration test) — not the recommendation engine, analyzers, or diagnostician. So D1/D6's findings there stand.
- **Adjacent bug spotted (flag for the outcome-attribution path, not owned here):** `meta-insights-adapter.ts:60` requests daily rows via `breakdowns:["day"]`; Meta's daily series is `time_increment=1` — `"day"` is not a valid breakdown dimension.

**Confidence:** all `file:line` claims were read directly by the auditors and the highest-stakes ones re-verified against current `main`. Tier-3.6 statistics and Tier-5/6/7 designs are _proposals_, correctly tagged `new`.

---

## 9. Open decisions for you

1. **Cadence.** Land the Tier-0 + Tier-1 bundle as its own small PR before PR2, or fold the safety floor into PR2? (Recommendation: separate — it's cheap, high-confidence, and the eval gate should predate PR2 so PR2's lift is provable.)
2. **PR2 scope.** Ship the keystone (2.1) + cost-per-booked switch (2.2) as account-level calibration first (Tier-2 of the spec's ladder), or go straight to per-campaign? (Recommendation: per-campaign — 2.1 makes it nearly free.)
3. **Learning loop timing (Tier 5).** Phase 1 deferred calibration on purpose. Is "Riley learns from operator approvals" (5.2) a now-thing or a post-launch thing? It's the lightest possible loop and the strongest "gets better over time" signal.
4. **Conversational Riley (Tier 6).** Is an interactive Riley in scope pre-launch, or is the autonomous cron + cockpit enough for v1? (It's a large net-new surface, but it's also where operator trust is won.)
5. **Phase-2 trigger.** Keep execution gated behind the eval benchmark (Tier 1) + 7.1 + a deployed pilot? (Strongly recommended — do not wire writes before the measurement gate exists.)

---

_Full per-domain evidence with file:line citations:_ [`domains/D1`](./domains/D1-decision-engine.md) · [`D2`](./domains/D2-perception-signals.md) · [`D3`](./domains/D3-attribution-targeting.md) · [`D4`](./domains/D4-learning-loop.md) · [`D5`](./domains/D5-execution-governance.md) · [`D6`](./domains/D6-cross-agent.md) · [`D7`](./domains/D7-evaluation.md) · [`D8`](./domains/D8-ops-scale.md) · [`D9`](./domains/D9-conversational-runtime.md)
