---
name: No more architecture passes — guard invariants only
description: After bounded cleanup 2026-04-19, architecture work stops. Only guard invariants, never reopen the system.
type: feedback
originSessionId: b43765c4-4e48-4560-a18c-ada80c51d87f
---

Do not propose or execute further architecture cleanup passes.

**Why:** User explicitly closed the architecture program after
6 convergence phases + 1 truthfulness pass. The system is sound.
Further polishing is not the highest-leverage move. The user
values bounded passes that correct contradictions without
reopening the system (4 files, net -37 lines was the right size).

**How to apply:** When reviewing or implementing new features,
enforce these invariants silently — no new feature may:

- bypass PlatformIngress for governed work submission
- create a second lifecycle spine or persistence truth
- construct deployment context outside DeploymentResolver
- run governance twice for the same work unit

If a feature would violate an invariant, flag it. Otherwise,
build capabilities, not platform.
