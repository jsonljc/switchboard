# riley lead_quality watch loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_riley_capability_audit_2026_06_10.

Goal (ORIGINAL): route lead*quality*\* diagnoses to an operator-visible WatchOutput (mirror breach_building) + eval fixture.
Goal (REDEFINED at ORIENT — premise false): the signal CANNOT fire through the live audit seam. Honest fix = document the
reachability gap on the two rules + pin it with a characterization/tripwire test. NO watch (would be inert/illusory).
Authority: autonomous through SURFACE; do NOT auto-merge (slice goal changed = stop condition). Task-size: standard (doc+test).
Base: origin/main @ 710e6d958 (re-fetched). baseline_sha: <set at worktree>
merge_safety: stop-glob touched=NO (metric-diagnostician.ts + its test + a campaign-decision.ts comment; no auth/billing/consent/governance/prisma).
Slice goal CHANGED -> SURFACE-before-merge (do not self-merge). independent_review=<pending>

## Ground truth (all tool/file-backed, verified at ORIENT 2026-06-17)

- diagnose() has 2 callers: campaign-decision.ts:144 (live audit seam) + apps/api ads-analytics.ts:39 (LLM read tool; returns
  diagnoses to the model, never routes to recs/watches/report).
- Live seam metrics: insightToMetrics (campaign-decision.ts:24) AND aggregateMetrics (audit-runner.ts:259) BOTH set
  cpl = cpa = safeDivide(spend, conversions) (IDENTICAL) and emit NO costPerBooked. comparePeriods (period-comparator.ts)
  maps a fixed 7-key MetricSet {cpm,inlineLinkClickCtr,costPerInlineLinkClick,cpl,cpa,roas,frequency} — no costPerBooked/chatsStarted/replyRate.
- lead_quality_issue (metric-diagnostician.ts:78): needs cpaUpSignificant && cplNOTSignificant. cpa≡cpl in the seam => if cpa is
  up-significant, cpl is too => cplNotSignificant is always false => NEVER fires via the seam. Iron-clad.
- lead_quality_degradation (:115): needs map.get("costPerBooked"); seam never emits it => `if(!cpl||!cpb) return false` => NEVER fires.
- ctwa*drive_by_clickers (:128) is the same class (needs chatsStarted/replyRate) but DOES have a consumer branch (rec engine:428);
  lead_quality*\* has NEITHER a producer-feed NOR a consumer. Out of scope to touch ctwa.
- Positive controls already exist: metric-diagnostician.test.ts:89/157 fire the rules only via hand-built DIVERGENT deltas
  (cpa 30/20 sig + cpl 5.5/5 NOT-sig; injected costPerBooked) — inputs the live pipeline cannot produce.
- breach_building precedent (PR #998, 849a81ecf): WatchOutput in recommendation-engine.ts appended outside the rec-only floor;
  WatchOutputSchema.pattern = z.string() (schemas/ad-optimizer.ts:216) so NO migration. Eval fixture drives it via deltas+targetBreach
  (NOT diagnoses) — which is exactly why a lead_quality eval fixture is impossible (the eval can't synthesize the diagnosis).

## Decision (FRAME): reject the watch; honest fix = document + pin

- (A) watch driven by hasDiagnosis(lead*quality*\*): REJECT — inert consumer (producer never fires), monitoring illusion,
  eval impossible (self-signing unit test only), violates feedback_safety_gate_needs_producer_population.
- (B) enrich insightToMetrics/MetricSet (diverge cpl/cpa, add costPerBooked): REJECT — that's the deferred booking-cost / Ledger
  pipeline; out of scope, broad engine behavior change.
- (C) pure surface, no code: viable but leaves the silent dead-rule trap; user pre-authorized "smallest correct thing".
- (D) CHOSEN: precise doc comments on the two rules + a note at the diagnose seam; a co-located characterization/tripwire test
  pinning (i) insightToMetrics collapses cpa≡cpl, (ii) comparePeriods emits no costPerBooked, (iii) end-to-end real-seam deltas
  never yield lead*quality*\*. Tripwire flips RED the day the pipeline gains booking-cost metrics -> wire the consumer THEN.
  Keep thresholds UNCHANGED (prompt constraint). No behavior change.

| step | done-condition (test/cmd)                                                                                                  | RED proof                                                                         | status | evidence |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ | -------- |
| 1    | worktree off fresh origin/main + deps/build resolve                                                                        | n/a                                                                               | todo   |          |
| 2    | characterization test: cpa≡cpl via insightToMetrics; no costPerBooked in comparePeriods; lead*quality*\* absent end-to-end | n/a (characterizes existing behavior; no RED — deliberately zero behavior change) | todo   |          |
| 3    | doc comments on lead_quality_issue + lead_quality_degradation + diagnose seam note                                         | n/a                                                                               | todo   |          |
| 4    | gates green: typecheck, --filter ad-optimizer test, lint, format, arch, verify-fast, eval:riley (no regression)            | n/a                                                                               | todo   |          |
| 5    | fresh-context independent review = zero >=warn                                                                             | n/a                                                                               | todo   |          |
| 6    | open PR, SURFACE (no auto-merge), report, update memory note                                                               | n/a                                                                               | todo   |          |

gate_results: typecheck=PASS test=773pass(+3 new tripwire) lint=PASS format=PASS arch=PASS verify-fast=PASS security=n/a(no dep change) build=n/a(no app pkg) eval=PASS(unregressed 24+10+6) review=0>=warn(2 warns raised+resolved, 1 nit declined)
carry_forward: DONE + MERGED #1135 (squash 23ebe03c4) 2026-06-18 after user authorization + a 3rd architecture/works-as-intended review (Ready-to-merge:YES). Worktree removed, branch deleted, main fast-forwarded, memory note flipped to MERGED.
Premise false: signal unreachable on the deterministic seam, not discarded. Honest fix = doc+tripwire, not a watch. REAL lever =
booking-cost metric pipeline (deferred Ledger/booked-value), NOT autonomous. Two cheap nits (bookedValueResolution help-text;
MIRA_HANDOFF_BRIEF_ENRICHMENT_ENABLED inverted-default doc) NOT folded (primary unmerged) — available as a separate chore PR.
Worktree .claude/worktrees/riley-lead-quality retained pending the merge decision; teardown when #1135 merges or closes.

## Log

- 2026-06-17: ORIENT done. Premise falsified with file:line proof. Slice redefined watch -> document+pin. FRAME chose (D).
- 2026-06-17: EXECUTE — worktree off 710e6d958; db:generate fixed the stale-Prisma-client chat typecheck noise; 3 doc comments + 3 tripwire tests; 17/17 diagnostician + 773/773 package green.
- 2026-06-17: VERIFY — all 6 gates green (verifier subagent) + eval:riley unregressed. Fresh-context review raised 2 warns (comment overstated "only routing caller"; lead_quality_issue IS reachable via the ads-analytics agent tool). Triaged as valid, revised all 4 comment blocks for per-path/per-rule precision; re-review = both resolved, 0>=warn.
- 2026-06-17: CONVERGE — committed d59c322a1, pre-push divergence re-check clean (origin/main still 710e6d958), pushed + opened PR #1135 SURFACE-only. Memory note updated. Loop STOPPED (actionable gap closed; bigger levers out of bounds).
- 2026-06-18: MERGED #1135 (squash 23ebe03c4) — required CI all green (lint/security/test/typecheck), mergeState CLEAN, squash-merge. Cleanup: worktree removed+pruned, local+remote branch deleted, main checkout fast-forwarded 78b9647ac->23ebe03c4, memory note flipped SURFACED->MERGED. Session hygiene complete; slice closed.
- 2026-06-18: user-invoked 3rd review (architecture + works-as-intended). origin/main advanced 12 unrelated commits (#1137-#1155, NONE touch my 5 files; merge-base still 710e6d958, no rebase needed for review). Verdict = READY TO MERGE: YES, 0 critical/0 important; reviewer empirically proved the tripwire flips red on cpl/cpa divergence + is non-vacuous. Applied Minor-1 (one clause: a cpa spike with stable CTR surfaces as audience*offer_mismatch, not silence — only lead_quality*\* abstain); declined Minor-2 (comment density, awareness-only). Amended cd45bc5f9, 17/17 + format green, force-pushed (with-lease; no --auto). PR #1135 remains SURFACE-only pending the merge/direction call.
