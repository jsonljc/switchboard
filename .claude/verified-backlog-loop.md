# Verified-backlog autonomous build-loop (driver prompt)

Drive the build-loop (`.claude/build-loop.md`) over the VERIFIED-OPEN backlog below, ONE PR-sized
slice at a time, fully autonomously (NO check-ins), using the superpowers chain. Stay strictly within
this list — when every item is merged-or-surfaced (or verified already-done/taken/blocked), STOP and
report. Do NOT invent new work; if the list is exhausted, say "all done" and stop the loop.

All gaps were freshness-verified against origin/main on 2026-06-26 — but RE-VERIFY each at ORIENT
(concurrent sessions merge fast; a gap may already be closed or taken).

## Slices (priority order; each is its own fresh worktree off origin/main under .claude/worktrees/)

1. **#9b — `/undo` approver-role floor.** `apps/api/src/routes/action-lifecycle.ts`: the
   `POST /:id/undo` handler (~lines 73-120) has only `assertOrgAccess`; the `/execute` handler
   (~line 33) requires `requireRole(...APPROVER_ROLES)`. Add the same approver floor to `/undo`
   (undo reverses an approved action — same privilege), with a test proving a non-approver is 403.
   `[stop-zone: authz]`
2. **A — `deriveConsentStatus` revoked-first root fix.** `packages/schemas/src/pdpa-consent.ts:62`
   short-circuits `if (!c.pdpaJurisdiction) return "not_applicable"` BEFORE checking
   `consentRevokedAt`, so a revoked-but-unstamped contact masks as not_applicable. Move the
   `consentRevokedAt` check first (revocation wins regardless of stamp). This closes the same-class
   gap in `calendar-book-consent.ts` `enforceConsentPrecondition`. Grep + cover EVERY consumer
   (operational gate, booking precondition, proactive eligibility, admin status). `[stop-zone: consent]`
3. **EV-1 — booking-join real-PG regression eval.** Add a `DATABASE_URL`-gated suite to
   `vitest.integration.config.ts` (SPINE-1, listed there as a future suite) guarding the #1269
   WorkTrace/Booking join: seed a `WorkTrace` (distinct id/workUnitId/traceId) + a `Booking`
   (`workTraceId = workUnitId`), assert the receipted-booking view surfaces non-null
   traceId/matchedPolicies/approvalId. Test-only, no behavior change. `[clean]`
4. **#5 — Redis conversion-bus drainer.** `packages/core/src/events/redis-stream-conversion-bus.ts`
   has `ensureConsumerGroup`/`readGroup`/`ack` with ZERO callers → with `REDIS_URL` set, conversions
   - CAPI go dark. Add a drain-loop consumer in `apps/api/src/bootstrap/conversion-bus-bootstrap.ts`
     (ensureConsumerGroup at start + readGroup→dispatch the registered record+CAPI handlers→ack,
     managed by `start()`/`stop()`); unit-test with the existing mock-redis. `[stop-zone: conversion/CAPI delivery]`
5. **EV-4 (Alex leg ONLY) — claim-boundary eval.** Extend `evals/alex-conversation` with claim-bait
   scenarios in two modes (classifier OFF = prompt must refuse/hedge/escalate; classifier ENFORCE =
   gate rewrites/escalates), driven by the `claimType` enum in
   `packages/schemas/src/claim-classifier.ts`. SKIP the Mira leg (blocked on EV-6, not started). `[clean]`

DEFER **#9a (approvalPolicy)** — the field is decorative-by-design (engine never reads it; real
enforcement = seeded `policyApprovalOverride`). It needs a wire-vs-delete product decision. Do NOT build it.

## Process per slice

- **ORIENT:** re-fetch origin/main; re-check `gh pr list` + `git worktree list` — if a slice is already
  merged or in-flight in another worktree, SKIP it (note why), never touch others' worktrees. Confirm
  the gap is still real vs origin/main with grep/read.
- **Brainstorm only if needed (judgment):** invoke `superpowers:brainstorming` ONLY for genuine design
  ambiguity (likely #5 drain-loop lifecycle, possibly A's consumer blast-radius). SKIP it for mechanical
  / single-call fixes (#9b, EV-1, EV-4).
- **Plan → Execute → Review:** `superpowers:writing-plans` (ephemeral, TDD-shaped) →
  `superpowers:test-driven-development` (RED→GREEN per step, fresh worktree) → VERIFY (delegate the full
  gate battery to a subagent: typecheck/test/lint/format/arch/`local-verify-fast`/`audit --audit-level=high`;
  build touched app pkgs) → `superpowers:requesting-code-review` (fresh-context independent review; triage
  with `superpowers:receiving-code-review`; fix every >=warn finding, re-review).
- **Merge policy (best judgment, no check-in):** AUTO squash-merge a slice ONLY when it is NOT stop-zone
  AND `gh pr checks` is fully green AND the independent review returns zero >=warn AND confidence is high
  (EV-1, EV-4 qualify). For stop-zone slices (#9b authz, A consent, #5 conversion-delivery): SURFACE —
  open the PR with the evidence summary, leave the merge for the human — and CONTINUE to the next slice
  (surfacing is non-blocking; never pause to ask). Clean up merged worktrees; gh-merge from worktree
  tolerates the local-branch-delete error (remote merge still lands); never `--force`.
- **After each merge:** update the relevant memory note + write any durable lesson
  (`feedback_*.md` + a `MEMORY.md` pointer).

## Quality bar (do not trade away for speed)

RED-before-GREEN is a hard done-condition (a step whose test was never seen red is not done). The
independent review is not self-gradable. Gate on real `gh pr checks` conclusions (`skipping` ≠ pass).
Honor the build-loop gotchas: rebuild a lower pkg's `dist` after editing it; typecheck the CONSUMER pkg;
new env var → env-allowlist, new mutating route → route-allowlist (prove with `local-verify-fast`);
Read/Edit via the WORKTREE path. No em-dashes; lowercase commit subjects.

## Termination + report

When every listed slice is resolved, STOP and report a per-slice line:
`{merged #PR | surfaced #PR (awaiting human merge, stop-zone) | already-done | skipped-taken | blocked+why}`.
Do NOT pick up anything outside this list.
