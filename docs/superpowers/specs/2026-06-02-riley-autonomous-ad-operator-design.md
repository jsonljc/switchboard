# Riley as a Governed Autonomous Ad Operator — Design

- **Date:** 2026-06-02
- **Status:** Design approved (brainstorming). Implementation plan to follow via writing-plans.
- **Author:** Jason + Claude
- **Supersedes the organizing frame of:** `2026-06-01-riley-phase1-superhuman-advice-design.md` (that spec's findings remain valid; this spec re-organizes the arc around an ordered decision pipeline rather than the looser "Eyes → Target → Brain → Verify" buckets).
- **Audit basis:** `docs/audits/2026-06-02-riley-improvement-audit/FINDINGS.md` + `domains/D1–D9`, plus a 6-cluster decision-science map (measurement & inference, attribution & signal, learning-phase cadence, lever routing, budget allocation, campaign structure), all file:line-verified against post-#792 `main`.

---

## §0 — North Star and the protective frame

Riley autonomously manages Meta ad accounts to **maximize booked-customer revenue while protecting lead flow** — perceiving each account correctly, refusing to act on untrustworthy numbers, routing the right lever to the right actor, executing only reversible/capped moves it has *earned* the authority to make, and compounding proven lift into ever-wider autonomy. The end state is **a governed revenue operator that knows when *not* to touch the account**, not "an ad agent."

The single most important constraint on this design — to be quoted verbatim in the implementation and in code review:

> **Riley is not a universal media-buying brain. Riley is a context-calibrated decision pipeline for small/modest-budget Meta accounts where evidence sufficiency, learning stability, and revenue truth matter more than heavy optimization frameworks.**

This sentence is a guard rail. The audit surfaced the entire best-in-class media-buying toolkit; most of it is an **anti-pattern at this account shape** because it fragments volume or demands statistical power the account does not have. **"All frameworks considered" must never become "all frameworks built"** (see §8).

---

## §0.1 — Status reconciliation (verified 2026-06-02)

This spec is the **umbrella the Phase-1 PR roadmap assembles toward**, not a competing track. The PR increments map onto its phases, and two have already landed:

| Phase-1 PR | Decision-pipeline home | Status |
|---|---|---|
| PR1 "Eyes" (#792) | Phase A perception + Phase B sight (Gate 1/2/3 inputs) | ✅ merged 2026-06-01 |
| PR2 "Target" (#798) | **Phase B Gate 4 (economic truth)** + part of Gate 9 abstention | ✅ merged 2026-06-02 — account-level cost-per-booked tier ladder (Tier-1 `booked_cac` → Tier-2 `cpl` → Tier-3 `cpc`); advisory-only |
| PR3 "Brain" | Phase B wiring (funnel-router, orphaned diagnoses) + Phase D | not started |
| PR4 "Verify" (eval) | **Phase A eval benchmark** | not started |

**The one re-sequencing this frame forces:** PR2 changed the optimization target **with no eval built yet**, so the next increment is the **Phase A abstention floor + eval** (effectively "PR4 pulled ahead of PR3"). It retroactively protects #798 and gates everything downstream. Remaining Phase-B economic work after #798: per-campaign **Hybrid** calibration (the `byCampaign` projection), margin/AOV plumbing, the funnel-leak router + the 5 orphaned diagnoses, CAPI-on, reconciliation, the lead-volume floor.

---

## §1 — Problem

Riley today is a **bag of analyzers that computes intelligence and then discards it before a decision** (the audit's "computed-then-discarded" meta-finding, confirmed independently by all 6 decision-science agents). Concretely:

- **No spine.** Recommendation rules fire independently off a fixed ±15% percent-change gate at hardcoded confidences, with no ordered gauntlet. There is no single place where "should Riley act here, and how confident is it?" is decided.
- **Optimized the wrong target (now partly addressed by #798).** Pre-PR2 the breach math ran on cost-per-*lead* (`spend ÷ conversions`). PR2 (#798) flipped it to an **account-level** cost-per-*booked* tier ladder. The remaining gap is the **per-campaign** booked-CAC Hybrid — the store keys it (`crm-funnel-store.ts:42`) but `getFunnelData` collapses it to one aggregate.
- **Acts on an ambiguous, untrusted number.** The conversions denominator is Meta's *unfiltered* `conversions` (no `action_type`, no pinned attribution window); reconciliation against CRM truth is stubbed to "healthy"; there is no measurement-trust gate before optimization.
- **Acts on noise.** No minimum-evidence floor — it will pause a near-zero-traffic campaign at 0.9 confidence.
- **Throws away the leak location.** It computes the funnel leak point (impression→CTR→landing→lead→booked) and only *displays* it; 5 of 9 diagnoses (including the two purest junk-lead signals) have no consumer.
- **Would thrash learning the moment it executes.** Meta's learning phase resets on "significant edits"; Riley has no structured reset-class flag and its cooldown machinery is structurally inert on the governance path.
- **Cannot execute, and cannot be asked anything.** Advisory-only (no mutating path exists); no conversational surface (`SkillMode` loads only Alex).

The fix is overwhelmingly **wiring what exists + adding lightweight closed-form logic**, not importing ML or enterprise frameworks.

---

## §2 — Objective function

**Primary:** maximize booked-customer revenue efficiency — minimize **cost-per-booked** / maximize **trueROAS** (booked revenue ÷ ad spend), margin-aware where margin/AOV is configured.

**Hard constraint (the "and leads" half):** a **lead-volume floor**. Riley may not starve the funnel chasing efficiency. Any CAC-reducing move (pause, cut, shift-away) that would push projected booked-consult volume below the floor is downgraded to `watch` with that reason. *This constraint is currently absent from config and must be added* (`packages/schemas/src/ad-optimizer-config.ts` has only `monthlyBudget`/`targetCPA`/`targetROAS`).

**Economics-derived target, not an arbitrary multiple.** The target should derive from margin/AOV (break-even ROAS = 1 ÷ profit-margin), not the default `targetROAS = 3`. Where margin is unknown, the system says so (`marginBasis:"unavailable"`) and never silently claims to be margin-aware.

**Bounds (per deployment):** target CAC, profit margin / AOV, minimum daily leads, maximum daily spend, maximum budget step.

**The small-budget reality that shapes everything:** at a $100 target CPA the learning-exit budget floor is ≈ (CPA × 50) ÷ 7 ≈ **$714/day per ad set**. A modest pilot runs *below* that, so most ad sets are *legitimately and permanently* learning-limited (the 50→10 conversion reduction excludes lead-gen). Therefore the dominant allocation lever at this scale is **consolidation + a lower economics-derived target**, not fine-grained portfolio rebalancing.

---

## §3 — The decision pipeline (the spine)

Every candidate action, for every entity, every cycle, runs this ordered gauntlet. **Abstention (`watch`) is a first-class output at every gate** — Riley emits "not enough to act, here's why" rather than manufacturing confidence. A gate that abstains names its reason and stops the entity's pipeline (except where it redirects to a measurement/structural lever).

| # | Gate | Purpose / rule | Frameworks absorbed | Current state (file:line) |
|---|------|----------------|---------------------|---------------------------|
| 0 | **Hygiene / coverage** | Enough usable data and clean taxonomy to analyze this entity? Else abstain at account/entity level. | data-sufficiency, naming/taxonomy hygiene | `CoverageValidator` built but **orphaned** (`onboarding/coverage-validator.ts`; only barrel export `index.ts:58`); source taxonomy hardcoded `ctwa`/`instant_form` (`real-provider.ts:116-119`) |
| 1 | **Measurement-trust** | *Do not optimize against a cost number until the number is trustworthy.* Signal-health green? CRM↔Meta reconciliation drift in band? No account-wide conversion step-change (the Jan-2026 window-change trap)? Else → emit a **measurement-fix lever** and abstain on budget actions. | attribution models, attribution windows, CAPI/EMQ, dedup, reconciliation | signal-health red-gate **works** (`audit-runner.ts:243-288`); reconciliation **stubbed to healthy** (`inngest.ts:395-404`, real runner exists `core/attribution/reconciliation-runner.ts:31-82`); step-change detector **missing** |
| 2 | **Sufficiency** | ≥20 clicks AND ≥N conversions AND ≥N days on *this* entity? Else `watch`. Fix the breach counter footgun where a zero-conversion-with-spend day counts as a breach. | minimum-sample / traffic floor | **missing** (spec promised, code absent); footgun at `meta-campaign-insights-provider.ts:116` |
| 3 | **Signal-vs-noise** | Is the metric move significant *for this sample* (rate-aware two-proportion / rate-ratio test, or posterior interval), and *durable* (trend), not a one-day blip? Else `watch`. | statistical significance, Bayesian small-sample, trend/forecast/anomaly | fixed ±15% volume-blind (`period-comparator.ts:21`); trend path **orphaned** (`getTrendData`/`getAdSetInsights` unwired in `inngest.ts`) |
| 4 | **Economic truth** | Recompute on **booked-CAC / trueROAS** per campaign (the keystone projection), margin-aware; strict fallback ladder booked-CAC → CPL → CPC that *lowers confidence and constrains the allowed action family*. | headroom/marginal framing, attribution truth, margin/break-even | drives on cost-per-lead (`audit-runner.ts:155`); per-campaign data exists (`crm-funnel-store.ts:42`) but collapsed (`real-provider.ts:121-133`) |
| 5 | **Leak-localize → lever route** | Localize the funnel leak (impression→CTR→landing→lead→booked), map symptom→diagnosis→lever, and tag the lever with an **authority class** (§4). | reach/freq saturation, the "which lever when" tree | leak point **computed then only displayed** (`funnel-analyzer.ts:59-69` → `use-ad-optimizer.ts:51`); 5/9 diagnoses orphaned (`metric-diagnostician.ts`) |
| 6 | **Learning + cadence** | Entity in LEARNING / learning-limited (lockout)? Action `resetsLearning`? Within per-entity cooldown? Would it be the 2nd reset this cycle? → suppress / queue / batch / downgrade (§5). | learning-phase mechanics, significant-edit discipline, scale cadence | `learningPhaseImpact` is free-text (`ad-optimizer.ts:177`); cooldown machinery **structurally inert** on the gate path (`governance-gate.ts:159`) |
| 7 | **Constraints** | Lead-volume floor (don't starve bookings), spend caps (#788 + `checkSpendLimits`), min-spend-per-entity floor, ≤20% step clamp, CBO/ABO coherence. | guardrails, allocation bounds, bid coherence | spend caps exist but inert for Riley; **lead-floor absent**; `isCbo` hardcoded `false` (`audit-runner.ts:509`) |
| 8 | **Confidence derivation** | Confidence = f(posterior-interval width, trend durability, economic tier, measurement trust). **Not** a literal constant. This value gates autonomy. | calibration | hardcoded 0.6–0.9 (`recommendation-engine.ts:118,141,165,…`) |
| 9 | **Autonomy decision** | Given authority-class + reset-class + confidence + the *earned tier for this action class* + eval-green → **execute** (T1+) / **recommend** (T0) / **handoff**. | earn-it autonomy (§6) | advisory-only |
| 10 | **Outcome attribution** (Phase E) | After an action: realized booked-CAC delta + Meta↔CRM reconciliation as *quasi-incrementality* → recalibrate confidence (Gate 8) and widen/contract autonomy (Gate 9). | the *cheap* incrementality that fits this scale | display-only loop today |

**Design note:** Gates 0–8 are pure analysis and run identically whether Riley is advisory (T0) or autonomous. Only Gate 9 differs by earned tier. This is what lets every phase before execution still ship the full brain.

---

## §4 — Lever-routing tree + authority classes

Gate 5 routes each diagnosis to a lever carrying an **authority class** — the product architecture that turns "performance bad" into "the right actor pulls the right lever." **Authority class is a schema invariant: only an `act`-class recommendation may ever carry a `candidateAction` that reaches a Meta mutation.** A diagnose-only finding can never be mis-wired to an execution path.

### Locked authority table

| Lever | Authority class | Notes |
|-------|-----------------|-------|
| Budget nudge ≤20%, non-resetting, SUCCESS-only | **ACT** (eventually; the first earned auto-action) | reversible, capped; ideal T1 because it does not reset learning |
| Pause / reduce spend | **ACT**, human-approved first | pausing <7d doesn't reset; pause ≥7d does |
| Broaden targeting | **ACT**, gated by learning/cadence | resets learning → high bar |
| CAPI / signal config | **ACT** (operator-config class) | hardens measurement; not a budget move |
| Creative fatigue → new creative | **HANDOFF → Mira** | substrate exists (draft-only delegate, needs `skillSlug="creative"` deployment + a new `creative_refresh` target) |
| Lead quality / sales follow-up | **HANDOFF → Alex** | seam does **not** exist yet (net-new) |
| Landing page / page speed / offer / pricing | **DIAGNOSE-ONLY** | off-platform; Riley surfaces a finding it cannot execute, rendered "needs you / your web team," never a swipe button |
| Structure / consolidation | **ACT**, highest tier, human-approved | resets learning + reshapes account; default is *consolidate*, not fragment |
| **Lead-form edits** | **ACT-LATER / FORM-MUTATION** | separate class: human-approved, schema-strict, **preview-required**, **not in the first execution phase** — see schedule below |

### Lead-form edits — the deliberate middle class

Meta instant forms *are* on-platform and eventually automatable, so lead-form edits are **not** diagnose-only forever; but they materially affect lead quality, volume, compliance, and UX, so they are **not** in the first ACT bucket either. Schedule:

- **Phase A/B:** diagnose lead-form friction only (and note Riley is currently *blind* here — there is no form-completion-rate metric; adding one is required to even diagnose it).
- **Phase C:** no form mutation.
- **Phase D/E:** allow human-approved form edits **only if** before/after preview, compliance checks, and rollback all exist.

### Off-platform detection

Riley detects DIAGNOSE-ONLY leaks from in-platform + CRM/funnel data (e.g. high CTR but landing-conversion drop → landing page; CPL down but cost-per-booked up → lead quality → Alex; strong clicks weak conversions → offer/pricing). The minimum behavior even pre-execution: **stop dropping the 5 orphaned diagnoses**; emit them as `watch`/informational recs tagged with their authority class, satisfying the never-silence contract.

---

## §5 — The change-cadence governor (the leash, made real)

The danger is not thrashing a *stable* ad set — at this account shape most ad sets are *never* stable (learning-limited by default). The danger is **touching a learning ad set at all**, and **resetting the little signal it has**. The governor encodes:

1. **`resetsLearning: "yes" | "no" | "conditional"`** — a structured flag on every action, derived from Meta mechanics, replacing today's hand-authored free-text `learningPhaseImpact` (`ad-optimizer.ts:177`). Correct the current errors (a ≤20% scale is *not* a reset; it is wrongly labeled "will reset learning").
   - Resets: budget change >~20%, bid strategy, optimization event, targeting, add/remove creative, placements, attribution settings, pause ≥7d.
   - Does not reset: ≤20% budget change, ad copy edit (asset unchanged), on/off within ad set, CBO campaign-level budget moves, scheduling, naming, pause <7d.
2. **`resetsLearning:"yes"` ⇒ never swipe-approvable**, regardless of financial classification. This reconciles the two taxonomies that currently disagree — `ACTION_RISK_CONTRACT` (`recommendation-sink.ts:114-129`) marks creative swaps as low-risk swipeable even though they reset learning. A learning reset is a material, hard-to-undo cost.
3. **Learning-state lockout.** Suppress all `resetsLearning:"yes"` actions on a LEARNING ad set to `watch`; route a *learning-limited* ad set **loudly** to the structural remedy set (consolidate / broaden / CBO / higher-funnel event / longer window), never silently passing it.
4. **Stateful per-entity cooldowns.** ≥7 days between reset-class edits on an entity; ≥3–4 days between ≤20% scale steps; a per-account daily cap on entities touched. **This requires fixing the linchpin defect:** `governance-gate.ts:159` rebuilds `createGuardrailState()` fresh per evaluation, so cooldowns *never fire* on the path #788 and any executor use; hydrate from the existing `guardrail-state` store instead. Feed the risk scorer the real `learningPhase`/`recentlyModified` inputs it currently receives as hardcoded `false`.
5. **Cross-rec arbitration + batching.** At most one reset per entity per cycle; resolve contradictory co-emissions (saturation currently emits both `refresh_creative` and `restructure`); batch co-warranted changes into one edit (one reset, not five); a reset must clear an expected-lift bar exceeding the ~7-day re-learning cost (budget-scaled).

---

## §6 — Earn-it autonomy model

Every org **starts at "approve everything" (T0).** Authority widens **per action class, per org**, only after that class proves positive lift over a rolling window (Gate 10) *and* operator approval rate is high *and* the eval is green. Autonomy can also **demote** if lift regresses.

| Tier | Scope | Gating |
|------|-------|--------|
| **T0 — advisory** | all actions, including resetting ones | default; Riley today |
| **T1 — first earned** | ≤20% budget nudge (non-resetting), signal-health fixes, `watch` | only `resetsLearning:"no"` + reversible + SUCCESS-state ad set + outside scale cooldown + eval-green |
| **T2 — wider reversible** | cross-campaign/ABO budget reallocation, scaling winners, pause-clear-loser | per-entity cooldowns + lockout still apply |
| **T3 — higher-stakes** | large budget increases, optimization-event switch | resetting → batched, human-confirmed, long track record |
| **T4 — structural / irreversible** | consolidate/restructure, launching/killing campaigns, lead-form edits, creative (via Mira) | human-approved or handoff; never silent auto |

**Reset-class gates tier before dollar thresholds do.** An action may not auto-execute if it would touch a LEARNING/learning-limited ad set, violate the per-entity reset cooldown, or be the 2nd+ reset on that entity this cycle.

---

## §7 — Safety invariants (non-negotiable)

1. Every mutation flows through `PlatformIngress.submit()` → `WorkTrace` → `GovernanceGate`. No mutating bypass path.
2. Actions are reversible, capped, and idempotent (reuse claim-first `WorkTraceStore.claim()`, #780).
3. **No `system_auto_approved` for financial intents.** `governance-gate.ts:98-106` short-circuits that mode to `execute` *before* the #788 spend post-processor at `:178`, bypassing the spend lever and `checkSpendLimits`. Financial intents register `approvalMode:"policy"`.
4. **Measurement-trust precedes economics** (Gate 1). Riley abstains on budget actions when measurement is the bottleneck.
5. **`resetsLearning:"yes"` ⇒ never swipe-approvable** (§5).
6. **Authority class is a schema invariant** — only `act`-class recs may carry a `candidateAction` (§4).
7. Hard spend caps and the lead-volume floor are independent of the autonomy lever.
8. Cooldown state is stateful on the governance path (§5.4) — without it, the cadence guarantees are fiction.
9. Global **and** per-org kill-switch.
10. A **no-ghost-execution** invariant test: no recommendation can mutate Meta without a corresponding `WorkTrace`.
11. **Eval must be green to widen autonomy**; trust is earned on *proven lift* (Gate 10), never on rubber-stamped approval counts.

---

## §8 — Context-SKIP discipline (deliberately not built)

Repeating the §0 guard: *Riley is not a universal media-buying brain.* The following best-in-class techniques are **out of scope** because they fragment volume or require statistical power a single modest-budget medspa account lacks. Each must be explicitly skipped in implementation, with a one-line reason in the plan:

- **Formal incrementality** (Meta Conversion Lift, GeoLift, holdout/ghost-ad studies) — underpowered; the holdout starves live delivery. *Kept instead:* CRM↔Meta reconciliation + realized-booked-CAC-after-action as cheap quasi-incrementality (Gate 10).
- **MMM / data-driven & multi-touch attribution** — single channel, modest volume, short history → no power.
- **Efficient-frontier / response-curve optimizers, multi-armed bandits** — too few, too noisy weekly data points. *Kept instead:* marginal-ROAS-as-*probe* + Beta-Binomial small-sample estimation (the one "advanced" technique that *fits* low volume).
- **Dedicated test campaigns, deep lookalike ladders, multi-tier retargeting, geo-micro-segmentation, aggressive horizontal duplication** — all fragment budget below the learning-exit floor.
- **Heavyweight forecasting (ARIMA/Prophet), bid caps as default, sub-daily pacing** — over-engineered for the data density / delivery-fragile at small budget.

When account scale grows (multi-account aggregate, Phase F+), revisit — but never by default.

---

## §9 — Phase map

Each phase is independently valuable and gated by the prior. **External gate:** live execution (Phase C+) depends on Meta App Review / business verification, already on the launch critical path — Phases A/B land fully in parallel with it.

- **Phase A — Trustworthy sight + abstention floor + eval.** *(No execution. The product behavior is principled abstention: "not enough to act.")*
  Gate 0 (wire CoverageValidator), Gate 2 (sufficiency floor + breach-counter fix), the conversions-denominator fix (action_type + pinned attribution window), the measurement step-change guard, the structured `resetsLearning` flag, ad-set-granular learning lockout, the `meta-insights-adapter.ts:60` `breakdowns:["day"]`→`time_increment:1` bug, and **the deterministic eval benchmark** (clone `evals/governance-decision/`) with abstention / learning-limited / measurement-trust fixtures.

- **Phase B — Revenue truth.**
  The booked-event stamping keystone (`calendar-book.ts:282-296`: add campaign-id + value + identifiers — unlocks trueROAS *and* CAPI dispatch *and* high EMQ at once); the `byCampaign` projection (Gate 4); rate-aware significance (Gate 3); CBO/bid-strategy *perception* (read campaign budget/type/bid strategy — stop hardcoding `isCbo:false`); lead-volume floor + economics-derived target in config; instantiate the real `ReconciliationRunner`; wire `capiAttributionStale` so `harden_capi_attribution` can fire; CAPI-on (gated on Meta App Review); wire the funnel-leak router + the 5 orphaned diagnoses + authority-class tags; feed `sourceComparison` and convert the dropped budget imbalance into a materiality-gated `shift_budget`.

- **Phase C — First earned autonomy (Execution v1).**
  Structured `candidateAction` with a numeric budget delta (today's `params: Record<string,string>` cannot carry one); build `MetaAdsClient.updateCampaignBudget` (**does not exist** — correction: only pause-only `updateCampaignStatus` exists); route through ingress/WorkTrace/gate; forbid `system_auto_approved` for financial intents; make cooldown state stateful; **T1 auto-execution** (≤20% nudge, non-resetting, SUCCESS-only, eval-green, default human-approval, graduating per-org on proven lift). No form mutation.

- **Phase D — Sharper brain + wider autonomy.**
  Beta-Binomial confidence (Gate 8), fetch `reach` + wire `detectSaturation`, wire the trend/forecast path, marginal-ROAS-as-probe, the consolidation diagnostic + tune-vs-restructure precedence rule, Advantage+/broad-targeting advisory, **T2**. Lead-form edits become possible (human-approved + preview + compliance + rollback).

- **Phase E — Compounding learning.**
  Gate 10 fully wired: outcome attribution → confidence recalibration → autonomy widening; the quasi-incrementality signals; per-action-class lift rollup; operator approve/reject as a learning signal.

- **Phase F — Orchestration + scale.**
  Riley→Mira `creative_refresh` handoff (seed `skillSlug="creative"`); the net-new Riley→Alex lead-quality seam; account-level batch fetch (collapse ~4×N Graph calls to ~3–4/deployment), header-aware adaptive throttling + 429 backoff, per-deployment step fan-out, zero-output + retry-exhaustion alerting. Optionally, the conversational Riley surface.

---

## §10 — Scope and non-goals

- **In scope:** Meta/Facebook only; the medspa wedge; single ad account per org; weekly→faster cadence as scale warrants.
- **Non-goals:** multi-platform breadth (the architecture is platform-shaped so a 2nd platform is additive later, but breadth is explicitly deferred); a universal media-buying brain (§0/§8); auto-promoting advisory approval *counts* into spend autonomy (trust is earned on lift, not approvals); off-platform mutation (website/offer/pricing stay diagnose-only).

---

## §11 — Testing & evaluation strategy

- **Deterministic, model-free eval gate** cloned from `evals/governance-decision/` (the in-repo template — *not* claude-ads). Fixtures must cover: thin-data → `watch`; within-noise → `watch`; durable-breach → `pause`; recovering → `watch`; learner → no action; learning-limited → *structural* remedy (not a tweak); just-exited → not scaled yet; measurement-untrusted → abstain + measurement-fix; off-platform leak → diagnose-only rec with correct authority class.
- **Eval-green is a hard prerequisite** to changing confidence math, significance thresholds, or widening any autonomy tier.
- Co-locate `*.test.ts` per new module; run `pnpm test` + `pnpm typecheck` before commit; `pnpm --filter @switchboard/ad-optimizer test`.
- The no-ghost-execution invariant test (§7.10) is standing.
- Every cadence/threshold constant is **named, eval-fixtured config**, never a magic number.

---

## §12 — Key codebase seams (for the implementation plan)

| Concern | Seam | Note |
|---------|------|------|
| Conversions denominator | `meta-campaign-insights-provider.ts:92-96`; pattern to copy at `meta-report-insights-provider.ts:38` | add `action_type` filter + `action_attribution_windows` |
| Booked-event stamping (keystone) | `core/skill-runtime/tools/calendar-book.ts:282-296` | add campaignId/value/fbclid/email/phone; `ConversionEvent` schema already carries them |
| Per-campaign booked-CAC | `real-provider.ts:121-133`; store keys at `crm-funnel-store.ts:42` | add `byCampaign` projection (zero new queries) |
| Numeric action params | `schemas/ad-optimizer.ts:179` (`Record<string,string>`) | add structured `candidateAction` with reversible numeric delta |
| Budget mutator | `meta-ads-client.ts:236` (pause-only `updateCampaignStatus`) | `updateCampaignBudget` **must be built** |
| Stateful cooldown | `governance-gate.ts:159` (fresh state per eval) | hydrate from `guardrail-state/store.ts` |
| `system_auto_approved` footgun | `governance-gate.ts:98-106` precedes `:178` | forbid for financial intents |
| Funnel-leak router | `funnel-analyzer.ts:59-69` → only `use-ad-optimizer.ts:51` | route into `generateRecommendations` |
| Orphaned diagnoses (5/9) | `metric-diagnostician.ts` | lead_quality_issue, lead_quality_degradation, audience_offer_mismatch, competition_increase, account_level_issue |
| `sourceComparison` not fed / imbalance dropped | `audit-runner.ts:409-418`, `:498-516` | wire into engine |
| Reconciliation stub | `inngest.ts:395-404`; real runner `core/attribution/reconciliation-runner.ts:31-82` | instantiate |
| V2 ad-set block dead | `adOptimizerDeps` at `inngest.ts:213-263` lacks `getAdSetInsights`/`getTrendData` | wire feed |
| `resetsLearning` flag | `ad-optimizer.ts:177` (free-text); swipe contract `recommendation-sink.ts:114-129` | structure + reconcile |
| Lead-volume floor / target | `ad-optimizer-config.ts:46-53` | add fields |
| #788 spend lever | `spend-approval-threshold.ts:42-106` | feed `candidateAction`, don't rebuild |
| Mira handoff | draft-only delegate + `creative.concept.draft`; needs `skillSlug="creative"` + new `creative_refresh` target | substrate exists |
| Alex handoff | — | net-new seam |

---

## §13 — Open questions (resolve in writing-plans or later)

1. **Exact sufficiency thresholds** (clicks/conversions/days) per action family — set as config defaults, tune via eval.
2. **The economics-derived target** when margin/AOV is unknown — confirm the `marginBasis:"unavailable"` fallback never silently claims margin-awareness.
3. **Reconciliation drift bands** for the measurement-trust gate (the runner uses 1%/5% today).
4. **Lead-form compliance checks** — what compliance rules gate a Phase-D/E form edit (medical/medspa context).
5. **Conversational Riley** — whether to add the "Mouth/Ears" surface in Phase F or defer entirely.
6. **First implementation slice** — Phase A is the natural first plan; confirm whether the writing-plans pass should detail A only (recommended, expand B+ just-in-time) or A+B together.
