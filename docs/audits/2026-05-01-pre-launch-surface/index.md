# Pre-Launch Surface Audit — Triage Index

> Source spec: [`docs/superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md`](../../superpowers/specs/2026-05-01-pre-launch-surface-audit-design.md)

## Status

| Surface                | Tier     | Findings doc                               | PR  | Closed |
| ---------------------- | -------- | ------------------------------------------ | --- | ------ |
| 01 Dashboard core      | Deep     | [01](./01-dashboard-core-findings.md)      | —   | —      |
| 02 Dashboard secondary | Standard | [02](./02-dashboard-secondary-findings.md) | —   | —      |
| 03 Marketing           | Deep     | [03](./03-marketing-findings.md)           | —   | —      |
| 04 Onboarding          | Deep     | [04](./04-onboarding-findings.md)          | —   | —      |
| 05 Chat surfaces       | Standard | [05](./05-chat-findings.md)                | —   | —      |
| 06 Notifications       | Standard | [06](./06-notifications-findings.md)       | —   | —      |
| 07 Operator / admin    | Light    | [07](./07-operator-admin-findings.md)      | —   | —      |

## Severity counts

Populated during triage (Phase C).

## Launch-blocker queue

Populated during triage. Each entry references its finding ID, surface, fix spec/plan (or trivial-fix bypass PR), and Status.

## Calibration precedents

Populated during Phase B as each surface's calibration ritual runs.

## Ship-with acknowledgments

Populated during triage if any. Per spec §10 step 5, certain Launch-blocker classes are hard-prohibited from ship-with — check that hard-prohibition list before adding any entry here.

```
Ship-with: DC-41
Acknowledged-by: Jason
Acknowledged-at: 2026-05-02
Rationale: Halt button is hidden at launch (PR #342); wiring requires backend runtime gate + new endpoint + audit trail, out of PR-1 scope. Severity is High (not Launch-blocker), so the ship-with hard-prohibition list does not apply.
Mitigation: None at v1; operators contact support to halt dispatch in an emergency. The op-strip "Live" pulse remains visible as a read-only status indicator.
Re-evaluate: 2026-06-01
```

## High backlog

Populated during triage.

## Re-audit gate

See [runbook-re-audit-gate.md](./runbook-re-audit-gate.md). Run before launch per spec §13.7.

- **Re-audit-SHA:** _set at re-audit time_
- **Result:** _set at re-audit time_
