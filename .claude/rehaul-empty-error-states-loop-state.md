# rehaul-empty-error-states (Pass-2 thread 4) loop — externalized state (scratch, not committed)

Durable record lives in memory note project_aesthetic_rehaul.

Goal: migrate remaining LIVE EDITORIAL-register empty/error/loading surfaces to the shared StatePanel (+ token Skeleton), replacing raw error.message / raw status / ad-hoc empty text / hand-rolled skeletons. Mechanical slice (no docs PR; direct TDD build-loop via subagent-driven-development).
Authority: AUTONOMOUS (mechanical UI; no merge-stop glob expected -> dashboard components only).
Task-size: standard (one bounded PR, 4 tasks).
Base: origin/main @ 527f8de46. Worktree: .claude/worktrees/rehaul-empty-error-states (branch design/rehaul-empty-error-states; installed+built).

StatePanel API (apps/dashboard/src/components/query-states/state-panel.tsx): {icon?, eyebrow?, title (serif, NEVER a raw status code), body?, role:"status"|"alert", label?, onRetry?, retryLabel?, children?}. Skeleton = shared token loader (query-states/skeleton.tsx, re-exported by ui/skeleton.tsx). Error-copy pattern: eyebrow "Couldn't load" + calm title (e.g. "We couldn't reach X") + body "This is usually momentary. Try again in a moment." role=alert + onRetry=refetch. Empty: role=status, calm title + body. Tests follow the **tests**/ convention per surface; extend existing test files.

SCOPE (the bounded targets; EXCLUDE: mira/cockpit night-canvas = dark register out of scope; toasts = transient/fine; agent-panel = already QueryStates-migrated; Home/Results/Reports = deferred; status-palette leaks = concurrent design/rehaul-status-color-tokens session):

- Task 1 (settings ERROR -> StatePanel role=alert + onRetry): settings/account/page.tsx (~104 inline error), components/settings/business-facts/page.tsx (~73 "Failed to load business facts" destructive text), components/settings/operational-state/operational-state-section.tsx (~72 "Failed to load operational state").
- Task 2 (settings EMPTY -> StatePanel role=status): components/settings/channel-management.tsx (~177 "No channels provisioned yet."), components/settings/whatsapp-management.tsx (~281 "No phone numbers registered.", ~350 "No message templates found." + its section error).
- Task 3 (knowledge): components/knowledge/upload-panel.tsx (~130 "Loading documents..." -> Skeleton; ~164 "No documents uploaded yet" -> StatePanel role=status), components/settings/knowledge-skeleton.tsx (hand-rolled bg-muted animate-pulse -> shared Skeleton; resolves audit B1).
- Task 4 (inbox handoff): components/inbox/handoff-detail-sheet.tsx (~84-104 unbranded "Couldn't load this handoff" panel -> StatePanel role=alert + onRetry).

Per task: fresh subagent (sonnet) + RED proof + per-task review (sonnet). Then VERIFY (typecheck, dashboard test, lint, format:check incl .tsx, arch:check, CI=1 local-verify-fast, next build, audit) + final whole-branch review (opus; user's emphasis: aligns w/ codebase + wider architecture + actually-works) + a light does-it-work (error/empty states actually trigger; onRetry actually refetches). Screenshots: interaction/data-gated (note honestly).

| task                                    | done-condition                                           | status  |
| --------------------------------------- | -------------------------------------------------------- | ------- |
| 1 settings errors                       | StatePanel renders on error + RED-proven test; typecheck | pending |
| 2 settings empties                      | StatePanel role=status + test                            | pending |
| 3 knowledge empty/loading + B1 skeleton | StatePanel/Skeleton + test                               | pending |
| 4 handoff error                         | StatePanel role=alert + onRetry + test                   | pending |

gate_results: pending

## Log

- 2026-06-21: thread 4 ORIENT done (inventory via Explore); worktree built; starting EXECUTE.
