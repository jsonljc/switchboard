---
name: Architecture cleanup complete — capability building mandate
description: Architecture convergence done 2026-04-19. No more architecture passes. Guard invariants, build revenue capabilities.
type: project
originSessionId: b43765c4-4e48-4560-a18c-ada80c51d87f
---

Architecture cleanup program is complete as of 2026-04-19.

Phases 1-6 converged the operating spine. A final bounded
truthfulness pass (PR on main, commit c5f1f98a) corrected
Dockerfile packaging, broken exports, DOCTRINE registry, and
README framing. The repo now tells the truth about itself.

**Why:** The system passed a deploy-audit truthfulness test.
Mismatch between docs and code is now eliminated. Further
architecture work is no longer the highest-leverage move.

**How to apply:**

Primary track: capability building (first SMB revenue wedge).
Secondary track: fix pre-existing package extraction breakage
(ad-optimizer/creative-pipeline tsconfig wiring) since broken
packages slow every later iteration.

Do NOT:

- Start another architecture pass
- Introduce any new runtime truth outside PlatformIngress /
  PlatformLifecycle / DeploymentResolver / WorkTrace
- Reintroduce a second control plane, lifecycle spine, or
  persistence truth in any new feature

DO:

- Guard the invariants on every PR
- Fix infra issues only when they block speed or trust
- Spend main energy on revenue-facing capabilities
