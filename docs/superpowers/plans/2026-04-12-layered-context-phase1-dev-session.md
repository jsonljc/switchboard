# Layered Context Discipline — Phase 1: Dev Session Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Switchboard's CLAUDE.md into five named context layers and add a git-ignored CLAUDE.local.md that bridges the second brain wiki and memory files into dev sessions.

**Architecture:** Config-only changes — no code. CLAUDE.md gets five labelled sections (doctrine, project memory, task capsule format, tool gating, write-back) preserving all existing content. CLAUDE.local.md is a personal, git-ignored file with per-task-type wiki pointers and memory file paths. `.gitignore` gets one new entry.

**Tech Stack:** Markdown, git

---

## File Map

- Modify: `CLAUDE.md` — restructure into five labelled sections, preserve all existing content
- Create: `CLAUDE.local.md` — personal bridge file, git-ignored
- Modify: `.gitignore` — add `CLAUDE.local.md`

---

### Task 1: Add CLAUDE.local.md to .gitignore

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Open .gitignore and add the entry**

Add after the `.env.*.local` line:

```
# Personal Claude context bridge (second brain → Switchboard)
CLAUDE.local.md
```

- [ ] **Step 2: Verify the entry is correct**

Run:

```bash
git check-ignore -v CLAUDE.local.md
```

Expected output: `.gitignore:N:CLAUDE.local.md	CLAUDE.local.md` (where N is the line number)

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore CLAUDE.local.md personal context bridge"
```

---

### Task 2: Create CLAUDE.local.md

**Files:**

- Create: `CLAUDE.local.md`

- [ ] **Step 1: Create the file**

Create `CLAUDE.local.md` at the repo root with this exact content:

````markdown
# Switchboard — Personal Context Bridge

This file is git-ignored. It bridges the second brain wiki and memory files
into Switchboard dev sessions. Load only what is relevant to the current task.

---

## Wiki Context by Task Type

Load only the relevant 1-2 pages per task. Do not load the full wiki.

| Task type                | Wiki pages to load                                 |
| ------------------------ | -------------------------------------------------- |
| Architecture decisions   | `governed-agent-os`, `context-budget-architecture` |
| GTM / positioning        | `switchboard-distribution-trust`, `memory-as-moat` |
| Employee / memory design | `three-tier-memory`, `compounding-leverage-engine` |
| PCD / pipeline work      | `pipeline-factories`, `narrow-revenue-motion`      |

Wiki location: `~/second brain/06_KNOWLEDGE/wiki/`

---

## Memory Files

Always relevant for Switchboard dev sessions. Read before starting any
non-trivial task to pick up past corrections and active decisions.

Location: `~/.claude/projects/-Users-jasonli-dev-switchboard/memory/`

- `feedback/` — code patterns, conventions Jason has corrected in past sessions
- `project/` — active decisions, known blockers, current workstreams

---

## Task Capsule Format

Use this structure for all subagent dispatches. Replace prose briefings.

```json
{
  "goal": "",
  "scope": [],
  "constraints": [],
  "expected_deliverable": "",
  "open_questions": []
}
```
````

---

## Write-Back Checklist

After each meaningful session, before closing:

1. Update relevant memory files in `~/.claude/projects/.../memory/`
2. Append to `~/second brain/06_KNOWLEDGE/wiki/log.md` if a new insight was produced
3. Note any reusable pattern or skill discovered
4. Record decisions made (what and why)

````

- [ ] **Step 2: Verify the file is ignored by git**

Run:
```bash
git status CLAUDE.local.md
````

Expected: no output (file is ignored, won't appear as untracked)

- [ ] **Step 3: Commit the .gitignore change only**

Note: CLAUDE.local.md itself is not committed (it's ignored). Only .gitignore was committed in Task 1. Nothing to commit here — verify and move on.

---

### Task 3: Restructure CLAUDE.md into five labelled layers

**Files:**

- Modify: `CLAUDE.md`

The goal is to reorganise existing content into five named sections. No content is deleted — everything already in CLAUDE.md stays, just moved under the right heading.

- [ ] **Step 1: Read the current CLAUDE.md in full**

```bash
cat CLAUDE.md
```

Understand which existing sections map to which layer before making any changes.

Mapping guide:

- **L1 Doctrine** ← "Codebase Map", "Build / Test / Lint", "Code Conventions", "Testing", "Commit Messages", "Architecture Enforcement", "Pre-Commit & CI", "Environment Variables"
- **L2 Project Memory** ← new section, pointers only (see content below)
- **L3 Task Capsule Format** ← new section, standard JSON format
- **L4 Tool Gating** ← new section, conventions
- **L5 Write-Back** ← new section, checklist

- [ ] **Step 2: Add the layer structure to CLAUDE.md**

Add this block at the very top of CLAUDE.md, before the existing content:

```markdown
# Switchboard — Claude Code Instructions

> **Context layers:** This file is organised into five layers. L1 is stable
> doctrine loaded every session. L2–L5 are conventions applied per task.
> See `CLAUDE.local.md` for personal wiki pointers and memory file paths.

---

## L1: Doctrine

> Stable. Loaded every session. Everything below this heading is L1.
```

Then add L2–L5 as new sections at the bottom of the file (after all existing content):

````markdown
---

## L2: Project Memory

Pointers only — no content dumps. Load the relevant slice for the current task.

- Active decisions and blockers: see `CLAUDE.local.md` → Memory Files section
- Wiki pages by task type: see `CLAUDE.local.md` → Wiki Context by Task Type
- Reusable procedures: test scaffold = co-locate `__tests__/<name>.test.ts`;
  migration = `pnpm db:migrate`; PR review = typecheck + lint + test + coverage

---

## L3: Task Capsule Format

Use this structure for all subagent dispatches. Replace prose briefings.

```json
{
  "goal": "",
  "scope": [],
  "constraints": [],
  "expected_deliverable": "",
  "open_questions": []
}
```
````

---

## L4: Tool Gating

- Read tools first. Confirm scope before using write tools.
- Never import from `@switchboard/db` or `apps/*` in `schemas`, `core`, or `cartridge-sdk` tasks.
- Prefer targeted file reads (`Read packages/core/src/model-router.ts`) over directory dumps.
- Only expose dashboard/db tools for app-layer tasks (Layer 6 in the dependency stack).

---

## L5: Write-Back

After each meaningful session:

1. Update relevant memory files (`~/.claude/projects/.../memory/`)
2. Append to `~/second brain/06_KNOWLEDGE/wiki/log.md` if a new insight was produced
3. Note any reusable pattern discovered
4. Record decisions made (what and why, not just what)

````

- [ ] **Step 3: Verify CLAUDE.md is valid markdown**

Run:
```bash
head -20 CLAUDE.md
tail -30 CLAUDE.md
````

Expected: L1 header at top, L5 write-back at bottom, all existing content preserved in between.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: restructure CLAUDE.md into five layered context sections"
```

---

## Done

Phase 1 is complete when:

- `git check-ignore -v CLAUDE.local.md` returns a match
- `CLAUDE.local.md` exists locally with wiki pointers and memory file paths
- `CLAUDE.md` has L1–L5 sections with all original content preserved under L1
