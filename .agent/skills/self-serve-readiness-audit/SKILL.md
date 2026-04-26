# Skill: Self-Serve Readiness Audit

## Purpose

Check whether a real customer can reach value without founder intervention.

## Use when

- Onboarding flow is being reviewed
- Signup or go-live is mentioned
- Channel connection is being checked
- Self-serve readiness is questioned
- Hidden founder intervention is suspected

## Inputs

- User request specifying journey or step to audit
- Dashboard source files (`apps/dashboard/`)
- API source files (`apps/api/`)
- `.agent/conventions/launch-readiness.md`
- `.agent/conventions/evidence-standard.md`

## Process

Audit journey step by step:

1. Landing / signup.
2. Org/account provisioning.
3. Website scan / business facts.
4. Training/playbook setup.
5. Test center.
6. Channel connection.
7. Go-live activation.
8. First inbound message.
9. Agent response.
10. Booking/revenue outcome if relevant.

For each step check:

- Frontend route exists.
- Hook calls real API.
- Proxy exists if dashboard route.
- Backend route exists.
- Store/service persists state.
- No-op callbacks.
- Stubs.
- Env gates.
- Hidden manual setup.
- Customer-facing error state.

## Output

- Journey status (step-by-step table)
- P0/P1/P2 findings
- Broken chain table (step | expected | actual | status | evidence)
- Hidden manual debt
- Customer impact
- Fix plan
- Acceptance criteria

## Quality bar

- Every step in the journey is checked, not just the ones that look broken.
- No-op callbacks and stubs are explicitly flagged, not assumed to work.
- Hidden manual setup is identified by checking whether state requires DB seeds or env flags.

## Failure modes

- Only auditing frontend without checking backend persistence.
- Assuming a hook works because it exists, without checking what it calls.
- Missing env gates that silently disable features.
- Skipping the booking/revenue outcome step.

## Done when

- Every journey step has been checked with exact file evidence.
- All broken chains are documented in the output table.
- Customer impact is stated for each finding.
