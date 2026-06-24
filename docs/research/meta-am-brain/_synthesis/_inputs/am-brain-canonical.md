# AM Brain — Full Architecture (canonical, shareable)

**What this is:** the complete, self-contained architecture for a Meta Account Manager's personal agent system ("AM Brain"). It is a single deduped system that replaces the live AM-OS production vault and the am-brain-v1 scaffold. This document is the source of truth — it folds in a 4-agent adversarial review (2026-06-08) and states the corrected design directly. Any agent (Metamate, Claude Code, Codex, MyClaw, MetaClaw) can read this cold and understand the whole system.

- Operator: Jason Li — AM, APAC/Singapore. FBID 608717784 · sales_employee_id 495568 · unixname jasonljc.
- Portfolio: 33 active advertiser accounts (registry has 43; 10 flagged in_portfolio=false).
- Runtime: Claude Code / Metamate, macOS laptop (primary) + OnDemand available.
- Provenance tags: [V1] am-brain-v1 spec · [OS] AM-OS production · [JSB] Jack Griesedieck's Second Brain · [INT] internal Meta references · [REV] adversarial-review correction · [REV2] 2026-06-09 runtime-host verification (devserver cron + mclone GDrive).

## 1. Thesis

The system's center of gravity is dual and layered: a compounding knowledge store — a Karpathy compiled wiki of flat, typed, interlinked pages (account/trend/playbook/signal/decision) where insight accrues across accounts — feeding a calibration-honest decision engine that tells the AM what to do today and drafts the outbound. The store compounds one-directionally (compiled, not merged — raw sources retained, pages link back, supersession > decay), so it gains the Jack/Karpathy compounding benefit without the fabrication/loss of a bidirectional merge. The deterministic data plane and dual-layer memory are plumbing in service of that. (Refined 2026-06-10: this is NOT "decision engine instead of knowledge store" — it is a compounding knowledge store WITH cognition on top.)

This is genuinely unserved by shipped tooling: Meta's GA Sales AI (~35 subagents) is read-only, browser-based, stateless-per-query, and does not draft outbound or run a proactive daily loop. AM Brain is proactive, action-drafting, persistent, and self-hosted (runs on a persistent Meta devserver — [REV2]; laptop only for interactive chat). Where Sales AI overlaps (CRM data, eval grounding), AM Brain reuses it rather than rebuilding it.

## 2. Design principles (invariants — non-negotiable)

| #    | Law                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| I-1  | **Determinism in code, judgment in the model.** All classification/joining/thresholding/ranking math is tested Python; the LLM does language + genuinely-ambiguous judgment only.                                                                                                                                                                                                   | Long LLM "skills" (1400+ lines) drift: misclassify, skip steps. [OS]                                                              |
| I-2  | **Rules first, numbers last.** Categorical bands order everything; a numeric score only breaks ties within a band. Low-confidence / human-judgment items render as a question, not a recommendation.                                                                                                                                                                                | Kills confident-but-wrong output. [V1]                                                                                            |
| I-3  | **Unknown ≠ zero. Never fabricate.** Absent inputs render unknown; uncalibrated surfaces carry a PACING UNCALIBRATED banner; unsourced proof points render [NEEDS CLEARED BENCHMARK].                                                                                                                                                                                               | The #1 way dashboards lie. [V1]                                                                                                   |
| I-4  | **Mirror the system of record; never invent its keys.** rs_id/org_id/sfid copied verbatim; the brain annotates, never authors CRM truth.                                                                                                                                                                                                                                            | Keeps the brain subordinate to CRM/ads. [V1][JSB]                                                                                 |
| I-5  | **Field-level ownership.** Every field is human-owned, agent-suggests (parked under suggested:), or generated. Agents never silently overwrite human judgment; auto-built files are never hand-edited.                                                                                                                                                                              | Safe autonomy over shared files. [V1][INT]                                                                                        |
| I-6  | **Gate the outbound, not the files.** No per-file ACLs (single operator legitimately sees all own clients). The real risk is one client's data in another's send — enforced at the draft boundary.                                                                                                                                                                                  | Boundary where the leak actually happens. [V1][INT]                                                                               |
| I-7  | **One canonical store; no bidirectional merge.** [REV3] Canonical = Metamate project memory (/memories/project/<id>/). Markdown + git in GDrive is a derived, one-way, read-only backup (DR + history), never edited/synced-back. No second live read/write store; no bidirectional LLM merge, ever. (REV1/REV2 had GDrive markdown canonical + git; flipped 2026-06-09 — see §11.) | Bidirectional prose-merge silently loses + fabricates data; a hosted scheduler can't natively touch raw-.md+git. [REV][REV3][INT] |
| I-8  | **Mirror live, author durably.** SoR-derived facts are thin regenerable caches (fetched_at, shelf-life, freely deletable); synthesized judgment is the durable, versioned truth. Stale cache is never served as fresh.                                                                                                                                                              | Makes staleness structural, not policy. [REV]                                                                                     |
| I-9  | **Draft-only at launch (autonomy rung 0).** "Approval" = the agent writes a Gmail Draft; the human reviews and sends. No auto-send. Graduate only on numeric criteria.                                                                                                                                                                                                              | No native approval UI; external sends are highest-risk. [V1][INT]                                                                 |
| I-10 | **Poll on schedule; there is no event path.** Tiered polling: cheap precheck before the LLM wakes. The scheduler runs on a persistent Meta devserver (always-on), not the laptop.                                                                                                                                                                                                   | No event bus exists; a devserver cron is the reliable unattended driver. [V1][INT][REV2]                                          |

## 3. System diagram

```
        OPERATOR (Jason, macOS laptop) ── reads generated/today.md · reviews drafts/ · sends · confirms
            ▲ cockpit + drafts (destination = operator)        │ "what's up with <client>?"
   ┌────────┴───────────────────────────────────────┐         │
   │  GENERATION (no per-client taint — operator-only)│         │
   │  reasons across ALL 33 clients freely            │◀────────┘ dual-load answer (score_reason+confidence)
   └────────┬───────────────────────────────────────┘
            │ produces a client-bound outbound?
   ┌────────▼───────────────── DRAFT-BOUNDARY GATE [V1+REV] ─────────────────────┐
   │  taint = THE ONE recipient client · cross-client content in one send → BLOCK  │
   │  no source → [NEEDS CLEARED BENCHMARK] · no raw spend to client · DRAFTS ONLY │
   └────────┬─────────────────────────────────────────────────────────────────────┘
            ▼  drafts/  (Gmail Draft; human sends)
 ─────────────────────────────────────────────────────────────────────────────────────
   ┌──────────────────────────────┐        ┌────────────────────────────────────────┐
   │  DECISION ENGINE (engine/, Py)│        │  RETRIEVAL                              │
   │  ALG-1 pace ALG-2 cover        │◀──────▶│  default: registry alias→slug → file    │
   │  ALG-3 mix  ALG-4 evidence     │  reads │  read (dual-load) + grep + recall hook  │
   │  ALG-5 RS-rank  ALG-8 cockpit  │  state │  (FAISS/BM25/KG = opt-in past ~5K chunks)│
   └──────────────┬────────────────┘        └────────────────────────────────────────┘
                  │ reads structured cache + authored truth
   ┌──────────────▼─────────────────────────────────────────────────────────────────┐
   │  KNOWLEDGE (vault markdown — Brain Protocol)        TWO TIERS:                    │
   │  ── MIRROR tier (thin, regenerable, fetched_at, NOT versioned/backed up) ──       │
   │     clients/<slug>/{performance, rs-ledger, interactions/, contacts}              │
   │  ── AUTHORED tier (durable truth, git-versioned) ──                               │
   │     clients/<slug>/{profile, relationship, style, narrative, commitments}         │
   │     _system/{registry, identity, data-access, ownership, clearance, cap-audit}    │
   │     agents.md (directives) · context.md (auto-built synthesis, never hand-edit)   │
   └──────────────┬─────────────────────────────────────────▲───────────────────────┘
        cache fill │                                          │ narrative fill (ingestion)
   ┌───────────────▼──────────────┐        ┌──────────────────┴────────────────────────┐
   │  DATA PLANE (engine/pulls/)   │        │  INGESTION                                  │
   │  6 parallel no-CAT pulls;      │        │  CRM AI-notes (dedup/TZ/ownership) [JSB]    │
   │  numeric-ID match first;       │        │  + CRM VC transcripts (96h window) [V1]     │
   │  registry IN(all ad_acct_ids)  │        │     → clients/<slug>/narrative.md           │
   └───────────────┬──────────────┘        └─────────────────────────────────────────────┘
                   │ READ-ONLY: jf graphql→xfb_presto tunnel · meta CLI · Unidash MCP · CRMUnifiedAPI MCP
   ┌───────────────▼──────────────────────────────────────────────────────────────────┐
   │  SYSTEMS OF RECORD: Ads insights · CRM (initiatives/CI) · Calendar · Gmail · VC     │
   └────────────────────────────────────────────────────────────────────────────────────┘

 RUNTIME (drives it all):  persistent devserver → crontab/systemd-timer (or MyClaw daemon) → TIERED POLL
    Tier1 Schedule (free) → Tier2 cache-diff Filter (cheap, no LLM) → Tier3 Agent wake (LLM)
    + independent Tier1 timer: 96h transcript-capture sweep (unconditional)   [host: always-on, not the laptop]
 STORAGE:  GDrive markdown = CANONICAL (mounted on the devserver via mclone+systemd)  +  local git (versioning/recovery)
    one writer · append-only history · no locks/tombstones/second-store
```

## 4. On-disk layout

```
am-brain/                              ← the one system root
├── agents.md                          ← [INT] Brain Protocol directives, read every session
├── context.md                         ← [INT] auto-built portfolio synthesis (NEVER hand-edit)
├── config.md                          ← [V1] ALL constants: targets, thresholds, shelf-lives (single source)
│
├── _system/                           ← contracts + identity (AUTHORED tier; git-versioned)
│   ├── am-identity.json               ← FBID 608717784 · sales_employee_id 495568 · unixname jasonljc
│   ├── registry.json                  ← ONE registry: {slug → org_id, ad_account_ids[], account_team_id,
│   │                                     sfid, search_aliases[], narrative_path, in_portfolio}
│   ├── data-access.md                 ← verified pull paths + dead-ends (§6)
│   ├── ownership.md                   ← field-level ownership rules (I-5)
│   ├── capability-audit.md            ← NATIVE/BUILDABLE/IMPOSSIBLE verdicts + corrections (§9)
│   └── clearance/{benchmarks.md, dss-tiers.md}   ← operator-supplied cleared-benchmark library
│
├── engine/                            ← deterministic plane (Python)
│   ├── pipeline.py                    ← orchestrator: parallel pulls → cache → classifiers → render
│   ├── pulls/                         ← spend · rs · ci · calendar · email · crm_status · transcript
│   ├── classifiers.py                 ← pure ALG-1..5 functions, named constants, fully tested
│   ├── render.py                      ← ALG-8 cockpit + scorecard/coverage/rs-queue renderers
│   ├── gate.py                        ← draft-boundary clearance gate (single-recipient taint)
│   └── tests/                         ← unit tests (data-plane tests port from AM-OS; ALG tests are new)
│
├── clients/<slug>/
│   │   ── MIRROR tier (thin caches; fetched_at; freely deletable; NOT git/backup) ──
│   ├── performance.md                 ← generated from ads insights; every number source+fetched_at
│   ├── rs-ledger.md                   ← mirrors CRM (rs_id verbatim); stage clock via state-diff (§7)
│   ├── interactions/<YYYY-MM>.md      ← monthly CI digest (countable_ci flag; Email NOT countable)
│   ├── contacts.md                    ← business contacts, PII-minimized
│   │   ── AUTHORED tier (durable truth; git-versioned) ──
│   ├── profile.md                     ← human-owned strategy, 1 page (agent proposes diffs)
│   ├── relationship.md                ← trust/mood/objection (change only on confirm; suggested:{})
│   ├── style.md                       ← voice seed + do/don't
│   ├── narrative.md                   ← [JSB] cumulative reverse-chron meeting log (DUAL-LOAD partner)
│   └── commitments.md                 ← append-only; overdue recomputed daily
│
├── playbooks/<product>.md             ← per-solution playbook (clearance-gated proof points)
│
├── generated/                         ← daily outputs (overwrite; unknown≠0; CONF-1 banner if uncalibrated)
│   ├── today.md                       ← THE COCKPIT (ALG-8): MUST DO ≤3, OPTIONAL ≤7
│   ├── scorecard.md                   ← pacing (ALG-1)
│   ├── coverage.md                    ← coverage + solution-mix (ALG-2/3)
│   └── rs-queue.md                    ← ranked RS (ALG-5)
│
├── drafts/                            ← rung-0 outbound (mirrors Gmail Drafts); human sends
├── logs/{event-log.jsonl, context-ledger.jsonl, cron-errors.log}
├── .git/                              ← local version history + recovery (replaces lock/tombstone/WAL machinery)
└── _archive/                          ← retired AM-OS shell, read-only

   ~/para/learn/                       ← retrieval index (opt-in upgrade; not a store)
```

**Memory roles (no overlap):** vault = truth · git = versioning/recovery · para-learn = optional index · MEMORY.md = behavior/feedback only · CLAUDE.md = static directives only. No fact lives in two places without a source-of-truth marker.

## 5. The layers

| Layer              | Role                                                                                                                                                                                                                               | Built from       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| L1 Storage         | GDrive markdown canonical + local git. One writer; append-only history; no second store, no locks, no tombstones. Mounted on the persistent devserver via mclone+systemd (same vault the laptop sees).                             | [REV][INT][REV2] |
| L2 Data plane      | pipeline.py runs 6 parallel READ-ONLY no-CAT pulls; standardized envelope {step,status,time_ms,data,error}; numeric-ID matching first; registry IN(all ad_account_ids). Failed pull → unknown, never 0.                            | [OS]             |
| L3 Knowledge       | Two-tier dossier (mirror caches vs authored truth) + narrative.md dual-load + Brain Protocol format. Retrieval defaults to slug-read + grep + per-prompt recall hook.                                                              | [JSB][V1][INT]   |
| L4 Decision engine | ALG-1 pacing · ALG-2 coverage · ALG-3 solution-mix · ALG-4 evidence-banding · ALG-5 RS-rank (rules→numbers, question-fallback) · ALG-8 cockpit. Calibration honesty (CONF-1). Eval-judge harness for grounding.                    | [V1][INT]        |
| L5 Safety          | Draft-boundary gate: 3 rules — single-recipient taint, no raw spend / [NEEDS CLEARED BENCHMARK], drafts-only. Context Ledger logs every proposal+decision.                                                                         | [V1][INT]        |
| L6 Runtime         | persistent devserver → crontab/systemd-timer (or MyClaw agentic daemon) → tiered polling; daily cockpit; independent 96h transcript sweep. NOT the harness cron (REPL-idle + 7-day expiry) and NOT an OnDemand (18h-idle reclaim). | [INT][V1][REV2]  |
| L0 Capability gate | Re-run NATIVE/BUILDABLE/IMPOSSIBLE audit before building any new capability.                                                                                                                                                       | [V1]             |

## 6. Data access — paths that WORK (no CAT, from the laptop)

All READ-ONLY. Tunnel: jf graphql → xfb_presto_tools.execute_query (Presto via employee GraphQL token). Wrap every call with `export META_TRACING_DISABLE=1` (known ~75s hang on Mac/VPN/IPv6). jf graphql is officially unsupported ("no feature work") — tolerable but unowned.

| Signal                | Path                                                                                                    | Notes                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spend daily/WoW       | GraphQL ad_account.ad_insights{spend_usd}; fallback Presto edw_bir01.fct_ad_account_daily_revenue_split | cents ÷100; ad_account_id IN (ALL ids) — single id undercounts up to 70%. Spend path has an open VERIFY (a 2026-04 doc saw zeros) → default to Presto fallback until one live call confirms nonzero. |
| RS / initiatives + AR | GraphQL intern_user(FBID).crm_sales_user.initiatives(first:500)                                         | by FBID; paginate ~800–900 across 2 batches                                                                                                                                                          |
| RS EOS                | Presto dim_crm_account_plan_initiative (estimated_opportunity_size ÷100)                                | EOS not on GraphQL (dead-end)                                                                                                                                                                        |
| RS stage clock        | state-diff initiative_stage across pulls → stamp stage_entered_at on change                             | Do NOT use modified_time (moves on any edit → hides overdue RS). Historical = unknown.                                                                                                               |
| CI real-time          | GraphQL crm_client_interactions(first:200)                                                              | ~41 hard cap                                                                                                                                                                                         |
| CI full-quarter       | Unidash CI widget tab 1174094300424212                                                                  | selector sales_employee_id = 495568 (not FBID); quarter_id="YYYY-01-01"                                                                                                                              |
| Transcripts           | GraphQL crm_client_interactions → partner_event → vc_sessions{summary}                                  | 96h access window — capture via the independent sweep                                                                                                                                                |
| Calendar / Email      | meta calendar._ / meta google.gmail._ (read/draft)                                                      | meta CLI (Gmail Apps-Script path is BLOCKED)                                                                                                                                                         |
| Attribution gap       | territory-scoped l12_territory_name fallback                                                            | recovers shared/strategic accounts invisible to personal-book filter [INT]                                                                                                                           |
| CRM (shipped)         | CRMUnifiedAPI MCP where it overlaps the tunnel                                                          | permission-parity, oncall-supported — prefer over bespoke pulls when equivalent [INT]                                                                                                                |

**Dead-ends (do not retry):** EOS on GraphQL · baseline_metrics · 5-step Presto RS pipeline · partner_events direct (needs CRM_GRAPHQL_ACCESS GK) · node()...on VCSession · CAT-only all_ads_details/fct_ad_rolling_stats/crm_key_initiative_quarterly_rolling · GraphQL introspection on AccountPlanInitiative · Gmail Apps Script · WhatsApp send (read-only inbound, OnDemand-only). ID discipline: FBID vs sales_employee_id vs unixname — all from am-identity.json, never hardcoded.

## 7. The daily loop

```
devserver crontab / systemd-timer (always-on Meta host — survives a closed laptop because it is NOT the laptop)
 └─ /cron daemon  [RLIMIT_AS=8GB · track last-dispatch (no double-fire) · stagger ≥1min · batch-and-assemble]
    │
    ├─ Tier1 Schedule: 07:00 SGP weekdays (working_calendar)
    │   └─ Tier2 cache-diff Filter (cheap, NO LLM):
    │        • time-driven (ZERO network): days_in_stage advances locally from cached stage_entered_at
    │          → any RS crossing 14d/28d attribution window? overdue commitment? meeting today?
    │        • these gate ~90% of cheap exits
    │        • spend-cliff / new-CI genuinely require a pull → if checked, they wake Tier3
    │        └─ nothing due → exit silently
    │           └─ Tier3 Agent wake (LLM, only when work found):
    │                1. pipeline.py: 6 parallel no-CAT pulls → MIRROR-tier cache (performance, rs-ledger)
    │                2. classifiers: ALG-1 pace · ALG-2 cover · ALG-3 mix · ALG-4 evidence · ALG-5 rank
    │                   → generated/{scorecard,coverage,rs-queue}.md  (unknown≠0; CONF-1 if uncalibrated)
    │                3. render: ALG-8 → generated/today.md (MUST DO ≤3 · OPTIONAL ≤7)
    │                4. evidence-ready RS + due outreach → gate.py → drafts/ (Gmail Drafts)
    │                5. write event-log + context-ledger; git commit; cron-error log on any failed pull
    │
    └─ Tier1 Schedule (independent, unconditional): every 12h
        └─ 96h transcript sweep: for any meeting in last 96h → ingest VC summary + CRM AI-notes
             (dedup/TZ-norm/ownership-validate) → clients/<slug>/narrative.md   ← bypasses Tier2 cost filter

 Weekly: hygiene/coverage sweep + re-arm cron.   Monthly: stale-context review (delete landed/abandoned).
 Operator: reads today.md · reviews drafts · sends · confirms agent suggestions.
```

## 8. The query flow (operator asks about a client)

```
"what's going on with <client>?"
 └─ registry: name/alias → slug
    └─ DUAL-LOAD:  clients/<slug>/ authored (profile,relationship,style,narrative,commitments)
                 + mirror (performance, rs-ledger)        [+ per-prompt recall hook injects top memories]
       └─ decision logic (ALG bands) → answer WITH score_reason + confidence
            • confidence low / required_human_judgment → render as a QUESTION, not a recommendation
            └─ asked to reach out? → gate.py (taint = this one client) → drafts/ (Gmail Draft) → human sends
```

The cockpit and any analysis span all 33 clients freely (destination = operator, no taint). Single-recipient taint applies only when producing a client-bound outbound artifact.

## 9. Component contracts (the joins that must hold)

| From → To                   | Contract                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| registry → pulls            | spend/perf use ad_account_ids[] IN (...) — never a single id (≤70% undercount)                       |
| pulls → cache               | standardized envelope; a failed pull renders unknown, never silent 0                                 |
| cache → classifiers         | numeric-ID match (org_id/team_id/ad_account/sfid) first; text match only as logged fallback          |
| classifiers → generated     | rules-first-numbers-last (I-2); a numeric score never reorders across bands                          |
| rs-ledger → ranking         | rs_id verbatim from CRM; stage_entered_at from state-diff, not modified_time; pre-existing = unknown |
| decision → operator         | every recommendation carries score_reason + confidence; low-confidence → a question                  |
| any client-bound send → out | passes gate.py: single-recipient taint · no raw spend · [NEEDS CLEARED BENCHMARK] · draft-only       |
| writes → store              | one writer; append-only history; git commit each run; auto-built files never hand-edited             |
| mirror tier                 | always carries fetched_at; never source of truth; not versioned/backed up; query-live-first          |
| authored tier               | the only git-versioned truth; field-level ownership; agent edits parked under suggested:             |
| new capability → build      | re-run capability audit (NATIVE/BUILDABLE/IMPOSSIBLE) first                                          |

## 10. Safety model (L5, launch posture)

Three rules, enforced at the draft boundary (gate.py), backed by drafts-only autonomy:

1. **Single-recipient taint** — a draft may contain data from exactly one client (its recipient); cross-client content in one send is BLOCKED. (Applies to outbound artifacts, not analysis.)
2. **No leak of sensitive figures** — no raw spend / WoW% to a client; any proof point without a cleared source renders [NEEDS CLEARED BENCHMARK]; the model must not improvise benchmarks.
3. **Drafts only** — the agent writes a Gmail Draft; the human reviews and sends. Nothing auto-sends.

Every proposal + decision is appended to the Context Ledger (logs/context-ledger.jsonl) for audit. The full Agent IO Security DSS×Destination matrix + delegation-laundering rules are the reference design for the future (when sub-agents or multi-tenant arrive); at single-operator launch the three rules above are sufficient. (Agent IO Security = outbound gate; Privacy-Infra "Sensitive Mode" = inbound DSS-4 read gate — complementary layers. AM/client data is generally DSS-2/3.)

## 11. Storage + runtime-host decision [REV3 2026-06-09 — APPROVED, supersedes REV2 below]

**REV3 (APPROVED): Metamate-native.** Canonical store = Metamate project memory; host = Metamate Automations; markdown+git = read-only backup. Full design: am-brain/docs/specs/2026-06-09-am-brain-metamate-native-storage-design.md.

- **Why the flip:** the L6 spike found (a) no self-serve persistent devserver from the Mac (only ephemeral OD), and (b) Metamate Automations is a real hosted/unattended scheduler but cannot natively touch raw-.md+git in GDrive (connector not FUSE; .md unreadable; no server-side git). {file+git canonical, hosted, unattended} = pick two. REV2 chose file+git+unattended → paid with an unprovisionable devserver. REV3 chooses hosted+unattended and moves the store to where the hosted scheduler can natively read/write.
- **Canonical = Metamate project memory** (/memories/project/<id>/ — available to scheduled missions, unlike /memories/personal/). Cron (Automation/Sandcastle) and operator (Collab Files in the Mac browser — no devserver/CLI) read/write the same namespace. One store, two surfaces → no sync, no drift, no git-in-mount, no devserver.
- **Markdown + git in GDrive = nightly one-way read-only backup** (DR for the namespace SPOF + human-browsable history). Never edited, never synced back.
- **Guardrails (evidence-driven):** project≠personal memory; strict per-file single-writer via owner: frontmatter (same-file = silent last-write-wins); cron never read-modify-writes a human file (MM2 is eventually consistent ~minutes); context.md/index.yaml automation-owned read-only (/brain:build steamrolls); verify-with-retry; mandatory backup; loud failure (heartbeat, "0 written"=fail) — the 164-silent-run disaster was personal+bidirectional+silent, all avoided here.
- **Open before build:** MM2 per-file size limit (~100KB unverified) + truncation; MM2 version-recovery/retention; engine-in-mission delivery (fbsource scmquery vs skillbook vs Dataswarm — own design); namespace provisioning + agents.md/README.md seed. L1/L2 logic unchanged; L2 packaging changes only with the engine-in-mission choice.
- **Maturity risk:** MM2 Brain backend + Collab Files are late-beta; Automations has a known ~23-run silent-stop bug (delete/recreate remediation + weekly health check).

**REV2 (SUPERSEDED by REV3 — retained for rationale) — GDrive-canonical on a persistent devserver**

Storage = GDrive markdown + local git (unchanged). This was never really about the laptop — it's about wanting one canonical, human-readable, recoverable store that is NOT a blocked native memory platform. That holds regardless of where the code runs.

Runtime host = a persistent Meta devserver, not the laptop (REV2). Verified 2026-06-09:

- **Scheduler:** a devserver crontab/systemd-timer (or MyClaw, an agentic daemon with a built-in cron scheduler) is the reliable unattended driver. Explicitly NOT the harness cron (fires only while the REPL is idle + auto-expires after 7 days) and NOT an OnDemand instance (reclaimed after ~18h idle). A persistent devserver is the documented home for "always-on, long-running automation."
- **GDrive reach:** the devserver mounts the same GDrive vault via mclone+systemd (read/write, dotsync-persisted) — the gdrive-mount skill already does this. So the scheduled job reads/writes the exact files the laptop sees.
- **Pulls:** jf graphql/Presto and the meta/gcal/gmail CLIs run natively on a Meta devserver. (The ~75s META_TRACING_DISABLE hang was a Mac/VPN/IPv6 artifact and is expected to disappear on a datacenter host; keep the flag — harmless.)

The native-Metamate-memory question is now moot for the runtime. meta agents.memory was only ever blocked from a Mac; we are not on a Mac and we are not using it as the store (GDrive is). The flip trigger below still governs if we ever adopt native memory, but it is no longer on the critical path.

**Flip trigger (unchanged, in capability-audit.md):** consider agents.memory only if (a) meta agents.memory read succeeds from the chosen host, AND (b) the personal-memory bug is closed, AND (c) a redundancy story exists. Until then: GDrive canonical, git for recovery, optional one-way export — never a second live store.

**Open host-level VERIFY items (do before L6 cutover) — SPIKE RESULTS 2026-06-09:**

1. **git inside the mclone mount.** ⏸ NOT YET TESTED on a devserver — blocked by item 2 (no persistent devserver was provisionable). Still the live risk if the devserver path is chosen. Fallback (git on local disk + sync markdown to mount) stands as the contingency.
2. **Devserver longevity / provisioning.** ❌ BLOCKER FOUND. From the Mac, the only self-serve host broker (ondemand CLI) offers ephemeral OnDemand only — ondemand list shows zero instances and the reservable pool is 100% od:\* types (fbcode/www/shellserver/mobile…). There is no self-serve persistent-devserver type, and no devserver in ~/.ssh/config/known_hosts. A persistent devserver requires a separate provisioning/request flow the operator must file; it cannot be stood up from this session.
3. **CLI presence.** ✅ CONFIRMED on the laptop — jf /opt/facebook/bin/jf, meta /opt/facebook/bin/meta, gcal/gmail → /opt/facebook/bin/google-mux all present. (Devserver-side presence still to confirm on whatever host is eventually chosen — expected present on standard Meta hosts.)
4. **Spend is host-independent.** ✅ CONFIRMED by reasoning, not re-probed — no devserver existed to re-probe from; the dead-end is identity/3PD-ACL-bound and the hosted/jasonljc identity is unchanged, so spend stays unknown. (Probe deferred until a real alternate-identity host exists; expectation unchanged.)

**REV3 finding — Metamate 2.0 Automations is a real hosted scheduler but is ARCHITECTURALLY INCOMPATIBLE with I-7 (file+git) unchanged.** [REV3 2026-06-09] Investigated as a candidate replacement for the persistent devserver (3 fan-out probes, HIGH-confidence, wiki-sourced):

- It exists and is genuinely hosted/unattended. "Automations" (time-based cron/interval/one-shot + event triggers) run server-side on Meta infra (EventRouter → Agent Runtime → Sandcastle/Tupperware warm-tier) and fire when the laptop is closed, running as you via a one-time confucius/mission/authorize grant. This is exactly the always-on trigger the devserver was for. (MyClaw/MetaClaw are devserver-local and being deprecated ~June 1 into Automations.)
- But it cannot host our current design: (a) Drive access is connector/API by Google file ID, NOT a FUSE mount — the mission never sees the laptop's mounted vault; (b) raw .md files are not reliably readable and folder-recursive "read 200 files by path" is not a primitive (Docs/Sheets only); writes create Google Docs, not raw .md; (c) no git over the Drive-backed vault (files aren't on the sandbox FS; CLI reliability in missions is poor); (d) arbitrary python3 -m engine.pipeline is not native — code must be delivered via skillbook cells, fbsource source: scmquery, or a Dataswarm PythonMetamateAgentOperator job; the sandbox is ephemeral per run (state persists via project-memory/Hive/Workspace, not a working dir). The one documented production cron catalog uses a Google Sheet as canonical store, not files+git. Also note: ~23-mission silent-stop bug + intermittent missed runs (reliability landmine for a daily driver).
- Net: Automations and (file+git canonical, hosted, unattended) can't all be true at once — pick two. The persistent devserver (REV2) remains the only I-7-compatible host. Adopting Automations would require reopening I-7 (move canonical state to a Sheet/Hive, land engine/ in fbsource, drop git-for-vault for Drive/Sheet revision history) — a deliberate redesign, not a drop-in.

**Recommended L6 path (proposal — REV2 stays locked until operator decides):**

- **Now → option 3 (on-demand on the laptop).** The laptop already has the FUSE mount + git + Python; run the cockpit/drafts interactively (/today) when the operator sits down. I-7 fully intact, zero infra to provision, ships the value immediately. A tiny Metamate Automation can serve as a hosted 07:00 nudge (it can read a small Sheet the laptop last wrote, or just ping) — using Automations for what it's good at without depending on it for file I/O.
- **Later → option 1 (devserver-backed unattended loop)** once a persistent devserver is requested/granted; then close VERIFY item 1 (git-in-mclone-mount) for real.
- **Option 2 (reopen I-7 for full Automations hosting)** = a future, deliberate decision, not a workaround.

## 12. Provenance — what each parent contributed

- **[V1] am-brain-v1** → the contracts: decomposed client dossier, ALG-1..8 decision engine, field-level ownership, calibration honesty (CONF-1 / unknown≠0), clearance-gate concept, the Phase -1 capability-audit method.
- **[OS] AM-OS production** → the data muscle: the fat-Python pipeline (zero-LLM classification, numeric-ID matching, standardized pull envelope), the account-registry multi-ad-account spend rule, freshness policy, the documented dead-ends. The data plane ports verbatim (its unit tests transfer); the classify/render layer is rewritten as ALG-1..8 with new tests.
- **[JSB] Jack's Second Brain** → the read-side: the narrative.md cumulative meeting-log + dual-load discipline, provenance-clean CRM-note ingestion (dedup/TZ/ownership), the enriched registry fields (search_aliases, narrative path), sync observability. Its write-side (bidirectional LLM-merge, 5-agent fleet, dual locks) is dropped.
- **[INT] internal Meta** → the law + the leverage: Brain Protocol format, single-store consensus, tiered-polling architecture, /cron daemon discipline (RLIMIT_AS=8GB, stagger, batch-and-assemble), Agent IO Security (future outbound gate), autonomy rungs, the no-CAT jf graphql→presto path + l12_territory fallback, CRMUnifiedAPI MCP + Sales AI eval-judge harness reuse, para-learn retrieval (opt-in).
- **[REV] adversarial review** → the corrections: taint on the draft not the session; stage clock via state-diff not modified_time; GDrive+git not a write-only WAL; two-tier mirror/authored dossier; cache-diff Tier-2 + independent 96h sweep; "port" = data-plane-only; simple retrieval default; 3-rule gate.

## 13. Build sequence

| Phase | Deliverable                                                                                                                                                              | Gated on               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| L0    | Capability audit re-run for any new capability; carry corrections                                                                                                        | live tool schemas      |
| L1    | GDrive store + git versioning; one-writer discipline. (Host-agnostic — engine paths resolve from **file**; runs from laptop GDrive today, devserver mclone mount at L6.) | —                      |
| L2    | Port AM-OS data plane verbatim (pulls + envelope + ID-matching + registry rule); lock enriched registry.json                                                             | data paths (§6)        |
| L3    | Two-tier dossier + dual-load + simple retrieval + per-prompt recall hook; CRM-note ingestion                                                                             | L1, L2                 |
| L4    | Rewrite classify/render as ALG-1..8 with new tests + eval-judge harness; unblock on operator inputs                                                                      | L3 + operator inputs   |
| L5    | gate.py (3 rules) + Context Ledger                                                                                                                                       | L4                     |
| L6    | devserver /cron daemon (crontab/systemd-timer or MyClaw) + GDrive mclone mount + tiered polling + daily cockpit + independent 96h sweep                                  | L5 + host VERIFY (§11) |

**Cutover (strangler-fig — AM-OS is the live daily driver):** point AM Brain at the same live data + one enriched registry → port the data plane → migrate account-by-account (plan.md → two-tier dossier + narrative) → keep /morning running until the ALG-8 cockpit reaches parity → flip the daily driver → archive AM-OS to \_archive/ (don't delete) → migrate/re-index memory last, after validation.

## 14. Operator inputs still blocking calibration (L4)

The decision engine can consolidate structure now but cannot produce a calibrated cockpit until:

1. Official CI definition + monthly targets (ci_definition, ci_target, rs_close_target) — until then every surface carries the PACING UNCALIBRATED banner.
2. Clearance rulings + cleared-benchmark library — the model must not improvise benchmarks.
3. SGP working calendar (public holidays) for working-day math.
4. Book-plan tiers for the real 33-account portfolio (exclude the 10 in_portfolio=false).

## Changelog

- **2026-06-09 | REV3 APPROVED (storage flip)** | Operator approved Metamate-native storage. I-7 flipped: canonical = Metamate project memory; host = Metamate Automations (hosted, fires laptop-closed); markdown+git = one-way read-only backup, no longer canonical. Operator edits via Collab Files in the Mac browser (no devserver/CLI; same MM2 namespace the cron writes) → no sync, no git-in-mount, no devserver. Verified Collab Files (✅ same store, nested tree, Mac-browser, with-caveats on edit-mode frontmatter) + sync/concurrency risk (single-writer-per-file is the Meta-endorsed pattern; bidirectional merge universally avoided; 164-silent-run disaster = personal+bidirectional+silent, all avoided). Design doc: am-brain/docs/specs/2026-06-09-am-brain-metamate-native-storage-design.md. Updated §2/I-7 + §11. Deferred: engine-in-mission delivery (scmquery/skillbook/Dataswarm) = next design. L1/L2 logic unchanged.
- **2026-06-09 | REV3 L6 host-proof spike** | Ran the §11 host VERIFY items. (1) No self-serve persistent devserver from the Mac (ondemand broker = ephemeral OD only) → REV2's host assumption is blocked on a separate provisioning request. (2) Investigated Metamate 2.0 Automations as a replacement: it IS a real hosted/unattended scheduler (Sandcastle/Tupperware, fires laptop-closed, runs as you), but is architecturally incompatible with I-7 — Drive access is connector/API (not FUSE), raw .md not reliably readable, writes create Google Docs not .md, no git over the vault, arbitrary python -m not native (needs skillbook/scmquery/Dataswarm), ephemeral per run. So (file+git canonical, hosted, unattended) can't all hold — devserver remains the only I-7-compatible host. (3) CLI presence confirmed on laptop; spend stays unknown (identity-bound, not re-probed — no alternate host). Recommendation: ship option 3 (on-demand on the laptop) now (I-7 intact, zero infra), reserve option 1 (devserver unattended) for when a persistent host is granted, treat option 2 (reopen I-7 for Automations) as a future deliberate decision. REV2 left LOCKED pending operator's fork choice; §11 VERIFY items updated with results. No L1/L2 code changes.
- **2026-06-09 | REV2 runtime-host** | Verified "cron on a Meta host + storage in GDrive" is feasible. Runtime host moves from Mac launchd → persistent devserver crontab/systemd-timer (or MyClaw daemon); GDrive vault mounted via mclone+systemd (gdrive-mount skill). Harness cron rejected (REPL-idle + 7-day expiry); OnDemand rejected (18h-idle reclaim). agents.memory Mac-block now moot for runtime. Added host-level VERIFY items (git-in-mount, devserver longevity, CLI presence, spend is identity-bound not host-bound). Updated §1, §2/I-10, §3 diagram, §5 L1/L6, §7, §11, §13. L1/L2 already-built code needs NO changes — engine is host-agnostic (paths via **file**, tools via PATH); only the L6 host wiring + the §11 VERIFY items are new.
- **2026-06-08 | architecture** | Canonical shareable architecture — folds in UNIFIED-ARCHITECTURE (rationale), BLUEPRINT (realization), and the 4-agent adversarial review corrections into one self-contained document.
- **2026-06-08 | cleanup** | Collapsed to single canonical spec: UNIFIED-ARCHITECTURE.md + BLUEPRINT.md moved to archive/. Added DECISIONS.md (one-page recall cheat sheet) for Metamate brain contribution.
