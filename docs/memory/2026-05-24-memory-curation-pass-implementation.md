# Memory Curation — First Consolidation Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute rollout step A of the memory curation policy — bring `MEMORY.md` from ~31.9 KB back under the 24 KB / ~200-line cap by tiering, archiving episodic shipped records, and installing the self-governing Curation Policy preamble.

**Architecture:** A one-time hand consolidation pass ("dream pass") over the local memory dir. Classify every entry by retention value, add `status` to project entries, extract durable lessons before archiving the episodic event records, regroup Tier 1 under five priority headers, and emit a Consolidation Report. The operation is made reversible with a timestamped backup (the dir is not git-tracked).

**Tech Stack:** Markdown files + frontmatter; `bash` (`cp`, `wc`, `grep`, `ls`); the Read/Edit/Write tools.

**Spec:** `docs/memory/2026-05-24-memory-curation-policy.md`

**Target dir (all paths below are relative to it):**
`/Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory/`

> **Adaptation note:** This dir is NOT a git repo. There are no commits and no test framework. Each task ends with a **verification command + expected output** instead. Task 0 takes a full backup so any task is reversible via restore.

---

## File Structure

- `MEMORY.md` — Tier 1 always-loaded index. Rewritten: Curation Policy preamble + 5 priority-ordered sections.
- `MEMORY-archive.md` — **new.** Tier 3. One-line pointers to archived episodic shipped records.
- `memory-maintenance-log.md` — **new.** Tier 3. Consolidation Reports, chronological.
- `archive/` — **new dir.** Optional home for long shipped topic files moved out of active recall.
- `reference_dashboard_architecture.md` — **new.** Tier 2. Absorbs the verbose inline Dashboard/Design-System/Routing blocks currently in `MEMORY.md`.
- Existing `project_*.md` topic files — gain `status: active|shipped`; shipped ones may move to `archive/`.
- Existing `feedback_*.md` / `reference_*.md` / `trigger_*.md` / `user_*.md` — unchanged except where a durable lesson is extracted into them.

---

## Task 0: Backup and baseline inventory

**Files:**
- Create: `~/.claude/projects/-Users-jasonli-switchboard/memory-backup-2026-05-24/` (sibling of the memory dir)

- [ ] **Step 1: Back up the entire memory dir (reversibility)**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard
cp -R memory "memory-backup-2026-05-24"
ls -1 "memory-backup-2026-05-24" | wc -l
```
Expected: a file count matching the live dir (≈89 including MEMORY.md). If anything goes wrong later, restore with `rm -rf memory && mv memory-backup-2026-05-24 memory`.

- [ ] **Step 2: Record the baseline metrics**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
echo "files: $(ls -1 *.md | wc -l)"
echo "MEMORY.md bytes: $(wc -c < MEMORY.md)"
echo "MEMORY.md lines: $(wc -l < MEMORY.md)"
```
Expected: ~88 files; MEMORY.md ~31933 bytes / ~190 lines. Note these — they go in the final Consolidation Report (`Promoted`/`Demoted`/`Archived` etc. counts and the before→after size).

- [ ] **Step 3: Generate the project-entry inventory**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
grep -rl "type: project" *.md | sort
```
Expected: the list of project topic files (≈30–40). This is the working set for Task 2's classification. Keep the output for reference.

---

## Task 1: Create Tier 3 scaffolding

**Files:**
- Create: `MEMORY-archive.md`
- Create: `memory-maintenance-log.md`
- Create: `archive/` (dir)

- [ ] **Step 1: Create `MEMORY-archive.md`**

Write `MEMORY-archive.md`:
```markdown
# Switchboard Memory — Archive (Tier 3, NOT always-loaded)

One-line pointers to episodic `project + shipped` records retired from the always-loaded
index. The work is done; full topic files remain greppable (here or under `archive/`).
Durable lessons from these were extracted into `feedback`/`reference`/`user` entries before
archival. See `2026-05-24-memory-curation-policy.md` (in the repo) for the policy.

## Shipped work (archived 2026-05-24)
```

- [ ] **Step 2: Create `memory-maintenance-log.md`**

Write `memory-maintenance-log.md`:
```markdown
# Memory Maintenance Log (Tier 3, NOT always-loaded)

Consolidation Report per dreaming/consolidation pass. Chronological.
```

- [ ] **Step 3: Create the `archive/` dir**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
mkdir -p archive
ls -d archive
```
Expected: `archive`

- [ ] **Step 4: Verify the scaffolding exists**

Run:
```bash
ls -1 MEMORY-archive.md memory-maintenance-log.md && ls -d archive
```
Expected: all three names print with no error.

---

## Task 2: Tag every project entry with `status: active|shipped`

**Files:**
- Modify: every `project_*.md` from Task 0 Step 3 (frontmatter only)

**Classification rule (deterministic):** an entry is `shipped` if its work is fully merged/closed and it is now a historical event record. It is `active` if work is in-flight, the entry is a standing canonical decision, or it tracks a launch/PR that is still open.

**Seed classification (verify each against the current `MEMORY.md` before applying):**

`active` (stay in Tier 1):
- `project_customer_ux_overhaul_blueprint` (brainstorm in flight)
- `project_alex_vertical_medspa` (standing canonical decision)
- `project_governance_deprioritization_sprint` (sprint in flight)
- `project_classifier_eval_pr3_ci_gate` (14-day bake in progress)
- `project_audit_wave_2_phased_state` (in flight)
- `project_consent_enforcement_pr596_shipped` (PR #596 still OPEN)
- `project_reports_is_launch_priority` (launch flip still blocked)
- `project_contacts_pipeline_shipped` (prod flip awaits env var)

`shipped` (archive candidates):
- `project_phase_d_complete`, `project_phase_d7_synergy_debt_roadmap`, `project_agent_first_redesign`, `project_slice_b_polish_backlog`
- `project_recommendations_v1_shipped`, `project_alex_home_reports_designs_locked`, `project_wave_1_5_status`
- `project_alex_cockpit_a3_shipped`, `..._a4_shipped`, `..._a5_shipped`, `..._a6_shipped`, `..._a7_shipped`, `..._a7_followup_scope`
- `project_riley_cockpit_wave_a_state`, `..._b2a_shipped`, `..._b2b_shipped`, `project_riley_b3_followup_shipped`, `project_riley_composer_adoption_shipped`
- `project_riley_wave_b_pr1_shipped`, `project_riley_wave_b_pr3_shipped`
- `project_local_readiness_shipped`, `project_cockpit_vertical_copy_shipped`, `project_cockpit_wiring_punchlist_shipped`, `project_cockpit_v2_sprite_system_shipped`
- `project_agent_infra_pr3_merged`, `project_deployment_pilot_shipped`
- any other `type: project` file whose body is past-tense "shipped/merged/closed"

> Entries like `project_canonical_agent_names` and `project_two_register_design` are **canonical decisions, not shipped events** — if they carry `type: project`, mark them `active` (they belong in Tier 1 under "canonical decisions"), do NOT archive.

- [ ] **Step 1: Add `status: active` to each active project file**

For each file in the `active` list, edit the frontmatter `metadata:` block to add the `status` line. Example for `project_alex_vertical_medspa.md`:
```yaml
metadata:
  node_type: memory
  type: project
  status: active
```
Apply the same `status: active` insertion to every file in the active list.

- [ ] **Step 2: Add `status: shipped` to each shipped project file**

For each file in the `shipped` list, insert `status: shipped` into the `metadata:` block the same way.

- [ ] **Step 3: Verify 100% status coverage**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
echo "project files: $(grep -rl 'type: project' *.md | wc -l)"
echo "with status:   $(grep -rl 'status: \(active\|shipped\)' *.md | wc -l)"
```
Expected: the two counts are **equal**. If not, list the gap with `for f in $(grep -rl 'type: project' *.md); do grep -Lq 'status:' "$f" && echo "MISSING: $f"; done` and fix.

---

## Task 3: Extract durable lessons before archiving

**Files:**
- Modify/Create: `feedback_*.md` / `reference_*.md` / `user_*.md` as needed

**Why:** Archiving must not lose a transferable lesson. Most shipped entries' lessons are ALREADY captured in the existing `feedback_*` block. This task finds the gaps.

- [ ] **Step 1: List existing procedural/semantic memories**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
ls -1 feedback_*.md reference_*.md user_*.md
```
Expected: ~25 feedback + a few reference/user files. These are the durable keepers.

- [ ] **Step 2: For each `shipped` file, decide if it taught an uncaptured lesson**

Read each shipped file's body. Apply the lint rule: *"Will a future session act better because of this?"* If it taught a durable gotcha/decision NOT already in a `feedback_*`/`reference_*` entry, note it. Most will already be covered (e.g. the cockpit shipped notes' lessons live in `feedback_cockpit_shell_pr_scope`, `feedback_dashboard_coverage_threshold`, etc.). Examples that may need capturing:
- `project_cockpit_v2_sprite_system_shipped` → Critical #3 (kind classification) is still open carry-debt → ensure it survives as an active note, not buried in an archived file.
- `project_contacts_pipeline_shipped` → the "prod flip awaits Vercel `NEXT_PUBLIC_CONTACTS_LIVE=true`" fact is active operational state → keep in Tier 1 active pointer, not archive.

- [ ] **Step 3: Create/update a `feedback_*` or `reference_*` entry for each uncaptured lesson**

For any gap found, write a new atomic memory (one fact per file) following the existing frontmatter format, with `**Why:**` and `**How to apply:**` lines. Prefer **update-over-create**: grep for a near-match first (`grep -rl "<keyword>" feedback_*.md`) and extend it rather than adding an adjacent entry.

- [ ] **Step 4: Verify no shipped file is the SOLE home of an open/active fact**

Run a scan for open-state markers in shipped files:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
for f in $(grep -rl 'status: shipped' *.md); do
  grep -liE "still open|carry-debt|awaits|not started|TODO|pending|blocked by" "$f" && echo "  ^ REVIEW: $f"
done
```
Expected: ideally empty. For any hit, confirm the active fact is captured elsewhere (Task 3 Step 3) before that file is archived in Task 4.

---

## Task 4: Archive the shipped episodic records

**Files:**
- Modify: `MEMORY.md` (remove shipped index entries)
- Modify: `MEMORY-archive.md` (add one-line pointers)
- Move (optional): long shipped topic files → `archive/`

- [ ] **Step 1: Append a one-line pointer per shipped entry to `MEMORY-archive.md`**

Under `## Shipped work (archived 2026-05-24)` in `MEMORY-archive.md`, add one line per shipped file:
```markdown
- [Phase D complete — agent-first redesign closed](project_phase_d_complete.md) — D1–D6 merged 2026-05-08..10
- [Alex Cockpit A.5 shipped](project_alex_cockpit_a5_shipped.md) — composer + ⌘K palette; Phase A 5/6
```
(one per file in the Task 2 `shipped` list). Keep each ≤150 chars.

- [ ] **Step 2: Remove those same entries from `MEMORY.md`**

Delete the corresponding shipped lines/sections from `MEMORY.md` (they now live in the archive). Leave the `active` project pointers in place — Task 5 regroups them.

- [ ] **Step 3: Move long shipped topic files into `archive/` (optional, size-driven)**

For shipped files over ~6 KB that are no longer useful as active detail, move them (plain `mv` — not a git dir) and fix the archive pointer's link to `archive/<file>`:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
mv project_alex_cockpit_a7_followup_scope.md archive/   # example: a shipped file ≈15 KB
```
> CAUTION: move ONLY files on the Task 2 `shipped` list. `project_audit_wave_2_phased_state.md` is the single largest file (~37 KB) but is **active** — do NOT move it. Short shipped files (<6 KB) may stay in place; moving is optional per spec.

- [ ] **Step 4: Verify archive pointers resolve**

Run (checks every link target in `MEMORY-archive.md` exists, in dir or `archive/`):
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
grep -oE '\]\(([^)]+\.md)\)' MEMORY-archive.md | sed -E 's/\]\((.*)\)/\1/' | while read -r t; do
  [ -f "$t" ] || [ -f "archive/$(basename "$t")" ] || echo "BROKEN: $t"
done
echo "done"
```
Expected: only `done` prints (no `BROKEN:` lines).

---

## Task 5: Rewrite Tier 1 — preamble + five priority sections

**Files:**
- Modify: `MEMORY.md`
- Create: `reference_dashboard_architecture.md` (absorbs verbose inline blocks)

- [ ] **Step 1: Demote the verbose inline reference blocks to a topic file**

The current `MEMORY.md` embeds full "Dashboard Architecture", "Key Design System", "Routing", "Character System", "App Shell Behavior", "Key API Hooks", "Lint/Type Rules" blocks inline. Move that content verbatim into a new `reference_dashboard_architecture.md` (frontmatter `type: reference`), leaving ONE pointer line in Tier 1.

Write `reference_dashboard_architecture.md`:
```markdown
---
name: dashboard-architecture-reference
description: Dashboard stack, design system, routing, character system, app shell, API hooks, lint rules — verbose reference
metadata:
  node_type: memory
  type: reference
---

<paste the moved blocks here verbatim>
```

- [ ] **Step 2: Write the Curation Policy preamble at the very top of `MEMORY.md`**

Insert immediately after the `# Switchboard Project Memory` title (verbatim from spec):
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

- [ ] **Step 3: Regroup the surviving Tier 1 entries under the five priority headers**

Restructure the rest of `MEMORY.md` into exactly these sections, in this order:
```markdown
## 1. Gotchas & failure-prevention rules
<all feedback_* pointers — the procedural block>

## 2. Canonical decisions
<project_alex_vertical_medspa, project_canonical_agent_names, project_two_register_design, core invariants>

## 3. Active pointers
<the 8 active project pointers from Task 2; one line each>

## 4. Semantic facts
<reference_dashboard_architecture pointer, reference_agent_patterns_catalog, reference_governance_trust_path, other reference_*>

## 5. Session triggers
<trigger_returned_from_australia and any other trigger_*>
```

- [ ] **Step 4: Shrink every Tier 1 line to ≤150 chars**

For each line, compress to `- [Title](file.md) — keyword-rich hook` ≤150 chars, absolute dates, no SHAs/PR logs. Find offenders:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
awk 'length > 150 {print length": "$0}' MEMORY.md
```
Expected after editing: no output (every line ≤150 chars). Repeat until clean.

---

## Task 6: Verify exit bar and emit the Consolidation Report

**Files:**
- Modify: `memory-maintenance-log.md`

- [ ] **Step 1: Verify the size cap**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
b=$(wc -c < MEMORY.md); l=$(wc -l < MEMORY.md)
echo "bytes=$b lines=$l"
[ "$b" -lt 24576 ] && [ "$l" -lt 200 ] && echo "PASS cap" || echo "FAIL cap — run another consolidation pass"
```
Expected: `PASS cap`. If `FAIL`, evict bottom-priority-first (section 5 → 4 → 3) per the preamble and re-run.

- [ ] **Step 2: Verify every Tier 1 link resolves**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
grep -oE '\]\(([^)]+\.md)\)' MEMORY.md | sed -E 's/\]\((.*)\)/\1/' | while read -r t; do
  [ -f "$t" ] || [ -f "archive/$(basename "$t")" ] || echo "BROKEN: $t"
done
echo "links checked"
```
Expected: only `links checked` (no `BROKEN:`).

- [ ] **Step 3: Verify no done-work event logs survive in Tier 1**

Run:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
grep -nE '`[0-9a-f]{7,40}`|PR #[0-9]+ →|→ `[0-9a-f]' MEMORY.md && echo "REVIEW above" || echo "PASS no event logs"
```
Expected: `PASS no event logs` (SHAs / PR→SHA arrows belong in Tier 3, not Tier 1).

- [ ] **Step 4: Stale code-claim check on surviving Tier 1 / gotcha entries**

For each backtick'd path referenced in `MEMORY.md` and the `feedback_*` files it points to, confirm it still exists in the Switchboard repo. Extract candidate paths:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
grep -ohE '`[a-zA-Z0-9_./-]+\.(ts|tsx|md|css|mjs)`' MEMORY.md | tr -d '`' | sort -u
```
For each path, check existence in the repo (`ls /Users/jasonli/switchboard/<path>`). For any that no longer exists, append a ` (stale 2026-05-24 — verify)` marker to that memory line. Exit bar: **zero stale claims left unmarked.**

- [ ] **Step 5: Append the Consolidation Report**

Append to `memory-maintenance-log.md` (fill counts from the work done):
```markdown
## Dream pass — 2026-05-24 (first pass, manual)
- Promoted (new feedback/reference from extracted lessons): <n>
- Demoted (verbose inline → topic file): <n>
- Archived (project+shipped → MEMORY-archive.md): <n>
- Merged (dedup): <n>
- Superseded: <n>
- Stale code claims flagged: <n>
- MEMORY.md size: 31933 B / ~190 lines → <b> B / <l> lines
```

- [ ] **Step 6: Final sign-off**

Run all three gates together:
```bash
cd /Users/jasonli/.claude/projects/-Users-jasonli-switchboard/memory
wc -c MEMORY.md; wc -l MEMORY.md
echo "project status coverage:"; echo "  $(grep -rl 'type: project' *.md | wc -l) project / $(grep -rl 'status:' *.md | wc -l) with status"
```
Expected: MEMORY.md < 24576 B and < 200 lines; project count == status count. If all pass, the pass is complete — and the backup from Task 0 can be deleted once you're confident (`rm -rf ../memory-backup-2026-05-24`).

---

## Notes for the executor

- **This rewrites the agent's own live memory.** Work deliberately; the Task 0 backup is the safety net.
- **Recall is text-matched, not semantic** — keep `description:` frontmatter and Tier 1 hooks keyword-rich.
- **`[[links]]`** between memories must keep resolving after moves; when moving a file to `archive/`, its inbound `[[name]]` links still match by slug, but Markdown `](path)` links need the `archive/` prefix.
- **Do not touch** the existing `feedback_*` gotcha content except to extend it — it is the highest-value tier.
