# Verified-backlog loop — state ledger (scratch, not committed)

Driver: .claude/verified-backlog-loop.md

| slice                               | type                        | status                                                                                                           | PR    | next action                                                                                                                                     |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| #9b /undo approver floor            | stop-zone (authz)           | DONE → SURFACED (review clean, 0 >=warn)                                                                         | #1336 | **awaiting human merge**                                                                                                                        |
| A deriveConsentStatus revoked-first | stop-zone (consent)         | DONE → SURFACED (review clean, nit fixed cbd6995ca)                                                              | #1337 | **awaiting human merge**                                                                                                                        |
| EV-1 booking-join eval              | clean (test-only)           | **AUTO-MERGED** (squash a8053b13d) ✓                                                                             | #1339 | done; worktree cleaned, main FF'd                                                                                                               |
| #5 Redis drainer                    | stop-zone (conversion/CAPI) | DONE → SURFACED (2 warns fixed a30f902dd: backoff+test, honest framing)                                          | #1342 | **awaiting human merge** (req CI running; the red "Eval — Claim Classifier" is the known non-required flaky/billing eval, not from this change) |
| EV-4 claim-boundary (Alex leg)      | clean (eval)                | grader OK; conflicts RESOLVED (merge 1fa3eb093, MERGEABLE); waiting on required typecheck/lint/test (security ✓) | #1344 | **AUTO-MERGE when the 4 required checks green** (last slice)                                                                                    |

Required checks (branch protection) = typecheck, lint, test, security ONLY. The 8 "Eval — \*" jobs are NON-REQUIRED + currently all red = known CI no-API-key (INFRA-1) state, NOT a real failure (EV-1/EV-6/others merged with same eval-red). EV-4 deterministic grader tests run in the required `test` job (70 green locally).

Progress: EV-1 MERGED ✓. SURFACED for human merge: #1336 (#9b authz), #1337 (A consent). In-flight: #5 (fixing 2 warns: hot-loop backoff + at-least-once framing/XAUTOCLAIM doc), EV-4 (review+CI).
#5 review WARNs: (1) subscribers swallow→drainer acks failed delivery (parity w/ in-memory, framing oversold; CAPI failure unmetered→TODO); (2) no backoff on readGroup-reject→hot-loop. Fix = backoff + honest framing (full at-least-once needs deferred XAUTOCLAIM).
Memory-note updates deferred to final consolidated summary.
| #9a approvalPolicy | — | DEFERRED (product call) | — | do NOT build |

Merge policy: clean+non-stop-zone+CI-green+review-zero-findings → auto-merge (EV-1, EV-4). Stop-zone → SURFACE + continue.
Worktrees under .claude/worktrees/. Other sessions' worktrees untouched. Re-verify each gap at ORIENT.

## LOOP COMPLETE (2026-06-27) — all 5 verified-backlog slices resolved; #9a deferred (product call).

- AUTO-MERGED (clean, non-stop-zone, review+required-CI green): EV-1 #1339 (squash a8053b13d), EV-4 #1344 (squash a6174412).
- SURFACED for human merge (stop-zone; 4 required checks green; eval-job reds = known non-required no-key INFRA-1): #9b #1336 (authz), A #1337 (consent root fix — closes calendar-book-consent revoked-but-unstamped hole), #5 #1342 (conversion/CAPI drainer).
- Worktrees kept for the 3 surfaced branches (remove on merge): undo-approver-floor, consent-revoked-first, redis-drainer.
- Deferred follow-ups: #9a approvalPolicy (wire-vs-delete decision); #5 XAUTOCLAIM PEL-recovery + dead-letter + CAPI-failure metric (documented in PR #1342); EV-4 NIT pinned by guard test.
- Reviews earned their keep: caught + fixed #5 hot-loop+framing, EV-4 grader recall (W1 soft-efficacy/timeline, W2 in-sentence refusal-mask), A doc-honesty nit.

## Log

- 2026-06-26: loop start. #9b ORIENT confirmed gap open (origin/main ab2168d04); implementer → PR #1336 (6 gates green, RED 400→403). Dispatched: #9b reviewer + A implementer (parallel, bg).
