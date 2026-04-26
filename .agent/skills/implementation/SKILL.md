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

1. **Ingress path:** Does this step introduce any mutating action? If yes, does it enter through `PlatformIngress.submit()`? If not, stop and redesign before writing code.

2. **Persistence layer:** Does this step write state? If yes, is `WorkTrace` the canonical store? If something else is written to instead, stop and redesign.

3. **Governance:** Does this step require a governed action? If yes, is `GovernanceGate.evaluate()` called exactly once? If governance is missing or called multiple times, stop and redesign.

If the answer to all three is "not applicable to this step" or "yes, correctly implemented" — proceed to write code.

If any answer is "no" or "missing" — state the specific violation, propose the minimal fix, and do not write code until resolved.

## Post-write check (run after writing code, before marking step complete)

Verify all 4 before marking the task step as done:

1. Does the new route/service flow through `PlatformIngress` for mutating actions?
2. Does it write canonical state to `WorkTrace`?
3. Is there a co-located test file (`*.test.ts`) covering the new behavior?
4. Does `pnpm typecheck` pass?

If any check fails: surface the specific failure, fix it, re-run the check. Do not move to the next step until all 4 pass.

## Output

For each step:

- Pre-write: explicit answers to the 3 questions (not implied — written out)
- Code: the implementation
- Post-write: confirmation that all 4 checks pass, or the specific fix applied

## Quality bar

- No step marked complete with a failing typecheck.
- No step marked complete without a co-located test.
- No mutating route that bypasses PlatformIngress.
- No parallel persistence path outside WorkTrace.

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
