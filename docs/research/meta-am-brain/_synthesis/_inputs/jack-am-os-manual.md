# Jack Griesedieck's AM-OS Second Brain — Complete System Manual

**Jack Griesedieck — AM-OS Second Brain v2 (GDrive Primary) — June 2026. 34 ANZ Mid-Market Accounts — Multi-Agent Architecture.**

## 1. System Overview & Philosophy

This is a multi-agent knowledge system designed for an Account Manager managing 34 ANZ mid-market accounts. The core idea:

- **One brain, many agents** — Metamate, Claude Code, MyClaw, MetaClaw, and Codex all share the same knowledge base
- **Compounding knowledge** — every meeting, every analysis, every interaction adds to the brain. Nothing gets lost.
- **Skill-driven** — 14 structured skills (/morning, /prep, /post-meeting, etc.) provide repeatable workflows that read from and write to the brain
- **Additive only** — the system never deletes. It only accumulates. Cleanup is always manual.
- **Dual-source truth** — for any client, you must consult BOTH the structured context file AND the meeting notes Google Doc

**Mental model:** Think of it as a CRM replacement that lives in your AI agent. Instead of filling in fields manually, your AI reads meetings, extracts insights, updates the brain, and proactively tells you what matters each morning.

## 2. Architecture — Two Copies, Many Agents

The brain exists in two synchronized locations:

| Location              | Role      | Who Uses It                 | Access Method           | Why It Exists                                              |
| --------------------- | --------- | --------------------------- | ----------------------- | ---------------------------------------------------------- |
| Google Drive          | PRIMARY   | Claude Code, Codex, Avocado | Filesystem (FUSE mount) | Version history, durability, multi-agent filesystem access |
| MM2 (Metamate Memory) | Secondary | Metamate, MyClaw, MetaClaw  | meta agents.memory API  | Fast API access for Metamate skills                        |

**Golden Rule:** GDrive wins on conflict. If the same file is modified on both sides between syncs, the GDrive version is kept. This is a deliberate durability choice — GDrive has version history.

```
┌─────────────────────────────────────────────────────────────────┐
│                    JACK'S SECOND BRAIN                           │
├─────────────────────┬───────────────────────────────────────────┤
│   ┌─────────────┐  │  ┌─────────────┐    ┌────────────────┐   │
│   │  Google      │  │  │  Metamate   │    │  Google Docs   │   │
│   │  Drive       │◄─┼──│  Memory     │    │  (Meeting      │   │
│   │  (PRIMARY)   │──┼─►│  (MM2)      │    │   Notes)       │   │
│   └──────┬───────┘  │  └──────┬──────┘    └───────┬────────┘   │
│     FUSE mount      │    API calls           Docs API          │
│   ┌──────▼───────┐  │  ┌─────▼──────┐    ┌───────▼────────┐   │
│   │ Claude Code  │  │  │ Metamate   │    │ Both agents    │   │
│   │ Codex        │  │  │ MyClaw     │    │ via download() │   │
│   │ Avocado      │  │  │ MetaClaw   │    │                │   │
│   └──────────────┘  │  └────────────┘    └────────────────┘   │
│        ◄────── Sync every 30 min (bidirectional) ──────►       │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Inputs — Where Data Enters the Brain

| Input Source            | How It Gets In                               | What It Creates/Updates                                             | Frequency               |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| Post-meeting processing | /post-meeting skill after each call          | Interaction log, context.md updates, pipeline changes, action items | After every client call |
| CRM AI Meeting Notes    | Automated daily sync (sync-crm-notes)        | Meeting notes Google Docs                                           | Daily (automated)       |
| Presto spend data       | /refresh or /health-check pulls live spend   | Spend section in context.md, analysis files                         | On-demand or weekly     |
| CRM pipeline data       | /pitch-priorities queries CRM RS tables      | Pipeline files, RS section in context.md                            | On-demand               |
| Calendar                | /morning, /prep, /calendar read calendar     | Engagement plan, CI tracking                                        | Daily                   |
| Gmail                   | /prep skill searches recent emails           | Meeting prep context                                                | Before meetings         |
| Manual brain dumps      | User pastes notes, context, decisions        | context.md updates, one-off entries                                 | Ad hoc                  |
| Health check analyses   | /health-check runs Presto diagnostic queries | Analysis files (diagnostic, funnel, etc.)                           | Monthly or pre-QBR      |
| Account setup           | /setup pulls from CRM + ACDP tables          | index.yaml entry, initial context.md                                | Once per account        |

## 4. Outputs — What the Brain Produces

| Output                       | Triggered By      | What It Delivers                                                            | Data Sources Used                                                |
| ---------------------------- | ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Morning Briefing             | /morning          | Portfolio summary: spend alerts, calendar, overdue actions, attention items | All context.md files, calendar, spend data                       |
| Meeting Prep Brief           | /prep {account}   | Evidence-backed pitch rationale, spend deltas, RS map, talk track           | context.md, spend data, Gmail, calendar, pipeline, meeting notes |
| Post-Meeting Updates         | /post-meeting     | Updated context, new interaction log, pipeline changes, actions             | User-provided meeting notes → writes to brain                    |
| Account Health Check         | /health-check     | 180-day diagnostic: trajectory patterns, RS gaps, deep dives                | Presto spend/conversion data, context.md                         |
| Headroom Analysis            | /headroom         | Response curve: how much more can they spend before diminishing returns     | Presto daily spend/CPA data                                      |
| CPA vs Spend                 | /cpa-v-spend      | Scatter plot + regression: optimal spend zones, diminishing returns         | Presto daily spend/conversion data                               |
| Portfolio Sweep              | /sweep            | Attention matrix: which accounts need action and why                        | All context.md files, spend alerts                               |
| Client Brief                 | /client-brief     | External-facing brief for QBRs or handoffs                                  | context.md, analyses, pipeline                                   |
| Account Handoff              | /account-handoff  | Complete handoff doc for another AM                                         | Full account history: context, interactions, pipeline, analyses  |
| Weekly Revenue Commentary    | Weekly automation | Revenue vs quota, tailwinds/headwinds, action plan                          | CRM revenue tables, context.md                                   |
| Performance Levers Scorecard | On-demand         | P5/PBP adoption heatmap across all recommendations                          | fct_performance5_account Presto table                            |

**Key insight:** The brain is a flywheel. Each interaction (meeting → post-meeting) adds context that makes the next prep better. Over time, the AI knows more about your accounts than any CRM field could capture.

## 5. Complete File Structure

**Google Drive (PRIMARY)**

```
Jack AM Workspace/ (GDrive root)
├── brain/                          ← THE BRAIN (synced to MM2)
│   ├── AGENTS.md                   ← Operations manual (read by ALL agents)
│   ├── soul.md                     ← Identity & personality guidelines
│   ├── context.md                  ← Portfolio-level curated knowledge
│   ├── context-secondary.md        ← Updates pushed from Metamate
│   ├── index.yaml                  ← MASTER ACCOUNT REGISTRY (34 accounts)
│   ├── CLAUDE.md                   ← Claude Code bootstrap pointer (NOT synced)
│   ├── .locks/                     ← File locking directory (atomic mkdir)
│   ├── resources/
│   │   ├── skills/                 ← 14 AM-OS skill definitions (.md files)
│   │   ├── schema-reference.md     ← context.md schema documentation
│   │   ├── data-access-reference.md ← How to query each data source
│   │   ├── ownership-matrix.md     ← Which skills can write which sections
│   │   └── freshness-policy.md     ← Data staleness thresholds
│   ├── logs/                       ← System event logs
│   ├── meeting-insights/           ← AI-generated meeting analysis
│   └── projects/                   ← 34 ACCOUNT FOLDERS
│       └── {account-slug}/
│           ├── context.md          ← Account plan & state (the key file)
│           ├── interactions/       ← Meeting logs (immutable once written)
│           │   └── YYYY-MM-DD-meeting-type.md
│           ├── analyses/           ← Performance analyses
│           │   └── diagnostic-YYYY-MM-DD.md, headroom-*.md, etc.
│           └── pipeline/           ← RS pipeline items
│               └── rs-{solution-name}.md
├── Accounts/                       ← CLIENT MEETING NOTES (Google Docs)
│   └── {Client Name}/
│       └── Google Doc (one per client — accumulates all meeting notes)
├── projects/                       ← NON-ACCOUNT WORK
└── brain-archive/                  ← Pre-migration archive (read-only reference)
```

**MM2 — Metamate Memory (Secondary, synced mirror)**

```
/memories/personal/
├── agents.md              (= brain/AGENTS.md)
├── soul.md                (= brain/soul.md)
├── context.md             (= brain/context.md)
├── index.yaml             (= brain/index.yaml)
├── resources/
│   ├── skills/            (= brain/resources/skills/)
│   ├── schema-reference.md
│   ├── data-access-reference.md
│   └── ownership-matrix.md
├── projects/{slug}/
│   ├── context.md         ← Account plan (operational copy)
│   ├── interactions/      ← Meeting logs
│   ├── analyses/          ← Analysis output files
│   └── pipeline/          ← RS pipeline items
└── .config/brain-sync-config  ← PRIMARY=gdrive
```

**What is NOT in the brain (but feeds it):** Presto/Hive (live spend + performance, queried on-demand, results written to context.md); CRM/MetaCRM (pipeline, RS status, org structure; notes synced daily); Google Calendar (read by /morning, /prep, /calendar); Gmail (searched by /prep); Core Memory/Metamate (session bootstrap config — GDrive IDs, storage model, formatting prefs).

## 6. index.yaml — The Master Registry

The single most important file. Lookup table for all 34 accounts. Every skill references it to resolve account names to IDs.

```yaml
accounts:
  - slug: treasury-wine-estates # URL-safe identifier (used in paths)
    name: "Treasury Wine Estates" # Display name
    crm_name: "Treasury Wine Estates Limited" # Full CRM legal name
    search_aliases: ["TWE", "Penfolds", "19 Crimes"] # Fuzzy match aliases
    status: active # active | paused | churned
    tier: 2 # Account priority tier
    org_id: "123456789" # CRM Org FBID (for RS/pipeline queries)
    ad_account_ids: ["987654321", "111222333"] # For Presto spend queries
    meeting_notes_url: "https://docs.google.com/document/d/..." # Google Doc
    path: projects/treasury-wine-estates/context.md # Relative brain path
```

**How skills use index.yaml:** (1) Account resolution: "prep for TWE" → search slug, then name, then crm_name, then search_aliases. (2) Spend queries: pull ad_account_ids → query Presto. (3) CRM queries: pull org_id → query pipeline/RS tables. (4) Meeting notes: pull meeting_notes_url → download Google Doc. (5) File paths: use slug to construct projects/{slug}/context.md.

**Corruption risk:** index.yaml is the master registry for ALL accounts across ALL agents. A bad write here breaks every account lookup. Validate carefully before writing.

## 7. Account context.md — The Account Plan

Each account has a context.md that serves as the living account plan. Strict structure.

**YAML Frontmatter (machine-readable metadata):**

```yaml
---
type: account-context
id: treasury-wine-estates
updated_at: 2026-06-08T10:30:00+08:00
org_id: "123456789"
ad_account_ids: ["987654321"]
vertical: CPG
subvertical: Alcohol
region: ANZ
hq_country: AU
status: active
tier: 2
confidence: 0.85
scorecard_status: green
data_freshness:
  spend: 2026-06-07 # Last spend data pull
  initiatives: 2026-06-01 # Last CRM RS sync
  meetings: 2026-06-05 # Last meeting processed
  stakeholders: 2026-06-05 # Last stakeholder update
  diagnostic: 2026-05-15 # Last health check
rs_count: 8
rs_pitched: 5
rs_adopted: 3
---
```

**Body Sections (human + machine readable):**

| Section                  | Purpose                                  | Updated By                               |
| ------------------------ | ---------------------------------------- | ---------------------------------------- |
| ## Snapshot              | One-line spend + status summary          | /refresh                                 |
| ## Business Overview     | What the client does, their goals        | /setup (once)                            |
| ## Brand Profile         | Brand positioning, audience, competitors | /refresh                                 |
| ## State of Partnership  | Relationship health, strategic direction | /setup, /post-meeting (append)           |
| ## Spend & Performance   | Current spend levels, trajectory         | /refresh                                 |
| ## QoQ Spend Trajectory  | Quarterly spend comparison table         | /refresh                                 |
| ## Account Context       | What's Working, What's Not, Open Threads | /post-meeting (rewrite)                  |
| ## Recent Interactions   | One-line log of last 10 meetings         | /post-meeting, /log-interaction (append) |
| ## Stakeholders          | Contact table + attitudes                | /post-meeting (propose new rows)         |
| ## Recommended Solutions | Full RS matrix with stages               | /pitch-priorities (overwrite)            |
| ## Partnership Pillars   | Strategic pillar mapping                 | /pitch-priorities                        |
| ## Engagement Plan       | CI tracking, cadence                     | /calendar                                |
| ## Actions               | Open action items with owners            | /post-meeting (append + mark done)       |
| ## Changelog             | Append-only history of changes           | Any skill (append only)                  |

## 8. The 14 AM-OS Skills

**Daily Operations**

- **/morning** (Daily): Start-of-day portfolio briefing. Reads all context.md, calendar, spend alerts. Produces HTML briefing with attention items, calendar, spend flags. Writes nothing (read-only).
- **/prep {account}** (Daily): Evidence-backed meeting preparation. Reads context.md, pipeline, spend, calendar, Gmail, meeting notes. Produces prep brief with spend deltas, RS evidence map, talk track. Read-only.
- **/post-meeting** (After calls): Process meeting notes into structured updates. Reads user-pasted notes/transcript. Produces updated context, interaction log, pipeline changes, actions. Writes context.md, interactions/, pipeline/.
- **/log-interaction** (After calls): Quick log without full processing. Reads user summary. Writes interactions/ file + Recent Interactions in context.md.

**Weekly / On-Demand**

- **/sweep** (Weekly): Portfolio-wide attention scan. Reads all context.md. Produces attention matrix. Writes nothing.
- **/refresh {account}** (Weekly): Pull latest spend + CRM data. Reads Presto spend tables, CRM. Writes context.md (Snapshot, Spend, Brand Profile sections).
- **/pitch-priorities** (Weekly): Score and rank RS opportunities. Reads CRM RS data, context.md. Writes RS section in context.md + pipeline/ files.
- **/calendar** (Weekly): Manage CI tracking and cadence. Reads calendar, context.md engagement plans. Writes Engagement Plan section.

**Deep Analysis (requires Presto)**

- **/health-check** (Monthly): 180-day performance diagnostic. Reads Presto (180 days spend/conversion). Produces trajectory classification, RS gaps, deep-dives. Writes analyses/diagnostic-\*.md + diagnostic freshness.
- **/headroom** (Pre-QBR): Spend scaling response curve. Reads Presto daily spend/CPA. Produces logarithmic curve fit, predictions at incremental spend. Writes analyses/headroom-\*.md.
- **/cpa-v-spend** (On-demand): Scatter plot of efficiency vs spend level. Reads Presto daily spend/conversion. Produces regression, optimal zones, diminishing-returns threshold. Writes analyses/cpa-v-spend-\*.md.
- **/client-brief** (Pre-QBR): External-facing client brief. Reads context.md, analyses, pipeline. Produces polished brief. Output only.

**Admin**

- **/setup** (Once): Initialize account in the brain. Reads CRM tables, ACDP, user input. Writes index.yaml entry, context.md (initial), folder structure.
- **/account-handoff** (Rare): Generate handoff documentation. Reads everything for the account. Produces comprehensive handoff doc. Output only.

## 9. Daily Workflow — A Day in the Life

```
MORNING (8:30 AM) → /morning → Read portfolio briefing
  • Spend alerts (any accounts up/down significantly?)
  • Today's calendar (which clients am I meeting?)
  • Overdue actions (what did I promise to do?)
  • RS attention items (any stuck in pipeline?)

BEFORE EACH CALL → /prep {account} → Get meeting brief
  • What happened last time? (Recent Interactions)
  • How's spend tracking? (Live Presto data)
  • What should I pitch? (RS evidence map with WHY NOW)
  • What did they email about? (Gmail search)
  • Talk track with conversation starters

DURING THE CALL → Take notes (paste transcript or manual notes)

AFTER EACH CALL → /post-meeting → Process the meeting
  • Extracts decisions, actions, stakeholder updates
  • Updates context.md (Account Context section)
  • Creates interaction log (interactions/ folder)
  • Updates pipeline items (stage changes, blockers)
  • Adds new actions with owners and dates

END OF WEEK → /sweep (attention?) → /refresh (key accounts) → /pitch-priorities (recalc RS)

MONTHLY / PRE-QBR → /health-check → /headroom → /client-brief
```

## 10. Sync Mechanism (MEDI)

**How the bidirectional sync works:**

1. **Phase 1 — GDrive → MM2:** Walk all GDrive brain/ files. For each file newer than MM2's copy, push to MM2.
2. **Phase 2 — MM2 → GDrive:** Find files that exist ONLY in MM2 (created by Metamate skills). Pull to GDrive.
3. **Phase 3 — Context merge:** If context.md differs on both sides, use LLM additive merge (keep ALL info from both, deduplicate).

**Sync is ADDITIVE ONLY.** The sync NEVER deletes files from either side. Both GDrive and MM2 accumulate as a superset. Stale file cleanup is always manual.

**Synced (included):** AGENTS.md, context.md, soul.md, index.yaml, brain.json, resources/ (.md, .json), projects/ (.md, .json), logs/, meeting-insights/.
**Excluded (never synced):** CLAUDE.md (any level), TODO.md, metamate.md, .locks/, .claude/, .short-term-memories/, .git/.

**Sync direction summary:** Claude Code writes → GDrive → sync pushes to MM2 (every 30 min). Metamate writes → MM2 → sync pulls to GDrive (every 30 min). On conflict → GDrive version wins. Metamate's changes lost.

```
Timeline example:
  T=0:00  Metamate updates TWE context.md on MM2
  T=0:15  Claude Code updates TWE context.md on GDrive
  T=0:30  Sync runs → CONFLICT → GDrive version kept
          Metamate's T=0:00 changes are LOST unless LLM merge recovers them
```

## 11. Automations & Schedules

| Automation                | Schedule               | What It Does                                                          | Managed By               |
| ------------------------- | ---------------------- | --------------------------------------------------------------------- | ------------------------ |
| Brain Sync (GDrive ↔ MM2) | Every 30 min, weekdays | Bidirectional sync of all brain/ files                                | MEDI schedule            |
| Task Queue Worker         | Every 3 hours          | Processes cross-agent task queue (tasks one agent queues for another) | MEDI schedule            |
| CRM Meeting Notes Sync    | Daily                  | Pulls AI-generated meeting notes from CRM → Google Docs               | sync-crm-notes skillbook |
| Weekly Revenue Commentary | Weekly (Fridays)       | Generates revenue vs quota analysis with commentary                   | MEDI / automation skill  |

**Task Queue (Cross-Agent Communication):** Sometimes one agent needs another to do something (e.g. Claude Code completes an analysis and wants Metamate to send a GChat message).

```
# task_queue.md format:
- id: tq-001
  from: claude-code
  to: metamate
  action: send-gchat
  payload: "Health check for TWE complete — see analysis"
  status: pending
  created: 2026-06-08T10:00:00
```

## 12. Ownership Matrix — Who Writes What

Every section of context.md has exactly ONE owner skill that can rewrite it. Other skills can only PROPOSE changes via the Changelog.

| Section                  | Owner Skill                     | Write Mode               |
| ------------------------ | ------------------------------- | ------------------------ |
| ## Snapshot              | /refresh                        | Overwrite                |
| ## Business Overview     | /setup                          | Overwrite (initial only) |
| ## Brand Profile         | /refresh                        | Overwrite                |
| ## State of Partnership  | /setup, /post-meeting           | Append                   |
| ## Spend & Performance   | /refresh                        | Overwrite                |
| ## Account Context       | /post-meeting                   | Rewrite                  |
| ## Recent Interactions   | /post-meeting, /log-interaction | Append                   |
| ## Stakeholders          | /post-meeting                   | Propose new rows         |
| ## Recommended Solutions | /pitch-priorities               | Overwrite                |
| ## Engagement Plan       | /calendar                       | Overwrite                |
| ## Actions               | /post-meeting, /log-interaction | Append + mark done       |
| ## Changelog             | Any skill                       | Append only              |

**Key rules:** status and tier fields are HUMAN ONLY — never auto-overwritten. RS manual overrides (impact_override, ease_override) are NEVER touched by automation. Interaction files are immutable once created — never edited after the fact. Always update updated_at timestamp when writing ANY section.

## 13. External Data Sources

| Data Source       | What It Provides               | Access Method            | Key Table / Endpoint                         |
| ----------------- | ------------------------------ | ------------------------ | -------------------------------------------- |
| Presto (Spend)    | Daily spend by ad account      | SQL on analytics kernel  | edw_bir01.fct_ad_account_daily_revenue_split |
| Presto (Fallback) | Spend if Tier 1 returns 0      | SQL on analytics kernel  | bi.fct_account_rolling_stats                 |
| Presto (ACDP)     | Ad account discovery by org    | SQL on analytics kernel  | ad_reporting.acdp_dim_l4_ad_account          |
| CRM Notes         | AI-generated meeting summaries | SQL on analytics kernel  | dim_crm_rich_text_note                       |
| CRM Pipeline      | RS stages, opportunities       | SQL or GraphQL           | CRM tables via org_id                        |
| Google Calendar   | Meeting schedule, attendees    | Calendar skill (llmvm)   | Metamate calendar API                        |
| Gmail             | Client email threads           | Inbox skill (llmvm)      | Gmail search API                             |
| Google Docs       | Meeting notes history          | download() or Docs skill | Google Docs API                              |
| Performance5      | P5/PBP adoption metrics        | SQL on analytics kernel  | fct_performance5_account                     |

**Kernel requirements:** Skills that need Presto data must switch to the llmvm_analytics kernel. Skills that use memory, calendar, Gmail, or Google Docs run on the default llmvm kernel. Skills never mix kernels in a single execution.

- llmvm (default): /morning, /prep, /post-meeting, /log-interaction, /setup, /sweep, /calendar, /client-brief, /account-handoff.
- llmvm_analytics: /health-check, /headroom, /cpa-v-spend, /refresh (spend scope only).

## 14. Multi-Agent Access Model

| Agent                   | Access Path                    | Primary Use                          | Can Write?                   |
| ----------------------- | ------------------------------ | ------------------------------------ | ---------------------------- |
| Metamate (daily driver) | MM2 API (meta agents.memory)   | All 14 AM-OS skills, daily workflows | Yes → MM2 (synced to GDrive) |
| Claude Code (VS Code)   | GDrive FUSE mount (filesystem) | Complex analysis, bulk edits, coding | Yes → GDrive (primary)       |
| Codex                   | GDrive FUSE mount              | Automation development, scripts      | Yes → GDrive                 |
| MyClaw / MetaClaw       | MM2 API                        | Quick lookups, mobile access         | Limited (via MM2)            |

**Why multiple agents?** Metamate — best for structured workflows (skills), calendar, CRM integration, daily ops. Claude Code — best for complex reasoning, bulk file ops, building new skills, code-heavy analysis. The brain is agent-agnostic — any agent that can read the files can work. AGENTS.md tells them how.

## 15. File Locking Protocol

Multiple agents run concurrently. Before writing ANY file, you MUST acquire a lock. Without locks, last-write-wins = data loss.

**For filesystem agents (Claude Code, Codex):**

```bash
# 1. Acquire lock (mkdir is atomic on POSIX)
mkdir "$BRAIN_ROOT/.locks/{filename}.lockdir"
# Success = you own it. Failure = someone else has it.
# 2. If lock exists, check age:
#    < 10 min old → wait 30 sec, retry (up to 3 times)
#    > 10 min old → stale (agent crashed). rmdir and retry.
# 3. Write the file
# 4. ALWAYS release (even if write fails):
rmdir "$BRAIN_ROOT/.locks/{filename}.lockdir"
```

**For API agents (Metamate):** Metamate uses the MM2 memory API which handles concurrency internally. However, the 30-minute sync window means Metamate should avoid editing files that Claude Code recently modified.

## 16. Conflict Resolution

A conflict = same file modified on BOTH sides within one 30-minute sync window (Claude Code edited it on GDrive; Metamate edited it on MM2; neither saw the other's change before sync ran).

**Resolution strategy:** (1) LLM additive merge — keep ALL information from both versions, deduplicate. (2) On true factual contradiction → GDrive wins (primary source of truth). (3) Result written to both sides — so both are synchronized post-merge.

**Best practice:** If you just triggered a Metamate skill that writes to an account, wait a few minutes before editing the same file in Claude Code.

## 17. Danger Zone — What Breaks Things

**Catastrophic (immediate data loss):**
| Action | Why It's Catastrophic |
|---|---|
| Delete files from brain/ | Sync is additive-only. Deleted files won't come back. Data lost permanently. |
| Overwrite context.md wholesale | Metamate may have added info between syncs. Full overwrite loses those additions. Always merge/append. |
| Write to MM2 directly from Claude Code | Creates split-brain divergence. Sync expects Claude Code → GDrive only. |
| Rename/move brain/ folder on GDrive | FUSE mount uses paths. Moving breaks the mount. |
| Edit files without acquiring lock | Concurrent writes = last-write-wins = data loss. |
| Corrupt index.yaml | Breaks ALL account lookups across ALL agents. |
| Put content in CLAUDE.md | CLAUDE.md is excluded from sync. Other agents can't see it. |

**Degradation (drift over time):** Skip reading context-secondary.md (miss Metamate's updates until next full merge); write files >100KB (sync slows, context windows saturate); deep nesting >3 levels (MM2 API traversal slow, one call per level); spaces/unicode in filenames (MM2 path handling mangles); skip lock release after error (stale lock blocks others up to 10 min); write during active sync (sync might overwrite with MM2's older version); never run /refresh (spend data stale).

## 18. Setup From Scratch

- **Phase 1: Initial Setup (10 min):** Open Metamate → /setup → auto-detects identity, pulls CRM accounts, builds index.yaml → enriches ad account IDs from ACDP tables.
- **Phase 2: Google Drive Setup (15 min):** Create GDrive workspace folder → create brain/, Accounts/, projects/ subfolders → run agentify-brain ("agentify my brain") → sets GDrive as primary.
- **Phase 3: Meeting Notes Google Docs (20 min):** Create one Google Doc per client in Accounts/{Client Name}/ → add each URL to index.yaml under meeting_notes_url.
- **Phase 4: Sync Schedules (5 min):** /sync-brain --setup-schedule → creates Light sync (30 min) + Deep sync (2x/day). Prerequisite: Confucius grant at authorization page.
- **Phase 5: CRM Meeting Notes Automation (5 min):** Enable sync-crm-notes skillbook → daily automation pulls AI meeting notes → Google Docs.
- **Phase 6: Verify:** ls ~/gdrive/claude/AGENTS.md; meta agents.memory list --path=projects/; wait 30 min, compare both sides; test /morning + /prep.

## 19. Recommended Skillbooks Ecosystem

**Must-Have:** sync-crm-notes (CRM AI notes → Google Docs daily); meeting-notes-sync (MetaCRM AI notes with pagination); am-os-weekly-revenue-commentary (revenue vs quota narratives); performance-levers-scorecard (P5/PBP adoption heatmap); pitch-accelerator-anz (client-facing RS pitch decks from pipeline).

**Very Useful:** ads-manager-performance (campaign-level analysis); qbr-dashboard-generator (interactive QBR dashboards); competitive-creative-analysis (creative format gaps vs competitors); am-os-spend-diagnostic (CPA report + efficiency curve); dream-skill (memory consolidation — reviews 200 conversations, updates long-term memory).

**Nice-to-Have:** metamate-slides (HTML decks); designed-deck (editable .pptx); google-slides-html (Google Slides export).

## 20. Quick Reference Card

| Question                       | Answer                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| Where does Metamate write?     | MM2 (via agents.memory API)                                |
| Where does Claude Code write?  | GDrive brain/ folder (via FUSE mount)                      |
| Who wins on conflict?          | GDrive (always)                                            |
| How often does sync run?       | Every 30 min, weekdays                                     |
| Does sync delete files?        | NEVER. Additive only.                                      |
| Where are meeting notes?       | Google Docs in Accounts/ folder (not synced)               |
| Where is the account registry? | index.yaml at brain root                                   |
| What's excluded from sync?     | CLAUDE.md, TODO.md, metamate.md, .locks/, .claude/         |
| Must I lock before writing?    | YES. Always mkdir → write → rmdir                          |
| Can I delete brain files?      | NO. Archive/rename instead.                                |
| How do I add an account?       | /setup → creates index.yaml entry + context.md             |
| How do I get spend data?       | /refresh {account} → queries Presto, updates context.md    |
| How do I prep for a meeting?   | /prep {account} → generates evidence-backed brief          |
| How do I process a meeting?    | /post-meeting + paste notes → updates everything           |
| What if Presto data is empty?  | Check ad_account_ids in index.yaml, try Tier 2 query table |
| What about WhatsApp?           | Not available in Metamate environment — skipped silently   |
