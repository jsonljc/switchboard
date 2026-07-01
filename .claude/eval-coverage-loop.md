# Eval-coverage continuation — autonomous build-loop (driver prompt)

Drive the build-loop (`.claude/build-loop.md`) over the REMAINING buildable slices of the
eval-coverage plan (`docs/superpowers/plans/2026-06-25-eval-coverage-plan.md`), ONE PR-sized slice at
a time, fully autonomously (NO check-ins), using the superpowers chain. Stay within the eval-coverage
workstream. When the buildable P1 backlog below is merged-or-surfaced (or verified taken/done/blocked),
STOP and report — and if nothing buildable remains, DECLARE THE EVAL-COVERAGE BUILDABLE BACKLOG DONE.
Do NOT invent work outside the plan.

MERGED already (skip): EV-1 #1339, EV-2 #1292, EV-3 #1323 (+#1334), EV-4 #1344, EV-6 #1343, EV-16 #1305.

## Slices (priority order; each its own fresh worktree off origin/main under .claude/worktrees/)

Read each slice's definition in the plan before building. Priority = buildable-now + leverage.

1. **EV-3c** — Mira taste/facts injection lane (ADV-1 Mira). UNBLOCKED by EV-6. Apply the EV-3
   adversarial/injection corpus pattern to the merged EV-6 Mira real-generation drive
   (`evals/mira-self-brief/`), with a deterministic agent-agnostic grader (NO key). Clones EV-3+EV-6;
   eval-only. `[clean -> auto-merge]`
2. **EV-10** — skill-runtime constraints / inert-path (SPINE-3/BUG-3, SPINE-4). `[likely clean]`
3. **EV-8** — Alex missing-scenario fixtures (AGENT-1..4, AGENT-6); extend `evals/alex-conversation`. `[clean -> auto-merge]`
4. **EV-9a** — consent fail-closed branches (GOV-1, GOV-6). `[stop-zone: consent -> SURFACE]`
5. **EV-12** — attribution chain (MONEY-4/BUG-10, MONEY-5, MONEY-6). `[stop-zone: money -> SURFACE]`
6. **EV-13** — creative medical-claim judge (MONEY-7/BUG-8). `[stop-zone: claim/money -> SURFACE]`
7. **EV-9b** — approval + operator-binding isolation (GOV-3/4/5/7/8). `[stop-zone: governance/authz -> SURFACE]`
8. **EV-11** — pre-real-money-flip gate (MONEY-1/3/8/9/10). `[stop-zone: money -> SURFACE]`
9. **EV-14** — cross-tenant route sweep (CHAN-1/2/3/7/8). `[stop-zone: tenant -> SURFACE]`
10. **EV-7** — Riley LLM-judgment + Robin lane (AGENT-7 + INFRA-3(Robin) + AGENT-10; carries EV-3b).
    Bigger (needs a Robin harness) — brainstorm the harness design first. `[partly clean]`

DEFER (note, do not build without scoping): **EV-5** live-BLOCKING leg needs the parked
`ANTHROPIC_API_KEY` (INFRA-1, an ops task) — build only the AGENT-5 tool-parity unit-test part if it
cleanly separates, else SURFACE a note. **EV-15/EV-17/EV-18** = P2; **EV-19** = P3 housekeeping — only
if the P1 list is exhausted and there is clear appetite.

## Process per slice

- **ORIENT:** re-fetch origin/main; re-check `gh pr list` + `git worktree list` (HEAVY concurrency —
  eval/audit sessions run in parallel; if a slice is already merged or in-flight, SKIP it and note why,
  never touch others' worktrees). Confirm the gap/slice is still open + its deps merged (read the plan
  slice + grep the target files).
- **Brainstorm only if needed (judgment):** invoke `superpowers:brainstorming` for genuine design
  ambiguity (EV-7 Robin harness; EV-12 attribution graph; a novel grader). SKIP for slices that clone
  an existing harness/grader (EV-3c clones EV-3+EV-6; EV-8 extends alex-conversation).
- **Plan -> Execute -> Review:** `superpowers:writing-plans` (ephemeral, TDD-shaped) ->
  `superpowers:test-driven-development` (RED->GREEN, fresh worktree) -> VERIFY (delegate the full gate
  battery to a subagent: typecheck/test/lint/format/arch/`local-verify-fast`/`audit`; build touched
  pkgs) -> `superpowers:requesting-code-review` (fresh-context independent review; the GRADER soundness
  — false-negative AND false-positive — is the crux for any eval slice; triage with
  `superpowers:receiving-code-review`; fix every >=warn finding, re-review).
- **Eval pattern (deterministic-first — the EV-3/4/6 law):** the BLOCKING leg is a deterministic,
  agent-agnostic grader that runs with NO API key (prove its teeth via the `runConversation`
  injected-executor seam or a fake adapter). The live-LLM leg is INFORMATIONAL, key-gated
  (continue-on-error), following the no-key convention (skip+exit0 off-main, exit2 on a main push).
  The `ANTHROPIC_API_KEY` is parked (INFRA-1), so live legs are NOT verifiable locally/CI — do NOT
  fake a live pass; rely on the deterministic blocking tests (they run in the required `test` job).
- **Merge policy (best judgment, no check-in):** AUTO squash-merge a slice ONLY when it is NOT
  stop-zone AND the 4 REQUIRED checks (typecheck, lint, test, security) are green AND the independent
  review returns zero >=warn AND confidence is high (eval-only slices with no production change:
  EV-3c, EV-8, EV-10 typically). The 8 "Eval — \*" CI jobs are NON-REQUIRED and currently RED (no
  key) — they do NOT block; verify via the deterministic tests in `test`. For stop-zone slices
  (consent/money/tenant/governance/authz: EV-9a/9b/11/12/13/14): SURFACE the PR with evidence, leave
  the merge for the human, and CONTINUE. Clean up merged worktrees; never `--force`.
- **After each merge:** update the eval-coverage note (`project_eval_coverage_2026_06_25.md`) +
  any durable lesson (`feedback_*.md` + MEMORY.md pointer).

## Gotchas (hard-won this workstream)

- Shared eval-config CONFLICTS are near-certain under concurrency: `.github/workflows/ci.yml`,
  `package.json`, `pnpm-lock.yaml`, `evals/tsconfig.json`, `evals/vitest.config.ts`. They are ADDITIVE
  — resolve by UNION (keep both sessions' jobs/scripts/includes) + `pnpm install` to regen the
  lockfile. Re-fetch + re-merge origin/main right before merge (it moves fast).
- Read/Edit via the WORKTREE path (worktree-drift). Fresh worktree setup: `pnpm install` +
  `pnpm db:generate` + FULL `pnpm build` (a partial `db...` build misses creative-pipeline/ad-optimizer
  -> ~300 spurious api failures). Required CI = typecheck/lint/test/security ONLY.
- Eval grader review must hit BOTH false-negative (misses a real violation) AND false-positive (flags
  benign/admin/dual-use) — anchor patterns on result-nouns/concepts, not bare verbs; split contrastive
  clauses before a refusal-hedge filter (EV-4 lessons).

## Termination + report

When every listed buildable slice is merged-or-surfaced (or verified taken/done/blocked), STOP and
report a per-slice line: `{merged #PR | surfaced #PR (awaiting human merge) | skipped-taken | already-done
| blocked+why}`. If the P1 buildable list is exhausted, explicitly DECLARE the eval-coverage buildable
backlog DONE (residual = EV-5 live-blocking blocked on the parked key/INFRA-1 + P2/P3 housekeeping).
Do NOT pick up anything outside the plan.
