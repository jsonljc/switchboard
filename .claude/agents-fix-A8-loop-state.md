# A8 — Alex booking-tool correctness loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap + moc_alex_cockpit.

Goal: Fix the wrong-target reschedule/cancel defect (service-mismatch falls back to soonest of ALL bookings).
Authority: autonomous-with-guardrails BUT booking/cancel = merge-stop -> SURFACE-before-merge.
Task-size: standard (one bounded PR).
Base: origin/main @ d5dcbaa5e (rebased onto it mid-slice; was ea7a30cdd) baseline_sha: ea7a30cdd -> d5dcbaa5e
merge_safety: stop touched = appointment-cancel behavior change (JUDGMENT stop) -> SURFACED PR #1248, human merge call. independent_review = PASS (0 findings >= warn; trim nit fixed + tested).

## OUTCOME: MERGED. PR #1248 squash-merged to main as 665cc1cd7 (2026-06-22, user-authorized merge). CI 15/15 green. Remote branch auto-deleted; worktree removed + pruned; local branch deleted. 3 source commits collapsed: guard + trim + whitespace edge test.

## REVIEWS: (1) VERIFY independent fresh-context = 0 >= warn (trim nit fixed). (2) requesting-code-review senior (opus, user-requested arch+correctness) = READY TO MERGE YES, 0 Critical/0 Important; swept repo -> NO other wrong-target booking-selection site exists (reminders iterate all; failure-handler/deposit resolve by explicit bookingId); confirmed result reaches LLM via reinjection-filter PRESERVED_FIELDS; declined cosmetic availableServices case-dedupe (implausible w/ playbook services, both reviewers no-change).

## Ground-truth brief (ORIENT, each claim tool/file-backed)

- DEFECT (rank 17): `calendar-reschedule.ts` resolveTarget returned `(narrowed.length>0?narrowed:bookings)[0]` -> service-supplied-but-no-match fell back to soonest of ALL bookings. Shared by booking.reschedule + booking.cancel. NO_UPCOMING_BOOKING only fired on ZERO bookings.
- `fail(code,...)` code is a FREE STRING (tool-result.ts:45); NO code consumes booking error codes (grep empty) -> new NO_MATCHING_BOOKING breaks no seam.
- Guard is pre-mutation -> cannot weaken invariant; governance/idempotent/WorkTrace/PlatformIngress untouched.

## Scope decision (LOCKED)

- THIS PR = rank 17 wrong-target guard ONLY. Behavior on mismatch = new NO_MATCHING_BOOKING fail (held services in data.availableServices; mirrors NO_UPCOMING_BOOKING; NOT human-escalation). + trim/lowercase match (reviewer nit, mirrors booking-value.ts normalize).
- rank 20 (CAPI occurredAt=future slotStart, calendar-book.ts:460; seam meta-capi-dispatcher.ts:116; slotStart already in metadata) = SEPARATE PR (different file/concern; one-liner, ready).
- rank 18 (stalled pending_confirmation blocks slot; failure-handler throw leaves pending + no metric + no reaper; overlap predicate prisma-booking-store.ts:59 notIn[failed,cancelled]) = SEPARATE slice A8b (needs reaper/cron or db overlap-TTL).

| step               | done-condition (test/cmd)                               | RED proof | status | evidence                                                           |
| ------------------ | ------------------------------------------------------- | --------- | ------ | ------------------------------------------------------------------ |
| 1 RED wrong-target | two-service-mismatch cancel asserts NO_MATCHING_BOOKING | seen      | done   | "expected 'success' to be 'error'" calendar-reschedule.test.ts:227 |
| 2 GREEN guard      | discriminated resolveTarget + 2 call sites              | n/a       | done   | core test 13 pass; commit bece996c7                                |
| 3 broaden          | reschedule mismatch + positive regressions              | n/a       | done   | core test 17 pass                                                  |
| 4 RED trim         | " Botox " matches "botox"                               | seen      | done   | "expected 'error' to be 'success'"                                 |
| 5 GREEN trim       | trim+lowercase both sides                               | n/a       | done   | core test 18 pass; commit 8f38dca1c                                |

gate_results: typecheck=PASS(22/22) test=PASS(core 441,2skip; full suite green w/ 1 known chat-attrib flake reran) lint=PASS(0err) format=PASS arch=PASS(0err-level) verify-fast=PASS build=PASS eval=N/A(mock-tools + key-gated; blind to real tool; CI runs it green anyway) review=PASS(0>=warn)
carry_forward (<=150 words): A8 rank-17 SURFACED as PR #1248 (rebased onto d5dcbaa5e). Human merge call (appointment-cancel behavior change). REMAINING A8 work for future fresh sessions: A8b = rank 18 stalled-pending reaper (bigger, cron/TTL); rank 20 = CAPI occurredAt one-liner (calendar-book.ts:460 -> commit-time now, keep slotStart in metadata; verify meta-capi-dispatcher future-time rejection). LESSON: alex-conversation eval uses mock-tools.ts (its own canned booking.reschedule/cancel) + self-skips w/o ANTHROPIC_API_KEY -> it is BLIND to real booking-tool changes; "eval if booking tools touched" buys regression-cover ONLY for conversation, not tool logic. Worktree .claude/worktrees/agents-fix-a8 -> remove after #1248 merges.

## Log

- 2026-06-22: ORIENT (collision clean) -> FRAME (scope=rank17 only; NO_MATCHING_BOOKING) -> PLAN (.claude scratch) -> EXECUTE (TDD RED->GREEN x2) -> VERIFY (all gates green; independent review 0>=warn, trim nit fixed) -> rebased onto d5dcbaa5e (A6 #1246 merged mid-slice) -> SURFACED PR #1248. DONE (human merge).
