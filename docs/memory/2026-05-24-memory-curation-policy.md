# Memory Curation Policy — Design

**Date:** 2026-05-24
**Scope:** The Claude Code agent workspace memory for this repo
(`~/.claude/projects/-Users-jasonli-switchboard/memory/`). This is **not** Switchboard
product code — it governs how the agent's persistent memory is structured and maintained.

## Problem

The always-loaded index (`MEMORY.md`) reached 31.9 KB against a 24.4 KB / ~200-line budget,
so it now loads only partially each session — memory is silently lossy. Across 88 files
(~418 KB total) the index entries had grown to 600–1024 chars each, and ~40 of them were
episodic "Phase/PR/slice X shipped → SHA" records kept in the always-loaded set as if live.

Four symptoms, one root cause — **no tiering and no retirement lifecycle**:

1. **Over budget / lossy** — nothing enforced the ceiling.
2. **Wrong things surface** — live and historical entries mixed in one flat list; long lines dilute the recall hook.
3. **Stale clutter** — completed work never leaves.
4. **Maintenance burden** — all upkeep is manual.

Research convergence (MemGPT, Generative Agents, Reflexion, Mem0, Zep/Graphiti, LangMem,
Anthropic Claude Code docs + the Memory/Dreaming talk) supports the fix below. Two findings
make this urgent rather than cosmetic: oversized context degrades the agent materially as
low-value entries accumulate ("context rot" — accuracy drops and middle-of-context entries get
lost; figures vary by model and are illustrative from the literature cited in the brainstorming
research, not a fixed benchmark), and once signal-to-noise crosses a threshold the agent
**stops trusting memory and ignores the file entirely**. Pruning protects trust.

## Organizing frame: retention value, not topic

Classify every memory by type (the LangMem/Mem0/Zep taxonomy):

| Type | Examples here | Verdict |
|------|---------------|---------|
| **Semantic** — stable facts/prefs | "Alex = medspa", coverage thresholds, canonical names, design tokens | Keep durably |
| **Procedural** — how-to / gotchas | "`pnpm reset` when exports missing", "auto-merge captures HEAD early" | Keep durably — **highest value** |
| **Episodic** — what happened | "PR #646 deleted queue UI → SHA", "A.5 shipped → commit" | Rots fastest — keep the *lesson*, archive the *event* |

The bloat is ~90% episodic. SHAs and merge status are derivable from `git log`/`gh`; the event
expires, only the lesson is durable.

## Three-tier structure

- **Tier 1 — `MEMORY.md` (always-loaded index).** Hard-capped under 24 KB / ~200 lines. The
  sharp operating control surface, not a diary. Holds durable facts, procedural gotchas, active
  pointers, session triggers — plus the Curation Policy preamble. One fact per line,
  keyword-rich (recall is text-matched, no embeddings), absolute dates, ≤150 chars, links into
  Tier 2.
- **Tier 2 — topic files (lazy-loaded, unbounded).** Full detail, recalled on demand by
  `description` match. The index points *into* these; it does not duplicate them.
- **Tier 3 — `MEMORY-archive.md` + archived topics (NOT always-loaded).** Episodic shipped
  records move here, staying greppable but off the always-loaded budget. Plus
  `memory-maintenance-log.md` for Consolidation Reports.

### Tier 1 priority order (most-protected first)

1. Procedural gotchas / failure-prevention rules
2. Current canonical product decisions
3. Active directional pointers
4. Durable semantic facts
5. Session triggers

When over cap, **evict bottom-priority-first** — gotchas are the last thing to go. Always-loaded
memory should behave less like documentation and more like a guardrail system.

**Canonical decisions** are stable product/architecture decisions (e.g. "Alex's vertical is
medspa", "approval is lifecycle state, not a route side effect") — *not* shipped-event records.
This distinction stops "PR X shipped" from sneaking back into Tier 1 dressed as canonical.

### The governing lint rule

For every write and every consolidation decision:
**"Will a future session act better because this is in the always-loaded index?"**
If no → Tier 2, Tier 3, or don't write it.

## Maintenance model: forcing function + dreaming pass

**A. Forcing function (passive).** The 24 KB / ~200-line cap is a hard limit. Crossing it
*triggers* a consolidation pass, never silent truncation.

**B. Dreaming pass (active).** A periodic out-of-band consolidation — Claude Code's `/dream`
behavior where available, plus manual `/dream` on demand. Fixed checklist per pass:

1. **Consolidate episodic → lesson.** Collapse rote "PR #X → SHA" runs into one holistic entry; move raw event records to Tier 3.
2. **Dedup & defragment.** Merge entries on the same fact. Grep before write; **update over create**.
3. **Demote verbose entries.** Index keeps gist + pointer; detail drops to the Tier 2 file.
4. **Resolve contradictions by recency.** Supersede the old fact in place; move superseded reasoning to archive (don't hard-delete).
5. **Verify code claims.** Where an entry names a file/function/flag, confirm it still exists; a stale "this exists" claim is worse than no memory.
6. **Normalize dates** relative → absolute.
7. **Enforce the cap.** If still over, evict bottom-priority-first.

**Consolidation Report** — appended to `memory-maintenance-log.md` (Tier 3) each pass:

```
## Dream pass — 2026-05-24
- Promoted: 3
- Demoted: 12
- Archived: 18
- Merged: 7
- Superseded: 2
- Stale code claims flagged: 4
- MEMORY.md size after pass: 21.6 KB / 183 lines
```

Auditability without polluting Tier 1.

## Write rules & file format

**Index line (Tier 1)**, grouped under the five priority headers:
```
- [Title](topic-file.md) — keyword-rich hook, ≤150 chars, absolute dates
```
No SHAs, no PR-by-PR logs, no done-work event logs in Tier 1.

**Topic file frontmatter** keeps `name` / `description` / `metadata.type` (`description` drives
recall, so keep it keyword-rich). The `project` type adds a status field:

```
metadata:
  type: project
  status: active | shipped
```

- `project + active` → eligible for a Tier 1 pointer.
- `project + shipped` → archive candidate. Before archiving, **extract any durable lesson into a
  `feedback` (procedural) or `reference`/`user` (semantic) entry**; the shipped record itself
  goes to `MEMORY-archive.md`.

A `canonical` status may be added later if a real need appears — **not now**.

## Curation Policy preamble (verbatim, to live at the top of `MEMORY.md`)

Procedural, not explanatory — rules only:

```markdown
## Curation Policy

- MEMORY.md is the always-loaded index; keep under 24 KB / ~200 lines.
- Tier 1: durable facts, procedural gotchas, active pointers, session triggers.
- Tier 2: topic files for full detail; link from index, do not duplicate.
- Tier 3: MEMORY-archive.md + archived topics for episodic shipped work.
- Priority order: gotchas → canonical decisions → active pointers → semantic facts → triggers.
- Canonical decisions are stable product/architecture decisions, not shipped-event records.
- Evict bottom-priority-first when over cap.
- Lint rule: will a future session act better because this is always loaded?
- Index lines: `- [Title](topic.md) — keyword-rich hook, ≤150 chars, absolute dates`.
- No SHAs, PR-by-PR logs, or done-work event logs in Tier 1.
- `metadata.type: project` must include `status: active|shipped`.
- `project + shipped` archives after extracting durable lessons.
- Prefer update-over-create; grep before writing.
- Resolve contradictions by recency; archive superseded reasoning.
- Verify file/function/flag claims before preserving them.
```

## Rollout

**A. Immediate remediation** — a first dreaming pass by hand to get `MEMORY.md` under 24 KB:

1. Archive the ~40 `project + shipped` episodic records:
   - Move their index entries into `MEMORY-archive.md` (one-line pointer each).
   - Move long shipped topic files under `archive/` only when no longer useful as active detail; short ones may stay in place.
   - Preserve relative `[[links]]` from archive entries to archived topic files so recall still resolves.
2. Before archiving each, extract any durable lesson into a `feedback`/`reference`/`user` entry.
3. Regroup surviving Tier 1 entries under the five priority headers.
4. Shrink every index line to ≤150 chars + pointer.
5. Tag every `project` entry `status: active|shipped`.
6. Write the Curation Policy preamble at the top of `MEMORY.md`.
7. Emit the first Consolidation Report to `memory-maintenance-log.md`.

**B. Policy home.** The preamble lives at the top of `MEMORY.md` (always-loaded) so the file is
self-governing rather than relying on external instructions nobody reliably sees. Preamble +
index together stay under the cap.

**C. Cadence.** `/dream` behavior where available for steady state; manual `/dream` on demand.
No new infrastructure.

## Non-goals / YAGNI

- No `canonical` status, no semantic/episodic/procedural type split across all files yet —
  `status: active|shipped` on `project` is the minimal deterministic signal.
- No vector/embedding recall — Claude Code recall is text-matched; keyword-rich descriptions
  are the lever.
- No automated decay scoring — the dreaming pass + hard cap are sufficient at this scale.

## Success criteria

- `MEMORY.md` loads in full every session (under 24 KB / ~200 lines).
- Tier 1 contains zero done-work event logs; gotchas are grouped first.
- Every `project` entry carries a `status`.
- A Consolidation Report exists for each dreaming pass.
- 100% of Tier 1 links resolve to existing topic/archive files.
- Zero stale file/function/flag claims remain unmarked after each pass.
