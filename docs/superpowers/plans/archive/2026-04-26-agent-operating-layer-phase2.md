# Agent Operating Layer Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add architecture gate enforcement, memory write-back, and implementation skill to the `.agent/` operating layer so architecture mistakes are caught before code ships and decisions persist across sessions.

**Architecture:** Three independent markdown/config deliverables — a PostToolUse hook in `.claude/settings.json` that prompts architecture checks after source file edits, a write-back step added to the context-compression skill plus harness memory pointers, and a new implementation skill with before/after checks wired into the resolver.

**Tech Stack:** JSON (Claude Code settings), Markdown (skill files), Bash (hook command via python3)

---

## File Map

| Action | File                                                                          | Purpose                                                     |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CREATE | `.claude/settings.json`                                                       | Project-level Claude Code config with PostToolUse hook      |
| MODIFY | `.agent/skills/context-compression/SKILL.md`                                  | Add mandatory write-back step and trigger clarification     |
| MODIFY | `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md` | Add pointers to `.agent/memory/semantic/`                   |
| CREATE | `.agent/skills/implementation/SKILL.md`                                       | Pre/post-write architecture checks for implementation tasks |
| MODIFY | `.agent/RESOLVER.md`                                                          | Load implementation skill on implementation triggers        |

---

## Task 1: Architecture Gate Hook

**Files:**

- Create: `.claude/settings.json`

- [ ] **Step 1: Verify no project-level settings file exists**

Run:

```bash
ls /Users/jasonli/switchboard/.claude/settings.json 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

Expected: `NOT FOUND`

If it exists, read its current contents before proceeding so you don't overwrite existing config.

- [ ] **Step 2: Create `.claude/settings.json` with the architecture gate hook**

Create `/Users/jasonli/switchboard/.claude/settings.json` with:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport json, sys\ntry:\n    data = json.load(sys.stdin)\n    fp = data.get('tool_input', {}).get('file_path', '') or data.get('file_path', '')\n    if '/apps/' in fp or '/packages/' in fp:\n        print('=== SWITCHBOARD ARCHITECTURE GATE ===')\n        print('File: ' + fp)\n        print('')\n        print('Answer ALL 4 before continuing:')\n        print('1. Do NEW mutating actions use PlatformIngress.submit()?')\n        print('2. Is canonical persistence through WorkTrace only?')\n        print('3. Is approval logic in the lifecycle service, not this route?')\n        print('4. Do new async paths have dead-letter handling?')\n        print('')\n        print('YES to all -> proceed. NO to any -> fix first.')\nexcept: pass\n\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Verify the JSON is valid**

Run:

```bash
python3 -m json.tool /Users/jasonli/switchboard/.claude/settings.json
```

Expected: JSON pretty-printed with no errors.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: add architecture gate hook to project Claude settings"
```

---

## Task 2: Memory Persistence

**Files:**

- Modify: `.agent/skills/context-compression/SKILL.md`
- Modify: `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md`

### Part A — Context-compression write-back

- [ ] **Step 1: Read the current context-compression skill**

Read `.agent/skills/context-compression/SKILL.md` and locate the `## Process` section and `## Done when` section. You will update both.

- [ ] **Step 2: Update the Process section to make write-back mandatory**

In `.agent/skills/context-compression/SKILL.md`, replace the `## Process` section with:

```markdown
## Process

1. Review session for durable content.
2. Extract decisions (what was decided and why).
3. Extract lessons (what was learned that applies to future work).
4. Extract failures (what went wrong and what structural fix prevents recurrence).
5. Identify invariant updates if any.
6. Identify open questions.
7. Identify next actions.
8. Identify skill/tool/eval candidates (repeated patterns that should become structural).
9. Write extracted content to the relevant memory files:
   - Append decisions to `.agent/memory/semantic/DECISIONS.md` using format: `## <title>\n\n**Decision:** <decision>\n**Status:** Active`
   - Append lessons to `.agent/memory/semantic/LESSONS.md` using format: `- <reusable rule>`
   - Append failures to `.agent/memory/episodic/FAILURES.jsonl` using format: `{"date":"YYYY-MM-DD","failure":"...","lesson_candidate":"...","skill":"..."}`
```

- [ ] **Step 3: Add the Trigger section above the Process section**

Insert before `## Process`:

```markdown
## Trigger

Run as the FINAL step of any session that completes:

- `/brainstorming`
- `/writing-plans`
- executing-plans

Also run when user says: "compact this session", "summarize what we learned", "update memory".
```

- [ ] **Step 4: Update the Done when section**

Replace `## Done when` with:

```markdown
## Done when

- All durable content from the session is written to the appropriate memory file on disk (not just output to chat).
- `.agent/memory/semantic/DECISIONS.md` contains any new decisions from this session.
- `.agent/memory/semantic/LESSONS.md` contains any new lessons from this session.
- `.agent/memory/episodic/FAILURES.jsonl` contains any new failure entries from this session.
- No transcript content remains — only distilled decisions, lessons, and failures.
```

- [ ] **Step 5: Verify the skill file reads correctly**

Read the full `.agent/skills/context-compression/SKILL.md` file and confirm:

- `## Trigger` section appears before `## Process`
- Step 9 in Process explicitly mentions writing to disk
- `## Done when` references actual file writes

### Part B — Auto-memory pointer

- [ ] **Step 6: Add pointers to harness MEMORY.md**

Read `/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md`. Find the end of the file and append two new entries under a new section heading:

```markdown
## Switchboard Agent Memory

- [Switchboard Architecture Decisions](/Users/jasonli/switchboard/.agent/memory/semantic/DECISIONS.md) — active architecture decisions, shipped items, deferred items for the Switchboard build
- [Switchboard Build Lessons](/Users/jasonli/switchboard/.agent/memory/semantic/LESSONS.md) — reusable rules distilled from past Switchboard sessions
```

Verify the paths resolve:

```bash
ls /Users/jasonli/switchboard/.agent/memory/semantic/DECISIONS.md && ls /Users/jasonli/switchboard/.agent/memory/semantic/LESSONS.md
```

Expected: both files found with no error.

- [ ] **Step 7: Commit**

```bash
git add .agent/skills/context-compression/SKILL.md
git commit -m "chore: make context-compression write-back mandatory and add memory triggers"
```

The MEMORY.md change is outside the repo — no git commit needed for it.

---

## Task 3: Implementation Skill + Resolver Update

**Files:**

- Create: `.agent/skills/implementation/SKILL.md`
- Modify: `.agent/RESOLVER.md`

- [ ] **Step 1: Create the implementation skill directory**

```bash
mkdir -p /Users/jasonli/switchboard/.agent/skills/implementation
```

- [ ] **Step 2: Create `.agent/skills/implementation/SKILL.md`**

```markdown
# Skill: Implementation

## Purpose

Enforce Switchboard architecture invariants during code execution. Runs before and after each step in executing-plans.

## Use when

- Implementing any step from an executing-plans task
- Writing new routes, services, stores, or tools in `apps/` or `packages/`
- Resolver routes this for: "implement this", "execution plan", "build this", "patch plan", "code changes"

## Inputs

- The step description from the implementation plan
- `docs/DOCTRINE.md`
- `.agent/conventions/architecture-invariants.md`

## Pre-write check (run before writing any code)

Answer these 3 questions explicitly in the session before touching any file:

1. **Ingress path:** Does this step introduce any mutating action? If yes, does it enter through `PlatformIngress.submit()`? If not, stop and redesign before writing code.

2. **Persistence layer:** Does this step write state? If yes, is `WorkTrace` the canonical store? If something else is written to instead, stop and redesign.

3. **Governance:** Does this step require a governed action? If yes, is `GovernanceGate.evaluate()` called exactly once? If governance is missing or called multiple times, stop and redesign.

If the answer to all three is "not applicable to this step" or "yes, correctly implemented" — proceed to write code.

If any answer is "no" or "missing" — state the specific violation, propose the minimal fix, and do not write code until resolved.

## Post-write check (run after writing code, before marking step complete)

Verify all 4 before marking the task step as done:

1. Does the new route/service flow through `PlatformIngress` for mutating actions?
2. Does it write canonical state to `WorkTrace`?
3. Is there a co-located test file (`*.test.ts`) covering the new behavior?
4. Does `pnpm typecheck` pass?

If any check fails: surface the specific failure, fix it, re-run the check. Do not move to the next step until all 4 pass.

## Output

For each step:

- Pre-write: explicit answers to the 3 questions (not implied — written out)
- Code: the implementation
- Post-write: confirmation that all 4 checks pass, or the specific fix applied

## Quality bar

- No step marked complete with a failing typecheck.
- No step marked complete without a co-located test.
- No mutating route that bypasses PlatformIngress.
- No parallel persistence path outside WorkTrace.

## Failure modes

- Skipping pre-write check because "the step is simple" — all steps require the check.
- Marking a step complete before running typecheck — typecheck must pass.
- Writing a test file in a different directory — tests must be co-located (`same-dir/*.test.ts`).
- Assuming governance is not needed without checking if the action is mutating.

## Done when

- All plan steps are complete.
- All 4 post-write checks passed for every step.
- `pnpm test` passes.
- `pnpm typecheck` passes.
```

- [ ] **Step 3: Update `.agent/RESOLVER.md` — implementation route**

In `.agent/RESOLVER.md`, find the `## Implementation / code changes` section and replace it with:

```markdown
## Implementation / code changes

**Triggers:** implement this, execution plan, build this, patch plan, code changes

**Load:**

- `docs/DOCTRINE.md`
- `.agent/skills/implementation/SKILL.md`
- `.agent/conventions/architecture-invariants.md`
- `.agent/conventions/token-budget.md`
- `.agent/conventions/source-of-truth.md`
```

- [ ] **Step 4: Update `skills/_index.md` to include the new skill**

Read `.agent/skills/_index.md` and append:

```markdown
## implementation

Enforces architecture invariants (PlatformIngress, WorkTrace, GovernanceGate, dead-letter) before and after each code step in executing-plans.
```

- [ ] **Step 5: Verify resolver loads correctly**

Read `.agent/RESOLVER.md` and confirm the implementation route now references `.agent/skills/implementation/SKILL.md`.

Read `.agent/skills/_index.md` and confirm `implementation` appears in the index.

- [ ] **Step 6: Commit**

```bash
git add .agent/skills/implementation/SKILL.md .agent/RESOLVER.md .agent/skills/_index.md
git commit -m "chore: add implementation skill and wire into resolver"
```

---

## Final Verification

- [ ] **Verify all three deliverables are in place**

```bash
# Hook exists and is valid JSON
python3 -m json.tool /Users/jasonli/switchboard/.claude/settings.json | grep -c "PostToolUse"

# Implementation skill exists
ls /Users/jasonli/switchboard/.agent/skills/implementation/SKILL.md

# Resolver references implementation skill
grep "implementation/SKILL.md" /Users/jasonli/switchboard/.agent/RESOLVER.md

# Context-compression has write-back step
grep "Write extracted content" /Users/jasonli/switchboard/.agent/skills/context-compression/SKILL.md

# Harness memory has Switchboard pointers
grep "Switchboard" /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/MEMORY.md
```

Expected: all 5 commands return a result (non-empty output, no errors).

- [ ] **Acceptance criteria check**

1. `.claude/settings.json` PostToolUse hook fires on Edit/Write to `apps/` or `packages/` files and outputs the 4 architecture questions
2. Context-compression skill now writes to disk as its final step, not just outputs to chat
3. Harness MEMORY.md has pointers to `.agent/memory/semantic/DECISIONS.md` and `LESSONS.md`
4. `.agent/skills/implementation/SKILL.md` exists with pre-write (3 questions) and post-write (4 checks)
5. `.agent/RESOLVER.md` implementation route loads `implementation/SKILL.md`
