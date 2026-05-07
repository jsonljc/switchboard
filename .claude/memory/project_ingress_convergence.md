---
name: Ingress Convergence
description: Converging chat gateway and API into one shared execution path with deployment as the single source of truth. Spec approved 2026-04-17.
type: project
originSessionId: c07312de-0c66-4302-9581-c6462434c255
---

Ingress convergence merges the two divergent execution paths (chat gateway direct + PlatformIngress API) into one shared runtime path.

**Why:** Chat gateway resolves deployments and executes skills directly, bypassing PlatformIngress. API/PlatformIngress path has no deployment awareness. This means governance posture differs by entry point and there's no single answer to "is this agent live?"

**How to apply:** All execution must flow through DeploymentResolver → SubmitWorkRequest → PlatformIngress → SkillMode → SkillExecutor. No exceptions, no chat-specific execution path.

Key architecture decisions:

- DeploymentResolver (new, in core) — resolves deployment identity, activation, trust, config
- SubmitWorkRequest extended with nested `deployment` context object
- `intent` stays as semantic execution key; `skillSlug` is the deployed runtime target (complementary, not competing)
- BuilderRegistry in SkillMode replaces hardcoded builderMap in chat gateway
- Builders are optional — passthrough for simple skills
- PlatformIngress stays stateless/single-turn — conversation state managed above
- ChannelGateway becomes thin adapter (parse, session, format — no execution)
- IntentRegistry not demoted — still provides governance classification and tracing labels

Diff sequence: (1) SubmitWorkRequest + DeploymentResolver, (2) BuilderRegistry + SkillMode hook, (3) Chat gateway rewiring, (4) Agent proof (8 integration tests, tiered), (5) Delete old path

Spec: `docs/superpowers/specs/2026-04-17-ingress-convergence-design.md`
