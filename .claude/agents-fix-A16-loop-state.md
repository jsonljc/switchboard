# A16 approver-role floor loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_second_wave_gap_eval_2026_06_22 + moc_governance.

Goal: approver-role floor on API /respond + /execute; designated-approver membership pushed into
core respondToParkedLifecycle (shared by API + chat/bridge). SURFACE (governance/authz merge-stop).
Authority: autonomous-with-guardrails THROUGH PR-open; human makes the merge call (DEFAULT SURFACE).
Task-size: standard (one bounded PR).
Base: origin/main @ a2de9564f (re-fetched) baseline_sha: a2de9564f
Worktree: .claude/worktrees/a16-approver-role-floor Branch: fix/a16-approver-role-floor
merge_safety: stop-glob touched=YES (governance/authz approval surface) -> SURFACE forced.
independent_review=pending

Pre-flight collision: A15 was claimed by a LIVE concurrent session (PID 9890, worktree
agents-fix-a15) -> user redirected me to A16. A16 clean (no worktree/branch/PR/process).
A7 #1251 disjoint (core lifecycle id-stamp + receipt + reports, not the API approval routes).

| step                           | done-condition (test/cmd)                                              | RED proof | status | evidence (cmd->result / file:line)                 |
| ------------------------------ | ---------------------------------------------------------------------- | --------- | ------ | -------------------------------------------------- |
| 1 core membership + error      | --filter core test (member/non-member/empty/null-rev)                  | pending   | todo   | respond-to-parked-lifecycle.ts                     |
| 2 chat error mapping           | --filter core test (parked-fallback non-member -> not_authorized)      | pending   | todo   | respond-to-channel-approval.ts refusalCodeForError |
| 3 api /respond floor + 403 map | --filter api test (requester->403, approver->through, membership->403) | pending   | todo   | approvals.ts + NEW approvals.test.ts               |
| 4 api /execute floor           | --filter api test (requester->403 no-exec, operator->through)          | pending   | todo   | action-lifecycle.ts                                |
| 5 verify + surface             | all gates green + independent review 0>=warn                           | pending   | todo   | -                                                  |

gate_results: typecheck=PASS test=PASS(api 2415/core 4461,0fail) lint=0err format=PASS arch=PASS
verify-fast=PASS security=PASS build=PASS eval=N/A review=SHIP-on-code(1 warn fail-open defensible;
blocker was FALSE repo-state misdiagnosis-disproven)
carry_forward: MERGED PR #1255 (squash b5499d492) 2026-06-22 — user authorized merge after 2
independent reviews concurred merge-ready; ALL CI green (CodeQL/analyze/architecture/docker/lint/
secrets/security/setup/test 11m/typecheck/5 evals); squash-merged, remote branch auto-deleted, local
main ff'd to b5499d492, worktree removed + pruned, local branch deleted. DONE. Key facts: D1 bridge gets NO requireRole (secret-authed, no principalIdFromAuth; floor
in core). Membership = approve-paths-only, AFTER self-approval, non-empty-only, fail-OPEN on probe
error. cross-tenant-isolation.test.ts + action-lifecycle.test.ts harnesses needed identity.getPrincipal
mock retrofit (new requireRole). Verifier subagent UNDER-reported (missed cross-tenant fail) -> caught
by my own full api re-run post-rebase.

## Log

- 2026-06-22: ORIENT done. A15 collision (live concurrent session) -> user redirected to A16. Ground
  truth verified, worktree up, install green. Plan written. -> FAN-OUT plan grade.
- 2026-06-22: 3-opus plan-grade (2 PASS, 1 REVISE). REVISE resolved: self-approval BEFORE membership
  (precedence); membership approve-only; harness retrofits. Plan revised (rev 1). -> EXECUTE.
- 2026-06-22: EXECUTE steps 1-4 TDD RED->GREEN (caught a worktree-drift bug at step 1 via RED:
  edited main-repo path not worktree; reverted+reapplied). Committed 62330b5b1.
- 2026-06-22: VERIFY. Verifier ALL_GREEN (under-reported). Independent review SHIP-on-code, false
  blocker disproven. origin/main advanced (A15 #1253) -> rebased onto 089318ce6 (disjoint, clean);
  caught+fixed cross-tenant-isolation harness; full re-verify green. SURFACED PR #1255. DONE.
