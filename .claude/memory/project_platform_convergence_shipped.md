---
name: Platform convergence shipped + caller migration designed
description: Contract shipped 2026-04-16 (PRs #201-#204). Caller migration spec and plan written same day. First caller = POST /api/execute. Implementation not started.
type: project
---

Platform convergence contract established 2026-04-16 (PRs #201-#204).

**What shipped:**

- SP6: Skill runtime unification (ModelRouter, lifecycle hooks, SkillRuntimePolicy)
- Platform Phase 1: Shared types (WorkUnit, IntentRegistration, GovernanceDecision, ExecutionConstraints, ExecutionResult, WorkTrace) + registries (IntentRegistry, ExecutionModeRegistry)
- Platform Phase 2: GovernanceGate facade wrapping existing PolicyEngine
- Platform Phases 3-6: SkillMode, CartridgeMode, PipelineMode, intent registrars, WorkTrace recorder, PlatformIngress
- 39 files in packages/core/src/platform/, 102 platform tests

**Caller migration (designed 2026-04-16, not yet implemented):**

- Spec: `docs/superpowers/specs/2026-04-16-platform-ingress-caller-migration-design.md`
- Plan: `docs/superpowers/plans/2026-04-16-platform-ingress-caller-migration.md`
- Strategy: prove POST /api/execute end-to-end first, then freeze boundary for new callers
- Key decision: GovernanceGate must reconstruct full propose-pipeline context assembly (identity, risk input, guardrails, spend lookup, composite context, system risk posture), not just wrap PolicyEngine.evaluate()
- Key discovery: governance infra already partially built (GovernanceGate class, decision-adapter, work-unit-adapter, constraint-resolver) but is the thin version — plan upgrades in place
- Double-governance solved by: new executePreApproved() on LifecycleOrchestrator
- 11 tasks, dependency-ordered

**How to apply:** New agents register an intent, reuse existing execution mode. No new direct paths bypassing PlatformIngress. After first caller proof passes, app-layer code must use PlatformIngress.submit() instead of orchestrator.resolveAndPropose().
