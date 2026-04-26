---
name: Agent Operating Layer — Phase 3
description: Fills the remaining gaps from the original `.agent/` spec — one new audit skill, a coding-standards convention, deterministic tool scripts, an evals format, and a maintenance checklist. YAGNI-trimmed from the original Phase 3 list (six items dropped as redundant or premature).
---

# Agent Operating Layer — Phase 3

> Approved: 2026-04-26.

## Problem

The Phase 1 spec deferred a set of items "earned later." Phase 2 closed the most painful gaps (architecture gate, memory persistence, implementation skill). The remaining deferred items split into three buckets:

1. **Worth building now** — concrete trigger, doesn't duplicate existing skills.
2. **Redundant** — overlaps with skills that already shipped (governance-redline duplicates architecture-audit + implementation; test-plan duplicates `superpowers:test-driven-development`).
3. **Premature** — needs a runner or external dependency that doesn't exist yet (full smoke-test/quality-rubric suite without a runner is documentation, not eval).

This spec only builds bucket 1. It documents bucket 3 minimally so future work has a slot to drop into.

## Goals

- Approval-state mutations outside the lifecycle service are caught quickly via a focused audit skill.
- Code-level rules are loadable as a single convention file so the implementation skill picks them up on every code step.
- Common architecture checks shift from latent reasoning to deterministic scripts where possible.
- The agent operating layer has a place to grow evals and maintenance work without re-deciding shape each time.

## Non-Goals

- Test-plan generator skill (TDD skill already covers it).
- Governance-redline skill (architecture-audit + Phase 2 implementation skill already cover it).
- A `deterministic-vs-latent` standalone convention (folded into coding-standards as a section).
- An eval runner. Smoke-tests and quality-rubrics are read, not executed, in this phase.
- Anything in `apps/` or `packages/`. This spec only changes `.agent/` and `docs/`.

---

## Design

### Section 1 — `.agent/skills/approval-lifecycle-audit/SKILL.md`

**Purpose:** Trace approval state transitions end-to-end. Catches bugs where approval is created or resolved in a route handler instead of the lifecycle service.

**When invoked:** Resolver triggers — "approval flow", "approval bug", "approval state", "approve action", "lifecycle state". May also be invoked by architecture-audit when it detects approval-adjacent code.

**Skill body — checklist:**

1. List every code path that creates a pending approval. Each must go through the lifecycle service, not a direct DB write.
2. List every code path that resolves an approval (approve / reject / expire). Each must go through the lifecycle service.
3. For each route handler involved: it should only *read* approval state. Mutation in a route handler is a violation.
4. Each transition must be recorded in `WorkTrace`.
5. The corresponding test must exercise the full path (request → resolve → side effect), not just the route handler.

**Run-first step:** Before reasoning, run `.agent/tools/check-approval-in-routes.sh` and incorporate its output as the starting list of suspect locations.

**Output shape:** `file:line — violation — proposed fix` per finding. Empty output if clean.

---

### Section 2 — `.agent/conventions/coding-standards.md`

**Purpose:** A single terse file the implementation skill loads on every code step. Mirrors CLAUDE.md "Code Basics" and adds rules that don't belong in the constitution.

**Contents (one page):**

1. **Source-of-truth note.** If this file conflicts with CLAUDE.md, CLAUDE.md wins.
2. **Code basics.** ESM, `.js` in relative imports, no `console.log`, no `any`, prefix unused with `_`, prettier (semi, double quotes, 2-space, trailing commas, 100 char), file-size error/warn at 600/400, coverage 55/50/52/55 (core 65/65/70/65).
3. **Test discipline.** Co-located `*.test.ts` per new module. No skipped tests without a linked issue. `pnpm test` and `pnpm typecheck` clean before commit.
4. **Deterministic before latent.** When a check can be expressed as a script (grep, AST query, type assertion, fixture), write the script in `.agent/tools/` and call it. Reserve LLM reasoning for judgment calls.
5. **Imports & layering.** Respect dependency layers (CLAUDE.md). No circular dependencies. No new abstraction when an existing util fits.
6. **Naming.** Match neighboring files. >3 new files for one task needs explicit justification.

---

### Section 3 — `.agent/tools/`

**Purpose:** Deterministic scripts that audit skills run before reasoning. New scripts shift checks from latent → deterministic.

**Initial files:**

- `README.md` — when to add a script, how a skill invokes it, naming, output format (machine-grep-friendly: `path:line: message`).
- `check-ingress-paths.sh` — flags mutating route handlers (`POST | PUT | PATCH | DELETE`) under `apps/*/src/routes` and `apps/*/routes` that don't reference `PlatformIngress.submit`. **Includes an allowlist** so the script flags suspicious production routes, not mechanically required-everywhere routes.
- `check-approval-in-routes.sh` — flags writes to approval state inside route handler files (assignments to `approval*`, `Approval*` create/update calls, lifecycle state writes outside `LifecycleService`).

**check-ingress-paths.sh allowlist (commented in the script):**

Routes legitimately *not* required to call `PlatformIngress.submit`:

- Auth / session handlers (login, logout, callback, csrf).
- Health, setup, internal admin routes (e.g., `/health`, `/setup/*`, `/admin/*`).
- Approval lifecycle response routes that correctly use `PlatformLifecycle`.
- Test fixtures and mocks.
- Routes explicitly documented as non-business-state mutation (e.g., preference toggles, UI-only state).

The allowlist is expressed as path patterns (regex over the file path). Adding a route to the allowlist requires a one-line comment explaining why. The script's job is to surface candidates for review, not to gatekeep.

**Output format (both scripts):** `path:line: message` lines, exit 0 on clean, exit 1 on findings. Skills incorporate the output verbatim.

---

### Section 4 — `.agent/evals/` shape (README + one smoke-test fixture)

**Purpose:** Establish the format so future evals slot in without re-deciding shape. No runner is built in this phase — these are read by Claude during a session, not executed by CI.

**Files:**

- `evals/README.md` — describes three eval kinds: `resolver-evals.json` (already exists; routes-against-prompts), `smoke-tests/` (skill output against a fixture with a known answer), `quality-rubrics/` (JSON checklists scoring an output). Notes the absence of a runner and that humans/Claude execute these manually for now.
- `evals/smoke-tests/architecture-audit-smoke.md` — one fixture: a synthetic snippet with one known DOCTRINE violation, plus the expected finding from architecture-audit. Demonstrates the format on paper (no runner) so the next smoke test is mechanical to write.

`quality-rubrics/` is **not** created in this phase. It would be empty and is documented in the README as "future."

---

### Section 5 — `.agent/maintenance/monthly-checklist.md`

**Purpose:** Single-page checklist for periodic upkeep. Human or Claude works through it.

**Items:**

- Prune `DECISIONS.md` entries marked Superseded older than 90 days.
- Review `LESSONS.md` for duplicates; merge.
- Review `FAILURES.jsonl`; promote recurring failures into LESSONS or INVARIANTS.
- Run all `.agent/tools/` scripts; ensure they still parse the current codebase shape (no false positives from renamed dirs).
- Re-run `resolver-evals.json`; fix drift.

---

### Section 6 — `.agent/RESOLVER.md` updates

**New route:**

```
## Approval lifecycle audit

**Triggers:** approval flow, approval bug, approval state, approve action, lifecycle state, approval in route

**Run first:**
- `.agent/tools/check-approval-in-routes.sh`

**Load:**
- `docs/DOCTRINE.md`
- `.agent/skills/approval-lifecycle-audit/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/source-of-truth.md`
- `.agent/memory/semantic/DECISIONS.md`
```

**Updated route — Architecture audit:**

Add to the existing route:

```
**Run first:**
- `.agent/tools/check-ingress-paths.sh`
```

**Updated route — Implementation / code changes:**

Add to the existing load list:

```
- `.agent/conventions/coding-standards.md`
```

---

## Directory Changes

```
.agent/
├── skills/
│   └── approval-lifecycle-audit/   ← NEW
│       └── SKILL.md
├── conventions/
│   └── coding-standards.md         ← NEW
├── tools/                          ← NEW
│   ├── README.md
│   ├── check-ingress-paths.sh
│   └── check-approval-in-routes.sh
├── evals/
│   ├── README.md                   ← NEW
│   └── smoke-tests/                ← NEW
│       └── architecture-audit-smoke.md
└── maintenance/                    ← NEW
    └── monthly-checklist.md
```

`.agent/skills/_index.md` — add `approval-lifecycle-audit` entry.

`.agent/RESOLVER.md` — add approval-lifecycle-audit route; add `Run first` to architecture-audit; add `coding-standards.md` to implementation route's load list.

No changes to `apps/` or `packages/`. No changes to CLAUDE.md.

---

## What This Phase Does NOT Build

- `governance-redline` skill (redundant with architecture-audit + implementation).
- `test-plan` skill (redundant with `superpowers:test-driven-development`).
- `deterministic-vs-latent.md` standalone convention (absorbed into coding-standards).
- Eval runner / CI integration for smoke-tests or quality-rubrics.
- `quality-rubrics/` directory contents.
- Additional tool scripts beyond the two listed.

---

## Acceptance Criteria

1. After running `.agent/tools/check-ingress-paths.sh` against the current `main`, output is either empty or every flagged file is justifiable. No production mutating route is silently missing from review without a documented allowlist reason.
2. After running `.agent/tools/check-approval-in-routes.sh`, output is either empty or each finding is a real candidate for the approval-lifecycle-audit skill.
3. Resolver loads `coding-standards.md` on the implementation route. The implementation skill (Phase 2) picks it up on the next code step.
4. Approval-lifecycle-audit route triggers correctly on each documented keyword (verified by adding the route to `resolver-evals.json` and re-running it).
5. `evals/README.md` and the example smoke test exist; the format is concrete enough that adding a second smoke test requires no design.
6. Monthly checklist exists and is short enough to actually be read.

---

## Implementation Report (filled in by the implementer at end of work)

After the work is complete, the implementer reports:

1. Files created or changed (full list).
2. Exact RESOLVER.md route changes (diff or before/after).
3. Exact scripts added (paths + line counts).
4. Sample output from both scripts run against `main` (a few representative lines, with any allowlisted paths called out).
5. Allowlisted routes and the one-line reason per route.
