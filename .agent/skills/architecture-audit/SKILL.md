# Skill: Architecture Audit

## Purpose

Audit Switchboard architecture against product doctrine and runtime invariants.

## Use when

- PlatformIngress is mentioned
- WorkTrace is mentioned
- Runtime convergence is being changed
- Mutating surfaces are being added
- Routes may bypass lifecycle/governance

## Inputs

- User request
- Relevant source files
- `docs/DOCTRINE.md`
- `.agent/memory/semantic/INVARIANTS.md`
- `.agent/memory/semantic/DECISIONS.md`

## Process

1. Identify the architecture area.
2. Read `docs/DOCTRINE.md`.
3. Read relevant invariants and prior decisions.
4. Locate code paths with exact file evidence.
5. Check whether mutating actions enter through PlatformIngress.
6. Check whether lifecycle state is owned centrally, not by routes.
7. Check whether WorkTrace remains canonical.
8. Check idempotency, approval, retry, and failure paths.
9. Check for bypass surfaces and architecture drift.
10. Classify issues P0/P1/P2.
11. Recommend minimal fix and tests.

## Output

- Verdict
- What is correct
- P0/P1/P2 findings with exact evidence
- Customer/product impact
- Recommended fix
- Acceptance criteria
- Tests required

## Quality bar

- No claims without file evidence.
- No generic praise.
- No broad rewrite unless needed.
- Every finding cites exact file path and function.

## Failure modes

- Guessing implementation exists without checking source code.
- Reviewing only one layer (e.g., only routes, not stores).
- Recommending architecture changes that violate DOCTRINE.md.
- Missing bypass surfaces because only the happy path was traced.

## Done when

- Every invariant from architecture-invariants.md has been checked against the target area.
- All findings have exact file evidence.
- Recommendations are minimal and testable.
