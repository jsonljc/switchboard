# Switchboard Invariants

Quick reference. `docs/DOCTRINE.md` remains canonical.

1. Every governed action enters through `PlatformIngress.submit()`.
2. Every action lifecycle is managed by the platform layer.
3. `WorkTrace` is the canonical durable record. One per WorkUnit.
4. `GovernanceGate.evaluate()` runs exactly once per action.
5. `DeploymentContext` is resolved once, at ingress, by `DeploymentResolver`.
6. Idempotency is enforced at `PlatformIngress` via `idempotencyKey`.
7. Every async path has a dead-letter destination.
8. Approval, undo, and emergency halt are core lifecycle operations.
9. Tools are strict, auditable, idempotent product surfaces.
10. Chat channels are ingress surfaces, not alternative execution architectures.
