# Skill: Implementation

## Purpose

Enforce Switchboard architecture invariants during code execution. Runs before and after each step in executing-plans.

## Use when

- Implementing any step from an executing-plans task
- Writing new routes, services, stores, or tools in `apps/` or `packages/`
- Resolver routes this for: "implement this", "execution plan", "build this", "patch plan", "code changes"

## Inputs

- The step description from the implementation plan
- `docs/DOCTRINE.md`
- `.agent/conventions/architecture-invariants.md`

## Pre-write check (run before writing any code)

Answer these 3 questions explicitly in the session before touching any file:

1. **Ingress path:** Does this step introduce any mutating action (create, update, delete, external write)? If yes, does it enter through `PlatformIngress.submit()`? If not — state the violation, propose the minimal routing fix, and do not write code until the plan or user explicitly resolves it.

2. **Persistence layer:** Does this step write durable state? If yes, is `WorkTrace` the canonical store? Caches and transient in-memory state are exempt. If durable state is written elsewhere — state the violation, propose the fix, and do not write code until resolved.

3. **Governance:** Does this step require a governed action (external write, destructive operation, tool invocation)? If yes, is `GovernanceGate.evaluate()` called exactly once per governed request (not per function call, not zero times, not twice)? If governance is missing or duplicated — state the violation, propose the fix, and do not write code until resolved.

If all three answers are "not applicable to this step" or "yes, correctly handled" — proceed to write code.

## Post-write check (run after writing code, before marking step complete)

Verify all 5 before marking the task step as done:

1. **PlatformIngress:** For any mutating action, grep the edited file for `PlatformIngress` or `platformIngress`. If a route handles POST/PUT/DELETE/PATCH and has no reference to PlatformIngress — flag as violation.
2. **WorkTrace:** For any durable state write, grep the edited file for `WorkTrace` or `workTrace`. If state is written to another model without a WorkTrace reference — flag as violation.
3. **Idempotency:** Does the mutating action include an `idempotencyKey`? Check that `PlatformIngress.submit()` is called with an idempotency key parameter. If absent — flag as violation.
4. **Co-located test:** Verify a test file exists at `<same-directory>/<filename>.test.ts`. Run `pnpm --filter <package> test` and confirm it passes.
5. **Typecheck:** Run `pnpm typecheck`. Confirm it passes with no new errors.

If any check fails: state the specific failure, fix it, re-run the check. Do not move to the next step until all 5 pass.

## Output

For each step:

- Pre-write: explicit answers to the 3 questions (not implied — written out)
- Code: the implementation
- Post-write: confirmation that all 4 checks pass, or the specific fix applied

## Quality bar

- No step marked complete with a failing typecheck.
- No step marked complete without a co-located test at `<same-dir>/<file>.test.ts`.
- No mutating route that bypasses PlatformIngress.
- No durable state write outside WorkTrace.
- No mutating action without an idempotency key.
- Coverage must not regress below project baseline (see CLAUDE.md for thresholds).

## Failure modes

- Skipping pre-write check because "the step is simple" — all steps require the check.
- Marking a step complete before running typecheck — typecheck must pass.
- Writing a test file in a different directory — tests must be co-located (`same-dir/*.test.ts`).
- Assuming governance is not needed without checking if the action is mutating.

## Done when

- All plan steps are complete.
- All 4 post-write checks passed for every step.
- `pnpm test` passes.
- `pnpm typecheck` passes.
