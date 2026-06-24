# A Second Brain for a Meta Ads Account Manager

**Version:** v2, 2026-06-07 (v1 restructured after review: added the AM Execution Layer as the product spine, Phase -1 capability audit, rules-first RS prioritization, relationship model, claim clearance gate, file lifecycle rules; demoted temporal KG to Phase 5)
**Research basis:** deep-research run (6 angles, 28 sources, 130 claims extracted, 25 adversarially verified by 3-vote panels, 20 confirmed, 5 refuted). Research-backed principles are cited; product-design sections introduced in v2 are marked **[PRODUCT]** and must be calibrated to the real AM scorecard.
**Scope:** Architecture + build plan for an AM second brain on Metamate (or any internal AI platform), for an AM managing 30 to 50 advertiser clients, 500 to 1000 open Recommended Solutions (RS), and a monthly Client Interaction (CI) quota.

---

## The product in one sentence

Not "an AI second brain with memory, graph, retrieval, agents, and outbound comms."

**An AM execution system that keeps you on pace for monthly CIs, prioritizes RS by evidence and client readiness, prepares every client interaction, drafts the follow-up, and remembers every commitment.**

The product spine, in order:

```
monthly scorecard → client coverage → RS prioritization → evidence pack
       → draft → CI log → follow-up → next action
```

Everything else in this document is substrate for that spine.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [The job to be done: the operating rhythm](#2-the-job-to-be-done-the-operating-rhythm)
3. [How to read the evidence](#3-how-to-read-the-evidence)
4. [Design principles](#4-design-principles)
5. [Architecture overview](#5-architecture-overview)
6. [The AM Execution Layer](#6-the-am-execution-layer) **[PRODUCT]**
7. [Memory: tiers, file layout, lifecycle](#7-memory-tiers-file-layout-lifecycle)
8. [Retrieval, citations, and the claim clearance gate](#8-retrieval-citations-and-the-claim-clearance-gate)
9. [The RS engine](#9-the-rs-engine)
10. [The relationship model](#10-the-relationship-model) **[PRODUCT]**
11. [Agent loops](#11-agent-loops)
12. [Outbound comms: guardrails and the autonomy ladder](#12-outbound-comms-guardrails-and-the-autonomy-ladder)
13. [Single-agent vs multi-agent](#13-single-agent-vs-multi-agent)
14. [Phased build plan (Phase -1 to Phase 5)](#14-phased-build-plan-phase--1-to-phase-5)
15. [Evaluation and operating metrics](#15-evaluation-and-operating-metrics)
16. [Refuted claims (do not build on these)](#16-refuted-claims-do-not-build-on-these)
17. [Open questions](#17-open-questions)
18. [Sources](#18-sources)

---

## 1. Executive summary

The system has two halves, and the order matters:

**The execution half (the product).** A scorecard control layer that knows the month's targets (CI count, RS closes, revenue growth, client coverage, solution mix), computes pacing daily, detects "behind," and converts every gap into a concrete recovery action with a ready draft. The daily surface is a cockpit that answers one question: _what do I do today to stay on pace?_ This layer is what makes the tool an AM operating system rather than a clever assistant. It is v2's main addition and is pure product design [PRODUCT]: no vendor ships it, and it must be calibrated to the actual scorecard mechanics.

**The intelligence half (the substrate).** The research-verified architecture from v1, unchanged in substance:

1. **Context engineering, not prompting** (Karpathy, Manus): per task, assemble playbook slice + dossier slice + live evidence. No mega-prompts.
2. **Files as the durable memory base** (Manus): playbooks, dossiers, ledgers, and the book plan as plain markdown, agent-operable and AM-reviewable, with restorable pointers back to systems of record.
3. **Hybrid retrieval** (HybridRAG): vector for abstractive playbook reasoning, entity/graph lookups for "which of this client's RS map to their CAPI gap," with mutual fallback.
4. **Background freshness** (Microsoft Sales agent): pipelines keep dossiers and the RS queue current. v2 demotes the event-triggered + temporal-KG version to Phase 5; until then, scheduled pulls and manual exports.
5. **Citation per claim** (Amazon, SIGIR 2025): every client-facing number links to its source signal. v2 extends this to a **claim clearance gate**: a cited internal fact can still be inappropriate to send, so sources and claims carry clearance classes checked at draft time.
6. **Draft-not-send + autonomy ladder** (Microsoft, Salesforce): all outbound starts as drafts; autonomy is earned per message category.
7. **One writer, many readers** (Cognition): a single-threaded agent produces output; read-only subagents (evidence-finder, benchmark-fetcher) contribute intelligence.

The differentiator remains the **RS engine**: 500 to 1000 open RS cannot be triaged by hand. v2 replaces the v1 multiplicative score with a **rules-first ranked decision framework** (categorical bands, plain-English reasons, explicit confidence, mandatory-override pins), because multiplication buries strategic RS the moment one factor is missing or wrong, and AMs need explainable prioritization more than mathematical elegance.

Build order changed accordingly: **Phase -1 (capability and source-of-truth audit) comes before everything**, the **CI/RS cockpit ships in Phase 2 before deep signal integration**, and temporal KG waits until the core loop demonstrably works.

---

## 2. The job to be done: the operating rhythm

The AM scorecard has three legs, and they are _monthly_ commitments, not abstract goals:

| Leg                 | The monthly reality                                                                                                   | What the system must do                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ad revenue growth   | Book-level target; concentrated in a few accounts                                                                     | Rank actions by revenue recovery value, not just pitch quality                 |
| RS adoption         | 500 to 1000 open RS; a closure cadence and (likely) a solution-mix expectation                                        | Continuous triage + keep every solution family moving, not just the easy ones  |
| Client interactions | A CI quota with pacing (illustrative: 120 CIs over ~21 working days is 5.7 per day; one slow week digs a 25+ CI hole) | Track target vs actual by week, flag "behind" early, generate recovery actions |

Two failure shapes the system must prevent:

- **Smart but off-pace:** brilliant pitch packs while the CI count quietly falls behind and six clients go untouched all month. v1 had this failure mode; the Execution Layer (Section 6) exists to kill it.
- **On-pace but hollow:** hitting CI counts with low-value touches. The RS engine and evidence discipline exist to kill this one.

Target end state: the AM's calendar is calls and pitches. Prep, evidence, drafts, logging, follow-up, pacing math, and triage are produced by the system and approved by the AM.

> **Calibration dependency:** the exact CI definitions, targets, RS categories, and scorecard weights were in a 77-line context paste lost to a session interrupt. Every number in Sections 6, 9, and 14 is a placeholder until calibrated against the real scorecard. This is the single highest-leverage piece of missing input.

---

## 3. How to read the evidence

Method: 6 research angles (context engineering; agent memory; RAG/GraphRAG; enterprise sales copilots; evidence grounding + HITL guardrails; single-vs-multi-agent + PKM). 5 parallel search agents per angle, 28 sources fetched, 130 falsifiable claims extracted, top 25 through 3-vote adversarial verification. 20 confirmed, 5 killed.

Weighing rules:

- **Vendor docs (Microsoft, Salesforce) are authoritative for architecture, not efficacy.** Their improvement numbers are self-reported (LLM-as-judge over synthetic data). Cite the design, never the outcomes.
- **Five widely-circulated benchmark claims were refuted** (Section 16) and must not appear in any internal pitch for this project. The architectural claims behind them survived.
- **Two findings carried 2-1 votes** (temporal KG; hybrid-retrieval split): validated design heuristics to pilot, not settled facts. v2 responds by demoting temporal KG to Phase 5.
- **Nothing verified is Metamate-specific or Meta-internal.** Hence Phase -1: the capability audit is now the first phase, not an appendix question.
- **[PRODUCT] sections (6, 10, plus the RS ranking rules in 9) are design, not research findings.** They encode AM scorecard mechanics and must be validated against the real program.
- **"gbrain":** best public match is gBrain, an open-source "self-wiring memory layer" for agents associated with Y Combinator's Garry Tan (MarkTechPost, 2026-05-22). Low confidence; none of its claims survived verification. If it is Meta-internal, it likely slots in at the T3 tier and should be evaluated against P4's capability bar.

---

## 4. Design principles

**P0. The scorecard is the boss.** [PRODUCT] Every surface, ranking, and nudge optimizes monthly scorecard attainment (CI pacing, RS closure cadence, coverage, revenue), with pitch quality in service of it. When pacing and pitch-elegance conflict, pacing wins. This principle is v2's spine and is product design, not external research.

**P1. Context engineering over prompt engineering.** "The delicate art and science of filling the context window with just the right information for the next step." Dynamic assembly of task spec + playbook excerpt + dossier slice + live evidence per request; no static mega-prompts. (Karpathy, [2025-06](https://x.com/karpathy/status/1937902205765607626); LLM-as-OS framing, [2023-09](https://x.com/karpathy/status/1707437820045062561)) [HIGH, 3-0]

**P2. The file system is the durable memory tier.** "Unlimited in size, persistent by nature, and directly operable by the agent itself" (Manus). Corollary: compression must be restorable; when context is trimmed, keep the path/URL/ID so the agent can re-fetch. ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)) [HIGH, 3-0]

**P3. Recitation steers attention on long workflows.** A continuously rewritten in-context plan (the cockpit checklist) keeps the global objective in the model's recent attention span. Qualification: recitation closes roughly half the gap; pair with retrieval and short-horizon decomposition. (Manus; Lost-in-the-Middle literature) [HIGH, 3-0]

**P4. A temporally-aware knowledge graph is a _later_ memory tier.** Graphiti-style fusion of conversational + structured business data with historical relationships is the right shape for "how has this account's CAPI readiness changed since Q1." Its benchmark claims were refuted, the capability claim carried 2-1, and the core RS/CI loop does not need it: **Phase 5 only** (Section 14). ([Zep paper, arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) [MEDIUM, 2-1]

**P5. Hybrid retrieval, because vector and graph fail differently.** Vector wins abstractive questions; entity-grounded/extractive lookups win relational ones; mutual fallback. Single-domain evidence; treat as a heuristic to validate. ([HybridRAG, arXiv 2408.04948](https://arxiv.org/abs/2408.04948)) [MEDIUM, 2-1]

**P6. Background freshness beats query-time scraping.** Microsoft's Sales agent processes emails/meetings/external data via background agents into a customer-owned insights store mapped to CRM records, triggered "as soon as source data becomes available." Adopt the pattern; v2 stages it (scheduled pulls first, event triggers in Phase 5). ([Microsoft technical report, 2025-12](https://techcommunity.microsoft.com/blog/microsoft365copilotblog/sales-agent-in-microsoft-365-copilot-evaluation-results-%E2%80%93-technical-report/4476867)) [HIGH, 3-0 architecture; 2-1 vendor-reported benefits]

**P7. A query-time orchestrator grounds, retrieves, applies policy, selects tools.** The AM supplies natural intent; the pipeline assembles context and enforces policy. (Microsoft report; [orchestrator docs](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/orchestrator)) [HIGH, 3-0]

**P8. RAG over a vector store is the baseline grounding mechanism.** Retriever + search index over chunked, embedded KB content. ([Salesforce Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-cloud-powered-agentforce/enable-trusted-agents-with-data-cloud)) [HIGH, 3-0]

**P9. Embedded layer over systems of record, not a standalone system.** Consume internal ad-signal/RS/CRM systems read-only; own only the dossier/queue/plan layer; surface inside the AM's daily tools. ([Microsoft architecture doc](https://learn.microsoft.com/en-us/microsoft-sales-copilot/architecture)) [HIGH, 3-0]

**P10. Citation generation on every claim.** Each generated claim links to its source. Amazon production study: claim grounding 83.86% to 95.46% (11.6 points; 13.83% relative). Imperfect in the wild (~52% source-citation recall), so QA sampling is mandatory. ([Cite Before You Speak, arXiv 2503.04830](https://arxiv.org/html/2503.04830v2)) [HIGH, 3-0]

**P11. Draft-not-send behind layered guardrails.** Grounded drafts with human review; Salesforce names the stack (zero data retention, toxicity detection, secure retrieval, dynamic grounding). v2 adds the claim clearance gate on top (Section 8.3). (Microsoft; Salesforce) [HIGH, 3-0]

**P12. Single-threaded writer; read-only intelligence subagents.** Share full traces; actions carry implicit decisions; parallel writers make conflicting ones. Multi-agent works "when writes stay single-threaded and the additional agents contribute intelligence rather than actions." ([Cognition](https://cognition.ai/blog/dont-build-multi-agents); [follow-up](https://cognition.ai/blog/multi-agents-working)) [HIGH, 3-0]

**Anti-patterns** (each violates a principle above):

- Optimizing pitch quality while the month is failing (P0).
- One giant system prompt containing all playbooks (P1).
- Choosing memory/RAG vendors off benchmark tables (Section 16).
- Building temporal-KG infrastructure before the RS/CI loop works (P4, P0).
- Parallel agents drafting parts of the same email (P12).
- Uncited or unclearned numbers in client comms (P10, Section 8.3).
- Dossiers living only in chat history (P2).
- A "top 10 brief" that is really an ignorable dashboard (Section 11, L1).

---

## 5. Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│  SYSTEMS OF RECORD  (read-only to the agent)                       │
│  ad-account insights/signals · RS system · CRM + CI log ·          │
│  email/WhatsApp threads · calendar · transcripts · cleared         │
│  benchmark library                                                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  Phases 1-4: scheduled pulls + manual exports
                               │  Phase 5: event triggers (email in, transcript
                               │  finalized, signal change)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  MEMORY  (Section 7)                                               │
│  T2 files: playbooks/ · clients/ · ledgers · book plan ·           │
│  scorecard (generated)          T3 temporal KG: Phase 5 only       │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  RS ENGINE  (Section 9)                                            │
│  eligibility signals → evidence objects → rules-first ranked       │
│  decision framework → objection parking with unblock conditions    │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  AM EXECUTION LAYER  (Section 6)  ← the spine owner                │
│  book plan · monthly scorecard pacing · client coverage ·          │
│  solution coverage · behind-schedule triggers · recovery actions   │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR  (single-threaded writer; Sections 8, 13)            │
│  ground in client context → scoped retrieval → citations →         │
│  claim clearance → policy → tool selection                         │
│  read-only subagents: evidence-finder · benchmark-fetcher          │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  SURFACES  (inside the AM's daily tools)                           │
│  daily cockpit (pacing first) · pitch packs · cited Q&A ·          │
│  meeting prep + post-meeting capture ·                             │
│  email/WhatsApp drafts → HITL approve → send → CI log              │
└────────────────────────────────────────────────────────────────────┘
```

| Component                            | Role                                                         | Owns data?                    |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------------- |
| Book plan + scorecard                | Monthly targets, pacing, coverage, mix                       | Yes (T2, human-owned targets) |
| Playbook KB                          | Per-product pitch + troubleshooting knowledge                | Yes (T2)                      |
| Client dossiers + relationship state | Per-client durable memory                                    | Yes (T2)                      |
| RS queue                             | Ranked, evidence-annotated view over the RS system of record | View + annotations only       |
| Execution layer                      | Pacing math, coverage tracking, recovery actions             | Yes (T2, generated)           |
| Orchestrator                         | Grounding, clearance, policy, tool selection                 | No                            |
| Evidence-finder                      | Read-only subagent mining account signals per RS             | No                            |
| Outbound layer                       | Draft, clear, approve, send, log                             | Audit log                     |
| Temporal KG                          | Time-aware entity/relationship layer                         | Phase 5                       |

---

## 6. The AM Execution Layer

**[PRODUCT]** This layer owns the monthly operating rhythm. The RS engine finds good pitches; this layer makes sure the _month_ is hit. It sits between the RS engine and the agent loops: opportunities go in, scheduled actions that keep the scorecard on pace come out.

All of it lives as T2 files (Section 7), which means **Phase 2 can ship it with only a CI log source and the manual ledgers**, before any deep ad-signal integration exists.

### 6.1 The book plan (monthly, human-owned, agent-drafted)

```yaml
# book-plan.md
month: 2026-06
ci_target: 120 # calibrate to the real scorecard
rs_close_target: 40
revenue_growth_target: …
priority_clients: # by book strategy, not alphabetical:
  - client: acme-fitness # revenue tier, risk tier, managed-program
    tier: grow # expectation, client maturity
    reason: "Q3 budget planning window; CAPI gap = biggest unlock"
  - client: bravo-retail
    tier: defend
    reason: "spend down 18% MoM; churn risk"
strategic_solution_mix: # anti-over-pitching guardrail
  capi: 20%
  advantage_plus: 25%
  creative_diversification: 25%
  messaging: 20%
  other: 10%
```

The agent drafts next month's plan from this month's outcomes + book strategy; the AM edits and approves. Targets are never agent-set.

### 6.2 The monthly scorecard (generated daily)

```yaml
# scorecard.md  (regenerated each morning; drives the cockpit)
month: 2026-06
working_day: 5 of 21
ci_target: 120
ci_completed: 47
ci_required_run_rate: 5.7/day
ci_actual_run_rate: 9.4/day
pacing_status: ahead # ahead | on_pace | behind | critical
rs_closed_vs_target: 9 / 40
clients_untouched_this_month: [delta-beauty, echo-dental, …]
clients_below_required_touches: [bravo-retail]
rs_categories_undercovered: [messaging] # vs strategic_solution_mix
commitments_overdue: 2
top_recovery_actions:
  - client: delta-beauty
    recommended_solution: creative_diversification
    evidence: "3 of 4 active ads >45d old; frequency 6.2"
    draft_ready: true
  - client: bravo-retail
    recommended_solution: none # coverage touch, not a pitch
    evidence: "untouched 19d; spend down 18% MoM"
    draft_ready: true
```

Pacing math is trivial on purpose: targets, completions, working days, run rates. The value is that it runs every day without being asked, and everything below it in the cockpit re-ranks when `pacing_status` degrades.

### 6.3 Coverage trackers

```yaml
# coverage/clients.md (generated)
- client: bravo-retail
  required_touches_this_month: 3 # by tier from book plan
  completed_touches: 1
  next_required_touch_by: 2026-06-14
  recommended_action: "deliver May performance recap + pitch CAPI cleanup"
```

```yaml
# coverage/solutions.md (generated)
- solution: creative_diversification
  open_rs: 37
  pitched_this_month: 4
  closed_this_month: 1
  undercovered: true # vs strategic_solution_mix
```

Coverage answers the two questions a pitch-ranker never asks: _which clients have I neglected_ and _which solution families am I over/under-pitching_. Both feed rank boosts into the RS engine (Section 9.2, rule R1).

### 6.4 Behind-schedule triggers

When `pacing_status` is `behind` or `critical`:

1. The cockpit reorders: recovery actions first, opportunistic pitches second.
2. Draft nudges are queued (draft-not-send) for every untouched/under-touched client, biased toward **low-effort, legitimate CI types**: performance recap delivery, quick-win flag, commitment follow-through, scheduled check-in. Recovering pace must not degenerate into spam; every nudge still carries real content with cleared evidence.
3. Overdue commitments escalate to the top (a broken promise is both a relationship cost and a free CI to recover).
4. If the gap is structurally unrecoverable at current run rate, the cockpit says so explicitly and proposes a triage plan (which clients/categories to deprioritize), rather than pretending.

### 6.5 Weekly book review (generated Monday)

Portfolio rollup: pacing vs targets, RS funnel movement (open → pitched → committed → closed), coverage heat map, solution-mix drift, at-risk accounts (spend drops, sentiment dips, silence), and next week's required touches placed against the calendar.

---

## 7. Memory: tiers, file layout, lifecycle

### 7.1 Tiers

| Tier                 | Contents                                      | Medium                         | Write path                 | Lifetime      |
| -------------------- | --------------------------------------------- | ------------------------------ | -------------------------- | ------------- |
| T0 working context   | current task, retrieved slices                | context window                 | per-turn assembly          | session       |
| T1 recited plan      | cockpit checklist                             | `today.md`, rewritten per step | agent                      | day           |
| T2 files             | plan, scorecard, playbooks, dossiers, ledgers | markdown (wiki/repo)           | per ownership matrix (7.4) | durable       |
| T3 temporal KG       | time-valid entities/relations                 | Graphiti-style store           | background pipeline        | Phase 5       |
| T4 systems of record | ads data, RS system, CRM, threads             | internal APIs                  | read-only                  | authoritative |

Rules: T4 is never copied wholesale into T2/T3; store derived insights plus the pointer back (P2). Every generated claim carries `fetched_at` and a source link. Numerics are validated at the T4 boundary; missing or non-finite data reads as "no evidence," never passes a threshold by default.

### 7.2 File layout (T2)

```
brain/
  today.md                      # cockpit + recited plan (T1)
  book-plan.md                  # monthly targets + strategy (human-owned)
  scorecard.md                  # daily pacing (generated)
  coverage/
    clients.md                  # (generated)
    solutions.md                # (generated)
  playbooks/
    advantage-plus-shopping.md  advantage-plus-app.md  capi.md
    creative-diversification.md click-to-message.md    reels-ads.md
    shops-commerce.md           billing-admin.md       organic-basics.md
    troubleshooting/
      ad-rejections.md  learning-limited.md  pixel-capi-debugging.md
      delivery-diagnostics.md  billing-failures.md
  clients/
    <client-slug>/
      profile.md                # vertical, model, spend tier, goals (human-owned strategy)
      contacts.md               # people, roles, channel + language prefs
      relationship.md           # relationship_state (Section 10; AM-confirmed)
      performance.md            # rolling snapshot + anomalies (generated, source-linked)
      rs-ledger.md              # RS view: bands, evidence, history (generated + annotated)
      commitments.md            # promises both directions, deadlines (append-only ledger)
      style.md                  # tone, format, channel etiquette (human-seeded, agent-suggested)
      interactions/
        2026-06.md              # monthly CI digest (generated)
        raw/2026-06-05-qbr.md   # per-CI records; archived after digest
  queue/
    rs-queue.md                 # current ranked queue snapshot (generated)
  archive/                      # closed RS, churned clients, superseded playbooks
```

PKM note (convention, not evidence): this is PARA adapted to the job (Projects = in-flight pitches, Areas = clients, Resources = playbooks, Archives = archive/). The load-bearing choices are P2 and the lifecycle rules below, not the folder philosophy.

### 7.3 Formats

**Playbook** (machine-readable frontmatter is what lets the pipeline auto-attach evidence):

```markdown
---
product: capi
rs_categories: [signals, measurement]
one_liner: "Server-side events recover signal lost to browser limits."
eligibility_signals:
  - id: capi_absent
    test: "0 server events in last 30d AND pixel events > threshold"
  - id: event_match_quality_low
    test: "EMQ below 6.0 on purchase events"
clearance: client_safe # Section 8.3 source class
last_reviewed: 2026-06-07
---

# Sections: When to pitch (signal patterns) · Value story + proof points

# (every number sourced + clearance-tagged) · Talk track · Objections and

# responses · Implementation steps + effort honesty · Common pitfalls · FAQ
```

**RS annotation** (overlay on the system of record; the brain never invents RS ids):

```yaml
rs_id: RS-2026-04412
client: acme-fitness
product: capi
status: open                       # mirror of system-of-record state
local_state: evidence_ready        # unscored | banded | evidence_ready |
                                   # pitch_drafted | pitched | objection_parked | won | lost
priority: {…}                      # rs_priority object, Section 9.2
evidence:
  - signal_id: capi_absent
    metric: "server event coverage"
    value: "0 events / 30d"
    window: 2026-05-08..2026-06-07
    source: <internal dashboard link>
    clearance: client_specific     # Section 8.3
    fetched_at: 2026-06-07
history:
  - 2026-05-28: email pitch sent (thread <id>)
  - 2026-06-03: objection: dev bandwidth (interactions/raw/2026-06-03-call.md)
unblock_condition: "dev agency onboarded OR client mentions dev capacity"
next_action: {type: follow_up, due: 2026-06-10, draft: ready}
```

**CI record:** date, type (call | email_thread | whatsapp | meeting | qbr), participants, 5-line summary, rs_touched, commitments (by/what/due), sentiment, follow_up_draft ref, logged_to_crm flag. CI records are what pacing counts; the official definition of a countable CI must come from the scorecard (Section 17).

### 7.4 File lifecycle and maintenance rules

Without these, 30 to 50 clients x 8 files becomes a messy CRM clone. The ownership matrix is the contract:

| Class                        | Files                                                                      | Agent may                                    | AM role                                 |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| Human-owned                  | book-plan targets, profile.md strategy fields, style.md seed               | propose diffs only                           | author + approve                        |
| AM-confirmed                 | relationship.md (trust, mood), contact merges, corrections to past records | suggest values                               | confirm each change                     |
| Agent-generated, regenerable | scorecard.md, coverage/, performance.md, rs-queue.md, CI digests           | overwrite freely (rebuilt from T4 + ledgers) | spot-check                              |
| Append-only ledgers          | interactions/raw/, commitments.md, rs-ledger history                       | append; never edit past entries              | correct via explicit correction entries |

Rules:

1. **Staleness expiry.** Every generated claim has `fetched_at` and a class-based shelf life (performance: 7 days; contact facts: 90 days; strategy fields: quarterly review). Expired claims are excluded from evidence and listed in a weekly hygiene queue, not silently reused.
2. **Correction protocol.** An AM edit to a file is ground truth; derived stores re-sync from files. A wrong memory gets a tombstone entry ("not true: X; do not re-derive") so re-ingestion of old threads cannot resurrect it.
3. **Bloat control.** profile.md capped at one page; per-CI raw files roll up into a monthly digest with the raw moved to archive; dossiers of churned clients archive whole. The cockpit flags any dossier over cap instead of letting it grow.
4. **Duplicate contacts.** Dedupe key = email/phone; merges are proposed, AM-confirmed.
5. **Strategy changes.** Changing profile.md strategy fields or book-plan tiers triggers a re-band of that client's RS queue (Section 9) and a coverage recalc; the system states what changed downstream.
6. **Maintenance budget.** Target: under 15 minutes/week of AM file gardening at steady state. It is a tracked metric (Section 15); if it trends up, the system is failing regardless of how smart the drafts are.

---

## 8. Retrieval, citations, and the claim clearance gate

### 8.1 Retrieval routing (P5, P8)

| Query shape                   | Primary                                                | Fallback | Example                                                                  |
| ----------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| Entity-grounded, relational   | entity lookup over ledgers/dossiers (graph in Phase 5) | vector   | "Which open RS for Acme are unblocked by their new dev agency?"          |
| Abstractive, conceptual       | vector over playbooks                                  | entity   | "How do I position creative diversification for a fatigued CPG account?" |
| Temporal                      | dated ledger scan (KG in Phase 5)                      | n/a      | "How has Acme's CAPI readiness changed since Q1?"                        |
| Exact numeric / current state | T4 live fetch, never memory                            | n/a      | "What was yesterday's spend?"                                            |

**Per-client scoping is mandatory and structural.** Retrieval for client X filters to X's dossier + global playbooks + the cleared benchmark library. Enforced at the index/query layer, not by prompt instructions.

### 8.2 Citation discipline (P10)

Citations attach at retrieval time: every chunk carries its source ref; generation cites per claim; drafts with uncited quantitative claims are rejected pre-review. Because the citation layer is measurably imperfect (~52% source-citation recall in the wild), weekly QA sampling is mandatory (Section 15).

### 8.3 The claim clearance gate

**A cited internal fact can still be inappropriate to send.** Citation proves _where a claim came from_; clearance decides _whether and how it may leave the building_. Two classifications, assigned at ingestion and enforced at drafting:

**Source classes** (provenance tag on every chunk and evidence object):

| Class                         | Meaning                                                                                    | Outbound?                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `client_specific`             | this client's own account data                                                             | to that client only, cited                                          |
| `aggregate_benchmark_cleared` | benchmarks from the approved library with approved phrasing                                | yes, approved phrasing only                                         |
| `client_safe`                 | public/external-shareable docs, help-center content, published case studies                | yes, cited                                                          |
| `internal_only`               | internal strategy, margins, roadmaps, other clients' data, internal benchmarks not cleared | never; rewrite or drop                                              |
| `policy_sensitive`            | policy/legal/compliance content                                                            | only as links/quotes of canonical public policy text; no paraphrase |

**Claim types**, each with its own rule: performance claims (client's own data only, cited, fresh per 7.4), product claims (client_safe docs or playbook proof points with sources), policy claims (canonical text only), benchmark claims (cleared library only; "advertisers in your vertical see…" requires an approved aggregate), billing claims (client's own billing data + canonical finance FAQ), recommendation claims (must carry at least one evidence object + effort honesty).

**Gate mechanics** (runs pre-review, before the AM ever sees the draft):

1. Parse the draft into claims; classify each claim's type.
2. Check every claim's evidence provenance: source class permits this recipient? Freshness within shelf life? Citation present?
3. **Client-safe rewriting:** claims grounded in internal phrasing are rewritten to external register while preserving the cited values; if no compliant phrasing exists, the claim is dropped and the gap is flagged to the AM ("I know X internally but cannot say it; consider asking the client about Y instead").
4. Cross-client check: any `client_specific` provenance from a different client hard-fails the draft (defense-in-depth behind the retrieval scoping).
5. Default-deny: unclassified sources are `internal_only` until classified.

The clearance rulings themselves (what is in the benchmark library, what counts as client_safe) come from the Phase -1 audit, not from the model's judgment.

---

## 9. The RS engine

The unique AM problem: 500 to 1000 open RS, too little time, not enough account-specific evidence. Generic copilots draft emails; this decides **which Meta Recommended Solution deserves a CI this week**, and shows its reasoning.

### 9.1 Evidence attachment (unchanged from v1)

Playbooks declare machine-readable `eligibility_signals`; the refresh pipeline evaluates them against live account data; matches produce evidence objects (metric, value, window, source, clearance, fetched_at) attached to the RS. All numerics validated at ingestion; missing data marks the RS `unscored` and emits a data-gathering task, never a silent zero.

### 9.2 Rules-first ranked decision framework

v1's multiplicative score is replaced. Multiplication is brittle: one wrong, missing, or unfairly low factor and the RS vanishes; strategic-but-not-yet-evidenced RS get buried; the math is unexplainable to the AM who has to trust it. Bands + rules + plain-English reasons instead:

```yaml
rs_priority:
  commercial_value: high | medium | low
  evidence_readiness: strong | moderate | weak
  client_readiness: ready | blocked | unknown # derived from relationship.md + objections
  urgency: now | this_month | later # seasonality, fiscal calendar, anomaly triggers
  effort: low | medium | high # client-side implementation cost
  score_reason: "EMQ 4.2 + zero server events; client asked about measurement on 2026-06-03 call"
  confidence: high | medium | low
  required_human_judgment: false # true forces AM review before any draft
```

Ranking rules, applied in order (rules first, numbers last):

- **R0. Pins.** Mandatory/program-committed/leadership-priority RS are pinned to the queue top regardless of evidence, labeled as such. Strategic importance must never be silently outranked by a tactically easier pitch.
- **R1. Execution-layer boosts.** RS for under-covered clients and under-covered solution families (Section 6.3) get rank boosts; when `pacing_status` is behind, recovery actions outrank opportunistic pitches (P0).
- **R2. Readiness gates.** `blocked` → objection-parked with an explicit `unblock_condition`, surfaced again when it flips; never buried, never nagging meanwhile. `unknown` → emits a discovery action ("ask about dev capacity on Thursday's call") instead of a guess.
- **R3. Band sort.** Within what remains: lexicographic by (urgency, commercial_value, evidence_readiness), with effort as a penalty inside a band. A high-effort RS with high value stays visible with its effort stated honestly.
- **R4. Numeric tiebreak.** A score may order items _within_ an identical band, never across bands.
- **Every surfaced RS shows `score_reason` in plain English plus `confidence`.** Low confidence or `required_human_judgment: true` renders as a question to the AM, not a recommendation.

### 9.3 Failure modes this design answers

| Failure mode (multiplicative)                           | Mitigation                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Strategic RS with weak current evidence gets buried     | R0 pins; evidence_readiness is one band among several, not a multiplier                                 |
| Stale low propensity hides a warming relationship       | client_readiness derives from relationship.md, which decays/updates (Section 10); R2 re-bands on change |
| High effort kills a mandatory or high-value RS          | effort is an in-band penalty + honesty field, not a divisor                                             |
| Generic revenue estimates masquerade as client-specific | commercial_value carries provenance; generic estimates cap confidence at medium                         |
| Timing inferred from weak signals                       | urgency requires a named trigger (calendar event, anomaly, client statement); else `later`              |
| No closed-loop adoption data, so it never learns        | proxy funnel learning (9.4)                                                                             |

### 9.4 Learning loop

When closed-loop adoption data is unavailable, learn from proxies: pitch → response, response → meeting, meeting → commitment, commitment → adoption where visible; plus explicit AM feedback on every queue item (accept / snooze / reject, with a one-tap reason). Feedback adjusts bands (e.g. repeated "client not ready" rejections flip client_readiness) and is reviewed quarterly against whatever real adoption data exists. The queue must visibly change in response to feedback, or the AM will stop giving it.

### 9.5 Pitch packs

For each surfaced RS, one reviewable unit: claim (one line), 2 to 4 evidence objects (cited, clearance-checked), proof point from the cleared library, 60-second talk track with objection branches, channel-appropriate draft in the client's register and `preferred_pitch_mode` (Section 10), and effort honesty (what it costs the client). The read-only evidence-finder subagent mines signals in parallel; the single writer composes (P12).

---

## 10. The relationship model

**[PRODUCT]** The best recommendation is not the highest-performing one; it is the one that fits the client's current trust level, appetite, decision cycle, business pressure, and recent objections. Without this layer the system produces technically correct, tone-deaf pitches.

```yaml
# clients/<slug>/relationship.md   (AM-confirmed class: agent suggests, AM confirms)
relationship_state:
  trust_level: medium # low | medium | high
  current_mood: frustrated # positive | neutral | frustrated | disengaged
  decision_maker_access: indirect # direct | indirect | blocked
  current_objection: measurement # budget | bandwidth | skepticism | policy | measurement | none
  preferred_pitch_mode: data_first # data_first | case_study | strategic | tactical
  last_value_delivered: 2026-05-21 "creative audit that lifted CTR 19%"
  next_best_relationship_move: educate # educate | ask | escalate | celebrate | follow_up
```

How it gates the system:

1. **client_readiness (Section 9.2) derives from here.** `current_mood: frustrated` or `disengaged` suppresses pitch nudges for that client and surfaces repair moves instead (deliver value, close an overdue commitment, celebrate a win).
2. **Deposit before withdrawal.** If `last_value_delivered` is stale (e.g. >30 days), the next touch leads with value (educate/celebrate/deliver), not an ask. The cockpit enforces the ordering.
3. **Pitch mode shapes the pack.** data_first leads with the evidence objects; case_study leads with the cleared proof point; strategic frames against the client's stated goals; tactical gets short and operational.
4. **Objections route playbook sections.** `current_objection: measurement` pulls the measurement-objection branch into any pitch for that client, regardless of product.
5. **decision_maker_access changes the move.** `blocked` converts pitch actions into access actions ("ask Jane for an intro to the CFO") before product actions.

Update discipline: the agent proposes changes from observed signals (reply latency, sentiment, meeting outcomes); trust and mood only change when the AM confirms. These two fields steering outbound tone on wrong autopilot is worse than them being stale.

---

## 11. Agent loops

Six workflows, each an orchestrator pass (P7: ground → retrieve → clear → policy → tool), each serving the spine.

**L1. Daily cockpit (scheduled, morning).** Not a to-do list; an answer to "what do I do today to stay on pace?" Structure, in fixed order:

1. **Are you behind this month?** Pacing banner: CI target vs actual vs required run rate; RS closes vs target; one-line verdict.
2. **Which clients must be touched this week?** From coverage; each with a suggested touch and ready draft.
3. **Which RS are evidence-ready now?** Top of the ranked queue with score_reasons.
4. **Which meetings today need prep?** One-pager per meeting (see L4).
5. **Which commitments are overdue?** Both directions: yours and theirs.
6. **Which drafts await approval?**
7. **Which accounts show risk signals?** Spend drops, sentiment dips, silence streaks.

Discipline: at most 3 must-do + 7 optional items; unfinished must-dos roll forward visibly (never silently vanish); the cockpit IS the recited plan (P3), rewritten as items complete. When pacing is behind, sections 1 and 2 expand and pitching compresses (P0, 6.4).

**L2. Pitch pack generation** (from L1 or on demand). Section 9.5. No pack ships with an uncited or unclearned claim.

**L3. Client Q&A and troubleshooting** (on demand). Ground in client context; retrieve playbooks + dossier + T4 live state; answer with citations through the clearance gate. Covers ads troubleshooting, billing/admin/finance FAQ, bounded organic. Low confidence or out-of-bounds (suspensions beyond playbook scope, legal, policy edge cases) → explicit "route to X" with a prepared internal escalation summary, not a guess.

**L4. Meeting prep + post-meeting capture** (calendar-triggered). Prep one-pager: relationship state + next_best_relationship_move, open commitments both directions, performance summary (fresh, cited), top 3 RS with reasons, last interaction recap. Post-meeting: draft CI record + follow-up email + commitment updates + RS state changes as **one approval batch**; on approve, ledgers update and the CI is logged to the system of record. This loop is where "nothing falls through cracks" lives.

**L5. Outbound drafting** (from L1/L2/L3/L4, incoming messages, or follow-up cadence). Draft in client register (style.md + preferred_pitch_mode); clearance gate; AM approval; send; auto-log CI + thread ref. AM edits are diffed into style.md suggestions ("prefers bullets, no emojis, Mandarin for WhatsApp").

**L6. Refresh pipeline** (scheduled through Phase 4; event-triggered in Phase 5). Pull signals/exports → validate numerics → update performance.md + evidence objects → re-band affected RS → recompute scorecard + coverage → queue tomorrow's cockpit. Every write traceable to its trigger.

---

## 12. Outbound comms: guardrails and the autonomy ladder

### 12.1 Hard rules

1. **Draft-not-send for everything** (P11) until a category graduates (12.3).
2. **Cross-client isolation**, enforced structurally at retrieval and re-checked at the clearance gate (8.3 rule 4).
3. **Citation + clearance gates** precede human review; QA sampling weekly (Section 15).
4. **Channel policy.** WhatsApp: 24-hour customer-service window, template requirements outside it, opt-in state per contact; the system tracks window state per thread and refuses non-template drafts outside it. Email: thread etiquette, internal-content screens.
5. **Escalation taxonomy.** Suspensions/policy strikes, legal/compliance, spend commitments beyond AM authority, angry-client sentiment → route to the AM or beyond with a prepared summary; never autonomous replies.
6. **Audit log.** Every draft, clearance result, approval, edit, send, and the evidence shown at approval time. The approval record protects the AM.

### 12.2 Guardrail stack (defense-in-depth)

| Layer              | Mechanism                                                                             |
| ------------------ | ------------------------------------------------------------------------------------- |
| Retrieval          | per-client scoping; provenance tags; secure retrieval                                 |
| Generation         | citation per claim; register constraints                                              |
| Clearance gate     | claim-type x source-class rules; client-safe rewriting; freshness; cross-client check |
| Pre-review screens | channel policy; PII; toxicity                                                         |
| Human              | per-message approval; batch approval for graduated categories                         |
| Post-hoc           | audit log; weekly grounding QA; edit-distance tracking                                |

### 12.3 The autonomy ladder

Granted per **message category**, by demonstrated precision, never globally:

| Rung                        | Categories                                                 | Gate to advance                                        |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| 0. Draft-only (launch)      | everything                                                 | n/a                                                    |
| 1. One-tap approve          | follow-up nudges, meeting confirmations, report deliveries | 4 weeks >90% sent unedited                             |
| 2. Batch approve            | cadence follow-ups, routine cited answers                  | sustained rung 1 + zero clearance failures in QA       |
| 3. Auto-send + notification | narrowest set: confirmations, scheduled report sends       | explicit policy sign-off; instant recall; weekly audit |

Pitches, objection handling, anything numeric, anything emotionally loaded: rung 0 to 1 indefinitely. The AM's judgment on live calls is the product, not a cost to optimize away.

---

## 13. Single-agent vs multi-agent

Per P12 (Cognition, 3-0): one single-threaded writer owns all output and state mutations (drafts, ledger writes, queue, cockpit). Read-only subagents contribute intelligence: evidence-finder (signals per RS), benchmark-fetcher (cleared aggregates), meeting-prep researcher. Subagents return scoped, distilled conclusions + source refs, not raw traces. The refresh pipeline processes events serially per client (per-client write lock), so two writers never race on one dossier.

---

## 14. Phased build plan (Phase -1 to Phase 5)

Ordering logic: resolve unknowns first (Phase -1), prove value with zero engineering (Phase 0), make answers trustworthy (Phase 1), **make the month manageable (Phase 2, the cockpit) before deep signal integration**, then pitch packs (3), capture (4), and only then memory infrastructure (5). Each phase is independently valuable; stopping anywhere still leaves a working tool.

### Phase -1: capability and source-of-truth audit (week 0 to 1)

Resolves v1's "open questions" _before_ anything is built:

- **Systems of record:** where RS state lives and its update cadence (subscribe or poll?); where CI logs officially live and **what officially counts as a CI**; where ad-account signals are queryable in structured form; calendar/transcript access.
- **Metamate capability matrix** (the 9 rows below): confirm native / buildable / impossible, with the fallback column as the contingency plan.
- **Permissions:** read/write per system; the agent acts strictly as the AM (same visibility, no more); export fallbacks where APIs are absent.
- **Clearance rulings:** what may be cited to clients, the approved benchmark library, policy-language rules, client-data boundaries (Section 8.3 is configured here, not invented by the model).
- **The minimum viable manual loop:** define what the AM does by hand in Phase 0 so it is deliberate, not accidental.

| #   | Capability                                                  | Used by        | Fallback                                   |
| --- | ----------------------------------------------------------- | -------------- | ------------------------------------------ |
| 1   | Retrieval index over an AM-controlled corpus, per-AM scoped | P2, P8, L3     | paste-relevant-file workflow               |
| 2   | Agent read/write to files with history                      | T2, L6         | agent proposes diffs, AM applies           |
| 3   | Tool calls: ad insights, RS system, CRM/CI log, calendar    | T4, L1, L2, L6 | scheduled manual exports, agent files them |
| 4   | Scheduled jobs                                              | L1, L6         | AM runs "morning brief" manually           |
| 5   | Event triggers                                              | Phase 5        | stay on schedules                          |
| 6   | Graph/temporal store                                        | Phase 5        | files + vector only                        |
| 7   | Long-context model with reliable citation behavior          | P10            | tighter slices + heavier QA                |
| 8   | Email/WhatsApp send integration + approval UI               | L5             | copy-paste drafts                          |
| 9   | Audit log of agent actions                                  | 12.1           | append-only log file                       |

**Deliverable: a one-page integration reality memo.** Phases 2+ timelines are committed only after it lands.

### Phase 0: manual second brain (week 1 to 2, no engineering)

Build by hand: top 10 client dossiers (priority by book strategy), top 5 playbooks (highest-revenue RS families), manual RS ledger for those clients, **manual CI target tracker + weekly book plan**, draft templates per channel. Use Metamate chat grounded on these files for Q&A, prep, and drafting.
Goal: better prep, faster replies, better pitch quality. Metric: minutes-to-answer; prep time per meeting.

### Phase 1: retrieval + citation + clearance labels (week 2 to 4)

Index the corpus; enforce cite-per-claim; **classify sources with clearance labels at ingestion** (8.3); build the golden question set.
Goal: trustworthy Q&A and meeting prep. Metric: >90% of golden questions answered with correct citation; zero clearance violations in test drafts.

### Phase 2: the CI/RS operating cockpit (week 4 to 8)

Book plan + daily scorecard + coverage trackers + behind-schedule triggers + draft nudges (Section 6) + the L1 cockpit. Needs only T2 files, the CI log source identified in Phase -1 (or the manual tracker), and calendar read.
Goal: **the system helps you hit the month.** Metric: pacing visibility daily; untouched-client count trending to zero; AM self-report "I know what to do today."

### Phase 3: evidence-ready pitch packs (week 8 to 14, contingent on Phase -1 findings)

Signal access (API or export fallback) → evidence attachment → ranked decision framework → pitch packs → outbound drafts → objection parking.
Goal: more RS touched and pitched per week. Metric: evidence-ready packs/day; RS touched/week (expect 5 to 10x); pitch → response rate.

### Phase 4: post-meeting capture and commitment memory (month 3 to 5)

Transcript/notes → CI record + follow-up draft + commitment extraction + dossier and RS-state updates as one approval batch (L4).
Goal: nothing falls through cracks. Metric: CI logging coverage ~100%; overdue commitments trending to zero; draft acceptance >70%.

### Phase 5: event triggers and temporal memory (month 5+, entry-gated)

Entry criteria: Phases 2 to 4 metrics green for 8 consecutive weeks. Then: email/transcript/signal event triggers, temporal KG (P4), auto-resurfacing of parked RS on unblock conditions, background enrichment.
Goal: less manual updating, more freshness. Metric: event-to-dossier lag; parked-RS revivals/month; temporal-question answer quality.

Autonomy-ladder graduation (12.3) runs as a parallel policy track gated on its own precision metrics, not tied to a phase.

Pilot design: run Phases 0 to 2 with 3 to 5 AMs before wider rollout; A/B the cockpit against self-directed triage on CI pacing attainment and RS progression. The vendor precedents' efficacy numbers are self-reported; generate your own.

---

## 15. Evaluation and operating metrics

**North star: monthly scorecard attainment.** CI pacing attainment (% of months on-pace at each weekly checkpoint), RS closes vs target, client coverage attainment, solution-mix balance vs plan. Attribute conservatively: RS closes have many causes; measure pacing and activity lift directly, claim revenue lift carefully.

**Leading indicators:** evidence-ready packs/day; RS touched and pitched/week; pitch → response → meeting → commitment funnel; untouched-client count; overdue-commitment count; draft acceptance rate and edit distance; response latency to client messages.

**Trust (non-negotiable):**

- Weekly grounding QA: sample 20 sent messages with claims; human-verify each against its citation. Target >95% grounded. (Basis: the citation layer improves grounding materially but real-world citation recall ran ~52%, so sampling is mandatory.)
- Clearance violations: target zero; any violation is a sev-1 review of the gate.
- Golden question set: 20 per playbook (extractive, abstractive, temporal, should-escalate); run on every KB or prompt change.

**System health:** AM file-gardening minutes/week (target <15); dossier freshness lag; stale-claim count in the hygiene queue; cockpit daily-open rate and % of cockpit actions acted on (an ignored cockpit is a failed cockpit); queue-feedback responsiveness (does AM feedback visibly re-rank?).

**Drift watch:** playbooks carry `last_reviewed`; >90 days flags in the cockpit. A wrong playbook is worse than no playbook.

---

## 16. Refuted claims (do not build on these)

Killed by 3-vote adversarial verification. They circulate widely; do not cite them in any pitch for this project.

| Refuted claim                                                          | Vote | Implication here                                                |
| ---------------------------------------------------------------------- | ---- | --------------------------------------------------------------- |
| "Context window = RAM, weights = CPU" as a literal LLM-OS architecture | 0-3  | Use context-engineering framing (P1), not the hardware metaphor |
| Zep beats MemGPT on DMR 94.8% vs 93.4%                                 | 0-3  | Temporal KG chosen for capability (P4), never this number       |
| Zep: up to 18.5% accuracy gain + 90% latency reduction (LongMemEval)   | 1-2  | Same                                                            |
| HybridRAG Faithfulness/Answer-Relevance 0.96 beats both alternatives   | 0-3  | Keep qualitative complementarity (P5); drop the metrics         |
| LLMs attribute claims correctly >70% via in-context learning alone     | 0-3  | QA sampling is mandatory (Section 15); never quote this figure  |

---

## 17. Open questions

Most v1 open questions moved into Phase -1 as audit work. Still genuinely open:

1. **The real scorecard mechanics** (the lost 77-line paste): official CI definition and counting rules, CI/RS targets, RS category taxonomy, any solution-mix expectations. Sections 6 and 9 calibrate to this; everything there is placeholder until then.
2. **"gbrain":** Garry Tan's public gBrain (low confidence) or a Meta-internal system? If internal, evaluate as the T3/Phase 5 layer.
3. **Compliance posture for AI-drafted client comms at Meta:** where the mandatory approval boundary sits; whether any category may ever legally reach autonomy rung 3; WhatsApp template/opt-in handling for AM-to-client messaging specifically.
4. **Benchmark library governance:** who owns the cleared list and approved phrasings the clearance gate depends on (8.3), and its refresh cadence.

---

## 18. Sources

Verified-primary (claims survived adversarial panels):

- Karpathy, context engineering: https://x.com/karpathy/status/1937902205765607626
- Karpathy, LLM-as-OS: https://x.com/karpathy/status/1707437820045062561
- Manus, Context Engineering for AI Agents: https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Zep/Graphiti temporal KG (arXiv 2501.13956): https://arxiv.org/abs/2501.13956
- HybridRAG (arXiv 2408.04948, ICAIF 2024): https://arxiv.org/abs/2408.04948
- Microsoft Sales agent technical report (2025-12): https://techcommunity.microsoft.com/blog/microsoft365copilotblog/sales-agent-in-microsoft-365-copilot-evaluation-results-%E2%80%93-technical-report/4476867
- Microsoft 365 Copilot orchestrator: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/orchestrator
- Microsoft Sales Copilot architecture: https://learn.microsoft.com/en-us/microsoft-sales-copilot/architecture
- Microsoft Sales Copilot functional overview: https://learn.microsoft.com/en-us/microsoft-sales-copilot/functional-overview
- Salesforce Agentforce + Data Cloud (Trailhead): https://trailhead.salesforce.com/content/learn/modules/data-cloud-powered-agentforce/enable-trusted-agents-with-data-cloud
- Cite Before You Speak (arXiv 2503.04830, SIGIR 2025): https://arxiv.org/html/2503.04830v2
- Cognition, Don't Build Multi-Agents: https://cognition.ai/blog/dont-build-multi-agents
- Cognition, follow-up: https://cognition.ai/blog/multi-agents-working
- Anthropic, multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system

Consulted, lower weight: agent-memory vendor comparisons (agentmarketcap.ai, devgenius.io, dev.to), hybrid-search posts (superlinked, Towards Data Science, FalkorDB), Gong platform pages, ZenML LLMOps database, HITL/guardrail explainers (machinelearningmastery, hatchworks), PKM-for-agents posts (affine.pro, ability.ai), gBrain tutorial (MarkTechPost, 2026-05-22).

**Changelog**

- v2 (2026-06-07): added AM Execution Layer (Section 6) + P0; rebuilt build plan around Phase -1 audit and Phase 2 cockpit; replaced multiplicative RS scoring with rules-first ranked decision framework + learning loop; added relationship model (Section 10); extended citations to a claim clearance gate (8.3); added file lifecycle/maintenance rules (7.4); reframed morning brief as pacing-first cockpit; demoted temporal KG and event triggers to Phase 5; added scorecard-attainment evaluation. v1 research findings, principles, and refuted-claims register retained.
- v1 (2026-06-07): initial research synthesis.
