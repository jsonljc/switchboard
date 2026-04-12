# Layered Context Discipline

**Date:** 2026-04-12
**Status:** Approved
**Author:** Jason

---

## Goal

Eliminate token waste and improve compounding leverage across two layers: dev sessions when building Switchboard, and Switchboard's own runtime LLM calls. Both layers implement the same five-layer context pattern. Phase 1 is config-only and ships immediately. Phase 2a adds a `ContextBudget` type and effort routing to `packages/core`. Phase 2b (prompt caching) is deferred to a separate spec.

---

## Architecture

The same five-layer pattern applied at two scales:

```
L1: Stable doctrine      — cached, loaded every session/call
L2: Project memory       — retrieved per task, only the relevant slice
L3: Task capsule         — structured { goal, scope, constraints, deliverable }
L4: Tool gating          — expose only tools relevant to this mode/employee
L5: Write-back           — capture what changed, what was learned, what compounded
```

**Phase 1** implements this at the dev session layer (CLAUDE.md restructuring + CLAUDE.local.md bridge). No code changes.

**Phase 2a** implements this at the Switchboard runtime layer (`ContextBudget` type, `ContextLoader` interface, `ContextAssembler`, effort routing in `ModelRouter`).

**Phase 2b** (deferred) adds prompt caching via `cache_control` headers at the API layer once Phase 2a's stable doctrine block exists.

---

## Phase 1: Dev Session Layer

### 1.1 Switchboard CLAUDE.md restructuring

Restructure `CLAUDE.md` into five explicit sections matching the layer model. Current content is preserved — the change is organisation, not content.

```
## L1: Doctrine
What Switchboard is, governance thesis, dependency layers, code conventions,
commit format, architecture enforcement rules.
(Stable. Claude Code caches this across turns.)

## L2: Project Memory
Pointers only — no content dumps. References to:
- Active decisions and known blockers
- Reusable procedures (test scaffold pattern, migration checklist, PR review format)
- Second brain wiki pages relevant to current work (see CLAUDE.local.md)
(Load the relevant slice per task. Never load the whole wiki.)

## L3: Task Capsule Format
Standard format for all subagent dispatches:
{
  "goal": "",
  "scope": [],
  "constraints": [],
  "expected_deliverable": "",
  "open_questions": []
}
Replace prose briefings with this structure.

## L4: Tool Gating Convention
Read tools first. Confirm scope before write tools.
Never expose dashboard or db tools for schemas/core tasks.
Prefer targeted file reads over dumping full directories.

## L5: Write-Back Convention
After each meaningful session:
1. Update relevant memory files (~/.claude/projects/.../memory/)
2. Append to wiki/log.md if a new insight was produced
3. Note any reusable pattern or skill discovered
4. Record decisions made (what and why, not just what)
```

### 1.2 CLAUDE.local.md bridge (git-ignored, personal)

New file at `~/dev/switchboard/CLAUDE.local.md`. Git-ignored. Bridges the second brain to Switchboard dev sessions.

```markdown
## Wiki Context by Task Type

Load only the relevant 1-2 pages per task. Do not load the full wiki.

- Architecture decisions → [[governed-agent-os]], [[context-budget-architecture]]
- GTM / positioning → [[switchboard-distribution-trust]], [[memory-as-moat]]
- Employee/memory design → [[three-tier-memory]], [[compounding-leverage-engine]]
- PCD / pipeline work → [[pipeline-factories]], [[narrow-revenue-motion]]

## Memory Files

Always relevant for Switchboard dev sessions:
~/.claude/projects/-Users-jasonli-dev-switchboard/memory/
→ feedback/_ — code patterns, conventions, past corrections
→ project/_ — active decisions, blockers, workstreams
```

### 1.3 Success criteria for Phase 1

- Every subagent dispatch uses the task capsule JSON format, not prose
- CLAUDE.md has five labelled sections matching the layer model
- CLAUDE.local.md exists and has wiki pointers + memory file paths
- First session after Phase 1: no re-explaining architecture doctrine that's already in L1

---

## Phase 2a: Runtime Layer

### 2.1 ContextBudget type

New file: `packages/core/src/context-budget.ts`

```typescript
export type Effort = "low" | "medium" | "high";

export interface ContextMemory {
  /** Brand voice, guidelines — top-K retrieved from KnowledgeStore */
  brand?: string;
  /** Learned patterns relevant to this task — top-K retrieved from SkillStore */
  skills?: string[];
  /** Recent approval patterns — summarised, not raw history */
  performance?: string;
}

export interface ContextTask {
  goal: string;
  scope: string[];
  constraints: string[];
  expectedOutput: string;
}

export interface ContextBudget {
  /** L1: stable doctrine — employee system prompt + core policies */
  doctrine: string;
  /** L2: retrieved memory — only what is relevant to this task */
  memory: ContextMemory;
  /** L3: task capsule */
  task: ContextTask;
  /** Routing hint — derived from taskType, not set manually */
  effort: Effort;
  /** Metadata — used for routing and logging, not injected into prompt */
  orgId: string;
  taskType: string;
}

/** Per-layer token limits. Configurable in defineEmployee(). */
export interface ContextBudgetLimits {
  doctrineBudget: number; // default: 2000
  memoryBudget: number; // default: 1000
  taskBudget: number; // default: 500
}

export const DEFAULT_CONTEXT_BUDGET_LIMITS: ContextBudgetLimits = {
  doctrineBudget: 2000,
  memoryBudget: 1000,
  taskBudget: 500,
};
```

### 2.2 ContextLoader interface

New file: `packages/core/src/context-loader.ts`

Owns L2 retrieval. Employees call this before constructing the budget. Keeps the retrieval boundary explicit — `ContextBudget` receives pre-assembled strings, not raw store handles.

```typescript
export interface ContextLoaderInput {
  orgId: string;
  employeeId: string;
  taskType: string;
  task: ContextTask;
  limits: ContextBudgetLimits;
}

export interface ContextLoader {
  load(input: ContextLoaderInput): Promise<ContextMemory>;
}
```

The production implementation (`PrismaContextLoader`) calls `KnowledgeStore` for brand context and `SkillStore` for relevant skills, using pgvector similarity search with top-K cutoff derived from `limits.memoryBudget`. A `NullContextLoader` is provided for tests.

### 2.3 ContextAssembler

New file: `packages/core/src/context-assembler.ts`

Assembles `ContextBudget` layers into a prompt string. Enforces per-layer token budgets. Budget is approximate (character-based, not true token count) — close enough for preventing runaway context, not for billing precision.

```typescript
export class ContextAssembler {
  assemble(budget: ContextBudget, limits: ContextBudgetLimits): string {
    // L1: doctrine (truncated to doctrineBudget chars)
    // L2: memory — brand, then skills, then performance (truncated to memoryBudget chars total)
    // L3: task capsule as structured block (truncated to taskBudget chars)
    // Returns assembled prompt string
  }
}
```

When any layer exceeds its budget, the assembler truncates from the end of that layer and appends `[truncated — see full context in memory store]`. This makes truncation visible rather than silently dropping data.

### 2.4 LlmCallWrapper extension

`packages/core/src/llm-call-wrapper.ts` — `CallOptions` gets an optional `budget` field:

```typescript
export interface CallOptions extends ResolveOptions {
  prompt: string; // existing — still works, no breaking change
  budget?: ContextBudget; // new — when present, assembler builds prompt from budget
  limits?: ContextBudgetLimits; // new — overrides defaults when budget is provided
  orgId?: string;
  taskType?: string;
}
```

When `budget` is present, the wrapper calls `ContextAssembler.assemble()` to build the prompt and ignores the raw `prompt` field. `prompt` stays as a required field (not optional) to avoid breaking existing callers — when `budget` is supplied, `prompt` can be passed as an empty string. Existing callers using only `prompt: string` are unaffected.

### 2.5 Effort routing in ModelRouter

`packages/core/src/model-router.ts` — add effort-to-slot mapping. `Effort` type is imported from `context-budget.ts`, not redefined here.

```typescript
import type { Effort } from "./context-budget.js";

// Effort → slot + options mapping
// low    → default slot (Haiku)              — formatting, retrieval, classification, CRUD
// medium → default slot + critical=true      — Sonnet via existing upgrade path
// high   → premium slot directly (Sonnet)    — ambiguous decisions, high-stakes reasoning

export function effortToSlotAndOptions(effort: Effort): {
  slot: ModelSlot;
  options: ResolveOptions;
} {
  switch (effort) {
    case "low":
      return { slot: "default", options: { critical: false } };
    case "medium":
      return { slot: "default", options: { critical: true } };
    case "high":
      return { slot: "premium", options: { critical: false } };
  }
}
```

Effort is derived from `taskType` by the caller (employee handler or `LlmCallWrapper` via a lookup table — `TASK_TYPE_EFFORT_MAP`). Manual override available by setting `budget.effort` explicitly.

Default `TASK_TYPE_EFFORT_MAP`:

```typescript
const TASK_TYPE_EFFORT_MAP: Record<string, Effort> = {
  "content.draft": "medium",
  "content.revise": "medium",
  "content.publish": "low", // deterministic gate check
  "calendar.plan": "medium",
  "calendar.schedule": "low",
  "competitor.analyze": "medium",
  "performance.report": "low",
  classification: "low",
  summarisation: "low",
  retrieval: "low",
  // default fallback: "medium"
};
```

### 2.6 defineEmployee() extension

`ContextBudgetLimits` added as optional config in `defineEmployee()`:

```typescript
defineEmployee({
  // ... existing config ...
  contextBudget: {
    doctrineBudget: 3000, // override for employees with larger system prompts
    memoryBudget: 1500,
    taskBudget: 500,
  },
});
```

When absent, `DEFAULT_CONTEXT_BUDGET_LIMITS` is used.

### 2.7 Success criteria for Phase 2a

- `ContextBudget` type exists and is exported from `packages/core`
- `ContextLoader` interface has production (`PrismaContextLoader`) and test (`NullContextLoader`) implementations
- `ContextAssembler` assembles budgets, truncates visibly when over limit, has unit tests
- `LlmCallWrapper` accepts `budget?: ContextBudget` without breaking existing callers
- `ModelRouter` has `effortToResolveOptions()` and `TASK_TYPE_EFFORT_MAP`
- At least one employee (Creative) migrated to use `ContextBudget` instead of raw `prompt`
- All existing tests pass

---

## What This Is Not

- **Not prompt caching** — Phase 2b, separate spec, requires Phase 2a's stable doctrine block first
- **Not the Hermes skill extraction loop** — Hermes is a write-back mechanism (L5), separate design
- **Not a breaking change** — `prompt: string` in `LlmCallWrapper` stays. Migration is opt-in per employee

---

## File Map

**Phase 1 (config):**

- Modify: `~/dev/switchboard/CLAUDE.md`
- Create: `~/dev/switchboard/CLAUDE.local.md` (git-ignored)
- Modify: `~/dev/switchboard/.gitignore` (add `CLAUDE.local.md`)

**Phase 2a (code):**

- Create: `packages/core/src/context-budget.ts`
- Create: `packages/core/src/context-loader.ts`
- Create: `packages/core/src/context-assembler.ts`
- Create: `packages/core/src/__tests__/context-assembler.test.ts`
- Create: `packages/core/src/__tests__/context-loader.test.ts`
- Modify: `packages/core/src/llm-call-wrapper.ts`
- Modify: `packages/core/src/model-router.ts`
- Modify: `packages/core/src/index.ts` (export new types)
- Modify: `packages/employee-sdk/src/index.ts` (add `contextBudget` to `defineEmployee()` config)
