# Switchboard Agent Resolver

Match task to triggers. Load only the listed files.

## Architecture audit

**Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

**Run first:**

- `.agent/tools/check-routes`

**Load:**

- `docs/DOCTRINE.md`
- `.agent/skills/architecture-audit/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/source-of-truth.md`
- `.agent/memory/semantic/DECISIONS.md`
- `.agent/memory/semantic/INVARIANTS.md`

## Self-serve readiness audit

**Triggers:** onboarding, signup, first agent live, launch Alex, go live, channel connect, self-serve, hidden founder intervention

**Load:**

- `.agent/skills/self-serve-readiness-audit/SKILL.md`
- `.agent/conventions/launch-readiness.md`
- `.agent/conventions/evidence-standard.md`
- `.agent/memory/semantic/LESSONS.md`

## Route-chain audit

**Triggers:** route, hook, proxy, backend, store, 404, broken endpoint, no-op callback, stub, missing persistence, button works but nothing saves

**Load:**

- `.agent/skills/route-chain-audit/SKILL.md`
- `.agent/conventions/evidence-standard.md`
- `.agent/conventions/token-budget.md`

## Implementation / code changes

**Triggers:** implement this, execution plan, executing-plans, executing plan, subagent-driven-development, build this, patch plan, code changes

**Load:**

- `docs/DOCTRINE.md`
- `.agent/skills/implementation/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/token-budget.md`
- `.agent/conventions/source-of-truth.md`

## Context compression

**Triggers:** summarize this session, compact, reduce token, memory update, what did we learn

**Load:**

- `.agent/skills/context-compression/SKILL.md`
- `.agent/memory/semantic/LESSONS.md`
- `.agent/memory/semantic/DECISIONS.md`

## Default

Load nothing beyond `CLAUDE.md`.

If the task is simple, answer directly.

If the task involves architecture, implementation, audit, memory, or repo changes and no route clearly matches, state the assumed route and proceed conservatively. Ask one concise clarification only if proceeding would risk wrong code or wrong architecture.
