# Security Policy

Switchboard handles clinic customer contact data, calendar credentials, and payment references. We take reports seriously and respond fast.

## Reporting a vulnerability

Please do not open a public issue for security reports.

Email **jasonljc@live.com** with:

- A description of the issue and where it lives (file path or endpoint)
- Reproduction steps or a proof of concept
- Impact as you understand it

You will get an acknowledgement within 72 hours. Please give us a reasonable window to remediate before any public disclosure.

## Scope notes

- Connection credentials are encrypted at rest (`packages/db`, credential encryption layer).
- Every mutating action passes a single ingress and governance gate (`packages/core/src/platform/`); bypass paths are architecture violations and in scope.
- The audit trail is hash-chained (`packages/core/src/platform/work-trace-integrity.ts`); anything that lets an actor rewrite history without detection is in scope.

There is no bug bounty program at this time.
