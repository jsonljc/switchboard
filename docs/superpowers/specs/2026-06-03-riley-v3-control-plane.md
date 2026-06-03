# Riley v3: Safe Revenue Control Plane (architecture spec)

**Date:** 2026-06-03
**Branch:** `worktree-riley-v3-control-plane-spec`
**Type:** architecture spec + sequenced roadmap (SPEC-ONLY; no product code, no schema files, no implementation)
**Scope of Riley today:** advisory-only, pre-Phase-C. This spec keeps it that way. Nothing here makes Riley execute.
**Roadmap detail:** `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md`

> Verification note. Every "already exists" claim below was audited (read-only) against `origin/main` at `63abdcb` (the per-source spend-attribution merge, #857), the parent of this spec commit. File:line anchors were accurate at that SHA and have been adversarially re-checked; a few may already be off by one or two lines under parallel-session drift. They are navigational, not contractual. Re-derive against live `main` at implementation time rather than trusting them blindly.

---

## 1. Thesis: consolidation, not rewrite

Riley (the ad-optimizer agent, `packages/ad-optimizer`) is often described as a 5-stage pipeline: Truth, then Diagnose, Lever, Authority, Learn. That framing is a planning-doc artifact, not the shape of the code. The code already collapses diagnose, lever, and output into single deterministic decision functions, already encodes per-action risk, and already has a fully-built governance permit path in `packages/core`. The weekly `AuditRunner.run()` is the spine and it works.

The v3 reframe is therefore not a new system. It is a renaming and consolidation of machinery that already exists, plus one genuinely-missing piece (the arbitrator). We stop modeling Riley as a linear pipeline and start modeling it as a stateful revenue control plane with five first-class objects.

Be precise about what "70%" means. The *substrate* is roughly 70% built: the RevenueState producers exist, the decision collapse exists, the three per-action risk maps exist, the ExecutionPermit is fully built, the outcome cron exists. That is not the same as "the work is 70% done." The *v3-specific value* (the arbitrator's single-primary selection, ownership derivation, the three OutcomeLedger enrichments, the business-context source, the Phase-C seam) is mostly net-new. This spec is careful to label each object as consolidation versus net-new rather than letting "the substrate exists" blur into "the work is mostly done."

The order of authority is the real thesis:

> deterministic control plane first, agentic router second, LLM narrator a distant third.

The LLM only narrates (`humanizeRecommendation`, `packages/ad-optimizer/src/recommendation-sink.ts:178-210`, a prose-only exhaustive `switch` with no model call and no fallback). The decisions are model-free and eval-gated (`evals/riley-recommendation/`, CI-blocking at `.github/workflows/ci.yml:536-601` via `pnpm eval:riley`).

**What the eval seam does and does not pin.** The eval runs the *per-campaign* decision path (`decideForCampaign` over a single synthetic campaign) plus account-level source-reallocation sub-evals. It therefore pins slice 1 (the RevenueState consolidation is behavior-preserving and stays inside that harness) and most of the decision layer. It does *not* currently exercise a cross-campaign selection: the OpportunityArbitrator (slice 2) lives at the `AuditRunner.run()` level, above the per-campaign harness, so the existing eval is structurally blind to it. Slice 2 must therefore bring its own pin (see section 3). Do not read "eval-gated" as "the arbitrator is automatically safe."

We do not throw out earned-the-hard-way code. The economic-tier resolver, the denominator step-change guard, the evidence floors, the signal-health checker, the spend attributor, the governance gate, the outcome-attribution cron all stay. v3 wraps them in typed objects; it does not replace them.

---

## 2. The reframe: pipeline to control plane

| v3 object | One-line purpose | Live status |
| --- | --- | --- |
| **RevenueState** | Is measurement AND business reality stable enough to act? | Real but scattered across `run()`; no single typed object. **Consolidate.** |
| **RevenueOpportunity** | The single most material booked-revenue leak, and who should own the fix. | Diagnose/lever/output already consolidated per-decision; ownership derivation and single-most-material selection are net-new. |
| **ActionContract** | What happens, blast radius and reversibility, rollback, success and guardrail metrics. | Risk/reset/evidence already encoded as three per-action maps; reversibility/rollback/guardrail fields are net-new and Phase-C-only. |
| **ExecutionPermit** | Is this allowed *now*? Approval, idempotency, cooldown, caps, expiry. | **Already built** in `packages/core` (`PlatformIngress.submit` to `GovernanceGate`). Riley does not use it yet (advisory-only). Zero new code. |
| **OutcomeLedger** | What happened after; was it causal or merely directional; should trust move? | `riley.outcome.attribute` cron and outcome rows exist; `causalStrength`/`businessContextStable`/`trustDelta` are net-new enrichments. |
| **OpportunityArbitrator** | Pick ONE primary mutating opportunity per account per cycle (plus optionally one non-mutating measurement fix). | **Genuinely missing.** Highest-value net-new piece. |

The rest of this section specifies each object: its purpose, the live producers it consolidates (with file:line), what is net-new, and where the typed boundary should live.

---

### 2.1 RevenueState: "is it safe to act?"

**Purpose.** A single typed object that answers one question before any opportunity is scored: is measurement and business reality stable enough to act on this account this cycle? It is the control plane's pre-flight check.

**Live producers it consolidates** (today these are six independent variables threaded through `AuditRunner.run()`, never aggregated; verified: no `RevenueState` type exists in `packages/schemas` or `packages/ad-optimizer`):

1. **Measurement trust.** `evaluateDenominatorStepChange()` (`packages/ad-optimizer/src/audit-report-builders.ts`, logic in `denominator-step-change.ts`) returns `{ measurementTrusted, accountWatch }`, consumed at `audit-runner.ts:408`. Detects an account-wide conversion-denominator collapse (`DROP_RATIO = 0.5`, `FLATNESS_BAND = 0.2`) that signals an attribution-window shift rather than a real performance drop. Gates cost-driven and learning-resetting recs (`campaign-decision.ts:177-189`) and the source reallocation (`source-reallocation.ts:159`).
2. **Economic tier and effective target.** `resolveEconomicTarget()` (`analyzers/economic-target.ts:168-189`) returns `{ economicTier: "booked_cac" | "cpl" | "cpc", effectiveTarget }`, consumed at `audit-runner.ts:417`. Tier 1 (`booked_cac`) needs a booked target *and* `accountBookings >= MIN_BOOKED_FOR_TIER1` (`=10`); Tier 2 (`cpl`) needs `accountConversions >= MIN_LEADS_FOR_TIER2` (`=30`); else Tier 3 (`cpc`). This is the booked-CAC-vs-CPL truth.
3. **Margin basis.** `marginBasis: "configured" | "unavailable"`, hardcoded `"unavailable"` at `audit-runner.ts:425` because no profit-margin / AOV source is plumbed. Surfaced honestly in `basisNote` rather than silently assumed.
4. **Coverage Gate-0.** `CoverageValidator.validate()` (`onboarding/coverage-validator.ts`) returns `coveragePct`; `isCoverageSufficient()` gates on `MIN_COVERAGE_PCT = 0.5` (50% of spend from tracked sources). Early-return abstention at `audit-runner.ts:300-321`. **Correction to a common shorthand:** the Gate-0 onboarding floor is **0.5**, not 0.7. (The 0.7 floor belongs to a *different* signal; see #6.)
5. **Signal health.** `SignalHealthChecker.getSignalHealthReport()` (`signal-health-checker.ts`) returns a `"red" | "yellow" | "green"` score plus `breaches[]`. `score === "red"` short-circuits the whole audit (`audit-runner.ts:336,345-357`); non-critical breaches become `fix_signal_health` recs.
6. **Per-source spend-attribution coverage.** `computeSpendBySource()` (`analyzers/spend-attributor.ts`, #857) returns `coverageBySource: Record<source, [0,1]>`, the fraction of each source's spend backed by real ad-set destination attribution vs the synthetic lead-share fallback. Gated by `SPEND_ATTRIBUTION_COVERAGE_FLOOR = 0.7` (`spend-attributor.ts:40`), consumed by `decideSourceReallocation()` (`source-reallocation.ts:150-156`): below floor on either source yields an honest null, no reallocation.

**Net-new.** One typed `RevenueState` object that the existing producers feed; the decision layer reads the object instead of six positional variables. No new computation: every field already exists, so we aggregate outputs, we do not recompute. One genuinely-missing dimension is deferred to slice 4: `businessContextFreshness` (clinic closed, promo ended, rep away, inventory out). That dimension is not free; it needs an operator-editable business-context source. A substrate partially exists, but mind which one: the *live* business-facts store (`prisma-business-facts-store.ts`) persists `BusinessFactsSchema` from `packages/schemas/src/marketplace.ts:274` (NOT the Playbook's separate `PlaybookBusinessFactsSchema` in `playbook.ts`), with a backfill migration `20260602140000_backfill_business_facts`, and Alex reads that store for dialogue (`skill-runtime/builders/alex.ts:100`). It carries *identity* facts (serviceArea, USPs, targetCustomer), not operational-state freshness, and it feeds Alex's dialogue, not Riley's audit. So `businessContextFreshness` is gated on net-new operational-state fields on that store (or a sibling) wired into Riley's path, not a free aggregation. Slice 4 must target `BusinessFactsSchema`/the store, not the like-named playbook schema.

**Assembly is progressive, not "once" (load-bearing correction).** `run()` has two early returns whose abort scopes *differ*, and the difference is the whole correctness story:
- **Gate-0 coverage abstention** returns at ~`:305`, before *every* downstream provider: the Meta insight fetches (`getCampaignInsights` x2 + `getAccountSummary`, ~`:339-343`), the CRM funnel, `resolveEconomicTarget` (`:417`), `marginBasis` (`:425`), the spend-attribution producer (inside `computeAuditEconomicsSections`, ~`:536`), and the booked-value provider. Nothing downstream runs.
- **Signal-health-red short-circuit** returns at ~`:345`, which is *after* the Meta insight fetches (they run at ~`:339-343` and feed the critical report's totals, so they are not skippable) but *before* the CRM funnel, `resolveEconomicTarget`, the spend-attribution producer, the booked-value provider, and the per-campaign decisions.

Therefore RevenueState **cannot be assembled in full up front** without calling the late producers past an abort that currently skips them, which would be both a behavior change and a Meta-quota/DB cost regression. The slice-1 design must build RevenueState *incrementally in producer order* and keep the two gates as standalone guards: RevenueState is complete only on the post-abort happy path, and its late fields (economic tier, marginBasis, spend-attribution coverage) are absent at both abort points. See the slice-1 abort-guard test in the roadmap, which encodes the asymmetry (Gate-0 calls zero providers; signal-red calls none of the late producers but does run the Meta fetches its report depends on).

**Where it lives.** Internal decision-layer type in `packages/ad-optimizer` (it is not persisted and not cross-surface), assembled in `audit-runner.ts` and passed into the decision functions. Not `packages/schemas` (that layer is for persisted/shared contracts like `RecommendationOutputSchema`).

**Why this is the strongest, lowest-risk win.** These six signals are independent pass-through values with zero cross-signal computation and no circular dependencies. The decision functions already take them as positional inputs, so threading one object is mechanical and pinned by the existing eval. It also co-locates the scattered gates (lines 300, 336, 408, 425, 536) into one legible "can we act?" object, which every later slice reads.

---

### 2.2 RevenueOpportunity: "the one material leak, and who owns it"

**Purpose.** A typed representation of a single candidate fix: the booked-revenue leak it addresses, its materiality, and who should own it (operator swipe, operator approval, Mira handoff, human escalation, or, Phase-C only, Riley itself).

**Live producers it consolidates.** The diagnose, lever, and output collapse the planning docs fear is *already done* in code:

- `decideForCampaign()` (`campaign-decision.ts:117-226`) internally runs `comparePeriods()`, `diagnose()`, `generateRecommendations()`, and four sequential gates (measurement-trust, economic-tier, learning-phase-active lockout, campaign learning guard) and returns `{ insights[], watches[], recommendations[] }` in one place.
- `decideSourceReallocation()` (`analyzers/source-reallocation.ts:132-208`) does the same for the account-level source mix, returning a single `RecommendationOutput | WatchOutput | null`.

The fragmentation risk lives in the plan docs, not the code. Keep these consolidated.

**Net-new (and labelled honestly).** Two things the recommendation layer does *not* have today, neither of which is a free read:

1. **Ownership as a derivation.** `RecommendationOutputSchema` (`packages/schemas/src/ad-optimizer.ts:191-217`) carries no owner. Ownership is decided downstream and *scattered across five inputs*, two of which are non-trivial functions: (a) `canSwipeApprove()` in the dashboard (`apps/dashboard/src/lib/decisions/swipe-policy.ts:8-10`), which needs `riskLevel` (derived in the sink from `urgency` via `URGENCY_TO_RISK`, not present on ActionContract or RevenueState) plus `clientFacing`; (b) the Mira-handoff gate, which is the `CREATIVE_HANDOFF_ACTIONS` allowlist (`recommendation-handoff-abstention.ts:10-13`, today only `refresh_creative`/`add_creative`) *plus* an evidence-floor check *plus* a learning-lock check inside `shouldAbstainFromHandoff`; (c) the governance approval mode in core. So ownership is **not** derivable from ActionContract plus RevenueState alone; it is a net-new derivation `deriveOwnership(opportunity, actionContract, revenueState, urgency, handoffGates, governanceMode)` that *subsumes* today's scattered logic into one place. That is a genuine and worthwhile consolidation, but it touches dashboard, handoff, and core, so it is not "additive and surface-agnostic." For the v3 advisory slices it lands backend-first as a parallel representation on the opportunity; whether the dashboard then *reads* it (true consolidation, a dashboard change) or keeps its own `swipe-policy` copy (duplication) is an explicit slice-2 decision, called out so it is not silently duplicated.
2. **"The *single most material* leak."** Today the audit emits multiple recommendations per account per cycle with no dedup, ranking, or selection (verified: `audit-runner.ts:511-513` pushes all per-campaign recs without filtering; one campaign can emit `add_creative` + `pause`, or `refresh_creative` + `restructure`). Choosing one primary is the OpportunityArbitrator's job (section 3); it is the missing piece, not a property of the decision functions.

**Where it lives.** `packages/ad-optimizer`, as an enrichment over the existing `RecommendationOutput` (ownership plus materiality plus the RevenueState snapshot under which it was judged).

---

### 2.3 ActionContract: "what happens, and how reversible is it"

**Purpose.** A per-action declaration of blast radius: reversibility, external/financial effect, whether it resets Meta's learning phase, evidence required, and (Phase-C only) rollback plan, success metric, guardrail metrics.

**Live producers it consolidates.** Today the "contract" is three co-located per-action maps, not one object (an important honesty correction; the shorthand "ACTION_RISK_CONTRACT encodes reversibility/effect/reset/swipe-approvability" overstates a single constant):

1. `ACTION_RISK_CONTRACT` (`recommendation-sink.ts:149-169`), keyed by the 14 action types, holds **two booleans each**: `{ financialEffect, externalEffect }`. That is all it holds. Eight money/platform-state actions (`scale`, `pause`, `restructure`, `review_budget`, `shift_budget_to_source`, `consolidate`, `expand_targeting`, `switch_optimization_event`) are `true/true`; six informational actions (`hold`, `test`, `refresh_creative`, `add_creative`, `harden_capi_attribution`, `fix_signal_health`) are `false/false`.
2. `ACTION_RESETS_LEARNING` (`action-reset-classification.ts:21-40`), a *separate* map keyed by the same actions: `"yes" | "no" | "conditional"`. At emit time, any `resetsLearning === "yes"` is forced to `externalEffect: true` (`recommendation-sink.ts:450-453`); learning reset is treated as material even when no dollars move (it especially hurts low-volume SMB).
3. `EVIDENCE_FLOORS` (`evidence-floor.ts`), per-action-family minimum evidence before a rec is allowed (e.g. `scale` needs `conversions: 3`; source reallocation needs `MIN_SOURCE_LEADS = 10`, `MIN_SOURCE_BOOKINGS = 3`).

"Swipe-approvability" is *not stored*; it is *computed* in the dashboard from these fields plus risk level (`canSwipeApprove()`: `riskLevel === "low" && !externalEffect && !financialEffect && !clientFacing`).

**A subtle trap: the static contract and the emitted contract disagree.** `ACTION_RISK_CONTRACT` is the *static* map, but the sink elevates `externalEffect` to `true` whenever `resetsLearning === "yes"` (`recommendation-sink.ts:453`). So `refresh_creative` is `false/false` in the static map yet *mutating* after elevation, while `pause` is `true/true` static and `resetsLearning: "no"`. Any consumer that asks "is this action mutating?" (the arbitrator, section 3) must apply the same elevation as the sink, or it will disagree with the sink about which actions are mutating. The consolidated ActionContract must expose both the static booleans and an `isMutating` helper that bakes in the elevation, used by everyone.

**Net-new, and explicitly Phase-C only.** `reversibility`, `rollbackPlan`, `successMetric`, `guardrailMetrics` do *not* exist (verified absent across the package and `RecommendationInputSchema`). "Reversibility" exists in core's governance `RiskInput` but defaults to `"full"` and Riley never populates it. These only matter at *execution*, which Riley cannot do. So v3 designs the ActionContract schema seam (slice 5) so Phase-C drops these fields in cleanly, but builds no rollback for actions that cannot execute. The v3 ActionContract is the consolidation of the three existing per-action maps into one keyed object plus the `isMutating` helper, with reversibility/rollback/guardrail as a designed-but-unwired extension.

**Where it lives.** `packages/ad-optimizer`, replacing the three parallel maps with one keyed `ActionContract` record. Surface-agnostic (Layer 2; no UI import; the dashboard keeps computing swipe-approvability from the contract fields it already reads).

---

### 2.4 ExecutionPermit: "is this allowed *now*"

**Purpose.** The runtime gate that decides whether a specific mutating action is allowed at this moment: approval state, idempotency, cooldown, spend caps, expiry.

**Live status: already built, in `packages/core`, not net-new.** This is the single most important "already exists" finding. The permit is the governance path:

- `PlatformIngress.submit()` (`packages/core/src/platform/platform-ingress.ts`) returns a `SubmitWorkResponse` whose approval-required branch carries an explicit `approvalRequired: true` (plus `lifecycleId?`, `bindingHash?`). Idempotency is a claim-first guard *before* governance (`platform-ingress.ts:100-160`).
- `GovernanceGate` (`packages/core/src/platform/governance/governance-gate.ts`) runs, in order: system auto-approval short-circuit, policy-engine evaluation, the `trustLevelOverride` constraint override (`governance-gate.ts:93-95`), and a spend-approval-threshold post-process. The policy-engine checks themselves live in `packages/core/src/engine/`: **cooldown** at `engine/policy-engine.ts:194-232`, **spend caps** (per-action plus daily/weekly/monthly) at `engine/spend-limits.ts:27-121`. **Approval expiry** is enforced at dispatch admission, `packages/core/src/approval/dispatch-admission.ts:46-52` (executable-until check). (These three files are in `engine/` and `approval/`, not under `platform/governance/`; the bare filenames are correct, the directory is not the governance dir.)
- `trustLevelOverride` is **stored and enforced** (`governanceSettings.trustLevelOverride`, read in `prisma-deployment-resolver.ts:133`, enforced in `governance-gate.ts:93-95`; the spend-autonomy lever is dormant unless `trustLevelOverride === "autonomous"`).

**Why Riley does not use it yet, and the one wire that does.** Riley's `packages/ad-optimizer` decision path *never imports `PlatformIngress`* (verified). Recommendations are advisory. The first and only wire into the governed-draft path is the Riley to Mira handoff (#854): `recommendation-handoff-dispatch.ts` builds a candidate (pure; abstains via `recommendation-handoff-abstention.ts`) and hands it to an *injected submitter callback*; the bootstrap layer (`apps/api/.../recommendation-handoff-workflow.ts`, `recommendation-handoff-request.ts`) is what actually calls `PlatformIngress.submit` with the seeded `{ id: "system", type: "system" }` actor, an idempotency key shaped `handoff:riley:<recId>:<action>`, and the intent `adoptimizer.recommendation.handoff` (which routes to a Mira *creative* draft, not an ad mutation), parking the draft for mandatory human approval.

**Net-new.** *Nothing in the permit itself.* v3's contribution is sequencing: design how a `RevenueOpportunity` plus `ActionContract` map onto a `CanonicalSubmitRequest` so that, in Phase-C, Riley's first self-owned reversible action class flows through the *same* governed path. Critically, that request is **not** the creative-handoff request: a self-executed `pause` needs a *new* ad-mutation intent and resolves to *Riley's own* deployment, not Mira's creative deployment. So slice 5 reuses the path's *conventions* (seeded actor, idempotency-key shape, the `approvalRequired` branch) but defines a new intent and deployment resolution. No new permit infrastructure; the open question is the intent/deployment for Riley self-execution, which is a Phase-C decision, not a spec one.

**Where it lives.** It already lives in `packages/core`. v3 adds no code here; it adds a documented mapping and (slice 5) a small designed-but-unwired adapter in `packages/ad-optimizer`.

---

### 2.5 OutcomeLedger: "what happened, was it causal, should trust move"

**Purpose.** The after-action record: what changed in the post-action window, whether the change is causal or merely directional, whether the business was stable enough for the result to mean anything, and whether trust in this action class should move.

**Live producers it consolidates.**

- `riley.outcome.attribute` cron lives in **ad-optimizer** (`packages/ad-optimizer/src/inngest-functions.ts:452-471`, daily 07:00 UTC); `executeRileyOutcomeAttributionDispatch` (`:439-450`) fans out one event per Riley org.
- The outcome record `RileyOutcomeRow` and the attribution engine live in **core** (`packages/core/src/recommendations/outcome-attribution-types.ts:91-113`, `outcome-attribution.ts`). The row carries `attributionMethod: "directional"`, a *static* `confidence: "low" | "medium"` (hardcoded per action kind in `KIND_CONFIG`, never updated post-insert), a pre/post `metricSummary` with `deltas`, and `visibilityFlags[]` (`meta_data_missing`, `zero_pre_baseline`, `below_noise_floor`, `same_campaign_overlap`, `same_kind_retry`) that hide noisy/conflicted outcomes from the cockpit. The row is rendered to an *existing* operator surface (the cockpit outcome feed via `/api/riley/outcomes`); there is already a human-readable home for enrichments.
- Critical scope fact: only *two* action kinds are attributable today, `V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"]` (`outcome-attribution-config.ts:3`). Everything else produces no outcome row.
- The PR-3/3.2 "learning loop" feeds booked-conversation patterns into `DeploymentMemory` for *agent dialogue* (`outcome-pattern-extractor.ts`), *not* back into Riley's recommendation scoring. The OutcomeLedger today is observational, not a feedback controller: it does not re-score recommendations or move trust.

**Net-new enrichments (advisory; rendered on the existing outcome feed; not auto-applied until Phase-C):**

- **`causalStrength`**, a *3-value enum* (`directional | corroborated | inconclusive`), not counterfactual/synthetic-control modeling. Honesty constraint (load-bearing): only two of the three values are derivable from signals we have today. The existing signals (`visibilityFlags`, `dailyRowCount`, overlap/retry) only ever *subtract* confidence, so they distinguish `directional` (a clean single pre/post delta, no flags) from `inconclusive` (flagged, sparse, or zero-baseline). They cannot, on their own, justify `corroborated`, which means *an independent second estimate agrees*. The only honest source of corroboration in this codebase is the CRM/booking side (e.g. a `pause` whose Meta spend fell *and* whose booked-revenue-per-dollar held, read from the booked-value provider / `bySource` funnel). That signal is **not** in today's outcome path (which reads only Meta `WindowMetrics`); wiring it is net-new and is sequenced with slice 4. Until then the ledger emits only `directional | inconclusive` and **never fabricates `corroborated`**. Keeping the enum at three values reserves the slot without over-claiming.
- **`businessContextStable`**, whether the business was stable across the attribution window (gated on slice 4's `businessContextFreshness`; absent that source it records `unknown`, never a fabricated `true`). Window-alignment matters: it must check that an operator confirmation's validity interval *overlaps the full attribution window* (`windowStartedAt` to `windowEndedAt`, which is in the past relative to the cron run), not merely that the operator edited the context recently.
- **`trustDelta`**, an explicit `up | none | down` record of whether trust in this action class *should* move, given the outcome and its `causalStrength`. Recorded *and rendered on the existing cockpit outcome feed* so a human reads it; **not auto-applied** (Riley executes nothing; auto-application of trust into future scoring is Phase-C). This is the seam where the OutcomeLedger *could* become a feedback controller, designed now and read by an operator now, switched into the scoring loop later. It is explicitly a Phase-C field surfaced early on an existing surface, not a dead stored field (see risk 7.2).

**Where it lives.** Enrichments extend the existing `RileyOutcomeRow` and attribution path in `packages/core/src/recommendations/`. Scoped to `V1_ATTRIBUTABLE_KINDS` (do not claim causal strength for actions we cannot even attribute).

---

## 3. The OpportunityArbitrator (the one genuinely-missing piece)

**Why it matters most.** For low-volume SMB, multiple simultaneous mutating edits in one cycle wreck attribution and reset learning. The OutcomeLedger already *detects this damage after the fact*: `same_campaign_overlap` and `same_kind_retry` visibility flags hide outcomes that were confounded by a concurrent edit. The arbitrator exists to close that loop. In its slice-2 form it is decision support: it names the single most material mutating opportunity so the operator approves one change rather than many, which already reduces concurrent-edit conflict. Mechanical *prevention* (suppressing non-primary mutating actions from the handoff or, later, from execution) is a deliberate, separately-tested enforcement step layered on top, not part of slice 2. The spec keeps the two distinct so "additive ranking" and "prevents conflicts" are never claimed of the same slice.

**What it does, and what it deliberately does not do.** The arbitrator runs at the `AuditRunner.run()` level (across all per-campaign candidates plus the account-level reallocation), after candidates are assembled. It picks one primary mutating opportunity per account per cycle, optionally plus one non-mutating measurement fix (a measurement-integrity fix, `fix_signal_health` or `harden_capi_attribution`, both non-mutating, does not conflict with attribution and should not be starved by the mutating cap).

It is **additive ranking metadata**: it annotates a `primaryOpportunity` and demotes other mutating candidates to a `secondary`/`deferred` rank. In slice 2 it **does not** change what gets emitted and **does not** change handoff gating. The #854 Mira handoff keeps firing under its existing rules (`shouldAbstainFromHandoff`), and emission stays unfiltered. The arbitrator's `primary` is consumed only by the operator surface, to highlight the single recommended action among many. This keeps slice 2 genuinely behavior-preserving for the emission and handoff paths. Making the handoff (or, in Phase-C, self-execution) *honor* the primary, that is, suppress non-primary mutating actions, is a separate, deliberately-tested step, not part of slice 2. The spec is explicit about this because "additive metadata" and "drives the handoff" cannot both be true at once.

**The arbitrator is not pinned by the current eval; slice 2 must bring its own.** The existing harness is per-campaign and cannot observe a cross-campaign selection (section 1). So slice 2's safety net is (a) direct unit tests of the deterministic `arbitrate(...)` function, and (b) a *new* multi-candidate eval fixture: extend `run-eval.ts` (which already supports account-level source-reallocation sub-evals) to drive a multi-campaign account and assert `expectedPrimary`. Until that harness exists the arbitrator is unpinned net-new behavior; building it is part of slice 2, not an afterthought.

**Deterministic score, not a bandit.** Each candidate gets:

```
score = materiality × revenueProximity × truthConfidence
        − learningResetPenalty
        − attributionConflictPenalty
```

Every factor is grounded in a signal that *already exists*, with one caveat called out:

| Factor | Grounded in (live) |
| --- | --- |
| `materiality` | the action's projected dollar impact. **Caveat:** today the only dollar magnitude is `estimateRisk(rec)` (`recommendation-sink.ts`), a regex scrape of the first `$` in the prose `estimatedImpact` (returns 0 when absent) and is an impact projection, not a clean comparable risk. It is unreliable as a primary ranking weight. Slice 2 must derive materiality from a *structured* magnitude (e.g. spend at the campaign, breach severity), not the prose scrape, or the top pick is partly arbitrary. |
| `revenueProximity` | `economicTier` from RevenueState: `booked_cac` (closest to booked revenue) over `cpl` over `cpc`. |
| `truthConfidence` | RevenueState composite: `measurementTrusted`, signal-health score, coverage (0.5 floor), per-source attribution coverage (0.7 floor), tier confidence. |
| `learningResetPenalty` | `ACTION_RESETS_LEARNING`: `yes` over `conditional` over `no`. |
| `attributionConflictPenalty` | the same condition the ledger flags as `same_campaign_overlap` / `same_kind_retry`: penalize a second mutating action on a campaign/account already being changed this cycle. |

"Mutating" means `ActionContract.isMutating` (the elevated contract, section 2.3: `financialEffect || externalEffect || resetsLearning === "yes"`, matching `recommendation-sink.ts:453`). The arbitrator chooses the highest-scoring mutating candidate; non-mutating measurement fixes bypass the cap.

**Where it lives.** A new deterministic module in `packages/ad-optimizer` (e.g. `analyzers/opportunity-arbitrator.ts`), reading `RevenueState` plus the candidate `RevenueOpportunity`s plus `ActionContract`. Pure, model-free, unit-tested, and pinned by the new multi-candidate eval fixture.

---

## 4. Defer list (out-of-scope-until-needed, stated explicitly)

These are deliberately *not* built. Stating them prevents scope creep and the "design balloons into Phase-C" failure mode.

1. **ExplorationBudget / conservative bandits.** Riley executes nothing; there is nothing to explore-vs-exploit. YAGNI until Phase-C autonomy. Deferred.
2. **Conformal-prediction machinery.** Keep the *principle* (wide uncertainty, so watch, do not act) but the existing named evidence floors *already are* the low-n uncertainty guard: `MIN_SOURCE_LEADS = 10`, `MIN_SOURCE_BOOKINGS = 3`, the `scale` family's `conversions: 3`, the `0.5` coverage Gate-0 floor, the `0.7` spend-attribution coverage floor, `MIN_BOOKED_FOR_TIER1 = 10`, `MIN_LEADS_FOR_TIER2 = 30`. No conformal infrastructure.
3. **Full ActionContract rollback/guardrail fields plus ExecutionPermit as new built code.** Design the schema *seam* (slice 5) so Phase-C drops in cleanly. Do *not* build `rollbackPlan`/`successMetric`/`guardrailMetrics` execution machinery for actions that cannot execute. The ExecutionPermit is already built in `packages/core`; v3 adds no permit code.
4. **`causalStrength` as counterfactual / synthetic-control / CausalImpact modeling.** It is a *3-value enum*; `corroborated` is a single independent-agreement check (CRM/booking), not a causal-inference engine. Until that signal is wired (slice 4), only `directional | inconclusive` are emitted.
5. **Standalone net-new Riley "results dashboard".** Out of scope here (tracked separately in the economic-truth-operator slice). v3 is backend object boundaries. Note this defer is about a *new standalone results surface*; it does **not** forbid the small, targeted extensions of *existing* operator surfaces that slices 3 and 4 need (`trustDelta` on the existing cockpit outcome feed; an operator business-context editor). Those are explicitly in scope and distinguished from the deferred results dashboard.
6. **`businessContextFreshness` as a free aggregation.** It is real and wanted, but it depends on net-new operator-editable operational-state plumbing (slice 4), not on consolidating existing producers. Until that exists, RevenueState carries it as `unknown`.

---

## 5. Sequenced roadmap (summary)

Five focused slices over the accreted system, *not* a rewrite. Each is independently shippable, eval-anchored (or, for slice 2, eval-extended), and advisory-only until Phase-C. Full per-slice detail (files, tests, acceptance, risks) is in `docs/superpowers/plans/2026-06-03-riley-v3-control-plane.md`.

1. **RevenueState consolidation** *(recommended first session)*. Behavior-preserving refactor: existing producers feed one *progressively-assembled* typed `RevenueState` (honoring the two early aborts); the decision layer reads the object instead of six positional variables. Eval stays green; add an abort-guard test. Pure win, lowest risk, every later slice depends on it.
2. **OpportunityArbitrator (plus the ActionContract consolidation it first consumes).** One primary mutating opportunity per cycle (plus optional one measurement fix). Deterministic score (section 3), materiality from a structured magnitude. Additive ranking metadata that does not change emission or handoff gating. Brings its own pin: arbitrator unit tests plus a new multi-candidate eval fixture with `expectedPrimary`.
3. **OutcomeLedger enrichment.** Add `causalStrength` (`directional | inconclusive` now; `corroborated` reserved for slice 4), `businessContextStable` (`unknown` until slice 4), `trustDelta` (recorded and rendered on the existing cockpit outcome feed, not auto-applied) onto the existing `riley.outcome.attribute` path. Scoped to `V1_ATTRIBUTABLE_KINDS`.
4. **`businessContextFreshness` (a sub-project, not a peer slice).** Split into 4a (schema plus store plus migration for operator operational-state with a freshness/last-confirmed timestamp), 4b (operator editor surface), 4c (RevenueState plus OutcomeLedger consumption, flipping `businessContextStable` and enabling the `corroborated` arm of `causalStrength`). Heaviest workstream; spans four packages plus an operator surface.
5. **Phase-C seam.** Design (designed-but-unwired) the `ActionContract` reversibility/rollback/guardrail fields and the `RevenueOpportunity` plus `ActionContract` to `CanonicalSubmitRequest` adapter for a self-executed reversible class (`pause` is the natural first: reversible, `resetsLearning:"no"`). The adapter defines a *new* ad-mutation intent and Riley-self deployment resolution (not the Mira creative handoff), and its test asserts convention-parity with the live handoff request builder so drift breaks it. Flipped only when Riley earns execution, in a separate Phase-C session.

**Sequencing rationale.** 1 is the foundation every other slice reads. 2 delivers the highest net-new value and depends only on 1. 3 enriches the after-action record and can run parallel to 2. 4 unblocks the dimensions that need new plumbing (and the `corroborated` arm). 5 is the explicit Phase-C bridge, kept unwired so advisory-only Riley stays advisory-only until it has earned execution.

---

## 6. Cross-cutting constraints honored

- **Advisory-only stays advisory-only.** No slice (1 through 4) gives Riley a mutating path. Slice 2 keeps emission and handoff gating unchanged. Slice 5 is designed-but-unwired. Grep test for every implementation PR: no new `PlatformIngress` caller in `packages/ad-optimizer`, no Meta write, no new mutating caller.
- **Surface-agnostic backend.** New backend objects live in `packages/ad-optimizer` (Layer 2) or `packages/core`; none import UI. The dashboard keeps computing swipe-approvability from contract fields it already reads. The targeted operator-surface touches (trustDelta on the existing outcome feed, the slice-4 business-context editor) are explicit, scoped UI additions, not a reopening of the deferred results dashboard.
- **Eval-anchored, honestly.** `pnpm eval:riley` (CI-blocking) pins the per-campaign *decision behavior* that slice 1 preserves. It does *not* pin the audit-runner provider/abort sequencing (the slice-1 abort-guard test does that) and does *not* pin the cross-campaign arbitrator (slice 2 adds a new multi-candidate fixture). The outcome path (slice 3) is downstream of decisions and does not perturb the eval.
- **No premature abstraction.** RevenueState and ActionContract are consolidations of existing maps/variables. ExecutionPermit adds zero code (it exists). The arbitrator is the only genuinely new module.
- **Honest about exists-vs-new.** Substrate ~70% built (RevenueState producers, decision collapse, three risk maps, full permit path, outcome cron). Net-new value: the arbitrator's selection, ownership derivation, three outcome enrichments, the business-context source, the Phase-C seam. "Substrate exists" is not "work done."
- **Conventions.** ESM plus `.js` relative imports; no `any`; co-located `*.test.ts`; conventional lowercase commit subjects; no em-dashes in prose; files under the 600-line arch-check ceiling.

---

## 7. Open questions / risks (addressed in the design above; restated for the implementer)

1. **Arbitrator vs eval.** The current eval is per-campaign and cannot see a cross-campaign arbitrator. Slice 2 must add a multi-candidate fixture (`expectedPrimary`) and keep the arbitrator additive (no change to emission/handoff gating). If a future product decision wants the arbitrator to *suppress* non-primary mutating actions, that is a separate, explicitly-tested behavior change, not a silent edit.
2. **`trustDelta` inertness.** It is a Phase-C field surfaced early. Mitigation that must actually happen in slice 3: render it on the *existing* cockpit outcome feed so a human reads it. If slice 3 cannot surface it on an existing surface, defer `trustDelta` to Phase-C rather than storing an unread field (the project's "fields stored is not enforced" lesson).
3. **RevenueState assembly ordering (asymmetric).** Honor the two early returns. Gate-0 must call *no* provider at all. Signal-health-red must not call `resolveEconomicTarget`, the CRM funnel, the spend-attribution producer, the booked-value provider, or the per-campaign decisions, but it runs *after* the Meta insight fetches (`getCampaignInsights` x2 + `getAccountSummary`), which feed its critical report and must not be moved or skipped. Assemble RevenueState incrementally; its late fields are absent at both aborts. Slice 1's abort-guard test encodes exactly this asymmetry.
4. **`businessContextFreshness` source of truth and window-alignment.** The freshness signal must encode *staleness of the input itself* (when did the operator last confirm), and `businessContextStable` must require that the confirmation's validity interval *overlaps the full attribution window* (which is in the past), not merely a recent edit. Otherwise stability is falsely confident.
5. **`causalStrength` derivation honesty.** Only `directional | inconclusive` are derivable from existing confidence-subtracting signals. `corroborated` requires the net-new CRM/booking-agreement signal (slice 4) and is never fabricated before then.
6. **`materiality` ranking signal.** The prose dollar-scrape (`estimateRisk`) is unreliable for ranking. Slice 2 must rank on a structured magnitude or the arbitrator's top pick is partly arbitrary.
7. **Ownership placement.** `deriveOwnership` consolidates five scattered inputs. Decide in slice 2 whether the dashboard reads the new field (consolidation, a dashboard change) or keeps its own `swipe-policy` copy (duplication). Do not silently duplicate.
8. **Slice 5 intent/deployment.** A self-executed `pause` is not the Mira creative handoff; it needs a new ad-mutation intent and Riley's own deployment resolution. That is an open Phase-C question. The slice-5 adapter is unwired and its test asserts convention-parity with the live handoff builder so it cannot rot silently.
