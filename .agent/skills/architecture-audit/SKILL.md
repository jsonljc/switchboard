# Skill: Architecture Audit

## Purpose

Audit Switchboard architecture against product doctrine and runtime invariants.

## Run first

Before reasoning, run:

```
.agent/tools/check-routes
```

Treat each output line as a starting candidate for the audit. Lines reported as `N findings suppressed by allowlist` are intentionally exempted — do not reason about them unless explicitly asked.

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

## Approval lifecycle deep trace

When `check-routes` reports an `approval` finding, perform this deeper trace before classifying:

1. Trace the call site upward. Does the mutation originate inside the route handler, or is the route only forwarding into `ApprovalLifecycleService`? Forwarding is fine; in-route mutation is a violation.
2. For each create / resolve path, confirm the corresponding `WorkTrace` write exists.
3. For each path, confirm a test exercises the full request → resolve → side effect chain, not just the route handler.

This replaces the previously proposed standalone `approval-lifecycle-audit` skill — it is a section of architecture-audit, not a separate route.

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
