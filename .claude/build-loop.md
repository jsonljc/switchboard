# Switchboard Build Loop (v3) — durable single-session slice driver

Generalizes the pilot-spine loop (`.claude/pilot-spine-loop-state.md`), hardened against the
failure modes in MEMORY.md. v3 (2026-06-14) folds in a 4-lens review (CC-harness, doctrine,
superpowers, adversarial red-team). Changes over v2: mechanical merge-stop globs so stop zones
are not an agent judgment call; an independent fresh-context review gate the orchestrator may
not self-grade; a pre-merge divergence re-check; the allowlist / `pnpm audit` / deletion gates
that actually block merges here; an enforced TDD RED proof; Workflow-backed fan-out; a TodoWrite
mirror. Safe by default (no autonomous merge), powerful by opt-in.

You are a TOP-LEVEL Claude Code session: you hold dispatch (Agent / Workflow) and own the
canonical ledger. You drive ONE PR-sized slice from ground truth to merged-or-cleanly-handed-off,
within one session. Keep top-level dispatch so the ledger stays the single source of truth; a
review or verify subagent MAY itself fan out per-finding sub-verifiers (subagents can nest) — the
rule is ledger ownership, not a capability limit.

## Operating model (context discipline is the whole point)

- Durable memory is ON DISK, never in context: the flat STATE*LEDGER (`.claude/<slug>-loop-state.md`,
  uncommitted), the slice's plan on `origin/main`, and the harness memory (`MEMORY.md` index +
  `feedback*\*.md` + the workstream topic file). The conversation is disposable; rehydrate from
  these alone. Let the harness auto-compact; do not hand-roll context drops. The ledger, not the
  window, is the source of truth.
- You run on ONE model (Opus) for the whole session. The harness does NOT switch models by phase.
  Routing is a property of DISPATCH only: pass `model: sonnet` for bounded impl, `model: haiku`
  for mechanical, `model: opus` for risky/review subagents.
- Delegate heavy reading, the gate-run, and review to subagents. They return COMPACT verdicts
  (per-gate booleans + the single failing excerpt + file:line), never raw logs or file dumps.
  This is the primary anti-context-rot lever. Never paste a full `pnpm test` log into your own
  context.
- Prefer the Workflow tool for the 2B fan-out and the VERIFY gate-run: a saved workflow gives
  deterministic `parallel()` fan-out, schema-validated structured verdicts, background execution
  while your window stays free, and resume-from-runId — which survives the fan-out usage-cap death
  (`feedback_workflow_usage_cap_resume`). Fall back to direct Agent dispatch for trivial slices.
- STATE_LEDGER is a small markdown table + log, updated at PHASE TRANSITIONS, not a JSON object
  every turn. Mirror the plan's numbered steps into TodoWrite at PLAN (in_progress on dispatch,
  completed on done-condition met) so the user has live, harness-native status alongside the ledger.

## Inputs

- SLICE: one PR-sized unit (e.g. "riley tier0 PR 0.3 seeder"), NOT a whole workstream.
- WORKSTREAM: riley | alex | mira | governance | launch (selects memory + eval, see Maps).
- STATE_LEDGER: path to the flat markdown state (default `.claude/<slug>-loop-state.md`).
- AUTHORITY: what the user pre-approved. If unset, default to SURFACE-before-merge (full
  autonomy through opening the PR; a human makes the merge call). See Authority & merge safety.

## Authority & merge safety (the irreversible-action gate)

Modes, least to most autonomous:

- SURFACE-before-PR: auto-run through VERIFY, then stop and surface the branch + evidence.
- SURFACE-before-merge (DEFAULT): auto-run all phases, open the PR with the evidence summary,
  stop before merging.
- AUTONOMOUS-WITH-GUARDRAILS: may squash-merge to main WITHOUT surfacing, but ONLY when every
  one of these holds — no merge-stop glob is touched (below), all required gates are green, the
  INDEPENDENT review (VERIFY) returned zero findings at severity >= warn, no stop condition
  fired, and confidence is high. Any miss downgrades this slice to SURFACE-before-merge.
- AUTO-MERGE-AGGRESSIVE: as above with a lower confidence bar. Opt-in per slice only; never the
  default. Still bound by the merge-stop globs and the independent review — those are not
  waivable by authority.

Merge-stop globs (mechanical, not a judgment call). If `git diff origin/main...HEAD --name-only`
matches ANY of these, you MUST stop at SURFACE-before-merge regardless of AUTHORITY, because on
this repo the median slice lives in a stop zone (roughly half of recent merges touched one):

- `**/prisma/**`, `**/migrations/**` (schema / data migration, irreversible)
- `**/*auth*`, session / api-key / principal files (authn/authz)
- `**/*billing*`, `**/*payment*`, `**/*stripe*`, `**/*deposit*` (money)
- `**/*consent*`, `**/*pdpa*`, `**/*privacy*`, erasure paths (privacy / regulated)
- `**/*credential*`, connection-credentials (org-scoped encrypt/merge)
- `**/*governance*`, GovernanceGate, PlatformIngress submit (the mutating entry + its gate)
- external sends: WhatsApp / Telegram / Slack send paths (`apps/chat/**/*send*` and templates)
- `scripts/route-allowlist.yaml`, `scripts/env-allowlist.local-readiness.json` (new bypass route / env var)
  This list is a FLOOR. Use judgment to ADD stops, never to remove one. When a stop trips, say so
  plainly in the surface ("touches `prisma/` -> human merge call").

Stop conditions (any -> STOP CLEAN and surface, even mid-phase): task-size is multi; the slice
goal must change to proceed; product behaviour changes beyond the slice; a merge-stop glob is
touched and AUTHORITY assumed auto-merge; non-trivial schema/data migration risk; >=2 independent
reviewers flag the same unresolved issue; required gates stay red after the capped attempts;
confidence is low despite green gates. Low confidence is the DEFAULT posture on any stop-glob
path — you opt UP to auto-merge, you do not assume it.

Independent review is not self-gradable. The VERIFY review subagent must be fresh-context: hand
it ONLY the three-dot diff + the acceptance criteria + the relevant `feedback_*.md` lessons, NOT
your implementation reasoning. It returns a structured verdict (per finding: severity + file:line).
You may not declare your own review clean. Triage findings with `superpowers:receiving-code-review`
(verify before implementing, push back if a finding is wrong) before looping fixes back to EXECUTE.

## Maps (verified 2026-06-14, hard-wired)

WORKSTREAM -> memory hub (load it, follow its `[[links]]`); all under
`/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/`:

- riley -> moc_riley.md (+ project_riley_capability_audit_2026_06_10.md)
- governance -> moc_governance.md (+ project_goal_governance_audit.md)
- alex -> moc_alex_cockpit.md (+ project_alex_capability_audit_2026_06_10.md)
- launch -> moc_launch_readiness.md (+ project_launch_readiness_state.md)
- mira -> project*mira_capability_audit_2026_06_10.md (NO moc_mira exists)
  The load-bearing lessons are the `feedback*\*.md`in that dir, indexed by`MEMORY.md`.
Do NOT rely on `.agent/memory/semantic/LESSONS.md` (a thin seed stub, not the operational corpus).

WORKSTREAM -> CI-blocking eval (run if the slice touches the decision engine):

- riley -> `pnpm eval:riley` governance -> `pnpm eval:governance`
- alex -> `pnpm eval:alex-conversation` claims/classifier -> `pnpm eval:classifier`

TASK-SIZE gate (set at ORIENT; scales the ceremony — this is the leanness lever):

- trivial (config / copy / 1-file): skip FRAME, skip plan-doc, skip fan-out.
  ORIENT -> EXECUTE -> VERIFY -> merge-or-surface. (Fan-out is overkill here; a single
  TDD pass lands it. The merge-stop globs and independent review still apply.)
- standard (one bounded PR): full loop, single-pass adversarial review.
- multi-slice (needs decomposition): STOP. The decomposition usually already exists on main
  (e.g. riley = `docs/superpowers/plans/2026-06-10-riley-remediation-tier0..tier5.md`).
  ADOPT it, pick ONE slice, restate SLICE, recurse. Never re-derive a plan that exists.

## Doctrine guardrails (non-negotiable; CLAUDE.md / DOCTRINE.md / feedback\_\*)

- Ground truth beats memory: grep producer AND consumer, run `pnpm typecheck` (`pnpm reset`
  first if it reports missing lower-layer exports), confirm "is this already done?" against
  `origin/main` (many backlog items already shipped). Verify on `origin/main`, not just the
  working tree.
- PlatformIngress is the only mutating entry; WorkTrace is canonical; layers schemas -> sdk ->
  core -> db -> apps, no cycles; no bypass paths.
- Branch context before commit (`git branch --show-current`, `git status --short`). One worktree
  per slice off FRESH `origin/main` (re-fetch first). Use three-dot diffs: `git diff origin/main...HEAD`.
- Plans/specs land on main as their OWN focused PR; impl branches consume specs already on main.
  The loop's working plan is `.claude/` scratch (uncommitted); land a `docs/superpowers/plans`
  entry as a separate PR only when a durable spec is warranted.
- Evidence over assertion. No em-dashes anywhere. Lowercase commit subject (Conventional Commits).

## Phases (mapped to the pilot-spine pipeline)

### 0. ORIENT (verify-open + ground truth)

- Re-fetch `origin/main`. Read STATE_LEDGER. Set TASK-SIZE.
- Pre-flight for a CONCURRENT session on the SAME slice: scan `gh pr list` + `git worktree list`
  for an in-flight PR / branch / worktree matching this slice BEFORE EXECUTE. Two top-level sessions
  ran activation P3.2 in parallel (2026-06-20) -> #1200 (happy-path) + #1201 (superset) = add/add
  same-file collision + duplicate effort. If found: adopt/extend that work, do not fork a rival.
- Route task TYPE via `.agent/RESOLVER.md` (for a build slice this is almost always
  "Implementation / code changes" -> loads DOCTRINE + .agent/skills/implementation + the
  conventions). RESOLVER routes by task TYPE, not workstream; WORKSTREAM only selects the
  memory hub + eval (Maps).
- Load the workstream memory hub + the slice's plan on `origin/main` if one exists. ADOPT an
  existing plan; do not re-derive. Stale-plan check: if its producer/consumer paths, signatures,
  schema names, or tests have drifted from `origin/main`, return REVISE rather than silently adapt.
- Confirm the gap is real with tools (grep, typecheck, three-dot diff vs main), not recollection.
- Done: <=120-word ground-truth brief, each claim tool/file-backed. -> FRAME (or straight to
  EXECUTE if trivial).

### 1. FRAME (brainstorm within doctrine)

- Smallest doctrine-compatible approach. Reject (one line each) anything violating
  invariants/layers. If genuinely greenfield, invoke `superpowers:brainstorming`; else design
  against named existing files.
- Confirm the slice fits ONE session/PR. If not -> it is multi-slice: adopt/derive the
  decomposition, pick slice 1, restate SLICE. -> PLAN.

### 2. PLAN (writing-plans, TDD-shaped, ephemeral)

- `superpowers:writing-plans` -> numbered steps; each independently executable, with a
  failing-test-first done-condition, sized for one dispatch. Write to `.claude/` scratch
  (uncommitted), NOT to `docs/` on the impl branch. Mirror the steps into TodoWrite.
- Capture `baseline_sha = git rev-parse HEAD`. -> FAN-OUT (standard / multi only).

### 2B. FAN-OUT PLAN GRADE (substantive slices only; skip if trivial)

Dispatch parallel adversarial subagents (model: opus), per `superpowers:dispatching-parallel-agents`;
prefer a Workflow so verdicts are schema-validated and the run is resumable. Each returns a
STRUCTURED VERDICT only:

- CRITIC: most likely failure; invariant/LESSON violations (producer-population, cross-slice
  seam, ingress pending_approval branch, updateMany no-match abort, NaN-blind gate).
- COMPLETENESS: missing migration-in-same-commit, app-level `--filter` tests, env/route
  allowlist entries, eval fixture, producer population for any flag-gated control.
- CODE-GROUNDED (the high-value lens): OPEN the actual files the plan names and check each
  sketch against real call sites: denominators / NaN guards, every consumer of a changed
  signature, fail-open defaults. This catches the defect class that actually ships here
  (fail-open assertWithinBlastRadius, false fixtures, self-signing oracles).
  `>=2` flag the same issue -> REVISE (cap 2), else PASS. -> EXECUTE.

### 3. EXECUTE (TDD enforced; route models on dispatch)

- Invoke `superpowers:test-driven-development`. One step at a time, RED -> GREEN -> REFACTOR.
  Dispatch each step to a subagent at the routed model (sonnet impl / haiku mechanical / opus
  risky). You hold the plan + ledger, never raw file bodies.
- RED proof is a hard done-condition: the step subagent returns the failing-test excerpt + the
  assertion that failed + why it is the right failure, BEFORE writing impl. A step whose test was
  never seen red is not done. After GREEN: run its specific test, tick the step in plan + ledger +
  TodoWrite.
- Step fails -> `superpowers:systematic-debugging` (root cause, no guessing), cap 3 attempts.
  If still red on a REQUIRED step: STOP CLEAN (ledger records blocker, attempts, current diff,
  failing excerpt, resume_at); do not carry a known-red required step into VERIFY. Explicitly
  non-blocking step -> log, skip, continue. If an executor finds the plan contradicts the code,
  raise a bounded REVISE signal; do not silently follow the sketch.

### 4. VERIFY (green CI, evidence-backed; delegate the run)

- DISPATCH a verifier subagent that RUNS the gates and returns per-gate pass/fail + only the
  failing excerpt (<~30 lines). Gates: `pnpm typecheck`; `pnpm test` AND
  `pnpm --filter <touched-app> test`; `pnpm lint`; `pnpm format:check`; `pnpm arch:check`;
  `CI=1 npx tsx scripts/local-verify-fast.ts` (the ONLY gate that catches new mutating-route /
  new env-var allowlist debt — `pnpm lint` misses both); `pnpm build` if app pkgs changed;
  `pnpm db:check-drift` if schema changed; CONDITIONAL: the workstream eval (Maps) if the slice
  touches the engine, with a new/extended fixture. For dashboard/UI work add `next build` /
  `--filter dashboard build` + a `.tsx` prettier pass (format:check and arch:check are `.ts`-only).
- Merge-time gotchas the verifier must also clear:
  - `pnpm audit --audit-level=high` is the REQUIRED `security` gate. A fresh transitive GHSA
    blocks ALL PRs independent of your diff; if it reds, confirm code-independent and handle via
    `auditConfig.ignoreGhsas` in a SEPARATE chore-deps PR, never auto-suppress a critical.
  - Deletions/renames: `build` type-checks dead/orphaned files. If the slice deletes or renames a
    module, grep the newly-orphaned set for stale importers before declaring green.
  - App test spies need typed `vi.fn` args, or `tsc` over tests reds the chat/api BUILD while
    vitest greens.
- Three-dot diff proof: `git diff origin/main...HEAD`. Confirm each acceptance criterion.
- Independent adversarial review: `superpowers:requesting-code-review` or `/code-review` on the
  diff, dispatched fresh-context (diff + criteria + lessons only). Returns findings only; you may
  not self-grade it. Triage with `superpowers:receiving-code-review`.
- Close with `superpowers:verification-before-completion`: every "done" claim carries fresh
  evidence from THIS run; no green asserted without the command output behind it.
- DONE = all required gates green (incl. eval + security + verify-fast) + every criterion
  evidenced + independent review at zero severity>=warn. Store booleans + one snippet in the
  ledger, never full logs.
- Approach wrong (not a local bug) -> FRAME (cap 1 redesign). Fixable bug + attempts left ->
  back to EXECUTE.

### 5. CONVERGE or HAND OFF

- Pre-merge divergence re-check (do this immediately before any merge, not just at ORIENT):
  re-fetch `origin/main`; confirm `git diff origin/main...HEAD` still clean-applies; run
  `gh pr list` + `git worktree list` to confirm no concurrent session moved the base or is
  mid-merge on an overlapping path. If origin/main advanced under you, `rebase --onto` and re-run
  the fast VERIFY gates before merging. Disable any `--auto` before a late push (auto-merge
  captures HEAD early and orphans late pushes).
- DONE + AUTHORITY allows auto-merge + no merge-stop glob touched: confirm branch, commit
  (lowercase subject, no em-dash), squash-merge via `superpowers:finishing-a-development-branch`.
  Stacked/squash hazards: no `--delete-branch` mid-stack; a diverged squash needs `rebase --onto`;
  force-push won't retrigger CI; the repo auto-deletes merged heads. Then cleanup worktree, update
  ledger + the workstream memory note, and write any new durable lesson to `feedback_*.md` + a
  `MEMORY.md` pointer.
- DONE but low confidence, a merge-stop glob touched, or AUTHORITY = surface: open the PR /
  summarize and SURFACE to the user.
- NOT converging (caps hit / scope > slice / stop condition fired): STOP CLEAN. Branch known-good
  or marked WIP; ledger holds {slice, step_n, baseline_sha, gate_results, blockers, resume_at};
  rehydrate next time from the on-main plan checkboxes + ledger. No thrash-reset that burns the session.

## STATE_LEDGER template (flat markdown, uncommitted, updated at transitions)

```
# <slice> loop — externalized state (orchestration scratch, not committed)
Durable record lives in memory note <project_<workstream>_*>.

Goal: <one line>   Authority: <user-approved>   Task-size: trivial|standard|multi
Base: origin/main @ <sha> (re-fetch each slice)   baseline_sha: <sha>
merge_safety: stop-glob touched=<y/n + which>   independent_review=<pass/findings>

| step | done-condition (test/cmd) | RED proof | status | evidence (cmd->result / file:line) |
|------|---------------------------|-----------|--------|------------------------------------|

gate_results: typecheck=· test=· lint=· format=· arch=· verify-fast=· security=· build=· eval=· review=·
carry_forward (<=150 words; rest rehydrates from on-main plan + this table):

## Log
- <date>: <transition>
```
