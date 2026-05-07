---
name: thin-harness-fat-skills-pivot
description: Switchboard pivoting to thin harness + fat skills architecture — domain logic moves from TypeScript in core to markdown skill files executed by minimal runtime
type: project
---

Switchboard is pivoting to a "thin harness, fat skills" architecture (inspired by Steve Yegge's framework).

**What:** Domain logic (~70 files) currently hardcoded in `packages/core/` moves into markdown skill files that teach the LLM how to perform domain processes. Deterministic operations (API calls, DB queries, stage transitions) become narrow tool functions. The governance spine (policy engine, approvals, risk scoring, trust scores) stays as the thin harness.

**Why:** Current architecture is "fat harness, thin skills" — only the platform builder can create agents, model upgrades don't improve agents, no network effects. The pivot enables: third-party skill authoring, model-upgrade leverage, customer customization without developers, and marketplace network effects.

**SP1 (proof migration):** Sales pipeline agent migrated from 4 TypeScript files to 1 markdown skill file + minimal runtime + 5 tool operations. Feature-flagged with shadow mode comparison before cutover. Spec at `docs/superpowers/specs/2026-04-14-thin-harness-fat-skills-design.md`.

**Key principle:** Skills hold judgment and process framing. Tools hold state transitions and computations. Policies hold safety/governance (injected by runtime, not authored in skills). Evals hold truth of whether it works.

**How to apply:** All future agent development should follow this pattern. No new domain logic in `packages/core/`. Anti-bloat rule: deterministic state logic must never go in markdown skills.
