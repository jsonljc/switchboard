# Eval-coverage RESIDUAL — autonomous build-loop (driver prompt)

Continue the eval-coverage plan (`docs/superpowers/plans/2026-06-25-eval-coverage-plan.md`) over its
REMAINING buildable slices, ONE PR-sized slice at a time, fully autonomously (NO check-ins), via the
superpowers chain: **brainstorming (only if needed) > writing-plans > test-driven-development >
requesting-code-review**. Stay within the eval-coverage workstream. Use your own judgment throughout.
When the buildable residual below is merged-or-surfaced (or verified taken/blocked), STOP and report —
and if nothing buildable remains, DECLARE THE EVAL-COVERAGE WORKSTREAM DONE. Do NOT invent work.

P1 backlog already DONE (do not redo): EV-1/2/3/3c/4/6/8/9a/9b/10/11/12/13/14/16 (merged or surfaced).

## Slices (priority = leverage × buildable-now; each its own fresh worktree off origin/main under .claude/worktrees/)

Read each slice's definition in the plan before building.

1. **EV-5 / AGENT-5 — tool-schema parity (the highest-leverage residual; the AGENT-5 half ONLY, no key).**
   Confirmed LIVE drift: `evals/alex-conversation/mock-tools.ts` `booking.create.required` includes
   `contactId`, but the REAL tool `packages/core/src/skill-runtime/tools/calendar-book.ts:144` omits it
   (`["service","slotStart","slotEnd","calendarId"]`); the real `inputSchema` is built INLINE (lines
   ~71/136), not exported. FIX: export each real tool's `inputSchema`/`required`/enums as a constant
   (behaviour-preserving extraction — the live tool keeps using it), then make the eval mock assert it
   EQUALS the real def BY IMPORT (`mock-tools.test.ts`), not against frozen literals. This makes the
   highest-coverage agent eval catch real tool-contract drift (the "mock-tool-blind" gap). Cleanly
   separates from the key-blocked INFRA-1 half. `[behaviour-preserving core export + eval; likely SURFACE (touches core) — review decides]`
   - DEFER the INFRA-1 half (restore the `ANTHROPIC_API_KEY` Actions secret + delete the live leg's
     `continue-on-error`) — that is an OPS task for the human, NOT agent-buildable. Note it; do not attempt.
2. **EV-17 — Spine async-correctness (SPINE-7..12 / BUG-6,7,11) [P2].** JSON-safe step payloads (ISO,
   no `undefined`); Leg-2 starvation (real-PG); register `sweepExpiredLifecycles` + bound its query;
   dual-lifecycle reader cannot misclassify UGC-complete-with-stale-stage; replay-to-terminal is a
   no-op; malformed stored JSON -> typed default at each `safeParse` seam. Each = a red-without test.
   `[core/spine fixes -> SURFACE]`
3. **EV-18 — Dashboard / app-state evals (APP-1,2,3) [P2].** loading/error/data + org-scoped-key tests
   for the 3 untested core fetch hooks (`use-agent-pipeline`/`use-decision-feed`/`use-mira-feed`); a
   missing-`DATABASE_URL`/`CREDENTIALS_ENCRYPTION_KEY` prod preflight + `DEV_BYPASS_AUTH`-refused-in-prod;
   broaden the `!data && !error` loading gate. `[mostly test-only; the prod preflight = prod-safety -> SURFACE that PR]`
4. **EV-19 — Eval-infra housekeeping (INFRA-4,5 / GOV-9,10) [P3].** wire a runner for the resolver
   routing dataset; api/chat own coverage floors; pin replay-after-de-entitlement; consolidate the
   NaN/Infinity-fails-toward-require-approval matrix across the 4 sites. `[mostly config/test -> auto-merge if clean]`

SKIP (taken by a concurrent session): **EV-15** channel delivery (`fix/ev15-channel-delivery` worktree).
Re-verify at each ORIENT — concurrency is heavy.

## Process per slice

- **ORIENT:** re-fetch origin/main; re-check `gh pr list` + `git worktree list` (heavy concurrency — if a
  slice is taken/merged, SKIP + note, never touch others' worktrees). Confirm the gap is still open
  (grep the target files; the defect should still reproduce).
- **Brainstorm ONLY if genuinely ambiguous (your judgment):** invoke `superpowers:brainstorming` for a
  real design fork (e.g. EV-17's dual-lifecycle reader / seam-default strategy). SKIP it for well-defined
  slices (EV-5 parity = a mechanical export+assert; EV-18 hook tests; EV-19 housekeeping) — go straight
  to a short TDD-shaped plan.
- **Plan -> Execute -> Review:** `superpowers:writing-plans` (ephemeral, TDD-shaped) ->
  `superpowers:test-driven-development` (RED->GREEN in a FRESH worktree, commit+push INCREMENTALLY for
  resilience) -> VERIFY (delegate the gate battery to a subagent: typecheck/test/lint/format/`arch:check`/
  `local-verify-fast`; build touched pkgs) -> `superpowers:requesting-code-review` (fresh-context
  independent review; for an EVAL the grader/defect-soundness — false-negative AND false-positive — is the
  crux; for a behaviour-preserving refactor, line-by-line behaviour preservation is the crux; triage with
  `superpowers:receiving-code-review`; fix every >=warn, re-review).
- **Eval pattern (deterministic-first):** the BLOCKING leg is a deterministic, no-key assertion (parity-by-
  import, a mutated-gate red-proof, a real-PG starvation test). Any live-LLM leg stays INFORMATIONAL /
  key-gated (`ANTHROPIC_API_KEY` is parked, INFRA-1) — do NOT fake a live pass.
- **Merge policy (best judgment, no check-in):** AUTO squash-merge ONLY when NOT stop-zone AND the 4
  required checks (typecheck/lint/test/security) are green AND review returns zero >=warn AND it is
  test/eval/housekeeping-only (EV-19, maybe EV-18 test hooks). SURFACE (leave for the human + continue)
  any production change or stop-zone: EV-5 core export, EV-17 spine fixes, EV-18 prod preflight. Clean up
  merged worktrees; never `--force` others'.
- **After each merge:** update `project_eval_coverage_2026_06_25.md` + any durable `feedback_*.md` lesson.

## Gotchas (hard-won)

- Shared eval-config CONFLICTS under concurrency (`ci.yml`, `package.json`, `pnpm-lock.yaml`,
  `evals/{tsconfig,vitest.config}`): resolve by UNION + `pnpm install`; re-fetch+re-merge origin/main
  right before merge.
- A new cross-package import (even `import type`) needs the dep in THAT package's `package.json` +
  `pnpm install`, else `turbo typecheck` goes red while vitest passes
  ([[feedback_type_only_import_and_stalled_subagent_recovery]]).
- If a background subagent stalls near-done (600s stream-watchdog) or its connection closes, RECOVER via
  your own commands (inspect worktree -> finish/commit/push); `merge origin/main` a stale recovered branch
  before trusting its diff (it masks others' merged work as deletions) — same memory note.
- Read/Edit via the WORKTREE path; fresh worktree = `pnpm install` + `pnpm db:generate` + FULL `pnpm build`.
  Required CI = typecheck/lint/test/security ONLY; the 8 "Eval — \*" jobs are non-required (no key).

## Termination + report

When every buildable slice above is merged-or-surfaced (or taken/blocked), STOP and report a per-slice
line `{merged #PR | surfaced #PR | skipped-taken | blocked+why}`, and DECLARE the eval-coverage workstream
DONE (residual = EV-5/INFRA-1 live-blocking, blocked on the human restoring `ANTHROPIC_API_KEY`). Do NOT
pick up anything outside this plan.
