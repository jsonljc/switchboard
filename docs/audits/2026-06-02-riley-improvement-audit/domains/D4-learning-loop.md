# D4 — The Learning Loop & Proof-of-Lift (flywheel PROOF/IMPROVE legs)

> Raw domain audit. `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**Riley's "outcome attribution loop" (Wave-B PR-3) is a directional before/after spend/CTR comparator that writes display-only rows. It is NOT a learning loop. Nothing it produces is read back into Riley's judgment.**

- **Trigger/wiring.** Daily 07:00 UTC dispatch cron fans one `riley.outcome.attribute` event per org with acted Riley recs (`apps/api/src/bootstrap/inngest.ts:676-691`); per-org worker runs the orchestrator (`:693-699`). Kill-switch `RILEY_OUTCOME_ATTRIBUTION_ENABLED` defaults **off** (`riley-outcome-attribution.ts:47-50`, `inngest.ts:701`) — loop is **dark in prod**.
- **Candidate selection.** `findAttributableCandidates` pulls acted `PendingActionRecord`s where `sourceAgent="riley"`, `status="acted"`, window+24h elapsed, no existing outcome row (`recommendation-outcome-store.ts:209-241`). Only **two** kinds attributable: `V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"]` (`outcome-attribution-config.ts:3`). Riley's economically important actions — `scale`, `shift_budget`, `add_creative`, `review_budget` — are **excluded entirely**.
- **What outcome is captured.** `attributeOneRecommendation` (`outcome-attribution.ts:21-133`) computes a pre- vs post-window delta on a **single proxy metric per kind**: `pause`→spend change; `refresh_creative`→CTR change (`outcome-attribution-config.ts:7-23`). `attributionMethod` is the literal `"directional"` (`:119`).
- **What metrics the post-window provider fetches.** `getWindowMetrics` (`meta-insights-adapter.ts:50-71`) requests only `spend`, `inline_link_click_ctr`, `impressions`. **No conversions, no leads, no bookings, no CRM join.** `WindowMetrics = {spendCents, ctr, dailyRowCount}` (`outcome-attribution-types.ts:19-26`).
- **Where stored.** `RecommendationOutcome` table (`schema.prisma:594-630`), one row per rec.
- **Where read back.** **Exactly one consumer:** `GET /api/cockpit/riley/outcomes` (`outcomes.ts:36-41`) → `listRenderableForOrg` (`recommendation-outcome-store.ts:140-163`) → an allowlisted copy string in the cockpit activity feed as `kind:"observed"`. **That is the entire read path. Display-only.**

**Answering the key questions:**

- **(a) Read back to influence future recs?** **No.** Only reader is the cockpit feed. `packages/ad-optimizer/src` references no `RecommendationOutcome`/`outcomeStore`/`priorOutcome`/`bookedCac`/outcome history. `RecommendationInput` (`recommendation-engine.ts:26-43`) carries only current-period metrics — no slot for past performance, realized CAC, or operator feedback.
- **(b) DeploymentMemory/OUTCOME_PATTERNS analogue (like Alex)?** **No.** Alex's loop: `compounding-service.ts:245` (extract from `booked`) → `context-builder.ts:203-221` (surface) → `renderOutcomePatternsForContext` injects `<outcome-patterns>` into Alex's prompt (`builders/alex.ts:111-145`). **Riley touches none of it.** Riley's emission mirror (`emission-mirror.ts:57-91`) doesn't even populate `injectedPatternIds`. Across audits Riley learns nothing; thresholds are constants.
- **(c) `injectedPatternIds`-style lift for Riley?** **No.** It's Alex-only and even for Alex **write-only**: persisted (`work-trace-recorder.ts:111`, `platform-ingress.ts:556`) but only read by hash-exclusion lists (`work-trace-hash.ts:22`) — never aggregated for causation. Riley omits it entirely. No per-pattern lift, no counterfactual, no A/B anywhere.
- **(e) Can lift be measured from existing data?** **Not as-is.** The outcome window only has spend + CTR. Measuring whether a rec improved CPA/bookings needs conversions/bookings in both windows — which exist on the audit breach path (`meta-campaign-insights-provider.ts:94,116`) and in `source-comparator` economics — but the outcome adapter ignores them. The data largely exists; it's not joined.

## 2. GAPS / WEAKNESSES

1. **No IMPROVE leg — observe-and-display only.** "Outcome attribution" is a misnomer; the north-star "keeps getting better" is structurally absent.
2. **Wrong success metric inside the loop.** Measures spend-went-down-after-pause (tautological) and CTR-after-refresh. Neither measures booked-CAC/bookings — the thing Riley exists to optimize.
3. **Only 2 of ~6 action kinds attributable.** `scale`/`shift_budget`/`add_creative`/`review_budget` produce zero outcome rows.
4. **No counterfactual/causation.** `attributionMethod="directional"` hardcoded; pre/post on a volatile account is dominated by seasonality + concurrent operator edits.
5. **No operator-feedback signal captured.** The approve/reject verdict — the cheapest, highest-signal training data — is discarded (`applyAct` just flips status, `interfaces.ts:57-64`).
6. **Dark in production** (default-off flag).
7. **Riley contributes nothing to the cross-agent lift substrate** (no `injectedPatternIds`).

## 3. RANKED RECOMMENDATIONS

**R1 — Make the attribution window booking-aware (realized CAC delta, not spend delta).** Extend `WindowMetrics` to include conversions/bookedCount/costPerBooked; join CRM bookings; compute pre/post booked-CAC delta. `meta-insights-adapter.ts:50-71`; `outcome-attribution-types.ts:19-26`; `outcome-attribution.ts:61-108`. Effort M, risk M. **Highest — precondition for any honest "did Riley help?" claim.** _TAG: net-new beyond Phase 1._

**R2 — Capture operator approve/reject as Riley's first learning substrate.** On `applyAct`, persist `AdRecommendationFeedback` keyed by `{orgId, actionKind, economicTier, archetype}`; maintain per-org per-kind approval rate; feed back as a confidence/urgency modifier. `interfaces.ts:57-64`; `recommendation-engine.ts:26-43`. Effort M, risk L (advisory-only). **The cheapest closed loop — direct human verdicts, no Meta/CRM dep, no counterfactual.** _TAG: net-new (lightest possible calibration; flag-gated)._

**R3 — Extend attribution to all material action kinds.** Widen `V1_ATTRIBUTABLE_KINDS` + per-kind favorable-direction config. `outcome-attribution-config.ts:3-23`. Effort S-M. Deps R1. _TAG: Phase-1-adjacent display / net-new if used for learning._

**R4 — Turn on the loop + per-kind lift rollup (close the PROOF leg).** Flip the flag after a bake; add an aggregate rolling outcomes into mean booked-CAC lift by actionKind/economicTier (the missing causation read — easier than Alex's since each rec maps 1:1 to a campaign+window). New aggregate on `recommendation-outcome-store.ts`; flag `inngest.ts:701`. Effort S (after R1). Deps R1, R3. _TAG: net-new._

**R5 — Counterfactual baseline before any auto-calibration.** Add a matched-control/same-account synthetic baseline so lift is causal, not seasonal (`attributionMethod` field already exists, `outcome-attribution.ts:119`). Effort L. **Critical before Phase-2 execution.** _TAG: net-new / Phase-2 prereq._

**R6 — Have Riley emit `injectedPatternIds`** to join the cross-agent lift substrate (`emission-mirror.ts:57-91`). Effort S. Deps R2. _TAG: net-new._

**Priority:** R1 → R2 → R3 → R4 (R1+R2 = minimum viable "Riley learns + can prove it"; R5 hardens for execution; R6 = moat plumbing).

## 4. VERIFICATION LOG

Spec §2 confirms closed-loop/auto-calibration is an explicit non-goal. Read all anchor files — directional spend/CTR comparator, 2 attributable kinds, `WindowMetrics` shape. Grepped all non-test consumers of `RecommendationOutcome`/`cockpitRenderable` → only the cockpit feed route. `RecommendationInput` has no outcome/history slot. Alex's loop closed (`compounding-service.ts:245` → `context-builder.ts:203-221` → `builders/alex.ts:111-145`); Riley has no analogue. `injectedPatternIds` write-only even for Alex; Riley omits it. Outcome adapter fetches only spend/ctr/impressions; booking-aware data exists but unjoined. Kill-switch default-off. Read-only audit (no DB).
