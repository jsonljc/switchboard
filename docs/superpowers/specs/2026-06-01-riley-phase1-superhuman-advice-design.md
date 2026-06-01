# Riley Phase 1 — Superhuman Advice (Eyes + Target + Brain)

**Date:** 2026-06-01
**Status:** Approved (2026-06-01) — builder-ready; Phase 1 standalone, non-mutating
**Agent:** Riley (ad-optimization, Meta/Facebook), `packages/ad-optimizer`
**Decision frame:** "Leashed operator." Phase 1 makes Riley's _judgment_ superhuman with **zero mutating paths**. Phase 2 (separate spec) adds governed execution. This spec is Phase 1 only.

---

## 1. Problem (verified ground truth)

Four parallel verification agents confirmed the following against the live code (file:line cited inline). The headline is worse than "Riley only advises":

1. **Riley is blindfolded in production.** The deployed weekly-audit cron is wired to a hardcoded **stub** insights provider (`apps/api/src/bootstrap/inngest.ts:242-250`) returning `periodsAboveTarget: 0` and `learningPhase: false` for every campaign. Because the kill / pause / add-creative / review-budget rules all require `periodsAboveTarget ≥ 1` (or `≥ 7`), **they can never fire**. The learning-phase guard, fed a constant 30-day/100-event state, is **silently disabled**. The real `MetaCampaignInsightsProvider` exists and is exported but is instantiated **nowhere**.
2. **Riley optimizes the wrong target.** `metrics-riley.ts:100-106` reinterprets the booking-cost config as **cost-per-lead** and carries the comment _"no booking attribution… future slice."_ `qualifiedPct` is forced to `0`. The booked/CAC economics already exist (`source-comparator.ts:34-48` — `costPerBooked`, `closeRate`, `trueRoas`) but are not wired into the decision engine. A campaign that floods cheap junk leads that never book scores as a **win** today.
3. **Riley's sharpest tools are orphaned.** Creative-dedup (`creative-analyzer.ts`), saturation/decay (`saturation-detector.ts`), and breach-forecast (`trend-engine.ts:projectBreach`) are implemented and tested but **excluded from the weekly audit** — they only run if Riley is invoked as a chat tool. Cross-campaign budget imbalance is **detected and then dropped** (`budget-analyzer.ts:38-67` → `audit-runner.ts:489-507` never emits a recommendation).
4. **The decision engine is pure deterministic heuristics** — no LLM, no statistics, hardcoded thresholds and confidences. That is acceptable for Phase 1; the goal is to make those heuristics see correctly, aim correctly, and explain correctly — not to add ML.

**Phase 1 thesis:** Riley does not need a smarter brain first. It needs to (a) see real data, (b) aim at customers, and (c) use the sharp tools it already owns — and to _prove_ that its recommendations are better than a human operator's first-pass diagnosis, before it is ever allowed to touch spend.

**Landscape update — #788 (merged to `main` 2026-06-01, present in this worktree's base `42b99b74`).** While this spec was being written, `spendApprovalThreshold` was made a real, enforced governance lever (`packages/core/src/platform/governance/spend-approval-threshold.ts`): an opt-in, doubly-dormant, **deny-respecting** autonomy knob that _parks_ spend above a threshold and auto-executes only reversible _standard_ approvals at/under it. Two consequences: (1) **the Phase-1 claims above still hold** — the stub, the wrong target, and the orphaned analyzers are unchanged; only `inngest.ts` line numbers shifted (~242-250) via #786. (2) **Phase 2's governance substrate now exists** — #788 explicitly left the seam this work fills: _"a correct Riley producer needs a structured budget-delta field on `RecommendationOutput` (which it does not yet carry) AND a path that routes it through `PlatformIngress`."_ That field is this spec's `candidateAction` (§6); wiring the producer + executor is Phase 2, which is precisely #788's named out-of-scope item. **Phase-1 guardrail from #788:** the recommendation flow must keep #788's deliberate invariant — do **not** scrape a `spendAmount` into `parameters` (pinned by `recommendation-sink.test.ts`); `candidateAction` stays inert (§6).

---

## 2. Goal & non-goals

**Goal.** Riley's _recommendations_ outperform a human media buyer's first-pass diagnosis on real-shaped data, with **zero writes to any ad account**. Success is measured by the recommendation-quality contract (§3), not by recommendation count.

**Non-goals (explicit YAGNI — not built in Phase 1):**

- Execution / any write to Meta. (Phase 2, named sequel — §6.)
- Closed learning loop / threshold auto-calibration from outcomes.
- A/B experimentation framework.
- Creative generation or Mira handoff.
- Trust/autonomy ratchet (this was the "autopilot" option; not chosen).
- CAPI turn-on (related, separate flag flip).

No mutating path is touched in Phase 1. The `MetaAdsClient` mutating methods (`updateCampaignStatus`, `createDraft*`, `uploadCreativeAsset`) stay caller-less and keep their never-auto-activate guards.

---

## 3. Recommendation-quality contract (the Phase 1 acceptance definition)

Every recommendation Riley emits in Phase 1 MUST satisfy all six, and the verification suite (PR4) tests each property directly:

1. **Economically targeted** — based on cost-per-booked / trueROAS where booking signal exists, not raw leads.
2. **Evidence-gated** — a kill/cut requires a _durable_ breach (≥7 days above target out of the daily window) and minimum traffic (≥20 clicks, ≥7 days data); a one-off bad day does not trigger action.
3. **Learning-phase protected** — recommendations are suppressed (downgraded to `watch`) for ad sets Meta reports as still in the learning phase. (Campaign-level aggregation rule in §4·PR1.)
4. **Margin-aware** — targets derive from break-even economics (break-even ROAS = 1 / profit-margin) where margin is known, not arbitrary CPA multiples alone. **Invariant:** a recommendation may set `marginAware: true` only if a configured margin/AOV source was actually used. If none exists, it sets `marginBasis: "unavailable"`, keeps `marginAware: false`, and the rationale states the fallback — margin-awareness is reported _unavailable_, never silently _satisfied_.
5. **Operator-explainable** — each recommendation carries a plain-language rationale **and** names the economic tier it used (booked-CAC vs CPL vs CPC) and the evidence behind it.
6. **Non-mutating** — advisory only. The recommendation carries a fully-specified, stable **candidate action** (§6) but dispatches nothing.

**Principled abstention is a first-class output.** When evidence is insufficient, learning phase is active, or a breach is not durable, Riley emits an explicit no-action / `watch` with rationale — never silence, and never a weak action dressed as a confident one.

---

## 4. Workstreams — sequenced as four PRs inside Phase 1

> Sequence per user direction: PR1 Eyes → PR2 Target → PR3 Brain → PR4 Verify. WS1 is the _first PR inside Phase 1_, not a separate strategy: unblinding alone can look "alive" while still optimizing the wrong thing, so it ships as step 1 of the foundation, not as the foundation.

### PR1 · Eyes — turn the existing brain back on

**What:** Replace the stub `createInsightsProvider` (`inngest.ts:242-250`) with the real `MetaCampaignInsightsProvider`, and make its two stubbed signals real.

- **Durable breach (daily).** Enhance `getTargetBreachStatus` to pull **daily-incremented** insights (`time_increment=1`, trailing ~14 days) in a single Graph call per campaign, compute per-day CPA = spend / conversions, and count days where CPA > targetCPA → `periodsAboveTarget` with `granularity: "daily"`. This yields the daily breach signal the kill rule needs **immediately**, with no multi-week snapshot warm-up (the existing snapshot-array path stays as a fallback).
- **Learning phase (entity edge).** Derive learning state from the ad-set entity edge (`learning_stage_info.status` → the existing `AdSetLearningInput.learningStageStatus` of `LEARNING|SUCCESS|FAIL|UNKNOWN`), replacing the hardcoded `learningPhase: false`. Meta's _insights_ edge does not expose learning phase; this requires a new read on `MetaAdsClient` against the entity edge.
- **Learning-phase aggregation rule.** Learning state is an ad-set concept, but some recommendations are campaign-level. A campaign-level destructive/scale action is **suppressed (downgraded to `watch`) if any material child ad set is in `LEARNING`, or if learning-status coverage across child ad sets is incomplete above a threshold** (default: status known for < 80% of child ad-set spend). A "material" child = an ad set carrying ≥ 10% of the campaign's spend in the window. This prevents acting on a campaign whose learning state is only partially known.

**Files:** `apps/api/src/bootstrap/inngest.ts` (wiring), `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` (real signals), `packages/ad-optimizer/src/meta-ads-client.ts` (daily-increment + ad-set-learning reads).
**Tests:** provider returns non-zero `periodsAboveTarget` from real-shaped daily rows; learning status derived from entity-edge fixture; campaign downgraded when a material child ad set is learning or coverage is incomplete; audit-runner now fires kill/scale on durable-breach input.
**Acceptance:** with the stub removed, a campaign whose CPA exceeds target for ≥7 of 14 days produces a `pause` recommendation; a campaign with a learning material child produces `watch`.

### PR2 · Target — aim at customers, not clicks

**What:** Switch the decision engine and `metrics-riley` from cost-per-lead to **cost-per-booked / trueROAS**, reusing the economics already computed in `source-comparator.ts` and the CRM funnel, behind a strict fallback ladder (§5).

- Replace the `cpa = spend / conversions` driver in the breach/kill/scale/review-budget thresholds (`recommendation-engine.ts`, `audit-runner.ts:146,186,366`) with **cost-per-booked** where booking signal is sufficient, falling back per §5.
- Replace the forced-`0` `qualifiedPct` and the `"cost per lead"` ROI label in `metrics-riley.ts` with booked / CAC-vs-target, and remove (or invert) the "no booking attribution" caveat as it becomes true.
- Targets become margin-aware: where profit margin / AOV is configured, derive break-even ROAS / break-even CPA rather than a bare CPA multiple; otherwise mark `marginBasis: "unavailable"` per §3.4.

**Files:** `packages/ad-optimizer/src/recommendation-engine.ts`, `audit-runner.ts`, `packages/core/src/agent-home/metrics-riley.ts`, schema for the `economicTier` / `marginBasis` tags.
**Tests:** engine optimizes on cost-per-booked when bookings are present; falls back and lowers action strength **and constrains the allowed action set** when sparse (§5); metrics surface CAC-vs-target; `marginBasis: "unavailable"` set when no margin config.
**Acceptance:** identical raw ad metrics produce _different_ recommendations depending on downstream booking outcomes (cheap-leads-that-never-book is no longer a "win").

### PR3 · Brain — use the sharp tools it already owns

**What:** Promote the orphaned analyzers into the weekly audit and action the imbalance Riley already detects; harden the gates with transcribed thresholds.

- Wire `creative-analyzer` (dedup, spend-concentration, CPA-outlier), `saturation-detector`, and `trend-engine` breach-forecast into `audit-runner.ts` so the autonomous audit is as strong as Riley's chat tools.
- Convert `budget-analyzer` imbalance detection into an actual `shift_budget` / reallocation recommendation (today its output is dropped). **Materiality guardrails** (so tiny campaigns don't generate noisy reallocation recs): source spend share ≥ 10%, the CPA/ROAS delta above a minimum, source campaign **not** in learning, and the destination has sufficient evidence strength (Tier 1/2 and passing the evidence gate). Below these, emit `watch`, not a reallocation. **Reuse the existing `shift_budget_to_source` action** (no new `AdRecommendationAction` enum value), so the no-fallback exhaustive switches in `recommendation-sink.ts` (`humanizeRecommendation` / `buildPresentation` / `ACTION_RISK_CONTRACT`) need no new arm; `shift_budget_to_source` is already classified `financialEffect: true` (not swipe-approvable).
- Transcribe ~6 media-buyer guard thresholds from `claude-ads` (MIT — facts/numbers, low IP risk) into Riley's heuristic constants: kill guard ≥7d + ≥20 clicks; scale ≤20% step then observe 3–5d; learning-phase budget ≥5× target-CPA / "Learning Limited" share gates; creative-fatigue = CTR drop >20% over 14d; break-even-ROAS framing. **No new ML.**

**Files:** `packages/ad-optimizer/src/audit-runner.ts`, `recommendation-engine.ts`, analyzer modules (wire, not rewrite), threshold constants.
**Tests:** audit run includes dedup/saturation/forecast findings; a detected imbalance now emits a reallocation recommendation only when materiality guardrails pass; guard thresholds block premature kills.
**Acceptance:** the weekly audit's recommendation set is materially richer and better-gated than the bare `metric-diagnostician` path it uses today.

### PR4 · Verify — prove it on real-shaped data

**What:** End-to-end proof that Riley's recommendations satisfy §3.

- TDD per workstream, asserting against the **real provider's default outputs**, not hand-built fixtures (the safety-gate-needs-producer-population scar — a hand-built fixture hides a stubbed producer).
- One full audit run over real-shaped seed data producing genuine kill / scale / reallocate recommendations, snapshotted for review.
- **At least one withheld/no-action case** per §3's abstention rule: thin data, active learning phase, and a non-durable (one-off) CPA spike must each yield no action / `watch`, not a kill.
- Each recommendation asserted to carry the `economicTier` tag, the `marginBasis`, the evidence summary, and the candidate-action descriptor (§6) — and to dispatch nothing.
- **No-ghost-execution assertion.** Mechanically assert that a Phase 1 audit run creates **no** ad-action `PlatformIngress` event, **no** `WorkTrace` mutation record for an ad action, **no** call to any `MetaAdsClient` mutating method (`updateCampaignStatus` / `updateCampaignBudget` / `createDraft*` / `uploadCreativeAsset`), and **no** `operator.apply_ad_action` dispatch. "Dispatches nothing" is a tested invariant, not a comment.

**Acceptance:** the suite encodes §3 as executable checks; the snapshot review shows recommendations a human operator would recognize as correct, including correct _refusals_. Live-account verification is deferred to the Meta App Review timeline already on the launch critical path.

---

## 5. The fallback ladder (highest-risk element — strict, never silent)

Riley's economic target degrades in tiers when downstream signal is sparse. The ladder MUST surface the tier and constrain action — it must never silently present a weak-evidence recommendation as a confident one.

| Tier           | Used when                                                                        | Optimizes on                           | Action strength                                                                               |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 · Booked-CAC | booking signal sufficient (default ≥ 10 booked in trailing window; configurable) | cost-per-booked / trueROAS             | full confidence/urgency                                                                       |
| 2 · CPL        | bookings sparse but ≥ ~30 leads in window                                        | cost-per-lead                          | confidence −0.15 and urgency one band lower; rationale states "lead-proxy, booking data thin" |
| 3 · CPC        | leads sparse too                                                                 | cost-per-click / delivery hygiene only | lowest strength; kill/scale withheld, only `watch`/signal-health recommendations allowed      |

Rules:

- The tier is recorded on every recommendation (`economicTier` field) and named in the operator rationale.
- A fallback from Tier 1 to Tier 2 applies the defined step (default: −0.15 confidence, urgency one band lower); a fall to Tier 3 forbids destructive actions entirely (only `watch` / `fix_signal_health`).
- **Tier gates the allowed action _families_, not just confidence.** Tier 2 may emit budget review/reallocation **only when the evidence gates pass**; Tier 3 cannot emit any destructive or spend-increasing candidate action (no kill, no scale, no budget increase) — full stop.
- Thresholds (10 booked / 30 leads / −0.15) are defaults to confirm or tune in planning; all are configurable, not magic constants buried in logic.
- Tier selection is per-deployment / per-window, computed from real CRM counts, and tested for both the sufficient and sparse branches.

---

## 6. Phase 2 interface preview (named sequel — designed now, not implemented)

Phase 1 recommendations are advisory only, but they are shaped so Phase 2 adds **only** the governed dispatch, with no rework. Every actionable recommendation carries a stable, structured **candidate action**:

```
candidateAction: {
  kind: "pause_campaign" | "budget_reallocation" | "scale_campaign",
  target: { campaignId, adSetId? },
  reversibleChange: { ... },   // e.g. { dailyBudget: { from, to } } with to ≤ 1.20× from
  reversible: true,
  requiresHumanApproval: true  // always true in Phase 1
}
```

This is **additive** — Phase 1 keeps the existing human-facing `AdRecommendationAction` enum (no churny 14-value rename across schemas/sink/tests); `candidateAction` is the new optional Phase-2 seam carrying the exact reversible mutation. Phase 2 will add `MetaAdsClient.updateCampaignBudget` + an `operator.apply_ad_action` intent that consumes `candidateAction` through `PlatformIngress → WorkTrace → GovernanceGate`, with hard caps, idempotency, and the never-auto-activate backstop intact. **#788 (merged 2026-06-01) already built that governance substrate** — `extractSpendAmount` (canonical key `spendAmount`, aliases `budgetChange`/`newBudget`) + the opt-in, deny-respecting `applySpendApprovalThreshold` park/grant lever — so Phase 2 _feeds and executes_ #788's gate rather than rebuilding it. The `candidateAction.reversibleChange` budget delta is the structured field #788 said `RecommendationOutput` "does not yet carry."

**In Phase 1, `candidateAction` is inert metadata: it must be carried on the recommendation but consumed by no executor.** A test asserts no Phase 1 code path reads `candidateAction` to dispatch anything (it pairs with the PR4 no-ghost-execution assertion). **It is also not mapped to `parameters.spendAmount`** — Phase 1 keeps #788's deliberate no-scrape invariant (pinned by `recommendation-sink.test.ts`); the budget-delta → `spendAmount` mapping that arms `applySpendApprovalThreshold` is Phase 2 only. (If you'd prefer renaming the enum to `*_candidate` instead of the additive descriptor, that's a one-line call to make now — flagged in §8.)

---

## 7. Risks & mitigations

- **Thin pilot booking data → bad calls on noise.** Mitigated by the strict fallback ladder (§5) — lowered action strength **and** a constrained action set; tested in PR4's sparse branch.
- **Daily-increment Graph cost / rate limits.** One `time_increment=1` call per campaign per audit (weekly cadence) — negligible volume; reuse existing client backoff.
- **"Looks alive but is strategically weak"** (WS1 without WS2/3). Mitigated by shipping Target + Brain within the same Phase 1 spec, and by §3 testing economic correctness, not recommendation count.
- **Scope creep into execution.** Hard non-goal (§2); enforced mechanically by the PR4 no-ghost-execution assertion — no mutating method gains a caller in Phase 1.
- **Stale lower-layer artifacts causing false "main is broken."** Run `pnpm reset` before typecheck per CLAUDE.md when schemas change.

---

## 8. Open decisions for review

1. **Candidate-action shape** — additive `candidateAction` descriptor (recommended, low-churn) vs renaming the `AdRecommendationAction` enum to `*_candidate`. Default: additive. _(User signed off: keep additive.)_
2. **Fallback thresholds** — the "sufficient booking signal" count (10 booked), the lead floor (30), and the confidence step (−0.15) are sensible defaults; confirm or tune during planning.
3. **Margin source** — break-even economics require a configured profit-margin / AOV per deployment; if absent for pilot orgs, PR2 uses the CPA-multiple path, marks `marginBasis: "unavailable"` / `marginAware: false` on the recommendation (per §3.4), and margin-awareness lands when the config exists. It is reported unavailable, never silently satisfied.
