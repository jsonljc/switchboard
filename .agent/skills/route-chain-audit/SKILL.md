# Skill: Route Chain Audit

## Purpose

Trace a user-facing action from UI to persistence/external effect.

## Use when

- A button or action needs verification end-to-end
- A route is suspected broken, stubbed, or no-op
- A feature "works in the UI but nothing is saved"
- Backend store or persistence is in question

## Inputs

- User request identifying the action to trace
- Dashboard source files
- API source files
- Store/service source files

## Process

1. Identify the user-facing action.
2. Find the frontend component/page.
3. Find the hook/client call.
4. Verify the API path matches.
5. Verify proxy route if dashboard uses one.
6. Verify backend route exists and handles the method.
7. Verify handler calls real service/store.
8. Verify persistence or external effect.
9. Flag stubs, no-ops, mismatched paths, fake success states, and missing error states.

## Required chain

```
frontend page/component
→ hook/client
→ dashboard proxy (if applicable)
→ backend route
→ service/store
→ database/external provider (if applicable)
```

## Output

| Step | Expected | Actual | Status | Evidence |
| ---- | -------- | ------ | ------ | -------- |

Status values: PASS, FAIL, STUB, NO-OP, MISSING

## Quality bar

- Every step in the chain is checked, not just the first and last.
- Mismatched API paths between frontend and backend are caught.
- Stub handlers that return 200 with no side effect are flagged.

## Failure modes

- Checking only the frontend layer.
- Assuming a proxy route works because the backend route exists.
- Missing that a handler returns success without calling any store.
- Not checking error/failure paths.

## Done when

- The full chain from UI to persistence is documented.
- Every step has exact file evidence.
- All broken links are classified by severity.
