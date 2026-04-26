# Architecture Invariants

- PlatformIngress is canonical entry for mutating actions.
- WorkTrace is canonical persistence.
- Approval is lifecycle state, not route-owned side effect.
- Tools are strict, auditable, idempotent product surfaces.
- Human escalation is first-class architecture.
- Idempotency and dead-letter handling are business-critical.
- Outcome-linked traces matter.
- Multi-agent behavior must have bounded roles.
- Semantic caching is for stable retrieval/narration, not fresh operational state.
- No non-converged mutating path should survive launch.
