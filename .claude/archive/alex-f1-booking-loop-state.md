# alex F1 booking-autoexecute loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_alex_capability_audit_2026_06_10.md (F1).

Goal: a default real-org Alex auto-executes booking at `guided` trust (supervised still gates) + honest pending_approval SKILL.md text (no false "queued" promise).
Authority: SURFACE-before-merge (governance/approval change -> human merge call, pre-decided).
Task-size: standard.

Base: origin/main @ 30557c49 baseline_sha: 30557c49 (worktree branched off this)
Worktree: /Users/jasonli/switchboard/.claude/worktrees/alex-f1-booking Branch: fix/alex-f1-booking-autoexecute
merge_safety: stop-glob touched = YES (governance/approval semantics change; pre-decided SURFACE). independent_review = CLEAN (2 em-dash nits found + fixed).

## Decision record

- REBASE vs REIMPLEMENT: re-implemented F1 fresh (replayed proven commit d8a66810 with TDD RED-first). NOT rebased #961 (CONFLICTING, ~70 behind, bundles out-of-scope F2). F2 disjoint files, left out.
- SKILL.md pending_approval text: did NOT instruct escalate (diverges from d8a66810's draft). REASON: blocking offline test evals/.../booking-fixtures-bite.test.ts + golden fixture book-sg-governed-close-pending encode the project's contract = on governed-close-pending Alex must DRIVE calendar-book and NOT escalate (escalate = the documented PRE-FIX wrong behavior). d8a66810's escalate instruction would trip the live eval (forbidden-tool-called:escalate). My text removes the false "already queued" lie, says team will confirm shortly, no escalate. SURFACE this fork for the merge decision.

## Plan steps

| step | done-condition                                                        | RED proof | status | evidence                                                                                         |
| ---- | --------------------------------------------------------------------- | --------- | ------ | ------------------------------------------------------------------------------------------------ |
| 1    | calendar-book.test guided=>auto-approve, supervised=>require-approval | YES       | DONE   | RED: expected 'require-approval' to be 'auto-approve' @ calendar-book.test.ts:150 -> GREEN 61/61 |
| 2    | calendar-reschedule.test reschedule+cancel guided/supervised          | YES       | DONE   | RED @ calendar-reschedule.test.ts:36,44 -> GREEN                                                 |
| 3    | governanceOverride {guided:auto-approve} on 3 booking ops             | n/a       | DONE   | calendar-book.ts booking.create + calendar-reschedule.ts reschedule/cancel                       |
| 4    | SKILL.md honest pending text, no false queue, no escalate             | n/a       | DONE   | SKILL.md:240-242, +3/-3, em-dash removed                                                         |

gate_results: typecheck=PASS(21/21 after db:generate) test=PASS(core 4141; my 2 files 61/61; full-suite chat-attribution flake=known infra) lint=PASS format=PASS arch=PASS verify-fast=PASS security=(in build/audit, green) build=PASS(10/10) eval=OFFLINE-PASS(259); LIVE=BLOCKED(Anthropic key insufficient credits) review=CLEAN
carry_forward: Engineering DONE + verified. SURFACE-before-merge: commit+push+open PR with evidence, STOP before merge (governance/approval change = human call). Surface (a) live eval blocked on API credits -> must run on CI/with-credits, (b) no-escalate SKILL.md decision vs d8a66810. #961 (F1+F2) remains open; this supersedes its F1 portion.

## Post-surface code review (superpowers:requesting-code-review)

Senior reviewer (fresh-context, opus) verdict: READY TO MERGE (yes). 0 critical, 0 blocking-important.
Traced real executor: skill-executor.ts:536 hooks -> GovernanceHook getToolGovernanceDecision(op,"guided")=auto-approve -> proceed:true -> skill-executor.ts:585 op.execute() -> bookingStore.create. NO PlatformIngress gate between in-skill hook and execute -> booking persists end-to-end (the path the live eval drives). Override shape/types correct; scoped guided-only; no fail-open; tests bite; no em-dash; no loader-risk tokens.
One non-blocking framing note (acted on): live managed-chat turn ALSO crosses a pre-existing OUTER GovernanceGate (channel-gateway -> PlatformIngress.submit, intent alex.respond) that gates the TURN not the booking write; pre-existing, out of F1 scope, non-blocking for shipped pilot. Added a "Scope clarification" section to PR #1068 body.

## Log

- 2026-06-15: ORIENT complete (all claims tool-backed). Decision: re-implement fresh.
- 2026-06-15: EXECUTE done. RED proven (3 guided assertions failed), GREEN 61/61. SKILL.md reworked to no-escalate per golden-fixture contract.
- 2026-06-15: VERIFY done. Deterministic gates green; offline eval 259 pass; live eval blocked (credits); review CLEAN after fixing 2 em-dash nits. -> SURFACE.
- 2026-06-15: POST-MERGE MAIN CI VERIFIED. Run 27527974770: typecheck/test/lint/architecture/security/secrets/docker/setup + Eval-Alex-Conversation + Eval-Governance + Eval-Riley + CodeQL ALL GREEN on main. Sole red = Eval-Claim-Classifier (401 invalid x-api-key) = environmental CI Anthropic-key auth flake on an UNRELATED eval (repo-wide infra, not this change; key was valid during the PR run). Main healthy wrt this slice. ACTION FOR USER/TEAM: rotate/refund the CI ANTHROPIC_API_KEY (live-LLM evals will red repo-wide until fixed).
- 2026-06-15: MERGED. Squash df3f9166 on origin/main (PR #1068 MERGED). Worktree removed + local branch deleted + remote branch auto-pruned. Local shared `main` checkout left untouched (concurrent session active, dirty render.yaml) -> ff on their next pull. SLICE COMPLETE.
- 2026-06-15 (surface step, retained): Commit cd9145c2 -> PR #1068 (OPEN, MERGEABLE, no auto-merge). Pre-merge re-check: origin/main advanced 30557c49->e32d74c0 (ad-optimizer only, no overlap; merges clean). CI "Eval - Alex Conversation" PASSED (1m15s) + CodeQL analyze PASSED -> live eval gate now GREEN (local credit-block was local-only; CI key funded). The no-escalate SKILL.md decision validated against the live eval. STOPPED before merge per AUTHORITY (governance/approval change = human merge call). Worktree LEFT in place for the merge decision. DONE-as-surfaced.
