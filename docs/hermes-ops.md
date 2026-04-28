# Hermes Ops

How Hermes is used alongside Claude Code on Switchboard.

## Doctrine

> Claude Code is the primary builder.
> Hermes is the second control plane: reviewer, watchdog, janitor, scheduler.

Hermes must **not** make runtime-mutating architecture changes without explicit
human instruction on a named branch. In particular, Hermes is not permitted to
lead changes to:

- `PlatformIngress` / approval lifecycle / `WorkTrace` persistence
- CAPI attribution correctness
- any path where one wrong abstraction creates weeks of mess

For those, Claude Code owns the branch and Hermes is only invoked as a reviewer.

Good Hermes work:

- pre-push invariant review
- nightly doctrine / test / drift checks
- weekly stale-worktree reports
- bounded, low-risk parallel chores in isolated worktrees
- PR / CI failure triage

Bad Hermes work (Claude Code leads, Hermes reviews only):

- core architecture decisions
- approval lifecycle refactors
- `PlatformIngress` changes
- attribution / billing correctness
- anything touching the convergence invariants in `docs/DOCTRINE.md`

## What is wired up

### 1. Pre-push diff reviewer (manual)

`scripts/hermes-review.sh` pipes `git diff origin/main...` into Hermes with an
invariant-focused review prompt and prints a `PASS | FAIL` verdict plus
`P0 / P1 / P2` issues.

```bash
./scripts/hermes-review.sh                # diff vs origin/main
./scripts/hermes-review.sh upstream/main  # diff vs custom base
```

Manual only. There is intentionally **no `pre-push` git hook** until the
reviewer's signal is calibrated. Once it reliably catches real issues without
noise, a hook can be added with a `SKIP_HERMES=1 git push` bypass — not before.

### 2. Nightly smoke (GitHub Actions)

`.github/workflows/nightly-smoke.yml` runs daily at 09:00 UTC against `main`:

- `pnpm typecheck`
- `pnpm test -- --run`
- `pnpm db:check-drift`

CI is the source of truth for codebase health, so this lives in Actions rather
than local cron — it runs whether or not the laptop is awake.

Failure-only alerting. Set the `NIGHTLY_SMOKE_WEBHOOK` repo secret to a Hermes
gateway / builder-channel webhook to receive notifications. If unset, failures
still surface as a red Actions run; success runs are silent.

Heavier checks (full `pnpm reset`, coverage trend, e2e) are deliberately
deferred until this signal is trusted.

### 3. Weekly worktree hygiene (local Hermes cron)

`scripts/hermes-worktree-hygiene.sh` reports — never deletes — worktrees that
are:

- on a branch already merged into `origin/main`
- on a branch that no longer exists on origin
- idle for 7+ days
- carrying uncommitted changes

This must be local because it needs access to the on-disk worktrees in
`.worktrees/` and `.claude/worktrees/`. Suggested cron entry:

```bash
hermes cron add \
  --schedule "0 9 * * MON" \
  --command "/Users/jasonli/switchboard/scripts/hermes-worktree-hygiene.sh"
```

The operator decides what to tear down. Recommended teardown when ready:

```bash
git worktree remove <path> && git worktree prune
```

### 4. Parallel low-risk chores

Use `hermes -w` (isolated git worktree) for bounded, independent work that does
not touch runtime correctness. Until trust is established, keep tasks small,
read-mostly, and reversible.

Worked example — sweeping a deprecated navigation reference:

```bash
hermes -w -q "Find stale references in this repo to the deprecated
marketplace/hire navigation path. Do not change runtime behavior. Update
docs and tests only if clearly safe and obvious. Run pnpm lint and pnpm
typecheck before producing a patch. Output:

  - the files you changed and why
  - lint/typecheck results
  - anything ambiguous you chose to skip

Stop and report instead of guessing if you find a runtime caller."
```

Good chore candidates: dead-code cleanup, doc synchronization, fixture updates,
audit follow-ups, "find where this pattern still exists", stale-link sweeps.

Bad chore candidates: anything in the doctrine list above.

## What is intentionally not wired up

- **MCP bridge into Claude Code.** Valuable later, but only after Hermes has
  earned trust as a reviewer and checker on its own. Wiring it earlier risks
  architecture theater.
- **Gateway integration with Switchboard's product chat.** Hermes alerts go to
  the builder/operator channel, never to the product runtime channel. Do not
  conflate them.
- **Cron-based full `pnpm reset`.** Too heavy for an initial signal. Add only
  once the lighter smoke check is reliable.
- **Pre-push git hook.** See above — script first, hook later.

## Alerting policy

Only alert on failure or drift. No "FYI" pings, no successful-run spam, no long
audit essays piped into chat. If an alert needs more than one screen of
context, it should link to a run / log instead of inlining it.
