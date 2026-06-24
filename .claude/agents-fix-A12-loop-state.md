# A12 Riley count-vs-value reallocation gate — loop state (orchestration scratch, not committed)

Durable record lives in [[project_riley_capability_audit_2026_06_10]] / moc_riley.

Goal: gate the scale->reallocate money-move on PROVEN paid value (fail-closed) so a cheap-cost-per-LEAD campaign whose leads never pay does NOT auto-scale. A12 is the 2nd/last autonomous prereq (with A6) for ever flipping RILEY_REALLOCATE_SELF_EXECUTION_ENABLED.
Authority: SURFACE-before-merge (money-adjacent: Riley budget reallocation gate). Full autonomy through opening the PR; human makes the merge call.
Task-size: standard (one bounded PR; producer->consumer span of one safety gate: db query + ad-optimizer gate + apps/api wire + eval).
Base: origin/main @ d5dcbaa5e (A6 #1246 is HEAD; main has NOT advanced past A6). baseline_sha: <captured at PLAN>
Worktree: .claude/worktrees/agents-fix-a12-riley Branch: fix/riley-count-value-gate
merge_safety: stop-glob touched = YES (money-adjacent reallocation gate; the reallocate submitter path) -> SURFACE-before-merge. independent_review = <pending>

## ORIENT brief (every claim tool-verified vs main @ d5dcbaa5e)

THE GAP (confirmed real):

- Scale rec fires on COUNT-CPA: recommendation-engine.ts:340-360 `scale` rule = `cpa > 0 && cpa < 0.8*targetCPA && periodsAboveTarget===0 && diagnoses.length===0`, where `cpa = spend/conversions` (campaign-decision.ts:30-31, cpl===cpa, count-based). So a cheap cost-per-LEAD campaign scales even if leads never PAY.
- The money-move: scale rec -> recommendation-sink.ts:543 -> budget-sink-dispatch.ts:dispatchRileyBudgetReallocation -> riley-budget-dispatch.ts:72 buildRileyBudgetCandidate (`actionType==="scale"`) -> riley-budget-submitter.ts -> PlatformIngress (parks for MANDATORY approval). NO paid-value check anywhere on this path.
- Flag wiring: inngest.ts:593 `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED==="true"` is the SOLE flag that wires `rileyBudgetSubmitter`. Flag OFF today => no reallocation proposals fire at all (inert). The gate is a forward safety property load-bearing at the flag-flip.
- trueROAS is DISPLAY-ONLY: source-reallocation.ts:303-323 -> compareCampaigns (source-comparator.ts:89) -> CampaignEconomicsRow.trueRoas, fed by queryBookedValueCentsByCampaign. Feeds the REPORT, NOT the scale decision/dispatch.
- `queryPaidValueCentsByCampaign` confirmed ABSENT (grep, src-wide).

BOOKED vs PAID (decisive):

- queryBookedValueCentsByCampaign (prisma-conversion-record-store.ts:226-254): ConversionRecord WHERE type="booked", origin="live", value:{gt:0}, occurredAt range, sourceCampaignId; groupBy sourceCampaignId; \_sum value (cents). `value` = EXPECTED value at booking ISSUANCE (playbook price; resolveBookedValueCents). Booked != paid (a no-show booking still has booked value).
- PAID value HAS a real producer: type="purchased" ConversionRecords written by record-verified-payment.ts:159-164 (`value: amountCents` real paid cents + `sourceCampaignId: params.sourceCampaignId ?? null`) and operator-intents/revenue.ts:58. So a `queryPaidValueCentsByCampaign` over type="purchased" (same origin/value/sourceCampaignId/date filters; ONLY type differs) is the genuine paid-value sibling. NO schema change (ConversionRecord already has the fields + indexes).
- trueRoasFromCents (source-comparator.ts:61) is the existing unit-correct ROAS computation (normalizeConversionValue cents->dollars, #819-trap-aware) BUT does NOT Number.isFinite-guard valueCents (a NaN sum -> NaN sails through). The store side excludes NaN/<=0 via value:{gt:0}+sum>0, but the floor must Number.isFinite-guard regardless ([[feedback_nan_blind_comparison_gates]]).

SEAMS:

- decideForCampaign (campaign-decision.ts:136) is PURE/per-campaign; the eval (`pnpm eval:riley`) drives it directly (evals/.../decide.ts:171). It already demotes scale->watch via measurement_untrusted (:225-238) and in_learning_phase (:257-267) — the established pattern to mirror.
- audit-runner.ts:582-664 per-campaign loop builds CampaignDecisionInput + calls decideForCampaign; injected per-org modifiers (confidenceModifierByKind/outcomeMultiplierByKind) threaded at :652-659 — the pattern to mirror for paidValueGate. Booked-value provider resolved separately in computeAuditEconomicsSections (:692-702). audit-runner.ts is 851 lines WITH `eslint-disable max-lines` (line 2) => arch-exempt, safe to add lines (but prefer a helper).
- WatchOutputSchema.pattern = z.string() (ad-optimizer.ts:216) => NEW watch pattern needs NO schema change.
- Barrels: BookedValueByCampaignProvider exported ad-optimizer index.ts:40; PrismaConversionRecordStore exported db index.ts:126; recommendation-watches.ts (78 lines) houses pure watch constructors.
- A6 go-live runbook exists: docs/runbooks/riley-reallocation-go-live.md (extend with the paid-value precondition).

## FRAME — settled design (the ONE real question)

DESIGN QUESTION (c): reuse the EXISTING trueROAS (booked value) vs add queryPaidValueCentsByCampaign (paid value)?
RESOLUTION: do BOTH halves of (c), each for the right reason:

- ADD `queryPaidValueCentsByCampaign` (type="purchased") for the DATA — the existing trueROAS is fed by BOOKED (expected) value, which does NOT prove payment; the safety problem is specifically "leads never PAY", so the gate must read PAID value. It has a real producer (verified payments), reuses the established ConversionRecord filters, NO schema change.
- REUSE the floor concept but express it as the MINIMAL honest v1: a `scale` rec requires finite, positive, campaign-attributed PAID value (paidValueCents > 0, Number.isFinite). A trueROAS MAGNITUDE threshold (>= X) is the documented future tightening (graduation), NOT hardcoded (a magic number would brick or be meaningless).

GATE PLACEMENT (a): in decideForCampaign (recommendation-engine/campaign-decision), at the scale-rec flow — the EARLIEST point in the scale->reallocate transition (strictly before buildRileyBudgetCandidate, so the scale rec never even becomes a money-move candidate). This is the ONLY placement the REQUIRED eval can verify (the eval drives decideForCampaign, not the dispatch). buildRileyBudgetCandidate stays a structural backstop (scale recs provably originate ONLY in generateRecommendations, so the single gate covers all). Mirrors the measurement_untrusted demotion exactly.

FAIL-CLOSED BEHAVIOR (b) — DESIGN 1 (always fail-closed, FORCED by the hard constraint "reject anything that auto-scales on count alone or fabricates a pass on missing data"):

- When the paid-value gate is ACTIVE and the campaign lacks finite positive paid value (absent/NaN/zero) => DEMOTE the scale rec to a `scale_unproven_paid_value` watch. Never auto-scale; never fabricate a pass.
- "Abstain-to-human, not hard-block" is satisfied by the demotion being a VISIBLE, RECOVERABLE watch (surfaces the situation + reason; graduates to a scale money-move per-campaign the moment paid value populates), NOT silent suppression.
- "Without bricking fleet-wide" is satisfied because: (i) the reallocation money-move is flag-OFF today (zero operational impact today); (ii) the demotion is a recoverable per-campaign watch, so the feature is data-gated not dead; (iii) holding a scale on an unpaid campaign is the CORRECT honest advice.
- REJECTED Design 2 (org-level/windowed "abstain when no paid signal"): it would let count-alone scaling through in the no-payment-tracking / zero-payment-week cases, which "reject anything that auto-scales on count alone" explicitly forbids. So Design 2 violates the hard constraint.

ACTIVATION / back-compat: `paidValueGate?` is an OPTIONAL input to decideForCampaign (undefined => no gate; existing eval fixtures + direct callers byte-unchanged). The live audit-runner builds + passes it ONLY when the paid-value PROVIDER is wired (mirrors the optional bookedValueByCampaignProvider idiom); prod wires the provider in THIS PR (producer-population) + the wiring is tested + the flag-flip checklist verifies it. Provider absent (legacy tests/analysis-only) => no gate (back-compat). This is the ONLY "off" path and it is a stable wiring property, not a flappy data property (no fail-open hole).

PRODUCER-POPULATION HONESTY ([[feedback_safety_gate_needs_producer_population]]): paid value populates from verified payments that carry sourceCampaignId. The gate fails CLOSED on absence (never a fabricated pass), so the swipe-gate present-but-all-false trap does NOT apply. Document the data dependency in the go-live runbook: flipping the flag requires confirming the pilot org records campaign-attributed verified payments (else every scale surfaces as a `scale_unproven_paid_value` watch — the intended fail-closed default). A db test drives the new query against a realistic type="purchased" row (the real producer's shape).

## Plan steps (full detail in .claude/agents-fix-A12-plan.md)

| step                                                   | done-condition (test/cmd)                                                                       | status  | evidence |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------- | -------- |
| A pure floor + watch (recommendation-watches.ts)       | vitest recommendation-watches.test.ts green                                                     | pending |          |
| B decideForCampaign gate (campaign-decision.ts)        | vitest campaign-decision.test.ts: scale->watch on null/0/NaN, scale flows on >0, scale w/o gate | pending |          |
| C eval fixtures + harness thread (schema/decide/jsonl) | pnpm eval:riley green (RED first: decide.ts ignores field)                                      | pending |          |
| D paid-value store query (db, type=purchased)          | vitest prisma-conversion-record-store.test.ts green                                             | pending |          |
| E port + audit-runner thread                           | audit-runner test: provider present->scale demotes; absent->scale flows                         | pending |          |
| F apps/api wire paidValueByCampaignProvider            | --filter api test + tsc green                                                                   | pending |          |
| G go-live runbook paid-value precondition              | doc reads clean, no em-dash, format:check                                                       | pending |          |

baseline_sha: d5dcbaa5e -> REBASED onto origin/main @ 7d14402bc (S8a #1247 + #1249 + A8 #1248; NO file overlap; clean rebase; Prisma client regenerated for S8a schema)
gate_results: typecheck=PASS test=PASS(_) lint=PASS format=PASS arch=PASS(eslint-disable on inngest-functions.ts orchestrator @cap, legacy-debt warn) verify-fast=PASS security=PASS(code-indep) build=PASS eval=PASS(+5 fixtures, "all match") check-routes=PASS(READ) review(plan-grade)=PASS(3/3 opus,0 blocker) review(VERIFY)=SHIP(0>=warn, all 6 acceptance CONFIRMED, 2 pre-existing nits)
(_) test: full monorepo green via gate-runner; chat attribution timeout = documented load flake (cleared on isolated rerun); db Postgres-INTEGRATION tests (work-trace/ledger/greeting `$queryRaw` 'void' deserialize) fail LOCALLY ONLY = stale shared DB missing S8a's just-merged migration + documented pg flake [[feedback_db_integrity_tests_pg_advisory_lock]]; NOT my files (my conversion-record mocked test 30/30, db tsc clean); CI db job uses MOCKED Prisma (no Postgres) so will not block. Verify via actual `gh pr checks`.

carry_forward (<=150 words): ORIENT + FRAME complete, design settled (Design 1 fail-closed, paid-value query type="purchased", gate in decideForCampaign demote scale->watch, provider-presence activation). Next: write plan -> FAN-OUT grade (3 opus) -> TDD execute -> independent VERIFY review -> SURFACE PR. Key risks the grade must check: fail-closed on absent/NaN/zero paid value; trueROAS/paid-value reaches the REAL decideForCampaign seam (producer->consumer); eval not a self-signing oracle; producer-population honest; no fleet-wide brick.

## Log

- 2026-06-22: SURFACED PR #1250 (rebased onto 7d14402bc, 8 commits + Co-Authored-By trailers). CI = ALL 15 GREEN (gh pr checks: typecheck/lint/test[11m29s, db green in CI]/architecture/security/eval-riley[required]/CodeQL/docker/secrets/setup/4 other evals). Independent VERIFY review = SHIP 0>=warn. The local db Postgres-integration failures were CONFIRMED stale-shared-DB (CI test job green). TERMINAL STATE = awaiting human merge (money-adjacent stop). Loop COMPLETE through SURFACE.
- 2026-06-22: ORIENT complete (every cite re-verified vs main @ d5dcbaa5e; gap real; queryPaidValueCentsByCampaign absent; type="purchased" producer found). FRAME settled (Design 1). -> PLAN.
- 2026-06-22: PLAN written (.claude/agents-fix-A12-plan.md, 7 TDD tasks). FAN-OUT grade = 3 opus (CRITIC/COMPLETENESS/CODE-GROUNDED) ALL PASS, 0 blocker. CODE-GROUNDED verified every sketch compiles+triggers (scale fixture fires; demotion point correct; store query mirrors booked; audit-runner thread type-valid; eval RED real). Bounded cap-1 REVISE folded: (1) Task C name BOTH decide.ts edit sites (Pick :97-110 + spread :195, co-required; flagged by 2 reviewers) + Zod-strip note; (2) Task E build the scale scenario explicitly (no existing audit-runner test produces scale via run()); (3) Task F structural-satisfaction fallback (registerInngest untested); (4) Task B comment cites single-origin backstops + measurement_untrusted precedence; (5) Task G origin=live default note. Single-origin claim CONFIRMED (scale only from recommendation-engine.ts:350; post-gate appends never scale). -> EXECUTE.
