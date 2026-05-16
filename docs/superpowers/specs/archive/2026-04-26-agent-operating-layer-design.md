# Agent Operating Layer (`.agent/`)

> Design spec for adding a structured AI operating layer to the Switchboard repo.
> Approved: 2026-04-26. Refined: 2026-04-26.

---

## Problem

CLAUDE.md carries architecture enforcement rules, project memory pointers, task capsule formats, tool gating, and write-back instructions that load every session regardless of task type. Architecture decisions and lessons are scattered across ~40 harness memory files outside the repo, creating tool lock-in and drift risk. When Claude makes the same mistake twice, the only fix is a "please remember" prompt — no structural prevention.

## Goal

Give AI agents a disciplined way to understand doctrine, load only relevant context, run deterministic checks, and stop repeating mistakes — without bloating every session's context window.

## Approach

**Skeleton + earned additions.** Ship the structural core (resolver, 4 proven skills, conventions, seeded memory, evals) in Phase 1. Add skills, tools, smoke tests, and quality rubrics only when real sessions reveal the need.

## Boundary

`.agent/` is an AI-assisted build layer for Switchboard.

- It is not product runtime code.
- It is not loaded by the Switchboard application.
- It does not define customer-facing Alex behavior.
- It does not replace the product `skills/` directory.

---

## Architecture

### Core Principle

CLAUDE.md is a router, not the whole brain. Progressive disclosure: the resolver routes to specific skills/context based on task type. Claude loads one skill at a time, reads only matched conventions, and writes back only decisions/failures/lessons.

### Flow

```
Small CLAUDE.md (50-70 lines)
      ↓
RESOLVER.md decides task type via keyword triggers
      ↓
Load one relevant skill
      ↓
Read only required doctrine/convention files
      ↓
Run deterministic repo checks (when available)
      ↓
Claude reasons on compact evidence
      ↓
Write back only decisions/failures/lessons
```

### Operating Loop

1. **Ingest:** After important sessions, use `context-compression` to save only durable decisions, lessons, failures, open questions, and next actions.
2. **Query:** Use `RESOLVER.md` to load only the relevant skill, convention, and memory for the task.
3. **Lint:** When repeated confusion appears, add or revise a skill, convention, resolver route, or eval. Do not add reminders.

### Token Budget Impact

| Mechanism                             | Saving                                          |
| ------------------------------------- | ----------------------------------------------- |
| Smaller CLAUDE.md (196 → 50-70 lines) | ~65% reduction in always-loaded context         |
| Resolver routes to one skill          | Avoids loading all skills/conventions           |
| Skill index (one-line summaries)      | Avoids loading full skill content speculatively |
| Deterministic tools (future)          | Replaces long manual code inspection            |
| Semantic memory                       | Stores distilled lessons, not transcripts       |
| Evals                                 | Prevents repeated correction loops              |

---

## Directory Structure (Phase 1)

```
.agent/
├── README.md
├── RESOLVER.md
├── ACCESS_POLICY.md
│
├── memory/
│   ├── working/                       # GITIGNORED
│   │   └── ACTIVE_TASK.md
│   ├── episodic/
│   │   └── FAILURES.jsonl
│   └── semantic/
│       ├── DECISIONS.md
│       ├── LESSONS.md
│       └── INVARIANTS.md
│
├── skills/
│   ├── _index.md
│   ├── architecture-audit/
│   │   └── SKILL.md
│   ├── self-serve-readiness-audit/
│   │   └── SKILL.md
│   ├── route-chain-audit/
│   │   └── SKILL.md
│   └── context-compression/
│       └── SKILL.md
│
├── conventions/
│   ├── source-of-truth.md
│   ├── architecture-invariants.md
│   ├── token-budget.md
│   ├── launch-readiness.md
│   └── evidence-standard.md
│
└── evals/
    └── resolver-evals.json
```

### Gitignore

```
.agent/memory/working/
```

### Not in Phase 1 (earned later)

- Skills: approval-lifecycle-audit, governance-redline, implementation-plan, test-plan
- Tool scripts (`.agent/tools/`)
- Smoke tests (`.agent/evals/smoke-tests/`)
- Quality rubrics (`.agent/evals/quality-rubrics/`)
- Maintenance checklists (`.agent/maintenance/`)

---

## RESOLVER.md

The resolver is advisory, not programmatic. Claude reads it and follows it. Trigger keywords are structured enough to parse later if enforcement is needed.

### Architecture audit

**Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

**Load:**

- `docs/DOCTRINE.md`
- `.agent/skills/architecture-audit/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/source-of-truth.md`
- `.agent/memory/semantic/DECISIONS.md`
- `.agent/memory/semantic/INVARIANTS.md`

### Self-serve readiness audit

**Triggers:** onboarding, signup, first agent live, launch Alex, go live, channel connect, self-serve, hidden founder intervention

**Load:**

- `.agent/skills/self-serve-readiness-audit/SKILL.md`
- `.agent/conventions/launch-readiness.md`
- `.agent/conventions/evidence-standard.md`
- `.agent/memory/semantic/LESSONS.md`

### Route-chain audit

**Triggers:** route, hook, proxy, backend, store, 404, broken endpoint, no-op callback, stub, missing persistence, button works but nothing saves

**Load:**

- `.agent/skills/route-chain-audit/SKILL.md`
- `.agent/conventions/evidence-standard.md`
- `.agent/conventions/token-budget.md`

### Implementation / code changes

**Triggers:** implement this, execution plan, build this, patch plan, code changes

**Load:**

- `docs/DOCTRINE.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/token-budget.md`
- `.agent/conventions/source-of-truth.md`

No dedicated implementation skill in Phase 1.

### Context compression

**Triggers:** summarize this session, compact, reduce token, memory update, what did we learn

**Load:**

- `.agent/skills/context-compression/SKILL.md`
- `.agent/memory/semantic/LESSONS.md`
- `.agent/memory/semantic/DECISIONS.md`

### Default

Load nothing beyond CLAUDE.md.

If the task is simple, answer directly.

If the task involves architecture, implementation, audit, memory, or repo changes and no route clearly matches, state the assumed route and proceed conservatively. Ask one concise clarification only if proceeding would risk wrong code or wrong architecture.

---

## Skills (Phase 1)

All skills must include: Purpose, Use when, Inputs, Process, Output format, Quality bar, Failure modes, Done when.

### architecture-audit

**Purpose:** Audit Switchboard architecture against product doctrine and runtime invariants.

**Must check:**

- PlatformIngress entry
- Lifecycle state ownership
- WorkTrace canonicality
- Idempotency
- Approval path
- Retry/failure path
- Bypass surfaces
- Architecture drift

**Output:** Verdict, what is correct, P0/P1/P2 findings with exact evidence, customer/product impact, recommended fix, acceptance criteria, tests required.

**Quality bar:** No claims without file evidence. No generic praise. No broad rewrite unless needed.

### self-serve-readiness-audit

**Purpose:** Check whether a real customer can reach value without founder intervention.

**Must audit:** Landing/signup, org provisioning, website scan, training/playbook, test center, channel connection, go-live activation, first inbound message, agent response, booking/revenue outcome.

**For each step check:** Frontend route, hook/client, proxy, backend route, store/service persistence, no-op callbacks, stubs, env gates, hidden manual setup, customer-facing error state.

**Output:** Journey status, P0/P1/P2 findings, broken chain table, hidden manual debt, customer impact, fix plan, acceptance criteria.

### route-chain-audit

**Purpose:** Trace a user-facing action from UI to persistence/external effect.

**Required chain:** Frontend page/component → hook/client → dashboard proxy if applicable → backend route → service/store → database/external provider if applicable.

**Must flag:** Missing route, mismatched path, no-op callback, stub handler, missing persistence, fake success state, missing error state.

**Output table:** Step | Expected | Actual | Status | Evidence

### context-compression

**Purpose:** Compress long sessions into durable Switchboard memory.

**Output only:** Decisions, lessons, failures, invariants updated, open questions, next actions, skill/tool/eval candidates.

**Do not store:** Full transcripts, repeated explanation, generic praise, unverified assumptions.

---

## Conventions (Phase 1)

### source-of-truth.md

1. `docs/DOCTRINE.md` is canonical for architecture doctrine.
2. Source code is canonical for implemented behavior.
3. `.agent/memory/semantic/DECISIONS.md` records project decisions.
4. `.agent/memory/semantic/INVARIANTS.md` is quick reference only.
5. `.agent/skills/*/SKILL.md` defines process, not product truth.
6. External harness memory is context, not repo truth.

### architecture-invariants.md

Core architecture invariants only (no code hygiene rules):

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

### token-budget.md

- CLAUDE.md is a map.
- Use RESOLVER.md before loading context.
- Load skill index before full skills.
- Load one skill at a time.
- Never dump entire repo context.
- Prefer exact file search, tests, typecheck, and scripts for mechanical checks.
- Use AI judgment for tradeoffs, prioritization, synthesis, and explanation.
- Compact long sessions into memory.
- Store decisions/lessons/failures, not transcripts.
- Reset context between unrelated tasks.

### launch-readiness.md

A path is not self-serve-ready if:

- Setup requires manual DB changes
- Button callback is no-op
- API path 404s
- Backend route is stubbed
- State is not persisted
- User cannot recover from error
- External-write path lacks governance
- Customer cannot reach first value

### evidence-standard.md

Every audit finding needs:

- Exact file path
- Exact function/route/component if available
- Observed behavior
- Expected behavior
- Customer/product impact
- Recommended fix
- Validation/test

---

## Memory

### Committed: `.agent/memory/semantic/`

**INVARIANTS.md** — One-line distillation of DOCTRINE.md's 10 non-negotiable invariants. Clearly states `docs/DOCTRINE.md` remains canonical.

**DECISIONS.md** — Seeded from harness memory:

| Decision                                                         | Status   |
| ---------------------------------------------------------------- | -------- |
| Architecture convergence done, mandate is capability building    | Active   |
| Domain logic in markdown skills, governance as thin harness      | Active   |
| SP6 is last runtime SP                                           | Active   |
| Ingress convergence landed (PRs #209-#212)                       | Shipped  |
| Staff view removed, owner-only nav                               | Shipped  |
| Creative-pipeline governance convergence deferred to post-launch | Deferred |

**LESSONS.md** — Seeded:

- Scan-hydrated fields are never ready; only user-confirmed content upgrades.
- Prefer per-section pure functions over monolithic switches.
- Skills should produce decision-ready intelligence with confidence/reasoning signals.
- Prove wedge before system; Alex must prove the conversion loop first.
- Measure booking completion, not link delivery.

### Committed: `.agent/memory/episodic/`

**FAILURES.jsonl** — Starts empty. Each entry: `{"date", "failure", "lesson_candidate", "skill"}`.

### Gitignored: `.agent/memory/working/`

**ACTIVE_TASK.md** — Template with sections: Task, Current focus, Files checked, Open questions, Next action. Cleared between tasks.

### Harness Memory

Do not delete old harness memory files in this phase. Migration happens separately.

---

## ACCESS_POLICY.md

- Read-only repo inspection is allowed.
- Local documentation and `.agent/` memory edits are allowed when requested.
- Source code edits require task context and should follow the implementation/code route.
- External writes, destructive actions, production changes, credential changes, and deployment actions require explicit user approval.
- Never expose secrets.
- Never place secrets in `.agent/` memory.

---

## Evals

### resolver-evals.json

```json
[
  {
    "input": "Audit Switchboard onboarding self-serve readiness",
    "expected_skill": "self-serve-readiness-audit"
  },
  {
    "input": "Check if PlatformIngress is being bypassed by any mutating route",
    "expected_skill": "architecture-audit"
  },
  {
    "input": "Trace this dashboard button from hook to backend store",
    "expected_skill": "route-chain-audit"
  },
  {
    "input": "This button works in the UI but nothing is saved",
    "expected_skill": "route-chain-audit"
  },
  {
    "input": "Compact this long Claude session into durable Switchboard memory",
    "expected_skill": "context-compression"
  },
  {
    "input": "Turn this approved design into a coding execution plan",
    "expected_skill": null,
    "expected_behavior": "Use implementation/code-changes resolver path; no dedicated implementation skill in Phase 1"
  }
]
```

---

## CLAUDE.md Rewrite

196 lines → 50-70 lines.

**Keeps:** Switchboard identity, pointer to `docs/DOCTRINE.md`, pointer to `.agent/RESOLVER.md`, core invariants, essential build/test commands, essential code basics, warning that `.agent/` is build-layer only.

**Removes/migrates:** Architecture Enforcement section (→ conventions), L2 Project Memory, L3 Task Capsule Format, L4 Tool Gating, L5 Write-Back, detailed instructions.

---

## What This Layer Does Not Cover

- Product decisions (marketplace, pricing, agent families) — stay in specs
- Skill authoring for the product (Alex skills, etc.) — stay in product code
- Personal preferences — stay in harness memory
- Cross-project context — stay in harness memory
- External references — stay in harness memory
- Meta/Elyra/Obsidian material — not in this repo

---

## Not Built in Phase 1

- `.agent/tools/`
- `.agent/maintenance/`
- Smoke tests
- Quality rubrics
- WORKSPACE.md
- Personal/cross-project memory
- Wiki/index/log files

The hard rule: if Claude makes the same mistake twice, add a skill, tool, or eval — not a reminder.
