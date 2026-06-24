# riley-diagnosis-surfacing loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_riley_capability_audit_2026_06_10.

Goal: surface the deterministic audit engine's computed-then-discarded diagnoses
(competition_increase / audience_offer_mismatch / account_level_issue) as operator-visible
watch(es), mirroring breach_building (#998). ONE PR-sized slice, highest-leverage-first.
Authority: AUTONOMOUS-WITH-GUARDRAILS (squash-merge only if ALL gates green + fresh-context
independent review zero findings >=warn + no merge-stop glob touched + pre-merge divergence clean).
Task-size: standard (one bounded PR; touches decision engine + eval).
Base: origin/main @ ebd58b252 (re-fetch each slice). baseline_sha: <set at PLAN>
merge_safety: stop-glob touched=NO (metric-diagnostician/recommendation-engine/campaign-decision/
audit-runner match no stop glob). independent_review=<pending>

## GROUND TRUTH BRIEF (ORIENT — verified 2026-06-18 against origin/main @ ebd58b252)

- Producer metric-diagnostician.ts: competition_increase (:54, cpm↑sig + ctr stable), audience_offer_mismatch
  (:111, ctr↑/stable + cpa↑sig), account_level_issue (:157, ≥3 metrics degrading sig). All use cpm/ctr/cpa,
  present in the 7-key MetricSet → all REACHABLE on the deterministic seam (insightToMetrics+comparePeriods).
  Proof: #1135 tripwire comment notes its fixture "surfaces as audience_offer_mismatch".
- Consumer gap: recommendation-engine.ts hasDiagnosis branches only on creative_fatigue/audience_saturation/
  ctwa_drive_by_clickers/landing_page_drop. The three above reach no rec/watch/insight. (One existing side
  effect: any diagnosis suppresses the `scale` rec via diagnoses.length===0 at :361.)
- Surface path is GENERIC: WatchOutput from generateRecommendations → campaign-decision.ts:213
  (if item.type==="watch") → audit-runner.ts:662 (watches.push(...decision.watches)) → AuditReport. No schema
  migration (WatchOutputSchema.pattern = z.string(), schemas/ad-optimizer.ts:216). No downstream pattern
  allowlist (breach_building appears only in its producer in non-test source; no switch over watch.pattern).
- Eval: evals/riley-recommendation. fixtures/\*.jsonl with expectedWatchPatterns (schema.ts:46);
  run-eval.ts asserts membership; drift-guard.test.ts:72 pins each known pattern; README coverage table ~:149.
  Counts 24 main + 10 source-reallocation + 6 arbitration. `pnpm eval:riley` = tsx evals/riley-recommendation/run-eval.ts.
- Agent skill skills/ad-optimizer.md:117 lists these patterns but is a SEPARATE agent-interactive surface
  (ads-analytics.diagnose tool), NOT the deterministic weekly AuditReport → not redundant.
- Pattern to mirror EXACTLY: breach_building (#998 = commit 849a81ecf). Files: recommendation-engine.ts (rule
  comment + watch fn + invoke + append), recommendation-engine.test.ts (co-located cases), new fixture
  evals/riley-recommendation/fixtures/<name>.jsonl, drift-guard.test.ts (+1 assertion after :72), README
  coverage row (~:149). NaN-guard every external numeric (#939).

## Concurrent-session check (ORIENT)

git worktree list + gh pr list @ 2026-06-18: NO open PR / worktree touches metric-diagnostician.ts /
recommendation-engine.ts / campaign-decision.ts / audit-runner.ts. Open PRs are WhatsApp/CTWA/consent/PDPA/
dashboard/deps. Clear to proceed; re-check at CONVERGE.

| step          | done-condition (test/cmd) | RED proof | status | evidence (cmd->result / file:line) |
| ------------- | ------------------------- | --------- | ------ | ---------------------------------- |
| (set at PLAN) |                           |           |        |                                    |

## FRAME conclusion (2026-06-18) — design locked

SHIP exactly ONE watch: pattern `audience_offer_mismatch`, mirroring breach_building (#998).

- INCLUDE audience_offer_mismatch: high-confidence, actionable ("strong clicks, low conversions"); a clean
  rising-CTR+rising-cost-sub-breach region where it is the ONLY possible signal and today emits nothing.
- EXCLUDE competition_increase: informational only (operator can't control auction/seasonality), CPM noisy → noise.
- EXCLUDE account_level_issue: low-confidence + cpl===cpa double-counts on the deterministic seam → "all metrics
  degrading" is misleading copy; fixing the count = changing a fired diagnosis w/ its own agent consumer (out of scope).
- SHAPE = non-rec WatchOutput (NOT a hold rec [gated-pipeline blast radius + double-hold w/ landing_page_drop];
  NOT an insight [that's the positive stable_performance category]).
- FIRING RULE (noise-safety crux): emit ONLY when it would otherwise be PURE SILENCE — diagnosis present AND
  results empty (withBurn empty) AND breachBuilding null. Auto-suppresses every overlap (add_creative/pause/
  review_budget/landing_page_drop-hold all land in results; burn/breach checked directly). Keys off BOOLEANS only
  (hasDiagnosis + array-emptiness) → zero new NaN-blind numeric comparison; numeric robustness stays in diagnostician.
- For excluded two: #1135-style marker comments documenting the deliberate decision; NO behavior change.
- Non-redundant w/ agent skill (skills/ad-optimizer.md:117 = on-demand ads-analytics.diagnose tool; this = automatic
  weekly deterministic AuditReport → owner digest #1153). No schema migration. No governance/money path.
- Doctrine OK: change in packages/ad-optimizer (L2) + evals + co-located tests; no new cross-layer dep, no UI ref,
  no mutating path. Merge-stop globs: none touched → AUTONOMOUS-WITH-GUARDRAILS available if review clean.

gate_results: typecheck=· test=· lint=· format=· arch=· verify-fast=· security=· build=· eval=· review=·
carry_forward (<=150 words): FRAME done, design locked (one watch: audience_offer_mismatch, pure-silence gating).
Next: PLAN (TDD-shaped) -> EXECUTE. Mirror breach_building diff shape exactly. Verify period-comparator.ts
significance thresholds when building the eval fixture (crib numbers from #1135's audience_offer_mismatch unit test).

## Log

- 2026-06-18: ORIENT complete. Ground truth verified against origin/main @ ebd58b252. Concurrent-session clear.
  Corrected a subagent error: the three diagnoses ARE reachable on the deterministic seam (they fire; nothing
  consumes them) — distinct from lead*quality*\* (#1135) which truly cannot fire. -> FRAME.
- 2026-06-18: SHIPPED. PR #1164 squash-MERGED to main (commit 3754398fe). audience_offer_mismatch surfaced as a
  pure-silence-gated informational watch (audienceOfferMismatchIfSilent + audienceOfferMismatchWatch in new
  recommendation-watches.ts; insufficientEvidenceWatch moved there to stay under the 600-line arch limit).
  competition_increase + account_level_issue documented as deliberately advisory-only (marker comments + guard
  tests). Eval fixture + drift-guard + README row added. ALL CI checks green (typecheck/lint/test/security/arch/
  Eval-Riley + CodeQL). Independent fresh-context review: SHIP, 0 findings >=warn. Worktree removed, branch deleted,
  local main ff-synced. DONE.
- 2026-06-18: MAIN SLICE COMPLETE. Memory note project_riley_capability_audit_2026_06_10 updated. Proceeding with
  the sanctioned optional chore PR for the 2 doc nits: chore/riley-audit-nit-docs, PR #1165 OPEN (doc/comment/string
  only, no behavior change): (a) bookedValueResolution help-text = catalog-alignment narrower than end-to-end value
  (core interface + api/chat prom help); (b) fixed stale `=== "true"` ResolveHandoffBriefDeps.readFlag doc -> actual
  `!== "false"` default-ON + inversion-vs-other-flags note at the inngest read site (value NOT flipped). Local gates
  GREEN (typecheck/lint/format/arch/verify-fast; no eval/no test coupling). CI poll bv5xifmdw running. NEXT: when
  #1165 CI green, squash-merge, ff-sync main, remove .claude/worktrees/riley-audit-nits + prune + delete branch,
  then STOP and report ALL DONE. No further slices (Mira->Riley D6-4 / Riley->Alex D6-5 / Spec-1B 1B-1.2+ are
  gated/deferred, NOT autonomous).
- 2026-06-18: ALL DONE. Chore PR #1165 MERGED (squash de3b89ed6), all CI green (incl test 10m30s + architecture).
  Chore worktree removed + branch deleted; local+origin main @ de3b89ed6. Memory note updated (nits RESOLVED).
  LOOP COMPLETE: main slice #1164 (audience_offer_mismatch watch) + chore #1165 (2 doc nits) both shipped. STOP.
