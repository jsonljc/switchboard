# Agent Operating Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `.agent/` directory with resolver, 4 skills, 5 conventions, seeded memory, evals, and rewrite CLAUDE.md from 196 to 50-70 lines.

**Architecture:** All files are markdown or JSON — no TypeScript, no build changes. `.agent/` is a build-layer for AI agents, not product code. CLAUDE.md becomes a router pointing to `.agent/RESOLVER.md` for task-specific context loading.

**Tech Stack:** Markdown, JSON, git

---

### Task 1: Gitignore and directory scaffold

**Files:**

- Modify: `.gitignore`
- Create: `.agent/memory/working/ACTIVE_TASK.md`
- Create: `.agent/memory/episodic/FAILURES.jsonl`

- [ ] **Step 1: Add .agent/memory/working/ to .gitignore**

Append to `.gitignore`:

```
# Agent operating layer — ephemeral working memory
.agent/memory/working/
```

- [ ] **Step 2: Create working memory directory with ACTIVE_TASK.md**

Create `.agent/memory/working/ACTIVE_TASK.md`:

```markdown
# Active Task

## Task

## Current focus

## Files checked

## Open questions

## Next action
```

- [ ] **Step 3: Create empty FAILURES.jsonl**

Create `.agent/memory/episodic/FAILURES.jsonl` as an empty file (no content).

- [ ] **Step 4: Verify gitignore works**

Run:

```bash
git status
```

Expected: `.agent/memory/working/` should NOT appear in untracked files. `.agent/memory/episodic/FAILURES.jsonl` SHOULD appear.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .agent/memory/episodic/FAILURES.jsonl
git commit -m "chore: scaffold .agent/ directory with gitignore for working memory"
```

---

### Task 2: README, ACCESS_POLICY, and RESOLVER

**Files:**

- Create: `.agent/README.md`
- Create: `.agent/ACCESS_POLICY.md`
- Create: `.agent/RESOLVER.md`

- [ ] **Step 1: Create .agent/README.md**

Create `.agent/README.md`:

```markdown
# Switchboard Agent Operating Layer

`.agent/` is an AI-assisted build layer for Switchboard.

- It is not product runtime code.
- It is not loaded by the Switchboard application.
- It does not define customer-facing Alex behavior.
- It does not replace the product `skills/` directory.

## Structure
```

.agent/
├── RESOLVER.md — Task → context router
├── ACCESS_POLICY.md — What actions are allowed
├── memory/ — Project build memory (semantic committed, working gitignored)
├── skills/ — Operational workflows for audits and compression
├── conventions/ — Shared rules for architecture, evidence, and token budget
└── evals/ — Resolver routing correctness checks

```

## Operating Loop

1. **Ingest:** After important sessions, use `context-compression` to save only durable decisions, lessons, failures, open questions, and next actions.
2. **Query:** Use `RESOLVER.md` to load only the relevant skill, convention, and memory for the task.
3. **Lint:** When repeated confusion appears, add or revise a skill, convention, resolver route, or eval. Do not add reminders.
```

- [ ] **Step 2: Create .agent/ACCESS_POLICY.md**

Create `.agent/ACCESS_POLICY.md`:

```markdown
# Access Policy

- Read-only repo inspection is allowed.
- Local documentation and `.agent/` memory edits are allowed when requested.
- Source code edits require task context and should follow the implementation/code route.
- External writes, destructive actions, production changes, credential changes, and deployment actions require explicit user approval.
- Never expose secrets.
- Never place secrets in `.agent/` memory.
```

- [ ] **Step 3: Create .agent/RESOLVER.md**

Create `.agent/RESOLVER.md`:

```markdown
# Switchboard Agent Resolver

Match task to triggers. Load only the listed files.

## Architecture audit

**Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

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

**Triggers:** implement this, execution plan, build this, patch plan, code changes

**Load:**

- `docs/DOCTRINE.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/token-budget.md`
- `.agent/conventions/source-of-truth.md`

No dedicated implementation skill in Phase 1.

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
```

- [ ] **Step 4: Commit**

```bash
git add .agent/README.md .agent/ACCESS_POLICY.md .agent/RESOLVER.md
git commit -m "feat: add agent operating layer — README, access policy, resolver"
```

---

### Task 3: Conventions

**Files:**

- Create: `.agent/conventions/source-of-truth.md`
- Create: `.agent/conventions/architecture-invariants.md`
- Create: `.agent/conventions/token-budget.md`
- Create: `.agent/conventions/launch-readiness.md`
- Create: `.agent/conventions/evidence-standard.md`

- [ ] **Step 1: Create source-of-truth.md**

Create `.agent/conventions/source-of-truth.md`:

```markdown
# Source of Truth

1. `docs/DOCTRINE.md` is canonical for architecture doctrine.
2. Source code is canonical for implemented behavior.
3. `.agent/memory/semantic/DECISIONS.md` records project decisions.
4. `.agent/memory/semantic/INVARIANTS.md` is quick reference only.
5. `.agent/skills/*/SKILL.md` defines process, not product truth.
6. External harness memory is context, not repo truth.
```

- [ ] **Step 2: Create architecture-invariants.md**

Create `.agent/conventions/architecture-invariants.md`:

```markdown
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
```

- [ ] **Step 3: Create token-budget.md**

Create `.agent/conventions/token-budget.md`:

```markdown
# Token Budget

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
```

- [ ] **Step 4: Create launch-readiness.md**

Create `.agent/conventions/launch-readiness.md`:

```markdown
# Launch Readiness

A path is not self-serve-ready if:

- Setup requires manual DB changes.
- Button callback is no-op.
- API path 404s.
- Backend route is stubbed.
- State is not persisted.
- User cannot recover from error.
- External-write path lacks governance.
- Customer cannot reach first value.
```

- [ ] **Step 5: Create evidence-standard.md**

Create `.agent/conventions/evidence-standard.md`:

```markdown
# Evidence Standard

Every audit finding needs:

- Exact file path.
- Exact function/route/component if available.
- Observed behavior.
- Expected behavior.
- Customer/product impact.
- Recommended fix.
- Validation/test.
```

- [ ] **Step 6: Commit**

```bash
git add .agent/conventions/
git commit -m "feat: add agent conventions — source-of-truth, invariants, token-budget, launch-readiness, evidence-standard"
```

---

### Task 4: Skills

**Files:**

- Create: `.agent/skills/_index.md`
- Create: `.agent/skills/architecture-audit/SKILL.md`
- Create: `.agent/skills/self-serve-readiness-audit/SKILL.md`
- Create: `.agent/skills/route-chain-audit/SKILL.md`
- Create: `.agent/skills/context-compression/SKILL.md`

- [ ] **Step 1: Create \_index.md**

Create `.agent/skills/_index.md`:

```markdown
# Switchboard Skills Index

Load full skills only when resolver triggers match.

## architecture-audit

Audits Switchboard architecture against DOCTRINE.md and core invariants.

## self-serve-readiness-audit

Checks whether a real customer can go from signup to first live agent without hidden manual setup.

## route-chain-audit

Traces frontend hook → proxy → backend route → store/service.

## context-compression

Compacts long sessions into decisions, lessons, failures, and next actions.
```

- [ ] **Step 2: Create architecture-audit/SKILL.md**

Create `.agent/skills/architecture-audit/SKILL.md`:

```markdown
# Skill: Architecture Audit

## Purpose

Audit Switchboard architecture against product doctrine and runtime invariants.

## Use when

- PlatformIngress is mentioned
- WorkTrace is mentioned
- Runtime convergence is being changed
- Mutating surfaces are being added
- Routes may bypass lifecycle/governance

## Inputs

- User request
- Relevant source files
- `docs/DOCTRINE.md`
- `.agent/memory/semantic/INVARIANTS.md`
- `.agent/memory/semantic/DECISIONS.md`

## Process

1. Identify the architecture area.
2. Read `docs/DOCTRINE.md`.
3. Read relevant invariants and prior decisions.
4. Locate code paths with exact file evidence.
5. Check whether mutating actions enter through PlatformIngress.
6. Check whether lifecycle state is owned centrally, not by routes.
7. Check whether WorkTrace remains canonical.
8. Check idempotency, approval, retry, and failure paths.
9. Check for bypass surfaces and architecture drift.
10. Classify issues P0/P1/P2.
11. Recommend minimal fix and tests.

## Output

- Verdict
- What is correct
- P0/P1/P2 findings with exact evidence
- Customer/product impact
- Recommended fix
- Acceptance criteria
- Tests required

## Quality bar

- No claims without file evidence.
- No generic praise.
- No broad rewrite unless needed.
- Every finding cites exact file path and function.

## Failure modes

- Guessing implementation exists without checking source code.
- Reviewing only one layer (e.g., only routes, not stores).
- Recommending architecture changes that violate DOCTRINE.md.
- Missing bypass surfaces because only the happy path was traced.

## Done when

- Every invariant from architecture-invariants.md has been checked against the target area.
- All findings have exact file evidence.
- Recommendations are minimal and testable.
```

- [ ] **Step 3: Create self-serve-readiness-audit/SKILL.md**

Create `.agent/skills/self-serve-readiness-audit/SKILL.md`:

```markdown
# Skill: Self-Serve Readiness Audit

## Purpose

Check whether a real customer can reach value without founder intervention.

## Use when

- Onboarding flow is being reviewed
- Signup or go-live is mentioned
- Channel connection is being checked
- Self-serve readiness is questioned
- Hidden founder intervention is suspected

## Inputs

- User request specifying journey or step to audit
- Dashboard source files (`apps/dashboard/`)
- API source files (`apps/api/`)
- `.agent/conventions/launch-readiness.md`
- `.agent/conventions/evidence-standard.md`

## Process

Audit journey step by step:

1. Landing / signup.
2. Org/account provisioning.
3. Website scan / business facts.
4. Training/playbook setup.
5. Test center.
6. Channel connection.
7. Go-live activation.
8. First inbound message.
9. Agent response.
10. Booking/revenue outcome if relevant.

For each step check:

- Frontend route exists.
- Hook calls real API.
- Proxy exists if dashboard route.
- Backend route exists.
- Store/service persists state.
- No-op callbacks.
- Stubs.
- Env gates.
- Hidden manual setup.
- Customer-facing error state.

## Output

- Journey status (step-by-step table)
- P0/P1/P2 findings
- Broken chain table (step | expected | actual | status | evidence)
- Hidden manual debt
- Customer impact
- Fix plan
- Acceptance criteria

## Quality bar

- Every step in the journey is checked, not just the ones that look broken.
- No-op callbacks and stubs are explicitly flagged, not assumed to work.
- Hidden manual setup is identified by checking whether state requires DB seeds or env flags.

## Failure modes

- Only auditing frontend without checking backend persistence.
- Assuming a hook works because it exists, without checking what it calls.
- Missing env gates that silently disable features.
- Skipping the booking/revenue outcome step.

## Done when

- Every journey step has been checked with exact file evidence.
- All broken chains are documented in the output table.
- Customer impact is stated for each finding.
```

- [ ] **Step 4: Create route-chain-audit/SKILL.md**

Create `.agent/skills/route-chain-audit/SKILL.md`:

```markdown
# Skill: Route Chain Audit

## Purpose

Trace a user-facing action from UI to persistence/external effect.

## Use when

- A button or action needs verification end-to-end
- A route is suspected broken, stubbed, or no-op
- A feature "works in the UI but nothing is saved"
- Backend store or persistence is in question

## Inputs

- User request identifying the action to trace
- Dashboard source files
- API source files
- Store/service source files

## Process

1. Identify the user-facing action.
2. Find the frontend component/page.
3. Find the hook/client call.
4. Verify the API path matches.
5. Verify proxy route if dashboard uses one.
6. Verify backend route exists and handles the method.
7. Verify handler calls real service/store.
8. Verify persistence or external effect.
9. Flag stubs, no-ops, mismatched paths, fake success states, and missing error states.

## Required chain
```

frontend page/component
→ hook/client
→ dashboard proxy (if applicable)
→ backend route
→ service/store
→ database/external provider (if applicable)

```

## Output

| Step | Expected | Actual | Status | Evidence |
|------|----------|--------|--------|----------|

Status values: PASS, FAIL, STUB, NO-OP, MISSING

## Quality bar

- Every step in the chain is checked, not just the first and last.
- Mismatched API paths between frontend and backend are caught.
- Stub handlers that return 200 with no side effect are flagged.

## Failure modes

- Checking only the frontend layer.
- Assuming a proxy route works because the backend route exists.
- Missing that a handler returns success without calling any store.
- Not checking error/failure paths.

## Done when

- The full chain from UI to persistence is documented.
- Every step has exact file evidence.
- All broken links are classified by severity.
```

- [ ] **Step 5: Create context-compression/SKILL.md**

Create `.agent/skills/context-compression/SKILL.md`:

```markdown
# Skill: Context Compression

## Purpose

Compress long sessions into durable Switchboard memory.

## Use when

- A session has produced important decisions or lessons
- Context window is growing large
- Switching to a new task
- User asks to summarize or compact

## Inputs

- Current session context
- `.agent/memory/semantic/LESSONS.md`
- `.agent/memory/semantic/DECISIONS.md`

## Process

1. Review session for durable content.
2. Extract decisions (what was decided and why).
3. Extract lessons (what was learned that applies to future work).
4. Extract failures (what went wrong and what structural fix prevents recurrence).
5. Identify invariant updates if any.
6. Identify open questions.
7. Identify next actions.
8. Identify skill/tool/eval candidates (repeated patterns that should become structural).
9. Append to the relevant `.agent/memory/semantic/` file.

## Output

- Decisions (append to DECISIONS.md)
- Lessons (append to LESSONS.md)
- Failures (append to FAILURES.jsonl)
- Invariants updated (if any)
- Open questions
- Next actions
- Skill/tool/eval candidates

## Do not store

- Full transcripts.
- Repeated explanation.
- Generic praise.
- Unverified assumptions.
- Personal preferences (those belong in harness memory).

## Quality bar

- Every extracted item is specific and actionable.
- Decisions include rationale.
- Lessons are stated as reusable rules, not episode summaries.

## Failure modes

- Storing raw session transcript instead of distilled content.
- Including generic observations ("we had a productive session").
- Missing a decision that was made implicitly.
- Storing assumptions as facts.

## Done when

- All durable content from the session is captured in the appropriate memory file.
- No transcript content remains — only distilled decisions, lessons, and failures.
```

- [ ] **Step 6: Commit**

```bash
git add .agent/skills/
git commit -m "feat: add agent skills — architecture-audit, self-serve-readiness, route-chain, context-compression"
```

---

### Task 5: Semantic memory

**Files:**

- Create: `.agent/memory/semantic/INVARIANTS.md`
- Create: `.agent/memory/semantic/DECISIONS.md`
- Create: `.agent/memory/semantic/LESSONS.md`

- [ ] **Step 1: Create INVARIANTS.md**

Create `.agent/memory/semantic/INVARIANTS.md`:

```markdown
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
```

- [ ] **Step 2: Create DECISIONS.md**

Create `.agent/memory/semantic/DECISIONS.md`:

```markdown
# Switchboard Decisions

## Architecture convergence done

**Decision:** Architecture convergence is complete. Mandate is capability building, not more architecture passes.
**Status:** Active

## Thin harness, fat skills

**Decision:** Domain logic lives in markdown skills. Governance stays as a thin harness.
**Status:** Active

## SP6 is the last runtime SP

**Decision:** Skill Runtime Unification (SP6) is the final runtime sub-project. No more runtime SPs after this.
**Status:** Active

## Ingress convergence landed

**Decision:** All ingress convergence commits landed via PRs #209-#212.
**Status:** Shipped

## Staff view removed

**Decision:** Staff view removed, owner-only nav, footer trimmed, dead links cleaned.
**Status:** Shipped

## Creative-pipeline governance deferred

**Decision:** Creative-pipeline.ts governance convergence deferred to post-launch. Ad-optimizer is launch-critical.
**Status:** Deferred
```

- [ ] **Step 3: Create LESSONS.md**

Create `.agent/memory/semantic/LESSONS.md`:

```markdown
# Switchboard Lessons

- Scan-hydrated fields are never ready; only user-confirmed content upgrades.
- Prefer per-section pure functions over monolithic switches.
- Skills should produce decision-ready intelligence with confidence/reasoning signals.
- Prove wedge before system; Alex must prove the conversion loop first.
- Measure booking completion, not link delivery.
```

- [ ] **Step 4: Commit**

```bash
git add .agent/memory/semantic/
git commit -m "feat: seed agent semantic memory — invariants, decisions, lessons"
```

---

### Task 6: Evals

**Files:**

- Create: `.agent/evals/resolver-evals.json`

- [ ] **Step 1: Create resolver-evals.json**

Create `.agent/evals/resolver-evals.json`:

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

- [ ] **Step 2: Commit**

```bash
git add .agent/evals/
git commit -m "feat: add agent resolver evals"
```

---

### Task 7: Rewrite CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

This is the most critical task. The current CLAUDE.md is 196 lines. The target is 50-70 lines.

**What stays (compressed):** Switchboard identity, pointer to DOCTRINE.md, pointer to .agent/RESOLVER.md, core invariants (one-liners), essential build/test commands, essential code basics, .agent/ boundary warning.

**What moves out:**

- Architecture Enforcement section (lines 101-135) → already in `.agent/conventions/architecture-invariants.md`
- L2 Project Memory (lines 154-161) → resolver handles context loading
- L3 Task Capsule Format (lines 163-176) → removed (not needed with resolver)
- L4 Tool Gating (lines 178-185) → `.agent/conventions/token-budget.md`
- L5 Write-Back (lines 187-196) → `.agent/skills/context-compression/SKILL.md`

- [ ] **Step 1: Replace CLAUDE.md with the rewritten version**

Replace the entire contents of `CLAUDE.md` with:

```markdown
# Switchboard — Claude Code Instructions

Governed operating system for revenue actions (TypeScript monorepo, pnpm + Turborepo).

For architectural rules: `docs/DOCTRINE.md`
For deep architecture: `docs/ARCHITECTURE.md`

## Agent Operating Layer

Before architecture work, audits, or implementation planning:

1. Read `.agent/RESOLVER.md` to identify task type.
2. Load only the files the resolver specifies.
3. Use deterministic tools before reasoning manually.
4. Keep context lean. Do not load unrelated files.

`.agent/` is a build layer for AI agents. It is not product code, not loaded by the app, and does not replace the product `skills/` directory.

## Core Invariants

- Mutating actions enter through `PlatformIngress.submit()`.
- `WorkTrace` is canonical persistence.
- Approval is lifecycle state, not a route-owned side effect.
- Tools are audited, idempotent product surfaces.
- Human escalation is first-class architecture.
- No mutating bypass paths.

## Codebase Map
```

packages/schemas/ — Zod schemas & shared types (no internal deps)
packages/sdk/ — Agent manifest, handler interface, test harness
packages/cartridge-sdk/ — Legacy cartridge interface (pending removal)
packages/creative-pipeline/ — Creative content pipeline (async jobs via Inngest)
packages/ad-optimizer/ — Ad platform integration + optimization
packages/core/ — Platform ingress, governance, skill runtime, orchestration
packages/db/ — Prisma ORM, store implementations, credential encryption

apps/api/ — Fastify REST API (port 3000)
apps/chat/ — Multi-channel chat — Telegram, WhatsApp, Slack (port 3001)
apps/dashboard/ — Next.js UI + operator controls (port 3002)
apps/mcp-server/ — MCP server for LLM tool use

```

## Dependency Layers

```

Layer 1: schemas → No @switchboard/_ imports
Layer 2: cartridge-sdk, sdk, creative-pipeline, ad-optimizer → schemas only
Layer 3: core → schemas + cartridge-sdk + sdk
Layer 4: db → schemas + core
Layer 5: apps/_ → May import anything

````

Circular dependencies are forbidden.

## Build / Test / Lint

```bash
pnpm build                        # Build all (Turbo)
pnpm lint                         # Lint all
pnpm test                         # Run all tests
pnpm typecheck                    # TypeScript type checking
pnpm --filter @switchboard/core test  # Single package
pnpm db:generate                  # Generate Prisma client
pnpm db:migrate                   # Run migrations
````

## Code Basics

- ESM only, `.js` extensions in relative imports (except Next.js)
- Unused variables prefixed with `_`
- No `console.log` — use `console.warn` or `console.error`
- No `any` — use proper types or `unknown`
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width
- Conventional Commits enforced by commitlint
- Every new module must include co-located tests (`*.test.ts`)
- Run `pnpm test` and `pnpm typecheck` before committing

## Environment Variables

See `.env.example`. Never commit `.env` files or secrets.

````

- [ ] **Step 2: Verify line count**

Run:
```bash
wc -l CLAUDE.md
````

Expected: 65-75 lines.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "refactor: rewrite CLAUDE.md as compact router — 196 to ~65 lines"
```

---

### Task 8: Final validation

- [ ] **Step 1: Verify all files exist**

Run:

```bash
find .agent -type f | sort
```

Expected output:

```
.agent/ACCESS_POLICY.md
.agent/README.md
.agent/RESOLVER.md
.agent/conventions/architecture-invariants.md
.agent/conventions/evidence-standard.md
.agent/conventions/launch-readiness.md
.agent/conventions/source-of-truth.md
.agent/conventions/token-budget.md
.agent/evals/resolver-evals.json
.agent/memory/episodic/FAILURES.jsonl
.agent/memory/semantic/DECISIONS.md
.agent/memory/semantic/INVARIANTS.md
.agent/memory/semantic/LESSONS.md
.agent/skills/_index.md
.agent/skills/architecture-audit/SKILL.md
.agent/skills/context-compression/SKILL.md
.agent/skills/route-chain-audit/SKILL.md
.agent/skills/self-serve-readiness-audit/SKILL.md
```

That is 18 committed files. `.agent/memory/working/ACTIVE_TASK.md` exists locally but is gitignored.

- [ ] **Step 2: Verify working memory is gitignored**

Run:

```bash
git status .agent/memory/working/
```

Expected: No output (directory is ignored).

- [ ] **Step 3: Verify CLAUDE.md line count**

Run:

```bash
wc -l CLAUDE.md
```

Expected: 65-75 lines.

- [ ] **Step 4: Verify no unintended files**

Run:

```bash
git status
```

Expected: Clean working tree (all changes committed).

- [ ] **Step 5: Produce validation report**

Print this report:

```
## Validation Report

1. Files created: 19 (18 committed + 1 gitignored)
2. Files modified: 2 (CLAUDE.md, .gitignore)
3. CLAUDE.md line count: before=196, after=~75
4. Migrated from CLAUDE.md:
   - Architecture Enforcement → .agent/conventions/architecture-invariants.md
   - Tool Gating → .agent/conventions/token-budget.md
   - Write-Back → .agent/skills/context-compression/SKILL.md
   - Project Memory pointers → resolver handles
   - Task Capsule Format → removed (not needed)
5. Intentionally not added:
   - .agent/tools/ (earned later)
   - .agent/maintenance/ (earned later)
   - Smoke tests, quality rubrics
   - WORKSPACE.md
   - Personal/cross-project memory
   - coding-standards.md, deterministic-vs-latent.md
6. Route-chain-audit included in Phase 1 because it is a proven pattern
   from recent audit work and was requested in the refined spec.
7. .agent/memory/working/ is gitignored: YES
8. Risks/open follow-ups:
   - Harness memory migration (removing 6 project files) is a separate task
   - Future skills (approval-lifecycle, governance-redline, implementation-plan, test-plan)
     will be added when real sessions trigger them
   - Tool scripts will be added when manual checks repeat 3+ times
```
