# Agent Operating Layer — Phase 2

> Design spec for improving the `.agent/` layer to address three workflow pain points.
> Approved: 2026-04-26.

---

## Problem

The Phase 1 agent operating layer is implemented but has three critical gaps that cause real workflow pain:

1. **Architecture mistakes ship** — violations of DOCTRINE invariants (wrong ingress paths, bypass routes, approval in wrong layer) are caught in PR review or production, not before code is written.
2. **Context is lost between sessions** — context-compression extracts decisions and lessons but never writes them back. Each session starts without knowledge of prior decisions.
3. **No structured implementation process** — the brainstorming → writing-plans → executing-plans workflow has no architecture checkpoint during code execution. Plans are followed but doctrine is not enforced.

The user is non-technical and works via slash commands (`/brainstorming`, `/writing-plans`, executing-plans). The design must be automatic — not dependent on remembering to trigger checks.

---

## Goals

- Architecture violations blocked before commit, not caught in review
- Decisions and lessons persist across sessions without manual intervention
- Each implementation step validates against DOCTRINE before and after writing code
- Existing slash command workflow is unchanged

---

## Non-Goals

- Observability/performance auditing (Phase 3)
- Legacy cleanup auditing (Phase 3)
- Cross-feature chain auditing (Phase 3)
- External integration verification (Phase 3)

---

## Design

### Section 1: Architecture Gate (pre-commit hook)

**What it does:** Fires automatically after every file edit that touches source code. Runs a focused architecture check before the next step proceeds — catching violations as code is written, not at commit time.

**Hook location:** `.claude/settings.json` — `PostToolUse` hook on Edit/Write tool calls, triggered when the edited file is in `apps/` or `packages/`.

**Check process (from `.agent/skills/architecture-audit/SKILL.md`):**

1. Does any new mutating action bypass `PlatformIngress.submit()`?
2. Does anything write to persistence outside `WorkTrace`?
3. Does any approval logic live in a route instead of the lifecycle service?
4. Does any new async path lack dead-letter handling?

**On violation:** Commit blocked. Surface exact file, line, violation, and recommended fix. Do not continue implementation until resolved.

**On pass:** Silent. No output unless a violation is found.

**Performance:** Adds ~10-15 seconds per file edit on implementation tasks. Only fires on source file edits in `apps/` or `packages/`, not docs or config.

---

### Section 2: Memory Persistence

**Two-part fix:**

#### Part A — Context-compression write-back

Context-compression currently extracts decisions and lessons from a session but produces output only in chat. Fix: make write-back the final step of every significant session.

**Trigger:** As the final step of any session that completes `/brainstorming`, `/writing-plans`, or executing-plans. Also on explicit "compact this session" or "summarize what we learned" request.

**Write targets:**

- Decisions → append to `.agent/memory/semantic/DECISIONS.md`
- Lessons → append to `.agent/memory/semantic/LESSONS.md`
- Failures → append to `.agent/memory/episodic/FAILURES.jsonl`

**Format for DECISIONS.md entries:**

```
| <decision> | <Active/Shipped/Deferred> |
```

**Format for LESSONS.md entries:**

```
- <reusable rule, not episode summary>
```

**Format for FAILURES.jsonl entries:**

```json
{ "date": "YYYY-MM-DD", "failure": "...", "lesson_candidate": "...", "skill": "..." }
```

**Quality bar:** Only distilled content. No raw transcript. No generic observations. No unverified assumptions.

#### Part B — Auto-memory pointer

Add a reference entry in `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md` pointing to `.agent/memory/semantic/` so Switchboard architecture decisions load at every session start.

**Entry to add:**

```
- [Switchboard Agent Decisions](.agent/memory/semantic/DECISIONS.md) — active architecture decisions, shipped items, deferred items
- [Switchboard Lessons](.agent/memory/semantic/LESSONS.md) — reusable rules distilled from past sessions
```

This means current Switchboard architecture decisions and lessons are available at session start without any user action.

---

### Section 3: Implementation Skill

**New file:** `.agent/skills/implementation/SKILL.md`

**Purpose:** Enforce architecture invariants during code execution. Invoked automatically at the start and end of each step in executing-plans.

**When invoked:**

- Before writing any code for a step
- After writing code for a step, before marking it complete

**Pre-write check (3 questions, answer explicitly):**

1. What is the ingress path for any mutating action in this step? Must be `PlatformIngress.submit()`.
2. What is the persistence layer? Must be `WorkTrace` for canonical state.
3. Does this step require governance? If yes, is `GovernanceGate.evaluate()` called exactly once?

If any answer violates DOCTRINE: state the violation, propose the fix, do not write code until resolved.

**Post-write check:**

1. Does the new route flow through `PlatformIngress`?
2. Does it write to `WorkTrace`?
3. Is there a co-located test (`*.test.ts`)?
4. Does the chain compile (`pnpm typecheck`)?

If any check fails: surface it immediately, fix it, re-check. Do not move to the next step.

**Resolver update:**
Add implementation skill to the "Implementation / code changes" resolver route:

```
## Implementation / code changes

**Triggers:** implement this, execution plan, build this, patch plan, code changes

**Load:**
- `docs/DOCTRINE.md`
- `.agent/skills/implementation/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/token-budget.md`
- `.agent/conventions/source-of-truth.md`
```

---

## Directory Changes

```
.agent/
└── skills/
    └── implementation/          ← NEW
        └── SKILL.md
```

`.claude/settings.json` — add PostToolUse hook for architecture gate

`/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md` — add two pointer entries

`.agent/RESOLVER.md` — update implementation route to load implementation skill

---

## What This Does NOT Change

- Existing slash command workflow (`/brainstorming` → `/writing-plans` → executing-plans)
- `.agent/` directory structure beyond adding `skills/implementation/`
- Existing skills (architecture-audit, self-serve-readiness-audit, route-chain-audit, context-compression)
- CLAUDE.md

---

## Acceptance Criteria

1. A commit that adds a mutating route bypassing `PlatformIngress` is blocked with a specific error message
2. After a `/brainstorming` session, decisions appear in `.agent/memory/semantic/DECISIONS.md`
3. At session start, the last 5 decisions from `.agent/memory/semantic/DECISIONS.md` are available without user prompting
4. During executing-plans, each step explicitly answers the 3 pre-write questions before touching a file
5. A step with a missing test or typecheck failure is not marked complete

---

## Not Built in Phase 2

- Observability/performance skill
- Legacy cleanup audit skill
- Cross-feature chain auditing
- External integration verification (Stripe, Meta CAPI)
- Quality rubrics
- Smoke tests
