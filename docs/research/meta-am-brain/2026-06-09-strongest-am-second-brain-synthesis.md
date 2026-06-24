# The Strongest AM Second Brain

### A synthesis of AM Brain (canonical, REV3) + Jack Griesedieck's AM-OS, into one architecture

**What this is.** The strongest combined architecture for a Meta Ads Account Manager's personal agent system - produced by fusing two _real_ systems: the operator's own principled **AM Brain** canonical (REV3, 2026-06-09) and Jack Griesedieck's **production** AM-OS Second Brain (34 ANZ accounts). It keeps AM Brain's safety + calibration spine and Jack's operational maturity, while inheriting **neither** parent's catastrophic failure mode (Jack's silent-data-loss bidirectional merge; AM Brain's hidden-engine-with-no-named-surface + untested in-prompt math). Any agent (Metamate, Claude Code, Codex, MyClaw, MetaClaw) can read this cold.

- **Operator:** Jason Li - AM, APAC/Singapore. FBID 608717784 · sales_employee_id 495568 · unixname jasonljc.
- **Portfolio:** 33 active advertiser accounts (registry 43; 10 `in_portfolio=false`).
- **Date:** 2026-06-09. **Provenance tags:** `[AM]` AM Brain · `[Jack]` AM-OS · `[synth]` new synthesis · `[ext]` external grounding.
- **Supersedes (folds in):** `2026-06-07-meta-am-second-brain-architecture.md` (v2 research) + `meta-am-brain/SPEC.md` (v2 spec) + the AM Brain REV3 canonical + Jack's AM-OS manual. Source docs staged in `_synthesis/_inputs/`.

> **How it was produced.** A fan-out of **34 agents**: 7 dimension harvesters reconciling best-of-both, 3 external-grounding research agents (web-cited), 9 adversarial skeptics (refute-by-default; 2/3 to overturn), 1 chief architect fixing the spine, and per-section writers. The contested **storage** decision was settled by _evidence, not deference_ - and it **overturned the operator's own approved REV3**. Method + verdicts in the Appendix.

-

## Executive verdict - what changed vs the two parents

1. **Storage (FEATURED, §3) - REV3 was overturned 2/3.** Neither REV3's MM2-canonical nor Jack's bidirectional sync won; a **tier-split single store** did - AUTHORED truth on files + **local-disk** git + GDrive revisions + off-host bundle; regenerable MIRROR caches on whatever the unattended host can reach. It **dissolves REV3's `{file+git, hosted, unattended}` host trilemma** and is grounded in 3 web-research angles **plus Jack's own manual admitting "Metamate's changes are LOST."**
2. **Skills (§6) - Jack's named surface over AM Brain's tested engine.** 12 thin-wrapper slash-skills atop ALG-1..8: _the name is the ergonomics, the Python is the correctness._
3. **Analytics (§7) - Jack's analyses suite refactored from in-prompt LLM math into tested Python** (ALG-9..13), then wired into ranking through an `analysis→evidence→RS` seam **neither parent built**.
4. **Governance (§9, survives 1/3) - single-writer now, gated multi-agent future.** Jack's fleet + locking + task-queue imported as _latent_ infra behind an 8-green-weeks + disjoint-writable-partition gate; the clearance gate made **unbypassable**.
5. **Memory (§5, overturned 2/3 → upheld with fixes) - the decomposed dossier holds**, with grain corrections (rs-ledger open/archive split, `interactions/raw` flattened ≤3 levels, half-year `narrative.md` shards).

-

## 1. Thesis - compounding knowledge store WITH a calibration-honest decision engine

A Meta Ads Account Manager carrying ~33 advertiser accounts in APAC/Singapore loses the same way every quarter: the knowledge that should compound - who the buyer is, what was promised, why spend was held flat, which RS already failed - evaporates between meetings, and the judgment that should be disciplined - "you can scale 40% before CPA degrades," "this benchmark proves the case" - gets improvised in a prompt and pitched with confidence it has not earned. The two parent systems each solve exactly one half of that loss and architect the other half as their catastrophic failure mode. **AM Brain** [AM] is a principled, calibration-honest _decision engine_ - a deterministic Python cortex (ALG-1..8) that bands everything rules-first, renders unknown as unknown, and gates every outbound claim - but it ships with _no compounding knowledge assets_: no named operator surface, no deep analyses, an empty dossier it has never filled at scale. **Jack's AM-OS** [Jack] is a production-mature _knowledge-and-skill machine_ - 14 named slash-skills, a per-section ownership matrix, a rich analyses suite, an enriched registry, narrative dual-load, all proven daily across 34 ANZ accounts - but it computes its highest-stakes numbers (log-curve fits, regressions, diminishing-returns thresholds) _inside LLM prose skills_ and has _no outbound clearance gate at all_, so a 1400-line skill silently mis-advises spend and one client's data can ride into another's send with nothing structural to stop it.

The thesis of this synthesis is that these are not competing designs to choose between - they are the two halves of one organism, and each parent's missing half is the other parent's strongest asset. **The strongest AM second brain is a dual-and-layered center of gravity: a compiled, compounding wiki feeding a tested decision engine, with a named-skill surface sitting over that engine as ergonomics - not as logic.** [synth]

### 1.1 The dual-and-layered center of gravity

Two layers, each owning exactly what it is good at, with a hard line between them:

```
            ┌──────────────────────────────────────────────────────────────┐
  OPERATOR  │  12 NAMED SKILLS  (Jack's surface — ergonomics, muscle-memory) │
  TYPES ──► │  /morning /prep /capture /log /sweep /refresh /pitch-priorities│
            │  /calendar /analyze /brief /setup /handoff  + freeform query    │
            └───────────────┬──────────────────────────────┬─────────────────┘
                            │ thin wrapper (no math here)   │
                            ▼                                ▼
            ┌──────────────────────────────────┐  ┌──────────────────────────┐
  TESTED    │  DETERMINISTIC ENGINE  (AM's spine)│  │  CLEARANCE GATE (gate.py) │
  PYTHON ─► │  classifiers.py  ALG-1..8          │  │  single-recipient taint   │
            │  analyses/*.py   ALG-9..13 (Jack's │  │  no-raw-spend / drafts-only│
            │     suite, refactored to code)     │  │  UNBYPASSABLE             │
            │  config.md = all constants         │  └──────────────────────────┘
            │  every number deterministic + tested│
            └───────────────┬────────────────────┘
                            │ reads / writes through ownership matrix
                            ▼
            ┌──────────────────────────────────────────────────────────────┐
  COMPOUND  │  KNOWLEDGE STORE  (the compiled wiki — one canonical store)    │
  KNOWLEDGE │  AUTHORED tier: profile / relationship / style / narrative /   │
            │     commitments  (durable truth; files + LOCAL-DISK git)       │
            │  MIRROR tier: performance / rs-ledger / interactions / analyses│
            │     (regenerable caches; fetched_at + shelf-life)              │
            │  narrative.md DUAL-LOADED with the structured dossier          │
            └──────────────────────────────────────────────────────────────┘

  THE LLM TOUCHES THIS STACK IN EXACTLY THREE PLACES (I-1):
   (1) extract structured facts from unstructured prose
   (2) compose operator/client-facing language
   (3) render genuinely-ambiguous / low-confidence items as a QUESTION
  Everything else — every threshold, join, band, rank, curve-fit, freshness
  check, gate decision — is tested Python. A skill that asks the LLM to
  compute a number is a bug.
```

The compounding store (detailed in §5) is the long-term memory that _gets denser over time_: a CRM note, a 96h VC transcript, an operator correction all flow one-directionally into authored truth that supersedes rather than accumulates [ext: Karpathy compiled-wiki]. The decision engine (detailed in §7) is the cortex that _reads that store and never lies about it_: rules order everything (I-2), unknown is never zero (I-3), and a numeric score may only break ties _within_ a band, never reorder _across_ bands. The named-skill surface (detailed in §6) is the ergonomic shell that makes the daily loop legible and teachable - but it is a thin wrapper, never the place the math lives.

**Why both layers, and why the line between them is load-bearing.** Each parent built one layer well and the other layer into its failure mode:

| Property                  | AM Brain alone [AM]                                  | Jack alone [Jack]                                                                           | This synthesis [synth]                                                           |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Operator surface          | none (freeform prompt only) - loses daily ergonomics | 14 named skills - legible, teachable, muscle-memory                                         | **12 named skills** (Jack's surface)                                             |
| Where math lives          | tested Python (I-1) - verifiable                     | in-prompt LLM (1400-line skills) - drifts, mis-advises                                      | **tested Python** (AM's discipline)                                              |
| Deep analyses             | none (a real capability gap)                         | health-check / headroom / cpa-v-spend / levers - QBR-critical                               | **Jack's suite, refactored to `engine/analyses/*.py`** (capability + discipline) |
| Outbound safety           | full clearance gate (gate.py + GATE-1..5)            | **none** - cross-client leak is unguarded                                                   | **AM's gate, kept wholesale, made unbypassable**                                 |
| Knowledge model           | two-tier mirror/authored - staleness structural      | rich but co-mingled; freshness hand-maintained, can drift                                   | **two-tier + computed freshness**                                                |
| Catastrophic failure mode | empty store (no compounding assets)                  | (a) LLM mis-computes spend; (b) cross-client send leak; (c) bidirectional-merge silent loss | **inherits neither**                                                             |

The hard line between the named surface and the tested engine is the single most important architectural commitment in this document, because it is where _both_ parents' failure modes get designed out at once. Put the math in the skill (Jack's way) and you get the 1400-line-drift, silently-mis-advises-spend failure. Hide the engine behind only a freeform prompt (AM Brain's way) and you lose the daily ergonomics a solo AM actually operates by. **The name is the ergonomics; the Python is the correctness.** [synth] Each skill's body is exactly three moves: (1) call `engine.classifiers` / `engine.analyses` for _all_ math, (2) hand the structured result plus the relevant dossier slice to the LLM for _language only_, (3) write through the ownership matrix. Curve-fitting and regression - the least-ambiguous candidates for code-over-LLM in the entire system - are the proof case: a `np.polyfit` on log-spend with golden-fixture tests is strictly better than the same fit improvised in a prompt, costs little, and is exactly what I-1 intends.

### 1.2 The grafts that make it stronger than either parent

This is not AM Brain with skills bolted on, nor Jack with a gate bolted on. Three grafts make the combined system strictly dominate both:

1. **Jack's production assets on AM Brain's principled spine.** Jack's analyses suite becomes `engine/analyses/{diagnostic, headroom, cpa_v_spend, levers, revenue_commentary}.py` - pure functions emitting a typed `AnalysisResult`, golden-fixture tested, narrated (never computed) by the LLM [synth]. Jack's per-section ownership matrix becomes a machine-checkable `_system/ownership.md` keyed at _field_ resolution (finer than Jack's section grain, more concrete than AM Brain's prose I-5). Jack's enriched registry (crm_name + display_name + status + aliases + `slug→display_name→crm_name→alias` resolution order) merges with AM Brain's lean join-keys into one validate-on-load `registry.yaml`. Jack's narrative dual-load, file-health limits, atomic-mkdir lock, task-queue seam, and danger-zone catalog all import as the production-hardened operational layer.

2. **The seam neither parent wired: analysis → evidence → ranking.** Each `AnalysisResult` emits `DM-EVID` evidence objects that feed ALG-4 (evidence attachment) and therefore ALG-5 (RS ranking) through an explicit producer→consumer contract pinned with a `safeParse` seam test [synth]. A decisive headroom signal ("underspending vs optimal zone by 35%") can raise a scale-up RS to `evidence_readiness=strong`; a past-knee cpa-v-spend signal can _suppress_ a scale-up RS and raise a consolidation RS - **while still only setting a categorical band** (I-2 preserved; the curve value never reorders across bands). This turns Jack's reports-the-AM-eyeballs into AM Brain's deep evidence engine. Neither parent built this; it is the highest-value graft in the synthesis (see §7).

3. **It inherits neither parent's catastrophic failure mode.** AM Brain's bidirectional-merge-as-default fear and Jack's bidirectional-merge-in-production both resolve to the _same_ settled storage ruling (§1.3, fully argued in §3): one canonical store, no bidirectional merge ever, additive merge demoted to a manual recovery-only tool. Jack's unguarded send boundary is closed by AM Brain's unbypassable gate (§9). AM Brain's empty store is filled by Jack's production knowledge assets. Jack's in-prompt math is replaced by AM Brain's tested engine. The combined system has _no_ path to silent spend loss, silent cross-client leak, silent data loss, or confident-but-wrong ranking.

### 1.3 The storage ruling, stated (full head-to-head in §3)

The most-contested decision in this synthesis is the storage/sync/concurrency/durability model, and per the operator's directive it was _not_ rubber-stamped from AM Brain's REV3 single-store-on-MM2 decision. Jack's bidirectional sync is production-proven and was weighed honestly; a hybrid (one canonical store + Jack's locking/task-queue/one-way-backup/version-history) was explicitly on the table and is what won. The adversarial verdict overturned the original files-canonical hybrid **2/3 on the durability headline**, and the settled model is the genuinely-stronger one those verdicts force:

> **One canonical live store, TIER-SPLIT by durability class**, with single-writer-by-construction + an advisory atomic lock + a one-way versioned off-host backup + a recovery-only (never scheduled) additive merge. [synth, forced by the §3 verdicts]
>
> - The **AUTHORED tier** (un-regenerable truth: profile / relationship / style / narrative / commitments + `_system`) is files + **LOCAL-DISK git** on the canonical host, with GDrive native revision-history as a free second recovery layer (treated as a bonus until verified) and a nightly off-host `git bundle` + `git fsck` tripwire as primary DR. The `.git` object store **MUST** reside on local disk, never on the cloud FUSE mount - closing the documented "Google Drive Sync corrupting git repositories" / rclone-mount-instability corruption class. [ext]
> - The **MIRROR tier** (regenerable caches: performance / rs-ledger / interactions / contacts / analyses, all `fetched_at`-stamped) may live on whatever store the unattended host can natively reach (an MM2 read-projection is permitted) because losing it costs nothing - it is re-derived next run, guarded by a 0-files-written-when-due **HARD FAIL**.
> - **No second live read/write store.** The optional API/memory projection is one-way, read-only, regenerable, never written back; an out-of-band edit that lands in the projection goes to a quarantine ledger drained by the manual `/brain:recover-merge` tool.

This keeps REV3's single-canonical-store _principle_ and the cross-source compounding consensus (single store + append-only + no bidirectional merge), **AND** Jack's production durability evidence (files+git+revision-history is the proven-recoverable layer), **AND** unblocks the unattended host - because the tier-split dissolves REV3's `{file+git canonical, hosted, unattended}` pick-two trilemma. The trilemma only binds the un-regenerable AUTHORED tier (which gets file+git); the regenerable MIRROR tier can ride the hosted scheduler's reachable store.

The rejected options and the adversarial verdict that settles it are presented in full in **§3 (FEATURED)**; the reconciled invariant form is **I-7** in §2. What matters for the thesis: the storage decision is _evidence-driven, not inherited_, and it is precisely the move that lets a solo AM run a laptop-closed compounding store without betting un-regenerable truth on a late-beta backend.

### 1.4 Genuinely unserved by Meta's Sales AI

This system is not a reskin of capability the operator already has from Meta. Meta's first-party assistance for advertiser conversations - the Business-AI / Sales-AI surface - is, by construction, **read-only, stateless, and single-account-scoped** [ext]. It can answer a question about _one_ advertiser in _one_ session; it does not persist a relationship across quarters, does not own the AM's book as a portfolio, does not act, and does not compound. The strongest AM second brain is unserved by it on five axes that are the entire point of the design:

| Capability                     | Meta Sales AI [ext]                       | This AM second brain [synth]                                                                                     |
| ------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **State across time**          | stateless; no memory between sessions     | compounding AUTHORED tier - profile / relationship / narrative / commitments that _get denser_ (§5)              |
| **Portfolio scope**            | single-account, per-conversation          | all 33 accounts ranked together - pacing (ALG-1), coverage (ALG-2), RS triage (ALG-5) over 500–1000 open RS (§7) |
| **Acting, not just answering** | read-only Q&A                             | drafts outbound, batches CI capture, parks commitments, graduates send autonomy on numeric criteria (I-9, §9)    |
| **Deep diagnosis**             | no curve-fits, no headroom, no trajectory | tested `analyses/*.py`: headroom log-curve, cpa-v-spend regression, 180d trajectory enum, lever adoption (§7)    |
| **Governed outbound**          | n/a (it doesn't send for you)             | unbypassable clearance gate - single-recipient taint, cross-client hard-fail, cleared-benchmarks-only (I-6, §9)  |

The reconciliation lessons - single-canonical-store, write-gates-before-storage, no-bidirectional-merge - are the _same_ 2026 production consensus that Salesforce, Mem0, and Anthropic's client-side-canonical pattern converge on [ext]. Meta's stateless single-account assistant is structurally on the wrong side of every one of those lessons for a portfolio operator. The wedge is real: **own the loop the read-only assistant cannot** - persist, rank, act, diagnose, and gate across the whole book.

### 1.5 Reuse, not rebuild, where the parents overlap

Where AM Brain and Jack already agree, the synthesis _adopts the shared mechanism verbatim_ rather than re-deriving it - the reuse-not-rebuild stance, consistent with "check existing utils first; >3 new files needs justification." Three large overlaps are taken whole, not rebuilt:

- **Append-only / immutable interaction history.** Both parents converge (Jack: "interaction files immutable once created"; AM Brain: append-only ledger + monthly digest + archive). Adopt the convergence directly: `interactions/raw` is write-once create-only; corrections are tombstone-referenced new entries (`not_true:<claim>; do_not_rederive:true`), never in-place edits (I-12). No new design here - the two parents already settled it.
- **The two-tier mirror/authored split + structural freshness.** AM Brain's `fetched_at` + shelf-life machinery and Jack's `data_freshness` block answer different questions (can-this-value-leave-the-building vs how-stale-is-this-account-at-a-glance) and are kept _both_, at two granularities, with the legible block **computed** from the underlying stamps so it cannot drift (I-8, §5). Enforcement is AM Brain's structural model; display is Jack's at-a-glance block - neither is rebuilt.
- **The data plane.** AM Brain's `jf graphql → presto` tunnel, numeric-ID-match, `IN(all ad_account_ids)` 70%-undercount rule, dead-end registry, and standardized pull envelope are ported essentially verbatim, _extended_ (not replaced) by Jack's named Presto tables, 3-rung spend cascade, and kernel-non-mixing rule into two named transports (§8). The shared discipline - a failed pull renders `unknown`, never `0` - is taken directly from both.

Where the parents _disagree_, this document resolves each conflict explicitly with a stated ruling and rationale (the storage ruling in §3; the engine-vs-LLM placement of analyses in §7; field-level-vs-section-level ownership in §9; the 12-vs-14 skill catalog in §6). Where they _agree_, the agreement is the evidence, and the synthesis inherits it without ceremony. The result - Jack's production knowledge assets running on AM Brain's calibration-honest, gated spine, with the analysis→ranking seam neither parent wired - is strictly stronger than either parent and is unserved by Meta's stateless single-account assistant.

_(Invariants I-1..I-13 that govern this architecture are stated in §2; the storage head-to-head and adversarial verdict in §3; the full layer model in §4.)_

## 2. Invariants - the reconciled law (I-1..I-13)

These thirteen invariants are the law the engine, the gate, the write-guard, and every skill obey. They fold AM Brain's I-1..I-10 (the calibration-honest, single-store, draft-only spine) into Jack's production laws (additive-only/never-delete, per-section single-owner, immutable interactions, registry-is-sacred, danger-zone) and resolve every conflict inline. Five conflicts were settled against the contested points the operator flagged: **I-7** (one-store-no-merge → tier-split files-canonical, not REV3's bare MM2 flip), **I-5** (field-grain overlaid with Jack's matrix), **I-11** (single-writer _by construction_, the lock as defense-in-depth not a hard mutex), **I-12** (immutability + tombstone + roll-up bounds), and **I-13** (registry superset, volatile counts excluded).

Provenance tags: **[AM]** AM Brain · **[Jack]** Jack's AM-OS · **[synth]** new synthesis · **[ext]** external grounding. The featured storage head-to-head and the full ruling live in §3; I-7/I-8/I-11/I-12 below carry only the law and its rationale, cross-referencing §3 rather than restating it.

| #    | One-line law                                                     | Resolves                  | Primary provenance        |
| ---- | ---------------------------------------------------------------- | ------------------------- | ------------------------- |
| I-1  | Determinism in code, judgment in the model                       | -                         | [AM]+[synth]              |
| I-2  | Rules first, numbers last                                        | -                         | [AM]                      |
| I-3  | Unknown ≠ zero; never fabricate                                  | -                         | [AM]+[ext]                |
| I-4  | Mirror the SoR; never invent its keys                            | human-field carve-out     | [AM]+[Jack]               |
| I-5  | Field-level ownership over a per-file matrix                     | grain conflict            | [AM]⊕[Jack]               |
| I-6  | Gate the outbound, not the files                                 | -                         | [AM]+[Jack]               |
| I-7  | One canonical live store; no bidirectional merge                 | **tier-split** (§3)       | [AM]+[Jack]+[synth]+[ext] |
| I-8  | Mirror live, author durably; staleness is structural             | -                         | [AM]+[Jack]+[synth]       |
| I-9  | Draft-only at launch; graduate only on numeric criteria          | two ladders               | [AM]+[synth]              |
| I-10 | Poll on schedule; there is no event path                         | -                         | [AM]+[Jack]               |
| I-11 | Single-threaded writer **by construction**; subagents read-only  | hard-mutex correction     | [AM]+[Jack]+[ext]         |
| I-12 | Additive history with archive-not-hoard; the agent never deletes | immutability+bounds       | [Jack]+[AM]+[synth]       |
| I-13 | Registry is sacred and stable; validate-before-write             | superset, counts excluded | [Jack]+[AM]+[synth]       |

-

### I-1 - Determinism in code, judgment in the model `[AM]`, extended `[synth]`

**Law.** ALL classification, joining, thresholding, ranking, curve-fitting, and regression is tested Python (`engine/classifiers.py`, `engine/analyses/*.py`). The LLM does language + genuinely-ambiguous judgment only, in exactly **three** places - the one-line split rule that governs every skill:

1. **Extract** structured facts from unstructured prose (e.g. `/capture` notes → decisions/sentiment).
2. **Compose** operator/client-facing language (verdict lines, talk tracks, briefs, `score_reason` prose).
3. **Render** low-confidence / required-human-judgment items as a **question**, not a recommendation.

> A skill that asks the LLM to compute a number is a bug.

**Why.** Long LLM skills (1400+ lines) drift, misclassify, and skip steps; a log-curve fit or diminishing-returns threshold computed in-prompt is unverifiable and silently mis-advises spend. Curve-fitting/regression is the least-ambiguous candidate for code-over-LLM - which is exactly why the `[synth]` extension folds Jack's analyses suite (`/health-check`, `/headroom`, `/cpa-v-spend`), which Jack ran as in-prompt LLM math, into deterministic `engine/analyses/*.py` modules. Capability from Jack, rigor from AM Brain. _(See §7 for the analysis modules and the producer→consumer seam.)_

-

### I-2 - Rules first, numbers last `[AM]` / SPEC ALG-5, ALG-5a

**Law.** Categorical bands order everything. The RS-rank pipeline is strictly:

```
R0 pins  →  R2 gates  →  R1 boosts  →  R3 band-sort  →  R4 numeric-tiebreak
```

A numeric score **MUST NOT** reorder across bands - it only breaks ties **within an identical band** (R4). Low-confidence / required-human-judgment items render as a **QUESTION**, not a recommendation (ALG-5a).

**Why.** This kills confident-but-wrong output. A numeric score reordering across bands is exactly how a ranking lies - the model becomes "confidently wrong" the moment a single fitted number jumps an RS past a categorical gate. Numbers-last means the analysis can set a band (I-1's analyses feed ALG-4/ALG-5, §7) but the curve value never reorders the queue.

-

### I-3 - Unknown ≠ zero; never fabricate `[AM]` / SPEC DM-4, CONF-1 + `[ext]`

**Law.** Absent / non-numeric / non-finite inputs render as **unknown** (NOT `0` / `false` / `pass`) and branch to an explicit unknown/unscored outcome. **`Number.isFinite`-guard every external numeric before any comparison.** Banners are mandatory and non-removable:

- Uncalibrated pacing surface → `PACING UNCALIBRATED` banner.
- Uncalibrated curve → `[UNCALIBRATED CURVE]` banner; **may NOT enter a client draft**.
- Unsourced proof point → `[NEEDS CLEARED BENCHMARK]`.

**Why.** The #1 way dashboards lie is defaulting missing → zero/pass. NaN-blind comparison gates pass NaN as **all-false** - every threshold built from `<` / `>` silently passes a NaN, so a missing spend reads as "under budget, all clear." The `Number.isFinite` guard is `[ext]` grounding from the project-memory NaN-blind-gates lesson (caught fabricating "corroborated" in a prior incident); it folds into the data-plane `SPEND_ZERO_GUARD` so a NaN spend never passes as 0.

-

### I-4 - Mirror the system of record; never invent its keys `[AM]` + `[Jack]` §12 carve-out

**Law.** `rs_id` / `org_id` / `sfid` / `ad_account_id` are copied **verbatim** from the SoR; the brain annotates, never authors CRM/ads truth. **Human-set fields living inside otherwise-generated files are HUMAN-ONLY and never auto-overwritten** - enumerated:

```
status · tier · scorecard_status · RS impact_override · RS ease_override
```

A generated `performance.md` must not flip a human-set `tier`; an agent re-banding RS must not touch a human `impact_override`.

**Why.** Keeps the brain subordinate to CRM/ads; the registry/SoR keys are the **join contract** - fabricating one undercounts or mis-joins silently. AM Brain leaves the carve-out _latent_ under DM-8 ("generated → overwrite freely" is true for the FILE but false for specific human-set fields inside it). **Jack learned in production (§12) that human-set fields live inside engine-regenerated files and must be carved out** - so the field-level enumeration is imported from Jack and made the I-4 contract, enforced by the write-guard (§9).

-

### I-5 - Field-level ownership over a per-FILE single-owner matrix `[AM]` I-5/DM-13 ⊕ `[Jack]` §12

**Conflict - field-grain vs section-grain.** AM Brain specifies ownership at **field** resolution as prose (freeze `trust_level` even inside a `/capture`-owned file). Jack specifies a **machine-checkable per-section owner table** with explicit write-modes - better documentation, but coarser grain.

**Ruling `[synth]`.** Adopt Jack's matrix _legibility_ at AM Brain's _field resolution_. Every file/field is exactly one of four classes, and the matrix is keyed **skill × (file + protected-field-list)** with an explicit `write-mode`, machine-checkable in `_system/ownership.md`, enforced by the write-guard on **every** write:

| Class        | Write-mode                | Behavior                                          |
| ------------ | ------------------------- | ------------------------------------------------- |
| human-owned  | `propose-under-suggested` | agent proposes diffs only                         |
| AM-confirmed | `propose-under-suggested` | agent parks under `suggested:`, operator confirms |
| generated    | `overwrite-free`          | agent overwrites freely (regenerable)             |
| append-only  | `append-only`             | append only; correct via tombstone, never edit    |

```yaml
# _system/ownership.md (excerpt)
files:
  - {
      path: "clients/*/performance.md",
      owner: engine,
      class: generated,
      write_mode: overwrite-free,
      human_only_fields: [tier, scorecard_status, status],
    }
  - {
      path: "clients/*/relationship.md",
      owner: engine,
      class: am-confirmed,
      write_mode: propose-under-suggested,
      human_only_fields: [trust_level, current_mood],
    }
  - {
      path: "clients/*/rs-ledger.md",
      owner: engine,
      class: append-only,
      write_mode: append-only,
      human_only_fields: [impact_override, ease_override],
    }
  - {
      path: "clients/*/profile.md",
      owner: human,
      class: human-owned,
      write_mode: propose-under-suggested,
      human_only_fields: ["*"],
    }
```

`trust_level` / `current_mood` change **ONLY** on operator confirm - they are field-level exceptions inside an otherwise `/capture`-owned file.

**Why.** Safe autonomy over shared structure. Jack's per-section owner-table is mechanically-checkable documentation of write authority (strictly better than prose); AM Brain's field grain is finer than Jack's section grain. Combining gives matrix legibility at field resolution. _(The full ownership table, write-guard, and the WRITE ladder it grounds live in §5 and §9.)_

-

### I-6 - Gate the outbound, not the files `[AM]` SPEC §8 GATE-1..5 + `[Jack]` §17 danger-zone

**Law.** **No per-file ACLs.** A single operator legitimately sees all own clients; analysis spans all 33 accounts freely. The real risk is one client's data in another's **SEND** - enforced at the **draft boundary** (`gate.py`) via:

- **single-recipient taint** - a draft carries data from exactly ONE client (its recipient);
- **cross-client hard-fail** - cross-client content → BLOCK;
- **no-raw-spend** - no raw spend / WoW% to a client; unsourced proof → `[NEEDS CLEARED BENCHMARK]`;
- **drafts-only** - agent writes a Gmail Draft; the human sends.

There is **NO send path that does not traverse `gate.py`**. Gate-bypass is a **forbidden, loud-failing, blocked-and-logged** operation.

**Why.** The leak happens at the send boundary, not in the files; for a 33-client book, cross-client contamination is the catastrophic failure. **Jack has NO outbound gate at all - a real safety gap** the synthesis closes by keeping AM Brain's gate wholesale. Making the gate unbypassable uses **Jack's danger-zone framing** (catastrophic-forbidden-operations list, §17), which mechanizes "unbypassable" better than AM Brain's prose. _(Full GATE-1..5 decision table, claims register, and escalation taxonomy in §9.)_

-

### I-7 - One canonical live store; no bidirectional merge, EVER `[AM]` + `[Jack]` + `[synth]` tier-split + `[ext]` GROUND consensus

> **This is the featured ruling. The full head-to-head, rejected options, and adversarial verdict are in §3. I-7 states only the settled law and why it is settled.**

**Law.** Exactly **one** canonical store, **split by durability class**:

- **AUTHORED tier** (un-regenerable truth: `profile` / `relationship` / `style` / `narrative` / `commitments` + `_system`) = files + **local-disk git** on the canonical host, with GDrive native revision-history as a _free second recovery layer_ (a bonus, **treated as unverified until proven**) and a nightly off-host `git bundle` + `git fsck` tripwire as primary DR. **The `.git` object store MUST reside on local disk, never on the cloud FUSE mount.**
- **MIRROR tier** (regenerable caches: `performance` / `rs-ledger` / `interactions` / `contacts` / `analyses`, all `fetched_at`-stamped) may live on whatever store the unattended host can natively reach (an MM2 read-projection is permitted), because losing it costs nothing - it is re-derived next run, guarded by a **0-files-written-when-due HARD FAIL**.

Additive LLM merge is **DEMOTED** from a scheduled loop to a **MANUAL recovery-only tool** (`/brain:recover-merge`): invoked only on a detected divergence, additive, deterministic-contradiction-resolution (**canonical wins**), diff-confirmed before commit. **No second LIVE read/write store**; the optional API/memory projection is one-way, read-only, regenerable, **never written back**. If an out-of-band edit ever lands in the projection it goes to a **quarantine ledger** drained by `/brain:recover-merge`.

**Why.** Bidirectional prose-merge silently **loses AND fabricates** data - corroborated independently by Jack's own manual ("Metamate's changes are LOST") and by the 164-silent-run disaster class (personal + bidirectional + silent). Three independent GROUND research angles (concurrency, pkm-compounding, ai-memory) converge unanimously on single-canonical-store + append-only + no-bidirectional-merge as the 2026 production consensus. The **tier-split dissolves REV3's `{file+git canonical, hosted, unattended}` pick-two trilemma**: the trilemma binds only the un-regenerable AUTHORED tier (which gets proven file+git recovery); the regenerable MIRROR tier can ride the hosted scheduler's reachable store under the heartbeat guard. The recovery-only merge keeps Jack's documented recovery value (a lost edit becomes recoverable, not permanent) while removing the always-on loss/fabrication surface AM Brain rejects - the two parents reconcile here, they are not mutually exclusive.

**Why not REV3's bare MM2 flip (not rubber-stamped).** Pinning canonical state to MM2 bets un-regenerable authored truth on a late-beta store with an unverified ~100 KB/file cap + truncation (one oversized `narrative.md` = silent loss), opaque version-recovery/retention, and a known ~23-mission silent-stop bug - and it contradicts AM Brain's _own_ ship-now recommendation (§11 "Now → option 3", laptop files+git, which IS file-canonical). Corrected to **tier-split files-canonical-for-authored**. _(Adversarial verdict: the chief-architect's pure-files hybrid was overturned 2/3 on the durability headline because git-on-a-cloud-FUSE-mount can itself corrupt - the `.git`-on-local-disk invariant above closes that hole. Full verdict in §3.)_

-

### I-8 - Mirror live, author durably; staleness is structural, not policy `[AM]` I-8/DM-5/DM-6 + `[Jack]` + `[synth]`

**Law.** SoR-derived facts are thin regenerable **MIRROR** caches - every value carries `source` + `fetched_at` + class **shelf-life**; freely deletable; **query-live-first**; **never served stale-as-fresh**. Synthesized judgment is the durable **AUTHORED** tier. Evidence **past shelf-life is EXCLUDED** from evidence-attachment (ALG-4) and the clearance gate, and queued to the hygiene sweep (ALG-7). The human-legible per-account `data_freshness` block is **COMPUTED** from the underlying `fetched_at` stamps (cannot drift), **not** hand-maintained. Deep Presto analyses are the one MIRROR artifact with `retain:true` (high regeneration cost) and are therefore the **only** mirror artifact backed up.

**Why.** Co-mingling live spend with durable strategy makes staleness a _policy_ question ("did anyone run `/refresh`?") instead of a _structural_ one (cache expires automatically). **Jack's `data_freshness` block is hand-maintained and can drift; computing it from `fetched_at` removes that drift** while keeping Jack's at-a-glance legibility. A 45-day-old headroom curve cited live in a QBR is exactly the staleness lie the shelf-life machinery exists to prevent. The `retain:true` analyses artifact is Jack's durable-diagnostic capability `[synth]`-reclassed as mirror-but-backed-up. \_(Two-granularity freshness - claim-level enforcement vs pull-level scheduling, and the `SHELF\__` constants - is detailed in §5 and §8.)\*

-

### I-9 - Draft-only at launch (autonomy rung 0); graduate only on numeric criteria, never self-granted `[AM]` SPEC OUT-5/OUT-6 + `[synth]` WRITE ladder

**Law.** There are **TWO** ladders, both in `_system/` so the operator sees the full "what can the agent do without me" surface in one place.

**SEND ladder** (drafts → client; launch = rung 0 everything):

| Rung               | Scope                                                        | Graduation gate                                          |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| 0 draft-only       | everything                                                   | launch default                                           |
| 1 one-tap          | follow-up nudges / meeting-confirmations / report-deliveries | **N consecutive clean sends** in category                |
| 2 batch            | cadence follow-ups / routine cited answers                   | sustained rung 1 + **zero clearance failures in QA**     |
| 3 auto-send+notify | confirmations + scheduled report sends **ONLY**              | explicit policy sign-off + instant recall + weekly audit |

**Pitches / objection-handling / numeric / emotional are capped at rung 1 PERMANENTLY.**

**WRITE ladder** (agent → store mutation):

| Ownership class                 | Effective rung                                  |
| ------------------------------- | ----------------------------------------------- |
| generated                       | rung 3 - overwrite freely, from day one         |
| append-only                     | rung 2 - append autonomously, never edit/delete |
| AM-confirmed                    | rung 1 - suggest, human confirms                |
| human-owned + human-only fields | rung 0 - forever                                |

**Why.** No native approval UI; external sends are highest-risk. **AM Brain conflated "autonomy" with "send autonomy"** and under-specified write autonomy - but **Jack's ownership matrix _is_ a write-autonomy specification** (generated = auto, human-owned = propose-only). Making both ladders explicit closes that gap. The SEND gate is scoped to **N-consecutive-clean** (not a fixed weekly sample) so it is **satisfiable at solo send volume** - the `[ext]` verdict correction, since a 20-message-per-week QA sample is unsatisfiable early for a single operator.

-

### I-10 - Poll on schedule; there is no event path `[AM]` + `[Jack]` cadence-as-cost-control

**Law.** Tiered polling:

```
Tier1 schedule (free)
  └─ Tier2 cache-diff filter (cheap, NO LLM, ZERO network):
        local stage-clock advances days_in_stage from cached stage_entered_at
        → gates ~90% of cheap exits
       └─ Tier3 agent wake (LLM, only when work found)
```

An **independent, unconditional 12 h timer** runs the **96 h transcript-capture sweep**, bypassing the cost filter. **Heavy analytics** (180 d diagnostic, headroom, cpa-v-spend) have **no cheap precondition** and run on explicit monthly / pre-QBR cadence - **NOT** through Tier2.

**Why.** No event bus exists. The Tier2 local stage-clock is the cheapest-correct way to detect 14 d/28 d attribution-window and overdue-commitment crossings (it reads the cached `stage_entered_at`, never `modified_time`, which moves on any edit and hides overdue RS). Forcing heavy analytics through a Tier2 gate is a **false economy** - the precondition check would itself need a Presto pull - so **Jack's cadence-as-cost-control** is the honest model for jobs with no cheap precondition. The 96 h window is a **hard data-expiry deadline** (VC summaries expire), so transcript capture cannot be cost-optimized away; 12 h-in-96 h = 8× capture redundancy against the silent-stop bug. _(Scheduler topology, `/cron` discipline, and the loud-failure heartbeat are in §10.)_

-

### I-11 - Single-threaded writer **by construction**; intelligence sub-agents are read-only `[AM]` ORCH-1/2 + `[Jack]` + `[ext]` Cognition P12

**Conflict - hard mutex vs by-construction.** AM Brain says "one writer, no locks." Jack mandates an atomic file-lock before _every_ write. A literal API lock over an eventually-consistent store is only **probabilistic**, so neither bare position is right.

**Ruling `[synth]` + `[ext]` correction.** Exactly one logical writer mutates files, enforced **single-writer-BY-CONSTRUCTION**: the cron is the **sole scheduled writer**; human edits arrive via a **different surface the cron never read-modify-writes**. _On top of that_, an **advisory atomic-mkdir / sentinel lock** is a crash/reentrancy + fail-loud guard - **NOT a hard mutex**. The real guarantee is by-construction; the lock is **defense-in-depth**.

```bash
# advisory mkdir lock — crash/reentrancy guard, trap-released, stale-aged
acquire(){ d="$BRAIN/.locks/$1.lockdir"
  for i in 1 2 3; do mkdir "$d" 2>/dev/null && return 0
    age=$(( $(date +%s) - $(stat -f %m "$d") )); [ $age -gt 600 ] && { rmdir "$d"; continue; }
    sleep 30; done; return 1; }
release(){ rmdir "$BRAIN/.locks/$1.lockdir" 2>/dev/null; }   # ALWAYS, even on failure (trap)
```

Sub-agents (evidence-finder, benchmark-fetcher, meeting-prep researcher) and read-only mobile lookup return **distilled conclusions + source refs**; they **MUST NOT draft outbound or write files**. Jack's task-queue is imported **inverted** - a read-only agent _requests_ a write from the single writer, never acts as a second writer.

A **true second WRITER** is admitted only behind an explicit gate: **8 consecutive green weeks** + **DSS-matrix implemented** + a **DISJOINT writable partition** where no two writers share a writable path (verified per the actual skill→agent map - the gate must check that no single generated file has two agent-writers under the then-current config).

**Why.** Parallel writers make conflicting decisions because actions carry **implicit decisions sub-agents can't see** - Cognition "Don't Build Multi-Agents" P12 (3-0 adversarially verified), independently corroborated by Anthropic's production lead-writer / read-only-subagent pattern. **Jack's 5-agent concurrent-write fleet works ONLY by papering over races with the bidirectional merge I-7 rejects** (two race axes: locks guard the same-store FUSE race, the merge reconciles the cross-store race - and the cross-store merge is the one I-7 deletes by collapsing to one store). The **disjoint-partition graduation gate makes the merge unnecessary** (writers never share a writable file, so there is no conflict to merge). On an eventually-consistent store an API lock is only probabilistic - hence by-construction is the guarantee and the lock is the belt to its suspenders. _(Multi-agent governance, the DSS×Destination matrix, and the inverted task-queue lane are in §9.)_

-

### I-12 - Additive history with archive-not-hoard; the agent never deletes `[Jack]` floor + `[AM]` recovery-enabled hygiene + `[synth]` roll-up bounds

**Law.** Four sub-rules:

1. **Immutable interactions.** `interactions/raw` is **write-once / create-only** (in-place edit blocked + logged). Corrections go in a **NEW tombstone-referenced entry**: `not_true:<claim>; do_not_rederive:true`. Never edit in place.
2. **Agent never deletes.** The agent **MAY NOT delete** any file in any class - deletion is **operator-only**. The monthly stale-context review is a cockpit **DELETE-CANDIDATE** hygiene queue the human approves, not an autonomous delete.
3. **Archive is MOVE-not-delete.** Archival (`raw` → monthly digest → `archive/`) is allowed **autonomously ONLY when git + the off-host backup are confirmed for the period**; otherwise it downgrades to a candidate.
4. **Roll-up / cap bounds** apply to **every growth-bearing file** so no single file breaches the store's per-file ceiling: **`narrative.md` → half-year shards** (`narrative-<YYYY-Hx>.md`); **`rs-ledger.md` → open-vs-archive split** (`rs/` open + `rs-archive/<year>` closed); **`interactions/raw` flattened to ≤3 directory levels**.

**Why.** **Jack's immutability-for-interactions is correct** (a CI record edited after the fact silently rewrites history the pacing engine counts) - promoted from AM Brain's implicit "append-only class" to an enforced invariant. **Jack's never-delete-ANYTHING is a workaround for additive-only sync that AM Brain doesn't need** (git + off-host backup let it archive safely) - so the synthesis takes Jack's safety floor (no autonomous delete - the highest-blast-radius op, with no upside) while keeping AM Brain's git-backed archive lifecycle (DM-11 bloat caps). The tombstone (DM-10) closes the gap where a retracted fact is **resurrected by re-ingesting an old transcript**. The roll-up bounds (`[synth]` / `[ext]`-verdict fix) prevent the **monolith hazard the decomposition exists to kill** - the adversarial review caught that an uncapped `narrative.md` (dual-loaded every query, bound by the per-file ceiling) and a single repetitive `rs-ledger.md` re-import the very single-rich-file failure the layout fixes. _(Archive lifecycle and the interactions layout are detailed in §5.)_

-

### I-13 - Registry is sacred and stable; validate-before-write `[Jack]` is-sacred + `[AM]` lean keys + `[synth]` merged superset

**Law.** `_system/registry.yaml` is the **single corruption single-point** - a bad write breaks every account lookup. It is **schema-validated on every load AND before every write**, **write-locked**, and **git-committed**. It holds **STABLE join-keys + resolution data only**:

```yaml
accounts:
  - slug: <kebab> # stable, URL-safe, used in all paths
    display_name: <str> # [Jack]
    crm_name: <str> # [Jack] full legal name — resolution fallback
    search_aliases: [<str>] # [both] union of alias sets
    status: active|paused|churned # [Jack] CRM lifecycle
    in_portfolio: true|false # [AM]  does THIS AM book it (43-vs-33); ORTHOGONAL to status
    tier: grow|defend|maintain # [Jack]
    org_id: <str> # [both]
    account_team_id: <str> # [AM]
    ad_account_ids: [<str>] # [both] ALWAYS bind IN(all ids) — a single id undercounts ≤70%
    sfid: <str> # [AM]
    narrative_path: clients/<slug>/narrative.md # [AM]
    narrative_source_url: <gdoc-url>? # [synth] ex-Jack meeting_notes_url; provenance only
    dossier_path: clients/<slug>/ # [Jack]
# EXCLUDED (volatile, generated → live in context.md header + scorecard):
#   rs_count, rs_pitched, rs_adopted, scorecard_status, data_freshness, updated_at, confidence
```

**Resolution order:** `slug → display_name → crm_name → search_aliases`. **Spend/perf pulls ALWAYS bind `IN(all ad_account_ids)`** - a single id undercounts up to **70%**.

**Why.** A master registry mutated on every count change is a **write-amplification + single-point-corruption hazard Jack himself flags** - so volatile counts are excluded and live in the generated `context.md` header (the regenerable surface designed to churn). `status` (CRM lifecycle) and `in_portfolio` (does THIS AM book it - the 43-vs-33 reality) are **orthogonal and both load-bearing**, so both are kept. **Jack's resolution order (adding the `crm_name` fallback leg) is strictly better than AM Brain's name/alias-only.** **YAML (not JSON)** because the operator hand-edits human-owned fields (`tier`, `in_portfolio`, aliases) and YAML permits comments - behind the validate-on-load guard, since it is the corruption single-point. `ad_account_ids[]` is (re)populated at `/setup` via the ACDP discovery table (§8), which is the maintenance mechanism AM Brain's IN(all-ids) rule needed.

## 3. The storage / sync / concurrency / durability ruling (FEATURED)

This is the contested decision. The operator told us not to rubber-stamp AM Brain's newest single-store flip - and we don't. We overturn it, and we also reject the chief-architect harvest's files-canonical headline that the adversarial verdicts knocked down 2/3. What survives all three angles of grounding and three rounds of adversarial review is a third thing neither parent shipped: **one canonical store, split by durability class.** This section states that ruling, runs the explicit three-way head-to-head, walks the evidence chain that forced each overturn, dissolves the host trilemma that drove REV3 to the wrong place, and lists what we rejected and how sure we are.

### 3.1 The settled decision (one paragraph, then the spec)

> **ONE canonical live store, TIER-SPLIT by durability class, with single-writer-by-construction + an advisory atomic lock + a one-way versioned off-host backup + a recovery-only (never scheduled) additive merge.** The **AUTHORED** tier - un-regenerable truth (`profile.md`, `relationship.md`, `style.md`, `narrative.md`, `commitments.md`, and `_system/`) - is files + **local-disk git** on the canonical host, with GDrive native revision-history as a free second recovery layer (a _bonus until verified_, never a relied-upon layer) and a nightly off-host `git bundle` + `git fsck` tripwire as primary DR. The **MIRROR** tier - regenerable caches (`performance.md`, `rs-ledger.md`, `interactions/`, `contacts.md`, `analyses/`), every value `fetched_at`-stamped - may live on whatever store the unattended host natively reaches (an MM2 read-projection is permitted) because losing it costs nothing: it is re-derived next run, guarded by a `0-files-written-when-due` **HARD FAIL**. There is **no second live read/write store**; the optional API/memory projection is one-way, read-only, regenerable, **never written back**. If an out-of-band edit ever lands in the projection it goes to a **quarantine ledger** drained only by the manual `/brain:recover-merge` tool.

Provenance of the decision itself: it **keeps [AM]'s** single-canonical-store _principle_ (I-7) and structural mirror/authored freshness (I-8); it **keeps [Jack]'s** production durability evidence that files+git+revision-history is the proven-recoverable layer, plus his locking, task-queue seam, file-health limits, and validate-before-write registry; and it **adds [synth]** the tier-split that dissolves the host trilemma and the recovery-only demotion of his merge. The decision is grounded by **[ext]** three independent research angles (concurrency, pkm-compounding, ai-memory) that converge unanimously on _single store + append-only + no bidirectional merge_.

### 3.2 The two governing invariants (stated; defined in §2)

This ruling is the implementation of two invariants from §2. They are the law; everything below is mechanism.

- **I-7 - One canonical live store; no bidirectional merge, EVER.** Exactly one canonical store, split by durability class; additive LLM merge is DEMOTED from a scheduled loop to a manual recovery-only tool.
- **I-8 - Mirror live, author durably; staleness is structural, not policy.** SoR-derived facts are thin regenerable MIRROR caches with `source + fetched_at + shelf-life`; synthesized judgment is the durable AUTHORED tier.

The two definitional contracts that make the tier-split mechanical:

```
AUTHORED  ≝  un-regenerable  ∧  files+git+revisions       ⇒  needs PROVEN recovery (two independent layers)
MIRROR    ≝  host-reachable  ∧  fetched_at-stamped         ⇒  needs NO recovery (re-derived from SoR next run)
```

A file's tier is decided by exactly one question: **if this file vanished, is it re-derivable from a system of record next run?** Yes → MIRROR (durability cost = zero). No → AUTHORED (durability cost = catastrophic; it gets the proven stack).

### 3.3 The git-on-local-disk invariant (the verdict's hard correction)

The single most load-bearing correction the adversarial review forced:

> **L1-DUR - The `.git` object store MUST reside on local disk, never on the cloud FUSE mount.** The mount carries only the working tree (the `.md` files). If the canonical host is ever a FUSE mount, git stays on local disk and markdown is one-way synced TO the mount - never git-on-mount.

```
        LOCAL DISK                          CLOUD FUSE MOUNT (mclone/rclone → GDrive)
   ┌──────────────────┐                    ┌──────────────────────────────────┐
   │  .git/  (objects, │  ── one-way ───▶  │  working tree: *.md only          │
   │  refs, packfiles) │   markdown sync   │  (NO .git/, NO desktop.ini/.DS_*) │
   └──────────────────┘                    └──────────────────────────────────┘
            │                                          │
            │ nightly                                  │ free, unverified
            ▼                                          ▼
   git bundle → 2nd off-host             GDrive native revision history
   location + `git fsck` tripwire        (BONUS recovery layer, until verified)
```

Why this is non-negotiable **[ext]**: git-on-a-cloud-FUSE-mount is itself a documented corruption class. rclone's own guidance states _"cloud storage is far less reliable than file systems expect"_ and that an rclone mount _"can't use retries"_ the way `sync` can, and that _"connecting applications directly to rclone mounts can make those applications highly unstable."_ There is a named _"Google Drive Sync corrupting git repositories"_ failure mode (the `desktop.ini` injection class). And the operator's **own untested VERIFY-1** flags _"git-inside-the-mclone-mount NOT YET TESTED."_ So `.git` on the mount could corrupt the canonical history; pinning `.git` to local disk closes the hole and makes the "two independent recovery layers" claim true by construction rather than by assumption.

Two guards ride with L1-DUR:

1. **GDrive-revisions are a BONUS, not a layer you rely on.** The operator (rightly) distrusts MM2's retention; the verdict demands the _same_ skepticism applied to GDrive: it is unconfirmed whether GDrive native file-version history retains usable point-in-time revisions for _mounted_ `.md` edited via FUSE (vs. Docs/web edits). Until confirmed, the **nightly off-host `git bundle` is the PRIMARY second recovery layer**; GDrive-revisions are upside.
2. **Corruption tripwire.** The nightly bundle job runs `git fsck` and exits loud on any object-db error (consistent with the L6 loud-failure discipline); the synced tree excludes `.git/`, `desktop.ini`, `.DS_Store`, and junk.

### 3.4 The host-trilemma dissolution (why a tier-split exists at all)

REV3 picked MM2-canonical because its L6 host spike found a hard constraint:

> **`{ file+git canonical, hosted, unattended }` - pick two.** No self-serve persistent devserver was provisionable from the Mac, and Metamate Automations cannot natively touch raw `.md`+git in GDrive (connector-not-FUSE, no git-over-vault, `python -m` not native).

REV3's error was treating the trilemma as binding the **whole store**, and resolving it by demoting the proven-durable layer (files+git+revisions) to a nightly backup so the _entire_ state could ride the hosted scheduler's reachable store. The tier-split **[synth]** observes the trilemma only binds the **un-regenerable AUTHORED tier**:

```
                    needs file+git (un-regenerable)?
                              │
                ┌─────────────┴─────────────┐
              YES                            NO
        AUTHORED tier                   MIRROR tier
   ── bound by the trilemma ──     ── NOT bound by it ──
   gets file+git+revisions;        regenerable, so it can ride
   the trilemma forces this        ANY host-reachable store
   tier onto a file+git host       (MM2 read-projection OK);
   (laptop now, devserver later)   losing it costs nothing
```

So the AUTHORED tier takes the file+git host (laptop on-demand now; persistent devserver later, gated on VERIFY-1) and keeps its proven recovery. The MIRROR tier rides the hosted scheduler's reachable store - satisfying the hosted+unattended leg for the cockpit-critical caches - guarded by a `0-files-written-when-due` HARD FAIL so a silent stop is loud, not lossy. **The trilemma dissolves: each tier pays only the cost it can afford.** (Runtime/host phasing and the Automation-as-nudge bridge are detailed in §10; this section establishes only the storage consequence.)

### 3.5 The head-to-head: three contenders, what each loses

The operator put three options on the table and asked for an honest weighing. Here it is.

| Dimension                          | **(A) REV3 bare single-store on MM2**                                                                          | **(B) Full-Jack bidirectional sync**             | **(C) Pure files-canonical hybrid** (chief-architect harvest) | **★ Tier-split (settled)**                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Canonical of AUTHORED truth        | MM2 project memory                                                                                             | GDrive primary (+MM2 secondary)                  | files+git on ONE FUSE host                                    | files + **local-disk** git                                          |
| Durability of un-regenerable truth | **late-beta store**: unverified ~100KB/file cap + silent truncation, opaque retention, ~23-mission silent-stop | GDrive revisions, but **merge can drop edits**   | git - but **git-on-mount can corrupt** (L1-DUR hole)          | local-disk git + nightly bundle + `fsck`; GDrive revisions as bonus |
| Recovery layers                    | 1 (opaque MM2 retention until next nightly)                                                                    | 1 (GDrive revisions) + lossy merge               | 2 claimed, but conditional on mount safety                    | **2 independent**, true-by-construction                             |
| Live history granularity           | backup-window gap (nightly)                                                                                    | continuous (GDrive)                              | continuous (per-run commit)                                   | **continuous per-run commit**                                       |
| Concurrency model                  | single-writer + advisory `owner:` frontmatter                                                                  | 5-agent fleet + dual locks + 30-min merge        | single-writer + mkdir lock                                    | **single-writer-by-construction** + advisory lock                   |
| Silent-loss surface                | same-file LWW accepted                                                                                         | **last-write-wins races** (Jack's own admission) | none (single writer)                                          | none (by construction)                                              |
| Fabrication surface                | none                                                                                                           | **always-on LLM prose-merge**                    | none                                                          | none (merge demoted to manual recovery)                             |
| Unattended laptop-closed cockpit   | ✅ (its only unique buy)                                                                                       | ✅                                               | ❌ (devserver unprovisionable; nudge ⇒ operator-ATTENDED)     | ✅ for MIRROR/cockpit (rides host); AUTHORED file+git               |
| Ships day one                      | needs MM2 cutover                                                                                              | already prod (for Jack)                          | laptop files exist today                                      | **laptop files exist today**                                        |

**What (A) REV3 loses - durability of the canonical copy.** It bets un-regenerable authored truth on a late-beta store with an unverified ~100KB/file cap plus truncation (one oversized `narrative.md` = silent loss), opaque version-recovery/retention, and a known ~23-mission silent-stop bug. It demotes the only proven-recoverable layer (files+git+GDrive-revisions) to a nightly backup - regressing from continuous per-edit history to a backup-window gap. And it **contradicts its own ship-now recommendation**: REV3 §11 says "_Now → option 3_" (laptop files+git on-demand), which **is** a file-canonical store - so REV3 ships file-canonical while declaring MM2-canonical. The tier-split keeps everything MM2-canonical uniquely buys (the regenerable tier rides MM2 for hosted reach) without this loss.

**What (B) full-Jack loses - simplicity AND safety, for zero solo payoff.** The 30-minute always-on prose-merge buys nothing without a _second concurrent live daily-driver_; a solo AM has one writer. It carries the documented **"Metamate's changes are LOST"** cost (Jack's own manual, verbatim) plus LLM-fabrication risk: the merge LLM preferentially selects generated over retrieved content, embedding that bias _permanently_ in the narrative. The 5-agent fleet + N×N task-queue + dual-lock machinery is over-built for one operator. And the solo failure mode is _worse_ than Jack's: async/batch usage (the likely solo pattern) makes silent merge losses **more** likely to hide than in Jack's daily-active usage, where he catches deltas fast.

**What (C) pure files-canonical loses - it was OVERTURNED 2/3.** The chief-architect harvest's headline ("strictly more durable than REV3: two recovery layers vs one opaque store") is **not defensible as written**, for two reasons the verdict surfaced: (1) git-on-a-cloud-FUSE-mount can itself corrupt (the L1-DUR class above), so "two independent recovery layers" is conditional on the mount being safe, not strict; and (2) it does **not** unblock the unattended host - the persistent devserver it needs is unprovisionable per the L6 spike, and the Automations-as-nudge fallback only pings the operator to open the laptop, so its ceiling is operator-**ATTENDED**, surrendering the laptop-closed daily cockpit MM2-canonical uniquely buys. The tier-split fixes **both** holes: the git-on-local-disk invariant closes the corruption hole, and pushing only the regenerable MIRROR tier to the host-reachable store restores laptop-closed operation for the cockpit.

### 3.6 The evidence chain (why the overturns are forced, not preferred)

Three independent grounding angles + Jack's own loss admission + the adversarial verdicts converge. This is evidence, not architecture taste.

**Jack's own loss admission [Jack].** The production manual documents the cost in plain text: _"GDrive wins on conflict → Metamate's changes are LOST unless LLM merge recovers them"_ (§10/§16). The bidirectional merge is the _recovery hatch, not the default win path_ - Jack himself frames it as last-resort. His system tolerates this because he is daily-active (catches losses fast) and because the merge exists to serve **concurrent multi-daily-driver writes** (Metamate + Claude Code + Codex) - a precondition the solo AM lacks. So the merge's reason-to-exist is absent for one writer.

**GROUND angle 1 - concurrency [ext].** Bidirectional sync silently loses data via last-write-wins races (Stacksync: _"LWW is notoriously prone to data loss"_; _"the last writer wins, silently destroying the other's work"_). Single-writer / single-source-of-truth achieves strong consistency without merge complexity (Orleans/Medium single-writer-multiple-reader). Industry backup-vs-sync consensus: one-way backup preserves deletion-recovery; bidirectional sync propagates deletions and corruptions catastrophically. **Verdict:** prevention-by-serialization beats detection-after-merge.

**GROUND angle 2 - pkm-compounding [ext].** Compounding knowledge needs one-directional flow + supersession, not bidirectional merge: Karpathy's compiled-wiki (newer source supersedes older, append-not-overwrite), Zettelkasten/evergreen forward-link provenance. LLM prose-merge is a _hallucination sink_: "Blinded by Generated Contexts" (arXiv 2401.11911) shows LLMs prefer generated over retrieved content even when retrieval is correct; SSGM (arXiv 2603.11768) shows evolving memory accumulates semantic drift unless governed. **Verdict:** one-way backup is structurally safer than bidirectional sync; the narrative must not be a merge target.

**GROUND angle 3 - ai-memory [ext].** Single-canonical-store + append-only + write-gates-before-storage is the 2026 production consensus: Salesforce write/read gates + confidence scoring, Mem0 2026, Anthropic client-side-canonical (memory tool operates on _your_ filesystem, never synced back to a hosted service), Oracle staleness analysis. Append-only **without** supersession creates "benign data corruption" - agents reuse stale facts with _false confidence_ (Oracle: the stale answer gains "the appearance of established precedent"). **Verdict:** the hard problem is _what to remember + preventing retrieval from quietly lying_, not the backend; and supersession (I-12 tombstone, §2) is mandatory, not optional.

**The adversarial verdict overturns.** Three rounds of skeptical review landed two decisive corrections that this section already absorbs:

1. The chief-architect's files-canonical hybrid was **overturned 2/3 on the durability headline** - git-on-mount corruption + unattended-host failure (above). One skeptic showed the **tier-split is strictly stronger than both pure REV3 and pure files-canonical**: it keeps REV3's hosted-cockpit buy (MIRROR rides the host) AND files+git durability (AUTHORED), so it dominates each on the axis the other loses.
2. The durability claim must be **conditional, not absolute**: files-canonical is more durable than REV3 _only when_ `.git` lives on local disk (L1-DUR) _and_ the second recovery layer is the off-host bundle (not unverified GDrive revisions). Both conditions are now hard invariants above, so the claim is defensible.

The net of the chain: **single store + append-only + no bidirectional merge** is unanimous across all three angles; the _only_ thing the verdicts changed is _which_ store holds the un-regenerable tier (files+local-git, not MM2) and how the durability claim is phrased (conditional on L1-DUR).

### 3.7 Concurrency: single-writer-by-construction; the lock is defense-in-depth

The real guarantee is **single-writer-by-construction**, not a mutex:

> The cron is the **sole scheduled writer**. Human edits arrive via a **different surface** (Collab Files / a separate interactive session) that the cron **never read-modify-writes**. Per-file `owner:` frontmatter + the rule "cron never RMW a human-owned file" is the primary same-store safety.

On an eventually-consistent store, an API "lock" is **only probabilistic** - a sentinel written via the memory API has a ~minutes acquire/read race where two writers can both observe "unlocked." So the lock is explicitly **NOT** sold as a hard mutex. It is a crash/reentrancy + fail-loud guard, layered defense-in-depth:

```
Precedence (which mechanism defends what):
 (a) owner: frontmatter        ── static single-writer-per-file policy        [AM, primary]
 (b) disjoint writable partition ── no two writers share a writable path        [synth, the conflict-ELIMINATOR; gated future]
 (c) advisory atomic lock       ── crash/reentrancy + fail-loud for cron-vs-interactive overlap  [Jack §15]
 (d) "cron never RMW a human file" ── scheduling backstop where (c)'s propagation race could leak  [REV3 guardrail]
```

The advisory lock primitive itself, harvested from **[Jack §15]** (atomic on POSIX, ~5 lines, production-proven across 34 accounts):

```bash
acquire(){ d="$BRAIN/.locks/$1.lockdir"
  for i in 1 2 3; do
    mkdir "$d" 2>/dev/null && return 0            # atomic create = ownership
    age=$(( $(date +%s) - $(stat -f %m "$d") ))
    [ $age -gt 600 ] && { rmdir "$d"; continue; } # >10min = crashed prior run → reclaim
    sleep 30
  done; return 1; }
release(){ rmdir "$BRAIN/.locks/$1.lockdir" 2>/dev/null; }   # ALWAYS, even on failure (trap)
```

Substrate caveat: the literal `mkdir`-lockdir applies on the **filesystem side** (the local-disk/FUSE working tree and any future FS agent). On the MM2 read-projection there is no native mkdir; the equivalent is a lock-sentinel `{locked_by, locked_at}` body with the same stale-timeout - _understood as advisory_, because the MIRROR tier it guards is regenerable and a torn write costs nothing (re-derived next run). `.locks/` and `.git/` are excluded from any MM2 projection.

**Lock granularity:** per-FILE for AUTHORED + the registry; per-RUN for the regenerable `generated/` bundle (MIRROR caches take last-write-wins freely - they are re-derived).

What we **keep** from Jack's concurrency layer (production-hardened, single-writer-safe): the mkdir lock, the task-queue **seam** (inverted to a _write-request_ lane: a read-only agent requests a write from the single writer, never acts as a second writer), the file-health limits (`<100KB/file`, `<3-level nesting`, kebab-case, no spaces/unicode), and the validate-before-write registry. What we **drop**: his bidirectional-merge and multi-live-writer fleet - they exist _solely_ to serve concurrent multi-daily-driver writes a solo AM does not have. (A true second writer is admitted only behind the explicit graduation gate - 8 green weeks + DSS-matrix + **disjoint writable partition** so writers never share a file and there is no conflict to merge; detailed in §9.)

### 3.8 The recovery-only merge (Jack's value, without his loss surface)

The two parents are **reconcilable, not mutually exclusive**, on the merge. Jack's additive merge has documented _recovery_ value (it converts a lost edit from permanent to recoverable); AM Brain rejects it as an _always-on_ loss/fabrication surface. The resolution: **keep the capability, demote it from a scheduled loop to a manual recovery-only tool.**

```
/brain:recover-merge   (MANUAL only — never scheduled)
  invoked when:  a divergence is detected
                 (backup-vs-canonical mismatch, OR a quarantined out-of-band MM2-projection edit)
  semantics:     • additive (keep all info from both sides, dedup)
                 • ONE file at a time
                 • deterministic contradiction-resolution: CANONICAL file WINS
                 • prints a diff for operator confirmation BEFORE commit
  result:        a "permanently lost" edit becomes "recoverable"
                 WITHOUT the steady-state always-on loss/fabrication surface
```

This is the precise best-of-both: Jack's documented recovery value is preserved; the always-on prose-merge that the three GROUND angles and the 164-silent-run disaster (personal + bidirectional + **silent**) condemn is removed. The optional API/memory projection is one-way and read-only; if an out-of-band edit ever lands in it, it does **not** auto-sync - it enters the quarantine ledger that only `/brain:recover-merge` drains.

### 3.9 Rejected alternatives + confidence

**Rejected - (A) REV3 bare single-store-on-MM2** (canonical = MM2; files+git demoted to nightly backup). _Loses_ durability of the canonical copy: bets un-regenerable truth on a late-beta store (unverified ~100KB cap + truncation, opaque retention, ~23-mission silent-stop), demotes the only proven-recoverable layer to a nightly backup (continuous→backup-window regression), and contradicts its own §11 ship-now (option-3 laptop file+git). The tier-split keeps MM2's unique buy (regenerable tier rides MM2 for hosted reach) without the loss.

**Rejected - (B) full-Jack bidirectional sync** (GDrive primary + MM2 secondary, 30-min cycle, LLM additive merge, GDrive-wins-on-conflict). _Loses_ simplicity and safety for zero solo payoff: the always-on merge serves a second concurrent writer the solo AM lacks; carries the "Metamate's changes are LOST" cost + permanent LLM-fabrication bias; the 5-agent fleet + N×N queue is over-built; async/batch solo usage hides losses _more_ than Jack's daily-active usage.

**Rejected - (C) pure files-canonical hybrid** (ALL tiers on files+git on a single FUSE host; headline "strictly more durable than REV3"). _Overturned 2/3_: the unconditional headline is indefensible (git-on-cloud-FUSE corruption class + the operator's own untested git-in-mount VERIFY-1), and it does not unblock the unattended host (devserver unprovisionable; nudge ⇒ operator-attended, surrendering the laptop-closed cockpit). The tier-split fixes both via the git-on-local-disk invariant and by pushing only the regenerable MIRROR tier to the host-reachable store.

**Rejected - git as sole concurrency control** (no lock; accept same-file silent last-write-wins). git makes loss _recoverable_ but not _prevented_ - "finding-after" is exactly the silent loss the anti-silent-loss invariant (I-3) hates. The ~5-line mkdir lock _prevents_ the cron-vs-interactive collision outright at near-zero cost; the cost asymmetry (an occasionally-unnecessary lock vs. a silently-lost operator edit) is decisive.

**Confidence: HIGH.** Three independent research angles converge unanimously on the _principle_ (single store + append-only + no bidirectional merge); the decisive _loss behavior_ is corroborated by Jack's own manual, not asserted; and the only adversarial weakness that landed was a _wording/invariant_ correction (durability is conditional on git-on-local-disk + off-host bundle), now absorbed as hard invariants L1-DUR and the GDrive-bonus guard. The decision is genuinely stronger than either parent and than the harvest's files-canonical headline - not a compromise, but the model the evidence forces.

**Re-open trigger (deliberate future fork, not a workaround):** promote the AUTHORED tier onto MM2 **only when** all of these close - MM2 per-file cap _verified_, retention _documented_, the silent-stop bug _fixed_, AND a redundancy story exists. This is AM Brain's own flip-trigger, now pointed at the _right_ direction.

> Cross-refs: the file/tier layout and registry schema are detailed in §5; the gated multi-agent graduation (disjoint-partition + DSS-matrix + 8-green-weeks) in §9; the host phasing, Automation-as-nudge bridge, and loud-failure/heartbeat guardrails in §10; the concurrency conformance test (cron-vs-interactive no-silent-loss; lock stale-timeout) in §13.

## 4. Layer model + system diagram

The system is **eight layers, each a clean seam**. Every layer consumes only the contract of the layer below and exposes a typed contract upward, so a failure or a swap in one layer (e.g. moving the runtime host from laptop to devserver) never reaches into another (the store schema). The numbering keeps AM Brain's `L0–L6` spine `[AM]`, folds Jack's deep-analytics into `L4` `[Jack→synth]`, and adds an explicit conformance layer `Ln` `[synth]` so "is it correct?" is a layer, not an afterthought.

### 4.1 The layer stack

| Layer                              | Role (one line)                                                                                                                                                                                                                                                                                                                                                                                                                 | Built from                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0 Capability gate**             | Re-run NATIVE/BUILDABLE/IMPOSSIBLE before building any capability; consult the machine-checkable danger-zone forbidden-ops list before any new write surface; every missing platform capability gets a listed fallback, never a silent omission.                                                                                                                                                                                | `[AM]` CAP-1..2 + `[Jack]` §17 danger-zone promoted to a forbidden-ops list                                                                                     |
| **L1 Storage**                     | ONE canonical store, **tier-split by durability** (§3). AUTHORED = files + **local-disk** git + GDrive revisions + nightly off-host bundle + `git fsck` tripwire; MIRROR = host-reachable regenerable caches (MM2 projection allowed), `0-files-written = HARD FAIL`. Single-writer-by-construction + advisory atomic-mkdir lock. No second live store; no bidirectional merge.                                                 | `[AM]` I-7/I-8 two-tier + `[Jack]` GDrive-revisions-durable + mkdir-lock + file-health limits + `[synth]` tier-split + `[ext]` single-store consensus           |
| **L2 Data plane**                  | `pipeline.py` runs READ-ONLY pulls in **two kernel-separated legs** (default-kernel: spend-live/rs/ci/transcript/calendar/email via `jf graphql` tunnel + `meta` CLIs; analytics-kernel: EOS/spend-fallback/P5/180d via Presto). Self-describing envelope; numeric-ID match first; `IN(all ad_account_ids)`; 3-rung spend cascade with a zero/NaN guard; a failed pull renders **unknown, never 0**.                            | `[AM]` fat-Python pipeline + ID-match + IN(all-ids) + dead-ends + `[Jack]` named Presto tables + kernel non-mixing + ACDP + `[synth]` two-transport legs        |
| **L3 Knowledge / Memory**          | Decomposed **two-tier per-account dossier** (MIRROR vs AUTHORED, opposite durability policies) + one **generated read-only `context.md` rollup** (Jack's single-glance value, zero write-contention) + in-vault `narrative.md` dual-load + merged sacred `registry.yaml` + `config.md` constants. Retrieval = slug-read + grep + recall hook (vector opt-in past ~5K chunks).                                                   | `[AM]` two-tier decomposed dossier + dual-load + `[Jack]` ownership matrix + analyses/ + rich registry + `[synth]` generated rollup + merged registry           |
| **L4 Decision engine + analytics** | Deterministic **banded engine** ALG-1..8 (pure functions, named constants, SPEC-fixture-tested) **+ Jack's analyses suite refactored into tested Python** ALG-9..13 emitting a typed `AnalysisResult` with born-clearance-classed fields; each result emits `DM-EVID` into ALG-4 via a `safeParse`-pinned producer→consumer seam. Calibration honesty wraps everything (CONF-1 / `[UNCALIBRATED CURVE]` / `insufficient_data`). | `[AM]` ALG-1..8 + calibration + `[Jack]` 5-analysis suite (capability) + `[synth]` analyses-as-tested-Python + analysis→ranking seam                            |
| **L5 Safety / governance**         | **Draft-boundary clearance gate** `gate.py` (single-recipient taint + cross-client hard-fail + no-raw-spend + drafts-only, backed by the GATE-1..5 claim-type×source-class table, default-deny), made **unbypassable**. **Write-guard** enforces the ownership matrix + human-only-fields + immutability on EVERY write. Two autonomy ladders (SEND + WRITE). Context Ledger + append-only DM-AUDIT.                            | `[AM]` gate.py + GATE-1..5 + escalation taxonomy + audit + `[Jack]` ownership matrix + danger-zone (gate unbypassable) + `[synth]` write-guard + two ladders    |
| **L6 Runtime / host**              | **Tiered-poll scheduler, host-portable.** Ship-now: laptop `launchd` against the FUSE GDrive mount + local git, with a Metamate Automation as a hosted **nudge-only** trigger. Maturity: persistent devserver `crontab`/`systemd-timer` once provisioned (git on local disk per VERIFY-1). `/cron` discipline (RLIMIT_AS=8GB, no-double-fire, stagger, batch-and-assemble) + loud-failure heartbeat.                            | `[AM]` tiered poll + 96h sweep + /cron discipline + option-3 laptop + `[Jack]` hosted-scheduler-laptop-closed + Confucius grant + `[synth]` Automation-as-nudge |
| **Ln Conformance / eval**          | SPEC fixtures TEST-1..16 = engine acceptance suite; golden-fixture tests for ALG-9..13; producer→consumer `safeParse` seam tests; **concurrency test (cron-vs-interactive no-silent-loss) BEFORE deploy**; golden question set + weekly grounding QA (>95%, clearance-violation = sev-1); operating metrics. Eval-judge reuses Sales AI grounding.                                                                              | `[AM]` SPEC §14 + eval-judge reuse + `[ext]` cross-slice-seam discipline + concurrency-test-before-deploy                                                       |

### 4.2 System diagram

```
        OPERATOR (Jason) ── reads generated/today.md · reviews drafts/ · sends · confirms suggestions
            ▲ cockpit + drafts (destination = operator)         │ freeform: "what's up with <client>?"
   ┌────────┴────────────────────────────────────────┐          │
   │  GENERATION — portfolio-wide, NO per-client taint │◀─────────┘ dual-load answer (+score_reason +confidence;
   │  reasons across ALL 33 accounts freely            │            low-confidence renders as a QUESTION)
   └────────┬────────────────────────────────────────┘
            │ produces a client-bound outbound artifact?
   ┌────────▼═══════════ L5 DRAFT-BOUNDARY GATE (gate.py · UNBYPASSABLE) ═══════════┐
   │  single-recipient taint · cross-client content → HARD FAIL · GATE-1..5 table   │
   │  no cleared source → [NEEDS CLEARED BENCHMARK] · no raw spend · DRAFTS ONLY     │
   └────────┬───────────────────────────────────────────────────────────────────────┘
            ▼  drafts/ (Gmail Draft; human sends)        ── every send → DM-AUDIT + CI + commitment-close
 ─────────────────────────────────────────────────────────────────────────────────────────────────────
   ┌───────────────────────────────────┐        ┌──────────────────────────────────────────┐
   │  L4 DECISION ENGINE + ANALYTICS    │        │  RETRIEVAL (RET-1..5)                      │
   │  ALG-1 pace ALG-2 cover ALG-3 mix   │◀──────▶│  registry alias→slug → dual-load dossier   │
   │  ALG-4 evidence ALG-5 RS-rank       │  reads │  + grep + recall hook (client-scoped,      │
   │  ALG-6 recover ALG-7 hygiene ALG-8  │  state │  index-level isolation) · live nums=fetch  │
   │  + ALG-9..13 ANALYSES → DM-EVID ────┼─seam──▶│  vector opt-in >~5K chunks                 │
   └──────────────┬────────────────────┘        └────────────────────────────────────────────┘
                  │ reads MIRROR cache + AUTHORED truth
   ┌──────────────▼──────────────────────── L3 KNOWLEDGE (two-tier dossier) ─────────────────────┐
   │  MIRROR (regenerable, fetched_at+shelf-life, NOT backed up*)  AUTHORED (durable, git+revisions)│
   │   performance · rs-ledger(open)/rs-archive · interactions/    profile · relationship · style   │
   │   <YYYY-MM> + raw-<date> · contacts · analyses/*(retain:true)  narrative(½y shards) · commitments│
   │  generated context.md ROLLUP (read-only)  ·  _system/{registry.yaml, ownership, identity}      │
   └──────────────┬───────────────────────────────────────────────▲──────────────────────────────┘
        cache fill │                                                │ narrative fill (ingestion)
   ┌───────────────▼──────────────────┐        ┌────────────────────┴───────────────────────────┐
   │  L2 DATA PLANE (pipeline.py)      │        │  INGESTION                                       │
   │  default-kernel leg │ analytics-  │        │  daily CRM AI-notes (dedup/TZ/ownership) [Jack]  │
   │  (spend/rs/ci/cal/   │ kernel leg  │        │  + 96h VC-transcript sweep [AM] → narrative.md   │
   │   email/transcript)  │ (EOS/P5/180d)│       └──────────────────────────────────────────────────┘
   │  envelope · IN(all-ids) · numeric-ID-match · 3-rung spend cascade · unknown≠0
   └───────────────┬──────────────────┘
                   │ READ-ONLY: jf graphql→xfb_presto · meta calendar/gmail · Unidash · CRMUnifiedAPI MCP
   ┌───────────────▼───────────────────────────────────────────────────────────────────────────────┐
   │  SYSTEMS OF RECORD: Ads insights · CRM (initiatives/CI/notes) · Calendar · Gmail · VC summaries  │
   └─────────────────────────────────────────────────────────────────────────────────────────────────┘

 L1 STORAGE (under all of it): AUTHORED = files + LOCAL-DISK git + GDrive revisions + nightly off-host bundle
   · MIRROR = host-reachable + regenerable (*analyses/ retain:true is the one backed-up mirror artifact)
   · single-writer-by-construction + advisory lock · NO second live store · NO bidirectional merge
 L6 RUNTIME (drives it): Tier1 schedule → Tier2 cache-diff (NO LLM, zero-network stage-clock) → Tier3 LLM wake
   + independent 12h/96h transcript sweep · heavy analytics on explicit cadence · 0-written=HARD FAIL heartbeat
 L0 CAPABILITY GATE + Ln CONFORMANCE wrap the whole stack.
```

### 4.3 Reading the diagram in one pass

A working day is a single top-to-bottom flow: **L6** wakes the loop on schedule → the **Tier2** zero-network stage-clock decides whether there is work → if so, **L2** pulls fresh signals into the **L3** MIRROR cache → **L4** runs the banded engine + any due analysis over MIRROR-cache + AUTHORED-truth → **L8 cockpit (ALG-8)** renders `today.md` → evidence-ready RS and due outreach become **L5**-gated drafts → the operator reads, edits, sends → the send logs a CI + closes commitments + appends audit, which becomes tomorrow's input. The **only** path from the brain to the outside world is the L5 gate (`[AM]` I-6), and the **only** writer is the single-threaded L6 cron or an interactive operator session (`[AM]` I-11) - those two invariants are what make the whole stack safe to run unattended.

The seams that must hold are pinned by tests (Ln): `registry → pulls` (IN-all-ids, TEST via account_count), `pulls → cache` (envelope, unknown≠0, TEST-13), `analysis → DM-EVID → ALG-4 → ALG-5` (the `safeParse` seam, band-only), and `any send → gate` (cross-client hard-fail, TEST-8). Cross-layer, the rule is uniform: **a number is computed in code, spoken by the model, and never crosses the gate without a cleared source.**

I have what I need from both source docs. The SHARED CONTEXT (especially the `memory-model` harvest, the `storage_ruling`, invariants I-4/I-5/I-7/I-8/I-12/I-13, and the L3 layer) plus the verdict fixes give me the concrete material. Let me write Section 5.

The verdicts on `memory-model` show `survives: false` (2/3 refute), but all three refutations are scoped corrections that **keep the decomposed-dossier decision** and add specific fixes - which the SHARED CONTEXT has already folded into the deliverable (flatten interactions/raw to ≤3 levels, half-year narrative shards, rs open-vs-archive split, analyses retain:true, nesting/labeling corrections). My SCOPE explicitly names these verdict fixes, so I'll write the corrected design as settled.

## 5. Knowledge / memory model & file layout

This section specifies what the brain _stores_ and _where_. It consumes the storage/sync ruling settled in §3 (one canonical store, tier-split by durability, no bidirectional merge) and the layer model in §4; it feeds the skills in §6 (which write through this layout's ownership matrix), the decision engine in §7 (which reads these files), and the safety layer in §9 (whose write-guard enforces this section's write-policy classes). The decomposed dossier here is the _structural_ expression of invariants **I-4, I-5, I-7, I-8, I-12, I-13** - it is not a separate decision but the file-level realization of those laws.

### 5.1 The core ruling: decompose by durability class, never one rich `context.md`

The single most contested layout question is **decomposed per-aspect files [AM]** vs **one rich 14-section `context.md` per account [Jack]**, for an _agent-written_ store. The ruling is **decompose** - and it is decided on **durability policy, not ergonomics**.

| Axis                 | One `context.md` [Jack]                                                                                                      | Decomposed dossier [AM]                                                                                      | Ruling      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- |
| Write reliability    | ~13 differently-owned sections rewritten in-place by many skills; the unreliable LLM op is surgical in-file section-splice   | every write is whole-file regenerate of a single-class file (the reliable primitive under I-1)               | **[AM]**    |
| Merge safety         | needs `.locks/` + LLM additive-merge + a danger-zone "overwrite wholesale = catastrophic" rule [Jack §15/§16/§17]            | aspects never share a file ⇒ field-level last-write-wins is **structurally impossible**; no merge to perform | **[AM]**    |
| Durability policy    | mirror (regenerable spend) and authored (durable strategy) co-mingled in one file → cannot have opposite git/backup policies | mirror tier and authored tier are _different files_ with opposite durability classes (I-8)                   | **[AM]**    |
| Operator-edit safety | editing one section can clobber another; cron and human interleave on one inode                                              | each human-owned concern is a small one-page file; cron cannot clobber a human edit it never reads           | **[AM]**    |
| Single-glance value  | the whole account at a glance (Jack's real win)                                                                              | recovered as a **generated read-only rollup** (§5.4)                                                         | **[synth]** |

**Why this is not a rubber-stamp of decomposition.** Jack's production system is the strongest _evidence for_ the ruling: his lock + merge + danger-zone apparatus exists _only because_ he is monolithic - collapse to one writer per file and all three mechanisms become unnecessary. Jack's genuine proof point is the **per-section ownership matrix**, not the single file - and that matrix maps 1:1 onto separate files (§5.7). We harvest the matrix and drop the monolith.

> Critically, Jack himself does _not_ keep everything in one file - he already decomposes `interactions/`, `analyses/`, `pipeline/` into siblings and pushes meeting notes _out_ to a Google Doc. The ruling completes the decomposition his own structure was already drifting toward.

### 5.2 File layout (one canonical store; tier-split by durability)

Per the §3 storage ruling, the **AUTHORED tier** is files + **local-disk git** on the canonical host (with GDrive native revision-history as a free second recovery layer and a nightly off-host `git bundle` + `git fsck` tripwire as primary DR); the **MIRROR tier** is regenerable caches that may live on whatever store the unattended host can reach (an MM2 read-projection is permitted), backed up only where `retain:true`.

```
am-brain/                              ← the one system root
├── agents.md                          ← [AM] Brain Protocol directives, read every session (AUTHORED)
├── context.md                         ← [AM] AUTO-BUILT portfolio synthesis, NEVER hand-edit (generated)
├── config.md                          ← [AM] SINGLE source of all constants: targets, pacing thresholds,
│                                          shelf-lives, caps, working_calendar (5.6)
│
├── _system/                           ← AUTHORED tier; local-git-versioned
│   ├── registry.yaml                  ← [synth] MERGED master registry (schema §5.5); validate-on-load
│   ├── am-identity.json               ← [AM] FBID 608717784 · sales_employee_id 495568 · unixname jasonljc
│   ├── ownership.md                   ← [synth] per-FILE ownership table {file→class, owner_skill, write_mode,
│   │                                      human_only_fields[]} + the forbidden-ops list (enforced by §9 write-guard)
│   ├── data-access.md                 ← [AM] verified pull paths + DEAD-ENDS (do-not-retry)
│   ├── freshness-policy.md            ← [synth] GENERATED human-readable view of config.md shelf-lives (display only)
│   └── clearance/                     ← [AM] benchmarks.md, dss-tiers.md (operator-supplied)
│
├── engine/                            ← [AM] deterministic Python plane (pulls/, classifiers.py, render.py,
│                                          analyses/, gate.py, tests/) — see §7
│
├── clients/<slug>/
│   ├── context.md                     ← [synth] AUTO-BUILT 1-screen account rollup, READ-ONLY (generated; §5.4)
│   │   ── AUTHORED tier (durable truth; local-git-versioned; backed up) ──
│   ├── profile.md                     ← [AM] human-owned strategy, 1 page (agent proposes diffs)
│   ├── relationship.md                ← [AM] AM-confirmed trust/mood/objection; suggested:{} parking block
│   ├── style.md                       ← [AM] voice seed + do/don't (human-seeded, agent-suggested)
│   ├── narrative.md                   ← [AM][Jack] cumulative meeting log; DUAL-LOAD partner; HALF-YEAR shards (§5.8)
│   ├── narrative-<YYYY>-H<1|2>.md      ← [synth] rolled half-year narrative shards (older windows)
│   └── commitments.md                 ← [AM] append-only; overdue recomputed daily
│   │   ── MIRROR tier (regenerable caches; fetched_at; NOT backed up; freely deletable) ──
│   ├── performance.md                 ← [AM] rolling perf snapshot; every number carries source + fetched_at
│   ├── rs-ledger.md                   ← [AM] OPEN RS only, YAML list (bands/evidence/history/next_action) (§5.9)
│   ├── rs-archive/<YYYY>.md            ← [synth] CLOSED (won/lost) RS, append-only, rolled out on close (§5.9)
│   ├── interactions/<YYYY-MM>.md       ← [AM] monthly CI digest (countable_ci flag; Email NOT countable)
│   ├── interactions/raw-<YYYY-MM-DD>-<type>.md   ← [AM] immutable per-CI records, FLATTENED to ≤3 levels (§5.10)
│   ├── analyses/<type>-<YYYY-MM-DD>.md  ← [Jack] durable dated Presto diagnostics; mirror-but-retain:true (§5.9)
│   └── contacts.md                    ← [AM] business contacts, PII-minimized; dedup key email|phone
│
├── playbooks/<product>.md             ← [AM] per-solution; clearance-gated proof points; eligibility_signals frontmatter
├── generated/                         ← [AM] today.md (cockpit), scorecard.md, coverage.md, rs-queue.md
│                                          (overwrite-free; CONF-1 PACING UNCALIBRATED banner if uncalibrated)
├── drafts/<YYYY-MM-DD>-<slug>-<purpose>.md  ← [AM] rung-0 outbound (mirrors Gmail Drafts; human sends)
├── logs/{event-log.jsonl, context-ledger.jsonl, cron-errors.log, heartbeat.jsonl}
├── archive/                           ← [synth] rolled raw CIs, churned clients (whole), superseded artifacts
└── .git/                              ← LOCAL DISK ONLY (never on the cloud FUSE mount — §3 invariant L1-DUR)
```

**Memory roles (no overlap):** vault = truth · local git = versioning/recovery · GDrive revisions + nightly bundle = DR · `~/para/learn/` FAISS/BM25 = optional retrieval index past ~5K chunks (not a store) · `MEMORY.md`/`CLAUDE.md` = behaviour/directives only. **No fact lives in two places without a source-of-truth marker** - which is why volatile counts are excluded from the registry (§5.5) and `data_freshness` is _computed_, not duplicated (§5.6).

### 5.3 The two-tier dossier - mirror vs authored, opposite durability policies

The decomposition exists because **durability policy differs by content**, and two policies cannot share a file.

|                  | MIRROR tier                                                                                                    | AUTHORED tier                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Files**        | `performance.md`, `rs-ledger.md` (+ `rs-archive/`), `interactions/` (digest + raw), `contacts.md`, `analyses/` | `profile.md`, `relationship.md`, `style.md`, `narrative.md` (+ shards), `commitments.md`, `_system/*` |
| **Content**      | SoR-derived regenerable caches                                                                                 | un-regenerable synthesized judgment                                                                   |
| **Stamping**     | every value carries `source` + `fetched_at` + class shelf-life (I-8)                                           | durable; no shelf-life                                                                                |
| **Git / backup** | NOT git-versioned, NOT backed up - re-derived next run                                                         | local-git-versioned + GDrive revisions + nightly bundle                                               |
| **Deletion**     | freely deletable (the agent may _archive_, never delete - I-12)                                                | operator-only deletion; agent archives only when backup confirmed                                     |
| **Query**        | query-live-first; stale cache never served as fresh                                                            | dual-loaded on every client-scoped read                                                               |
| **Loss cost**    | zero (regenerable) - guarded by a **0-files-written-when-due HARD FAIL** (§3)                                  | catastrophic - two independent recovery layers                                                        |
| **Write mode**   | overwrite-free / append-only                                                                                   | propose-under-`suggested:` / append-only                                                              |
| **Exception**    | `analyses/` is the **one** `retain:true` mirror artifact (high regen cost) → backed up (§5.9)                  | -                                                                                                     |

The `retain:true` carve-out is genuinely new **[synth]** and is the one nuance I-8 must carry: a 180-day Presto diagnostic is _generated and `fetched_at`-stamped_ (so it is classed mirror) yet _expensive to regenerate and cited at a point-in-time in a QBR_ (so it is backed up like authored truth). It is "mirror-but-retained," not durable judgment.

### 5.4 The generated read-only `context.md` rollup - Jack's glance value with no write-contention

The single objection to decomposition is "no one-glance view / N reads for a cheap Tier-2 check." The fix **[synth]** is to generate, per account, a **read-only** `clients/<slug>/context.md` rollup - a _projection over the decomposed truth_, never hand-edited. This extends AM Brain's existing portfolio-level auto-built `context.md` pattern down to the per-account level.

```
clients/<slug>/context.md   ── GENERATED, READ-ONLY (write-mode = overwrite; class = generated) ──
─────────────────────────────────────────────────────────────────────────────────────────────
header (all COMPUTED — cannot drift from underlying files):
  scorecard_status: amber          ← from §7 ALG-1 pacing + ALG-9 trajectory (worst-of)
  rs_count: 47 · rs_pitched: 12 · rs_adopted: 7   ← counted from rs-ledger.md + rs-archive/
  data_freshness: {spend, initiatives, ci, stakeholders, diagnostic}   ← Jack's legible block,
                                    COMPUTED from the underlying fetched_at stamps (§5.6)
body (assembled, never authored here):
  Snapshot         ← performance.md (latest)        | What's Working/Not ← relationship.md + narrative.md
  Top-3 RS         ← rs-ledger.md (ALG-5 banded)     | Open commitments  ← commitments.md (overdue first)
  Recent meetings  ← narrative.md (last N)           | Risk lines        ← ALG-9/ALG-11 (§7)
```

Why this beats both parents: it recovers Jack's single-file ergonomic (the real reason his operators love `context.md`) **without** the write-contention cost, because the rollup is a generated overwrite-free artifact. Operator-editability is _better_, not worse - editing `relationship.md` in the canonical editor cannot clobber `performance.md`, and a read-only rollup stops the operator hand-editing a file the build steamrolls.

**Regeneration trigger:** lazily on read **and** on every cockpit run (Tier-3) - never on every underlying write (write-amplification) and never only nightly (staleness). The header is cheap (counts + max of `fetched_at` stamps); the body is an assembly, not a recomputation.

### 5.5 The merged `registry.yaml` - stable keys, volatile counts excluded, validate-on-load

`_system/registry.yaml` is the **single corruption single-point** - a bad write breaks every account lookup (I-13). It is the superset of AM Brain's lean join-keys and Jack's enriched resolution fields, holding **stable join-keys + resolution data only**. YAML (not JSON) so the operator can hand-edit human-owned fields and add comments - behind a **schema-validate-on-load and validate-before-write** guard, since it is the corruption single-point.

```yaml
# _system/registry.yaml — one entry per account; validate-on-load (registry IS the corruption single-point)
accounts:
  - slug: treasury-wine-estates # [both] URL-safe, stable, used in all paths
    display_name: "Treasury Wine Estates" # [Jack]
    crm_name: "Treasury Wine Estates Limited" # [Jack] full legal name; resolution FALLBACK leg
    search_aliases: ["TWE", "Penfolds", "19 Crimes"] # [both] union of alias sets
    status: active # [Jack] CRM relationship lifecycle: active|paused|churned
    in_portfolio: true # [AM] does THIS AM book it (43-vs-33); ORTHOGONAL to status
    tier: grow # [Jack] book-plan mirror: grow|defend|maintain
    org_id: "123456789" # [both] CRM org FBID
    account_team_id: "445566778" # [AM]
    ad_account_ids: ["987654321", "111222333"] # [both] ALWAYS bind IN(all) — single id undercounts ≤70%
    sfid: "0061x00000ABCDE" # [AM]
    narrative_path: clients/treasury-wine-estates/narrative.md # [AM]
    narrative_source_url:
      "https://docs.google.com/document/d/..." # [synth] ex-Jack meeting_notes_url;
      #   provenance + human deep-link ONLY (Doc demoted to ingestion source, §5.8)
    dossier_path: clients/treasury-wine-estates/ # [Jack path]


# EXCLUDED from registry (volatile → generated; live in clients/<slug>/context.md header + scorecard):
#   rs_count, rs_pitched, rs_adopted, scorecard_status, data_freshness, updated_at, confidence
```

**Resolution order [Jack, strictly better than AM's name/alias-only]:** `slug → display_name → crm_name → search_aliases`. The `crm_name` fallback leg catches the legal-name mismatches alias lists miss.

**Two load-bearing rulings the merge settles:**

- **Keep BOTH `status` and `in_portfolio`** - Jack's `status` is the CRM relationship _lifecycle_; AM's `in_portfolio` is whether _this AM books it_ (the 43-vs-33 reality). They are orthogonal and both drive filtering and the `IN(all ad_account_ids)` pull rule.
- **Exclude volatile counts** - a registry mutated on every RS count change is a write-amplification + single-point-corruption hazard Jack himself flags (§17). `rs_count`/`scorecard_status`/`data_freshness` are **generated** and belong in the per-account `context.md` header (§5.4) and the scorecard - the regenerable surfaces designed to churn.

### 5.6 Two-granularity freshness - structural enforcement + computed legible display

Freshness answers two different questions, so it is modeled at two granularities that **cannot conflict** (the verdict-confirmed reconciliation: enforcement is structural, display is legible-but-derived).

|                     | ENFORCEMENT [AM, structural]                                                                                                                                                                                                                                                        | DISPLAY [Jack, legible - but COMPUTED]                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Question**        | "may this value enter an outbound claim?"                                                                                                                                                                                                                                           | "how stale is this account, at a glance?"                                                                          |
| **Mechanism**       | every mirror value carries `fetched_at`; `config.md` defines class shelf-life; evidence past shelf-life is **EXCLUDED** from ALG-4 evidence-attachment + the §9 clearance gate, and queued to the ALG-7 hygiene sweep; engine queries live-first; stale never served as fresh (I-8) | the `data_freshness:{spend, initiatives, ci, stakeholders, diagnostic}` block in the generated `context.md` header |
| **Read by**         | gate.py + ALG-4 + ALG-7                                                                                                                                                                                                                                                             | the human, in the rollup                                                                                           |
| **Source of truth** | the per-value `fetched_at` stamps                                                                                                                                                                                                                                                   | **computed from** those same stamps (so it can never drift - unlike Jack's hand-maintained block)                  |

```yaml
# config.md — the SINGLE source of all shelf-life constants (freshness-policy.md is a GENERATED view of this)
shelf_life:
  performance: 7d # [AM] daily spend moves fast
  contacts: 90d
  playbook: 90d
  diagnostic: 30d # [Jack /health-check is monthly]; headroom/cpa curves move slower → 60d
  headroom: 60d
  cpa_curve: 60d
  strategy: quarterly # authored; advisory, not a hard gate
  analyses: retain # the retain:true exception — never auto-expired (§5.9)
```

The decisive correction over Jack: his `data_freshness` block is **hand-maintained** and can drift (he stamps it in `/refresh`); here it is _computed_ from the underlying `fetched_at`, so "diagnostic is 23 days old" in the rollup is provably the real age. `config.md` as the single constants source also prevents the shelf-life thresholds being duplicated across `freshness-policy.md` and per-file constants (a Jack duplication risk).

### 5.7 Write-policy classes + the field-resolution ownership matrix

Four write-policy classes [AM, I-5/DM-8] are the spine; Jack's per-section **write-mode vocabulary** and his **human-only-field carve-outs** are overlaid at _field_ resolution. The matrix lives in `_system/ownership.md` as a machine-readable table the §9 write-guard consults on **every** mutation.

| Class            | Write mode                                                       | Files                                                                                                          | WRITE-ladder rung (I-9) |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **human-owned**  | `propose` (agent parks diffs only)                               | `profile.md` strategy fields, `style.md` seed, `config.md` targets, registry `tier`/`in_portfolio`/`aliases`   | rung 0 forever          |
| **AM-confirmed** | `confirm` (agent writes under `suggested:{}`, operator confirms) | `relationship.md` trust/mood, `contacts.md` merges, past-record corrections                                    | rung 1                  |
| **generated**    | `overwrite` (free; regenerable)                                  | `context.md` (both levels), `scorecard`, `coverage`, `performance.md`, `rs-ledger.md`, `analyses/`, `rs-queue` | rung 3 from day one     |
| **append-only**  | `append` (correct via tombstone, never edit)                     | `interactions/raw`, `commitments.md`, `rs-ledger` history, `rs-archive/`, logs                                 | rung 2                  |

```yaml
# _system/ownership.md — per-FILE table; human_only_fields enumerated (Jack §12 carve-out made checkable)
files:
  - {
      path: "clients/*/performance.md",
      owner: engine,
      class: generated,
      write_mode: overwrite,
      human_only_fields: [tier, scorecard_status, status],
    } # generated file, but these are human-set
  - {
      path: "clients/*/relationship.md",
      owner: engine,
      class: am-confirmed,
      write_mode: confirm,
      human_only_fields: [trust_level, current_mood],
    } # frozen even though /capture owns the file (DM-13)
  - {
      path: "clients/*/rs-ledger.md",
      owner: engine,
      class: append-only,
      write_mode: append,
      human_only_fields: [impact_override, ease_override],
    } # human RS overrides NEVER auto-touched
  - {
      path: "clients/*/interactions/raw-*.md",
      owner: engine,
      class: append-only,
      write_mode: create-only,
    }
  - {
      path: "clients/*/profile.md",
      owner: human,
      class: human-owned,
      write_mode: propose,
      human_only_fields: ["*"],
    }
  - { path: "context.md", owner: brain-build, class: generated, write_mode: overwrite } # automation-owned, human read-only
```

The **field-resolution** grain is what beats Jack's section grain: `trust_level` and `current_mood` are frozen _even inside_ a `/capture`-owned file (I-5/DM-13), and `tier`/`scorecard_status` are human-only _even inside_ a `generated` `performance.md`. Jack states these as prose carve-outs (§12 "status and tier are HUMAN ONLY"); enumerating them as checkable `human_only_fields` closes the silent-overwrite hole DM-8 leaves latent - a `generated → overwrite freely` file must still not flip a human-set field.

### 5.8 `narrative.md` dual-load - in-vault truth; the Google Doc demoted to an ingestion source

`narrative.md` is the cumulative reverse-chron meeting log, **AUTHORED tier**, dual-loaded with the structured dossier on **every** client-scoped read (`/prep`, `/capture`, freeform query). The contested question - **in-vault `narrative.md` [AM]** vs **external Google Doc [Jack]** - rules for in-vault on its merits, _independent_ of the storage-backend question.

|                                                       | In-vault `narrative.md` [AM]                                          | External Google Doc [Jack]                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Indexable by the brain                                | yes (grep + recall hook + FAISS)                                      | no                                                           |
| Per-client retrieval scoping (RET-1)                  | yes - client B's notes cannot structurally leak into client A's draft | no - leak prevented only by operator discipline              |
| Freshness / clearance taggable                        | yes                                                                   | no                                                           |
| "Consult both stores" failure surface                 | none (single truth)                                                   | Jack §17: "Skip reading context-secondary.md → miss updates" |
| Unbounded length / human-editable / native notes sink | preserved (Doc kept as upstream source)                               | yes                                                          |

**Ruling:** narrative lives in-vault; the external Doc, _if kept_, is **demoted to a raw ingestion source** (like Presto) - distilled into `narrative.md` by the 96h/daily sweep (dedup / TZ-normalize / ownership-validate), with its URL recorded in `registry.yaml` as `narrative_source_url` for provenance + a human deep-link. There is **no "consult both stores" rule** - the brain owns the single narrative truth, inside the retrieval scoping that makes cross-client leakage structurally impossible.

The Doc's genuine advantages (unbounded length, human-editable, native CRM-AI-notes sink) are preserved by keeping it upstream, not by making it canonical. AM Brain's I-7 single-store invariant - the explicitly contested decision - wins _here_ because a narrative the brain cannot index, scope, or clearance-tag is a retrieval-and-isolation hole.

**Half-year shards [synth/verdict-fix].** `narrative.md` is the one in-vault authored file that is _dual-loaded every query_ yet was uncapped in the parents - a long-tenured account eventually breaches the store's per-file ceiling and bloats every load. The ALG-7 hygiene sweep folds entries older than the live window into `narrative-<YYYY>-H<1|2>.md` half-year shards (read-only, still grep-able, still backed up), keeping the dual-loaded `narrative.md` to a recent rolling window. This mirrors the `raw → digest → archive` pattern the design already uses for CIs, and applies the I-12 roll-up bound to the file that needed it most.

### 5.9 RS ledger - open-vs-archive split; `analyses/` retained; per-RS files rejected at this scale

Two opposite scale arguments settle the RS and analyses layout.

**(1) RS pipeline - REJECT Jack's per-RS files; ADOPT one `rs-ledger.md` + an open-vs-archive split.** Jack stores one `pipeline/rs-{name}.md` _per RS_ - sensible at his ~8 RS/account density, but at this spec's **500–1000 open RS** that is hundreds-to-a-thousand tiny files per book (Jack's own "deep nesting / many files" degradation warning). One `rs-ledger.md` as a YAML list handles it with far better grep/ranking ergonomics.

But a single `rs-ledger.md` carrying _all_ RS including closed history is itself a growth-bearing monolith - structurally repetitive (N near-identical YAML blocks = the silent-drop hazard), agent-rewritten daily, and ceiling-approaching at a concentrated account. The **verdict fix [synth]** is the **open-vs-archive split**:

```
clients/<slug>/rs-ledger.md      ← MIRROR; OPEN RS only; YAML list {rs_id, eos, stage_entered_at, band,
                                     evidence[], history[], next_action, impact_override?, ease_override?}
                                     rs_id copied VERBATIM from CRM (I-4); overwrite-free-regenerable
clients/<slug>/rs-archive/<YYYY>.md  ← APPEND-ONLY; won/lost RS rolled out of the live set on close (I-12)
```

This restores Jack's finer grain at the one place the bare single-file regressed, keeps the live ledger bounded well under the per-file ceiling, and lets the daily loop re-rank the open set without rewriting closed history. The generated rollup (§5.4) still gives the single-glance RS summary, so nothing is lost ergonomically.

> **Stage clock** is `stage_entered_at`, stamped on `initiative_stage` change via state-diff - **never `modified_time`** (which moves on any edit and hides overdue RS). Pre-existing = `unknown` (I-3). This stamp is the durable derived state Tier-2 advances with zero network (§4/§7).

**(2) Analyses - ADOPT Jack's `analyses/` folder, classed `mirror-but-retain:true`.** A headroom curve or 180-day diagnostic is a genuine durable artifact AM Brain had no home for (`performance.md` is a rolling snapshot that gets overwritten). They live at `clients/<slug>/analyses/<type>-<YYYY-MM-DD>.md` (dated for point-in-time QBR citation), classed mirror (generated, `fetched_at`-stamped) but flagged **`retain:true`** - the one mirror-tier exception to the freely-deletable default, and therefore the only mirror artifact that is backed up (because regeneration cost is high). Superseded snapshots are marked stale (**supersession > decay** - never silently accumulated); a per-type cap (`keep latest N per type, roll older to archive/`) prevents a pre-QBR account accumulating dozens of diagnostics over years. Analyses are referenced by `rs-ledger` evidence objects via source-ref (the §7 producer→consumer seam).

### 5.10 File-health limits + the verdict's nesting fix

These are Jack's hard-won MM2/sync operational constraints (§17). They are load-bearing wherever the MIRROR tier rides an MM2 read-projection (the unattended host's reachable store, §3), and protect context windows on any backend.

| Limit             | Value                                   | Why                                                                                                     |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Per-file size     | **<100KB**                              | MM2 ceiling (Jack-proven); oversized file → slow sync + saturated context + truncation/silent-loss risk |
| Directory nesting | **≤3 levels**                           | MM2 API traversal is one call per level                                                                 |
| Filename charset  | kebab-case slugs; **no spaces/unicode** | MM2 path handling mangles otherwise                                                                     |
| Profile size      | `profile.md` ≤ 1 page                   | bloat control (DM-11)                                                                                   |

**The nesting fix [verdict, load-bearing].** Jack's path `clients/<slug>/interactions/raw/<date>-<type>.md` is **4 directory levels** (`clients`/`slug`/`interactions`/`raw`) - it _violates_ the ≤3-level rule under any MM2-backed mirror. The corrected layout **flattens `raw/` into the filename**:

```
WAS  (4 levels, violates the rule):  clients/<slug>/interactions/raw/<YYYY-MM-DD>-<type>.md
NOW  (3 levels, conformant):         clients/<slug>/interactions/raw-<YYYY-MM-DD>-<type>.md
```

`interactions/` becomes the only sub-level under the client folder → exactly 3 levels, the deepest allowed; do not nest further.

### 5.11 Additive history, tombstones, and bounded growth (I-12 realized in the layout)

The store is **additive with archive-not-hoard**; the agent never deletes.

- **`interactions/raw-*` is write-once / create-only.** Any in-place edit is **blocked + logged** (extends DM-9). Corrections go in a **new** tombstone-referenced entry - `not_true: <claim>; do_not_rederive: true` (DM-10) - never an edit. The tombstone closes the gap where the 96h sweep re-ingesting an old transcript resurrects a retracted fact. (Jack's immutability is correct but only _implied_ by "append-only class"; here it is enforced.)
- **The agent may not delete any file in any class.** Deletion is operator-only; the monthly stale-context review is a cockpit **DELETE-CANDIDATE hygiene queue** (ALG-7) the human approves - _not_ an autonomous delete. This imports Jack §17's "delete → permanent loss" as a hard agent-capability boundary, but **not** his never-delete-_anything_ posture (a workaround for additive-only sync the brain doesn't need).
- **Archival is MOVE-not-delete, and gated.** `raw → monthly digest → archive/` is allowed autonomously **only when git + the off-host backup are confirmed for the period** (concrete check: git commit hash present **and** nightly bundle timestamp within the threshold); otherwise it downgrades to a candidate. Git + backup are the recovery substrate that lets AM Brain archive safely where Jack must hoard.
- **Roll-up/cap bounds apply to every growth-bearing file** so none breaches the per-file ceiling: narrative half-year shards (§5.8), rs-ledger open-vs-archive split (§5.9), `analyses/` per-type cap (§5.9), `raw → digest → archive` for CIs. This is the monolith hazard the decomposition exists to kill, closed on the few files that still grow unbounded.

### 5.12 `config.md` - the single constants source

All thresholds live in **one** file, `config.md`: pacing/coverage thresholds, the per-class shelf-lives (§5.6), file-health caps, the SGP `working_calendar`, curve-fit floors (`curve_min_points`, `curve_min_r2`), and every named constant the §7 engine reads. `_system/freshness-policy.md` is a **generated human-readable view** of the shelf-life block - never a second source. This prevents the dual-source drift the memory-curation policy warns against and keeps the structural enforcement (§5.6) and the displayed freshness policy reading from one place.

- **What this section settles for the build:** the ship-now core (Phase 1, §12) lands the decomposed two-tier dossier + the generated `context.md` rollup + the validated `registry.yaml` + `config.md` immediately; the half-year shards, rs-archive split, and `analyses/` retention are layout rules enforced from day one (not deferred), because they are cheap to honour and expensive to retrofit. The open layout questions - MM2's unverified ~100KB cap and version-recovery semantics, whether to retain the external Doc at all, and the exact `analyses/` retention cap - are carried to §14 as blocking operator/verification inputs, not guessed.

## 6. Skills & operating loops - 12 named skills over a tested engine

This is the **packaging resolution** at the heart of the synthesis. Jack's system is loved by its operator because it has _named verbs_ (`/morning`, `/prep`, `/post-meeting`) - an ergonomic surface a human reaches for. AM Brain has the _correct engine_ (ALG-1..8, tested, deterministic) but **no named surface** - its power is a hidden `pipeline.py` the operator never invokes by name. Neither is sufficient. The settled design: **keep Jack's named-skill surface, and make every skill a thin wrapper over AM Brain's tested engine.** `[synth]`

> **The one-line law (I-1 applied to skills):** a skill is `engine math → LLM language → ownership-matrix write`. The Python does the correctness (every number, band, rank, curve); the LLM does only the three judgment jobs (extract structured facts from prose · compose register-matched language · render low-confidence items as questions); the write-guard enforces who may write what. **A skill that asks the LLM to compute a number is a bug.**

### 6.1 The 12-skill catalog

Reduced from Jack's 14 by three merges (`[synth]`): `/post-meeting → /capture`, `/log-interaction → /log -quick`, and the three analyses `/health-check + /headroom + /cpa-v-spend → /analyze <type>`. Write-modes reference the L5 ownership matrix; kernels reference L2 (`d` = default `llmvm`, `a` = analytics `llmvm_analytics`, never mixed in one execution `[Jack]`).

| Skill                          | Trigger                               | Backing LOOP/ALG                                          | Reads                                                             | Writes (tier · mode)                                                                                                                                                                             | Engine vs LLM                                                                                                                                                                 | K   |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **`/morning`** `[-weekly]`     | cron 07:00 SGP wkdays / manual        | LOOP-1 · ALG-1/2/8 (`-weekly` adds the book-review sweep) | book-plan, scorecard, coverage, rs-queue, calendar                | generated `today.md`, `scorecard.md`, `coverage/*` (MIRROR · overwrite-free)                                                                                                                     | engine: all pacing/coverage/cockpit math + selection; LLM: the plain-English verdict line + rollover labels                                                                   | d   |
| **`/prep <client>`**           | calendar (meeting soon) / manual      | LOOP-4 prep · ALG-4/5                                     | client dossier (dual-load), pipeline, fresh perf, gmail, calendar | nothing (read-only)                                                                                                                                                                              | engine: RS ranking, evidence-readiness, freshness; LLM: the one-page narrative + talk-track + objection branches                                                              | d   |
| **`/capture`** `[-quick]`      | after a call (paste notes/transcript) | LOOP-4 capture · ALG-4 re-band                            | raw notes/transcript + dossier                                    | CI record (MIRROR raw · **create-only**), follow-up draft (drafts/ · gated), commitments (AUTHORED · append), RS-state (MIRROR · update), narrative (AUTHORED · append) - **ONE approval batch** | engine: RS-state transitions, commitment diffs, countable_ci flag; LLM: extract decisions/actions/stakeholders from prose (flag inferred≠heard), draft in `style.md` register | d   |
| **`/log`**                     | quick touch, no full processing       | LOOP-4 (lightweight)                                      | one-line summary                                                  | CI record (MIRROR raw · create-only) + Recent-Interactions rollup                                                                                                                                | engine: countable_ci + timestamp; LLM: one-line normalize                                                                                                                     | d   |
| **`/sweep`**                   | weekly / manual                       | LOOP-1 (attention render-mode) · ALG-2/6                  | all dossiers, spend alerts                                        | nothing (read-only attention matrix)                                                                                                                                                             | engine: the entire attention matrix (untouched/below-required/at-risk); LLM: ordering rationale prose                                                                         | d   |
| **`/refresh <client>`**        | weekly / manual                       | LOOP-6 · ALG-4                                            | Presto spend + CRM                                                | performance, rs-ledger, snapshot (MIRROR · overwrite-free; **never** human-only fields)                                                                                                          | engine: spend cascade, WoW, freshness stamps, evidence re-band; LLM: brand-profile prose only                                                                                 | d+a |
| **`/pitch-priorities`**        | weekly / manual                       | LOOP-2 · **ALG-5**                                        | annotated RS, dossiers, cleared library                           | `queue/rs-queue.md` (MIRROR · overwrite), pipeline items                                                                                                                                         | engine: the full R0→R4 ranked queue + parked/discovery lists; LLM: nothing but the plain-English `score_reason` per line                                                      | d   |
| **`/calendar`**                | weekly / manual                       | LOOP-6 (cadence) · ALG-2                                  | calendar, engagement plans                                        | Engagement-Plan section (AUTHORED · rewrite)                                                                                                                                                     | engine: CI-cadence compliance, due-date spread; LLM: nothing                                                                                                                  | d   |
| **`/analyze <type> <client>`** | monthly / pre-QBR                     | LOOP-2 evidence · **ALG-9..13**                           | Presto (180d / daily spend-CPA / P5)                              | `analyses/<type>-<date>.md` (MIRROR · **retain:true**), DM-EVID into ALG-4                                                                                                                       | **engine: 100% of the math** (trajectory enum, log-curve fit, regression, adoption); LLM: only the readout prose, gated `[UNCALIBRATED CURVE]` if not calibrated              | a   |
| **`/brief <client>`**          | pre-QBR / handoff                     | LOOP-2 (assembly)                                         | dossier, analyses, pipeline                                       | nothing (output only - external-facing, **gate-checked**)                                                                                                                                        | engine: assembles cited evidence; LLM: the polished brief, every number through the gate                                                                                      | d   |
| **`/setup <client>`**          | once per account                      | (init)                                                    | CRM, ACDP, operator input                                         | `registry.yaml` entry (validate-before-write), initial dossier scaffold                                                                                                                          | engine: ID discovery (ACDP), registry validation; LLM: business-overview prose from CRM                                                                                       | d+a |
| **`/handoff <client>`**        | rare (AM change)                      | (assembly)                                                | everything for the account                                        | nothing (comprehensive handoff doc, output only)                                                                                                                                                 | engine: completeness check; LLM: the handoff narrative                                                                                                                        | d   |

**Two non-skill surfaces** round out the operator experience:

- **Freeform query** (`[AM]` query flow): "what's going on with `<client>`?" → registry resolves alias→slug → **dual-load** (AUTHORED + MIRROR + recall hook) → answer **with** `score_reason` + `confidence`; low-confidence/`required_human_judgment` renders as a **question, not a recommendation** (I-2). If asked to reach out, it produces a single-recipient-tainted draft through the gate. This is the everyday "talk to the brain" path; it is _not_ a 13th named skill unless the operator wants the affordance (open question §14). `[synth]`
- **Auto-cockpit cron** (LOOP-1 unattended): the same `/morning` engine, fired by L6 on schedule, so `today.md` is ready before the operator sits down - the proactive daily loop that Meta's read-only Sales AI structurally cannot run.

### 6.2 The operating rhythm

```
DAILY (10–15 min)   cron pre-renders today.md →  operator works the cockpit top-down
                    (must-do ≤3 · optional ≤7; recovery outranks pitches when behind)
   before a call →  /prep <client>          (evidence-backed one-pager)
   after a call  →  /capture                (CI + follow-up draft + commitments + RS-state, one batch)
   quick touch   →  /log

WEEKLY (Mon, ~20 min)  /morning --weekly  +  /sweep   (pacing vs targets, coverage gaps, at-risk)
                       /refresh <key clients>  ·  /pitch-priorities   (re-rank the RS queue)
                       /calendar   (CI cadence)  ·  hygiene queue (ALG-7: stale claims, over-cap files)

MONTHLY / PRE-QBR      /analyze diagnostic|headroom|cpa <client>   ·  /brief <client>
                       close + archive scorecard  ·  write next book-plan  ·  stale-context DELETE-CANDIDATE review
```

This is **Jack's proven cadence** `[Jack]` (the rhythm an AM actually lives) running on **AM Brain's tested engine** `[AM]` (so the numbers are right and the cockpit can't quietly lie). The maintenance budget is a hard signal, not a hope: **if file-gardening exceeds ~15 min/week at steady state, the system is failing - simplify before adding** `[AM]` CONF / `[Jack]` "additive-only needs manual cleanup" lesson, here bounded by ALG-7 + git-backed archival so cleanup is a one-tap approve, not a chore.

### 6.3 Why thin wrappers, not fat skills

Jack's skills are 1400+-line LLM procedures that drift - they misclassify, skip steps, and (worst) compute spend math in-prompt where it is unverifiable `[AM]` I-1 rationale. The synthesis inverts the ratio: the skill file is short (what to read, which engine call, how to phrase, who may write), and the weight lives in `engine/classifiers.py` + `engine/analyses/*.py` under unit tests. The payoff is compounding: a fix to ALG-5 ranking improves `/prep`, `/pitch-priorities`, and the cockpit **at once**, with a test that proves it - instead of editing the same logic, inconsistently, across three prose skills. The name is the ergonomics; the Python is the correctness.

## 7. Decision engine & analytics - the deterministic cortex + grafted analyses

L4 is where the synthesis earns its thesis. AM Brain contributes a **banded decision cortex** (ALG-1..8) whose discipline is that rules order everything and a number never reorders across a band. Jack contributes a **deep-analytics suite** (180-day diagnostics, headroom response curves, CPA-vs-spend regression, P5/PBP adoption) that AM Brain simply did not have - but which Jack ran as _in-prompt LLM math_, the exact unverifiable pattern I-1 forbids. The graft: **take Jack's analyses as a capability and refactor every one into tested Python**, then wire their output back into AM Brain's ranking through a typed seam neither parent built. `[synth]`

### 7.1 The banded cortex (ALG-1..8, verbatim from SPEC)

Pure functions in `engine/classifiers.py` + `engine/render.py`, named constants in `config.md`, unit-tested against fixtures TEST-1..16.

| ALG                           | Does                                                                                                                                | The discipline it enforces                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALG-1 Pacing**              | `required/actual run-rate`, `ratio` → `{ahead ≥1.10 · on_pace · behind ≥0.70 · critical}` + a plain-English recoverability verdict  | guards `working_days_remaining==0`; inputs pass DM-4 (unknown≠0); CONF-1 banner if uncalibrated                                                                                       |
| **ALG-2 Client coverage**     | per-client `required_touches`, due-date spread, `untouched / needs_attention / below_required`                                      | countable-CI only; tier `defend` + risk flag forces attention                                                                                                                         |
| **ALG-3 Solution coverage**   | `pitched_share(s)` vs `mix_target × undercoverage_factor (0.6)` → undercovered set                                                  | book-plan-relative, not vibes                                                                                                                                                         |
| **ALG-4 Evidence attachment** | playbook signal × client → eval `test` on **fresh** data → DM-EVID, `evidence_readiness {strong≥2-or-1-decisive · moderate · weak}` | non-evaluable (missing/NaN) → `unscored` + a data-gathering task, **never a band** (TEST-13)                                                                                          |
| **ALG-5 RS ranking**          | `R0 pins → R2 gates(blocked→parked, unknown→discovery) → R1 boosts → R3 band-sort → R4 numeric-tiebreak`                            | **a numeric score MUST NOT reorder across bands** (I-2); every line renders `score_reason`+`confidence`; low-confidence → a question (ALG-5a); feedback flips bands (ALG-5b, TEST-10) |
| **ALG-6 Recovery**            | when behind/critical → ranked recovery actions, each a **legitimate low-effort CI with real content**                               | no content-free "checking in"; if unrecoverable at capacity, say so + propose triage (GEN-2)                                                                                          |
| **ALG-7 Hygiene**             | weekly: expired claims, over-cap files, stale playbooks/contacts, unconfirmed suggestions >14d                                      | the bounded-maintenance guarantee                                                                                                                                                     |
| **ALG-8 Cockpit**             | assembles 7 sections, `must_do ≤3 / optional ≤7`, rollover-labeled, **recovery outranks pitches when behind**                       | the recited plan; rewrites checkboxes as work completes (TEST-14)                                                                                                                     |

### 7.2 The analytics graft (ALG-9..13) - Jack's suite as tested Python

Each analysis becomes a pure function in `engine/analyses/` emitting a typed **`AnalysisResult`**, golden-fixture tested, math never in the prompt:

| ALG                           | Skill                   | From                               | Inputs → Output                                                                                                                             | Born-clearance + calibration guard                                                                               |
| ----------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ALG-9 Trajectory**          | `/analyze diagnostic`   | `[Jack]` /health-check             | 180d spend/conversion → a **deterministic trajectory enum** (`scaling / plateau / declining / volatile / insufficient_data`) + RS-gap flags | `insufficient_data` bucket on thin history; feeds the cockpit risk section                                       |
| **ALG-10 Headroom**           | `/analyze headroom`     | `[Jack]` /headroom                 | daily spend/CPA → **log-curve fit** + predicted CPA at incremental spend + diminishing-returns point                                        | `[UNCALIBRATED CURVE]` banner if curve-form/thresholds unsupplied; **may NOT enter a client draft** uncalibrated |
| **ALG-11 CPA-vs-spend**       | `/analyze cpa`          | `[Jack]` /cpa-v-spend              | daily spend/conversion → **regression** + optimal-spend zone + diminishing-returns threshold                                                | same `[UNCALIBRATED CURVE]` gate; `Number.isFinite`-guarded inputs                                               |
| **ALG-12 Levers**             | `/analyze levers`       | `[Jack]` perf-levers-scorecard     | `fct_performance5_account` → P5/PBP adoption heatmap per recommendation                                                                     | adoption-gap rows become DM-EVID for ALG-4                                                                       |
| **ALG-13 Revenue commentary** | (weekly, operator-only) | `[Jack]` weekly-revenue-commentary | CRM revenue tables → revenue-vs-quota + tailwinds/headwinds                                                                                 | **operator-destination only** - never client-bound (no taint), but still cited                                   |

### 7.3 The seam neither parent built: analysis → evidence → ranking

Jack's analyses produced _reports a human reads_; they never fed his pipeline. AM Brain's ALG-4 consumed _playbook eligibility signals_ but had no deep-analysis source. The synthesis wires them together with an explicit, typed, **`safeParse`-pinned** producer→consumer contract `[synth] + [ext]` (the cross-slice-seam discipline):

```
engine/analyses/*  ──emit──▶  AnalysisResult { metric, value, fetched_at, clearance_class,
                                               confidence, evidence_objects[]: DM-EVID }
       │ (born-clearance-classed at source — a benchmark figure is aggregate_benchmark_cleared
       │  or internal_only the moment it is computed, never improvised later)
       ▼
   ALG-4 evidence attachment  ──▶  a DECISIVE analysis signal MAY set evidence_readiness=strong
       │                            on a matching RS, or SUPPRESS / RAISE an RS …
       ▼                            … but only ever sets a CATEGORICAL band (I-2 intact)
   ALG-5 RS ranking  ──▶  the RS reorders by BAND, never by the raw analysis number
```

The pin is a `ConsumerSchema.safeParse(producerOutput)` test (`[ext]` lesson: stacked slices each pass against their _own_ contract while the seam silently drifts). So a headroom curve can legitimately push "scale spend on `acme`" up the queue - but it does so by moving the RS into the `urgency: now` band with a cited `score_reason`, **not** by injecting a regression coefficient into a sort key. The analysis adds _evidence_, never _order_.

### 7.4 Calibration honesty wraps everything

Every surface inherits the I-3 stack `[AM]`: missing/non-finite inputs render `unknown` (never `0`/`pass`), `Number.isFinite`-guarded before any comparison (`[ext]` NaN-blind-gates: comparison floors pass NaN as all-false); an uncalibrated pacing surface carries **`PACING UNCALIBRATED`**; an uncalibrated curve carries **`[UNCALIBRATED CURVE]`** and is barred from client drafts; an unsourced proof point renders **`[NEEDS CLEARED BENCHMARK]`**. This is the precise discipline Jack's in-prompt analyses lacked - a 45-day-old headroom curve quoted live in a QBR is exactly the staleness lie the shelf-life + calibration machinery exists to prevent. The cortex tells the AM what to do today; the calibration layer guarantees it never does so by **fabricating** the reason.

## 8. Data plane & access

The data plane is the READ-ONLY substrate beneath the engine: a set of named pulls (`engine/pulls/`) that fetch system-of-record (SoR) truth, stamp it, and hand structured data to the MIRROR tier. It authors nothing in the SoR (I-4); it copies keys verbatim and renders `unknown` - never `0` - on any failure (I-3). Every design choice below is bound to a named transport, table, ID, or constant, because an under-specified data plane is exactly where a 70%-undercount or a silent-zero spend hides. (Engine consumers of this data - ALG-1..13, the clearance gate - are §7; storage tiers and the freshness _enforcement_ contract are §3/§5.)

### 8.1 Two named transports + kernel non-mixing

The two parents diverge on the primary access mechanism: AM Brain ships ONE tunnel (`jf graphql` → `xfb_presto`); Jack runs direct SQL on a dedicated analytics kernel. **Ruling [synth]: adopt BOTH as two named transports, not one-or-the-other.** AM Brain's tunnel is the right low-latency path for live RS/CI/transcripts (where Jack has no concrete recipe); Jack's analytics-kernel path is production-proven for the bulk/historical scans (a 180d diagnostic over 33 accounts is a Presto job, not a GraphQL paginate) and is the only place the named spend/perf tables are documented.

| Transport                           | Definition                                                              | Discipline                                                                                                                                                                                         | Use for                                                              |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `TRANSPORT_GRAPHQL` [AM]            | `jf graphql` → `xfb_presto_tools.execute_query`, employee GraphQL token | **no CAT**; `export META_TRACING_DISABLE=1` on every host (harmless on datacenter, saves ~75s on Mac/VPN/IPv6); `jf graphql` is officially unsupported ("no feature work") → tolerable but unowned | LIVE state: spend-live, RS/initiatives+AR, CI real-time, transcripts |
| `TRANSPORT_PRESTO_ANALYTICS` [Jack] | SQL on `kernel=llmvm_analytics`                                         | named tables only; bulk/historical                                                                                                                                                                 | 180d diagnostics, EOS, spend-fallback, P5 adoption, CRM-note bulk    |

Two rules govern transport choice:

- **TR-1 (transport selection)** [synth]: live current-state numbers prefer GraphQL; multi-day / historical / aggregate analytics prefer the analytics kernel.
- **TR-2 (kernel non-mixing)** [Jack §13]: a single pull invocation MUST NOT mix kernels. `pipeline.py` groups analytics-kernel pulls into ONE execution leg distinct from the GraphQL/default-kernel leg. This is Jack's hard production constraint, omitted by AM Brain's single-tunnel framing and load-bearing the moment analytics-kernel deep dives enter the daily/weekly loop. Per §6/§10 the `required_kernel` tag rides each skill and the partition only _activates_ under a Metamate-mission host; on the laptop/devserver one Python process does all pulls and TR-2 is inert-but-documented.

```
pipeline.py
 ├─ LEG A (default kernel, TRANSPORT_GRAPHQL):  spend-live · rs · ci · transcript · calendar · email · crm_status
 └─ LEG B (llmvm_analytics, TRANSPORT_PRESTO_ANALYTICS):  EOS · spend-fallback(if triggered) · p5_adoption · 180d-diagnostics(on-demand)
        ▲ never co-execute a Presto pull with a calendar/memory call in one invocation (TR-2)
```

### 8.2 The self-describing envelope

Every pull returns one standardized record. AM Brain supplies the base 5 fields (`step, status, time_ms, data, error`) and the failed-pull→`unknown` discipline; Jack's two-transport / kernel reality forces the added `transport`/`kernel`/`spend_source_rung` fields. The extra fields make the envelope **self-describing for audit and for the Tier-2 cache-diff** (which reasons about freshness/provenance without re-deriving it). [synth, extending AM]

```jsonc
{
  "step":             "spend",                  // pull name
  "status":           "ok|empty|error|unknown",
  "time_ms":          1240,
  "transport":        "graphql|presto_analytics|mcp|cli|unidash",
  "kernel":           "llmvm|llmvm_analytics|n/a",
  "spend_source_rung": "0|1|2|none",            // present only for spend; see §8.4
  "id_match_mode":    "numeric|text_fallback",  // §8.3
  "fetched_at":       "2026-06-09",
  "account_count":    33,
  "data":             { /* ... */ } | null,
  "error":            "string|null"
}
```

Three envelope rules:

- **ENV-1** [AM/I-3]: `status ∈ {error, empty, unknown}` ⇒ downstream renders `unknown`, never `0/false/pass`.
- **ENV-2** [synth]: `id_match_mode = text_fallback` MUST be logged - numeric match is mandatory-first (§8.3).
- **ENV-3** [ext, project-memory NaN-blind gates]: `Number.isFinite`-guard every external numeric before any comparison; a NaN spend must NOT pass a `> 0` test as all-false.

### 8.3 ID-matching discipline

The brain mirrors the SoR; it never authors keys (I-4). Identity is read from one file, never hardcoded.

| Rule                             | Contract                                                                                                                                                                                                                      | Source                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **ID-1 numeric-first**           | `org_id` / `account_team_id` / `ad_account_id` / `sfid` copied verbatim from `_system/registry.yaml`; numeric match attempted first                                                                                           | [AM]                                       |
| **ID-2 text-fallback-is-logged** | alias/text match only as a fallback, stamped `id_match_mode=text_fallback` in the envelope (ENV-2)                                                                                                                            | [synth]                                    |
| **ID-3 identity-from-file**      | identity (`FBID 608717784` / `sales_employee_id 495568` / unixname `jasonljc`) ALWAYS from `_system/am-identity.json`, never hardcoded elsewhere; **CI/Unidash uses `sales_employee_id`, RS uses `FBID` - do not cross them** | [AM]                                       |
| **REG-1 IN(all-ids)**            | every spend/performance/P5 pull MUST bind `ad_account_id IN (<all ids for slug>)`; **a single id undercounts up to 70%** - binding one id is a defect                                                                         | [AM rule] + [Jack `ad_account_ids[]` list] |

REG-1 is where the two parents complete each other: AM Brain states the 70%-undercount _rule_ but never names how the id set is _discovered_; Jack supplies the discovery table. **`ACDP_AD_ACCOUNT_DISCOVERY = ad_reporting.acdp_dim_l4_ad_account`** [Jack] is the canonical way to (re)populate `ad_account_ids[]` from `org_id` at registry build/refresh (the `/setup` path, §6). Rule + maintenance mechanism = complete. The personal-book filter additionally misses shared/strategic accounts; **`l12_territory_name`** [AM] is the territory-scoped attribution fallback that recovers them (load-bearing given 33 active vs 43 registered).

### 8.4 The 3-rung spend cascade + zero/NaN guard

Both parents agree on the middle rung; only AM Brain has the live GraphQL rung and only Jack names the second Presto fallback and the zero-trigger. **Ruling [synth]: a single deterministic 3-rung cascade, named constants in `config.md`, with a zero/non-finite/empty guard so there is no silent-zero hole.**

| Rung     | Constant                                                               | Source                     | Transport        |
| -------- | ---------------------------------------------------------------------- | -------------------------- | ---------------- |
| `RUNG_0` | `SPEND_LIVE_GRAPHQL = ad_account.ad_insights{spend_usd}` (cents ÷ 100) | [AM]                       | graphql          |
| `RUNG_1` | `SPEND_PRESTO_PRIMARY = edw_bir01.fct_ad_account_daily_revenue_split`  | [AM]+[Jack] (both name it) | presto_analytics |
| `RUNG_2` | `SPEND_PRESTO_FALLBACK = bi.fct_account_rolling_stats`                 | [Jack]                     | presto_analytics |

```python
# SPEND_ZERO_GUARD — engine/pulls/spend.py
def resolve_spend(slug, ids):                     # ids = ALL ad_account_ids (REG-1)
    for rung in (RUNG_0, RUNG_1, RUNG_2):
        v = pull(rung, ids)                        # binds IN(ids)
        # ENV-3: a NaN/None must NOT pass a `> 0` test as all-false
        if v is not None and Number.isFinite(v) and v != 0:
            return Spend(value=v, spend_source_rung=rung.idx, fetched_at=today())
        # 0 | non-finite | empty for an account-WITH-ids ⇒ cascade to next rung
    return Spend(value=UNKNOWN, spend_source_rung="none")   # I-3: unknown, NEVER 0
```

**Cascade trigger:** if a rung returns `0` OR non-finite OR empty for an account that HAS `ad_account_ids`, fall to the next rung and stamp `spend_source_rung`. If all rungs yield `0`/empty, render `unknown` (DM-4), never `0`. The `Number.isFinite` guard [ext] is folded INTO the cascade so a NaN never short-circuits to a false "zero spend" pass. **Until the open spend-zeros VERIFY closes** (a 2026-04 doc observed zeros on `ad_insights`) **default the live cockpit spend to `RUNG_1`**; `RUNG_0` stays unproven until one confirmed-nonzero GraphQL call.

### 8.5 The canonical pull set

`engine/pulls/`, all READ-ONLY, each declaring transport + table + ID rule. (The RS stage-clock - `STATE-DIFF`, stamp `stage_entered_at` on `initiative_stage` change, **never `modified_time`** which moves on any edit and hides overdue RS - is the §7 ALG mechanism; the pull only _persists_ the stamp.)

| Pull           | Transport              | Table / endpoint                                                                                                                                   | ID rule           | Notes                                                                                 |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `spend`        | graphql→presto cascade | §8.4 RUNG_0/1/2                                                                                                                                    | REG-1 IN(all ids) | `SPEND_ZERO_GUARD`; default RUNG_1 until VERIFY                                       |
| `rs`           | graphql                | `intern_user(FBID).crm_sales_user.initiatives(first:500)`, paginate ~800–900 over 2 batches by FBID                                                | FBID              | EOS via presto (see below)                                                            |
| `rs.EOS`       | presto_analytics       | `dim_crm_account_plan_initiative.estimated_opportunity_size` ÷ 100                                                                                 | -                 | **EOS is a GraphQL dead-end** → analytics kernel only                                 |
| `ci` (live)    | graphql                | `crm_client_interactions(first:200)`                                                                                                               | sales_employee_id | **~41 hard cap**; mark `countable_ci` (Email NOT countable)                           |
| `ci` (quarter) | unidash                | CI widget tab `1174094300424212`, selectors `sales_employee_id=495568`, `quarter_id='YYYY-01-01'`                                                  | sales_employee_id | full-quarter rollup → calibrates ALG-1 pacing                                         |
| `transcript`   | graphql                | `crm_client_interactions → partner_event → vc_sessions{summary}`                                                                                   | -                 | 96h window; see §8.7 STREAM_A                                                         |
| `calendar`     | cli                    | `meta calendar.*`                                                                                                                                  | -                 |                                                                                       |
| `email`        | cli                    | `meta google.gmail.*` (read/draft)                                                                                                                 | -                 | **Gmail Apps-Script BLOCKED** (dead-end)                                              |
| `crm_status`   | mcp                    | `CRMUnifiedAPI` MCP preferred where it overlaps the tunnel (permission-parity, oncall-supported); `jf graphql` tunnel = tolerable unowned fallback | per-record        | reuse-over-rebuild: a supported MCP beats an unowned tunnel for overlapping CRM reads |
| `p5_adoption`  | presto_analytics       | `fct_performance5_account`                                                                                                                         | REG-1 IN(all ids) | P5/PBP heatmap; **on-demand only** (no cheap precondition, §6/§10)                    |

**Account-set provenance:** registry build/refresh populates `ad_account_ids[]` via `ACDP_AD_ACCOUNT_DISCOVERY` from `org_id` (§8.3); `l12_territory_name` recovers shared/strategic accounts the personal-book filter misses.

### 8.6 Two-granularity freshness (the data-plane half)

Freshness lives at TWO granularities that answer DIFFERENT questions; collapsing them loses one. The CLAIM-LEVEL _enforcement_ contract (shelf-life gates evidence + the clearance gate; structural, not policy) is owned by §3/§5 invariant I-8. The data plane owns the PULL-LEVEL half - the scheduling input.

- **CLAIM-LEVEL** (safety; read by the clearance gate + ALG-4): every `DM-EVID` carries `source + fetched_at`; invalid past its class shelf-life ⇒ excluded from evidence and queued to the ALG-7 hygiene sweep, never silently reused. _(Enforcement detail in §3/§5.)_
- **PULL-LEVEL** (scheduling; read by the Tier-2 cache-diff + hygiene): a per-account `data_freshness` block `{spend, initiatives, ci, stakeholders, diagnostic}` in the MIRROR-tier dossier header - "when did each pull class last succeed" - is what Tier-2 reads to decide whether to re-pull. **Computed from the underlying `fetched_at` stamps, never hand-maintained** [synth] (Jack's block was hand-maintained and could drift).

`FRESH-1` (query-live-first wins at the boundary): any pull older than its `SHELF_*` is re-pulled before its number supports an outbound claim, regardless of cache state. `FRESH-2`: the daily loop pre-fills only cheap/live-transport classes (spend/rs/ci/commitments); analytics-kernel deep dives (health-check 180d, headroom, cpa-v-spend, P5) stay operator/cockpit-triggered (too heavy to run for 33 accounts every morning).

Shelf-life constants live in **`config.md` as the single source** (`SHELF_PERFORMANCE=7d, SHELF_CONTACTS=90d, SHELF_PLAYBOOK=90d, SHELF_DIAGNOSTIC=30d, SHELF_INITIATIVES=as-pulled`); Jack's `freshness-policy.md` becomes a _generated human-readable view_ of it (no dual-source fact, per the curation policy). This reconciles Jack's legible per-account block with AM Brain's structural shelf-life: Jack's block is the cheap scheduler input AM Brain's Tier-2 needs; AM Brain's per-claim rule is the safety input.

### 8.7 Dual ingestion streams → `narrative.md`

Transcript/note capture runs TWO complementary streams covering different sources with different durability. AM Brain is right that VC summaries are _ephemeral_ (a hard 96h CRM expiry) and need a frequent unconditional sweep; Jack is right that durable CRM rich-text notes suit a daily skillbook. **Run both; route both through ONE ingestion pipeline so there is no double-count.** [synth]

```
STREAM_A (time-critical) [AM]            STREAM_B (durable) [Jack]
SWEEP_WINDOW = 96h                       daily sync-crm-notes /
SWEEP_INTERVAL = 12h  (8× redundancy)    meeting-notes-sync (pagination)
crm_client_interactions                  dim_crm_rich_text_note
  → partner_event                        read back via download() / Docs skill
  → vc_sessions{summary}
BYPASSES the Tier-2 cost filter
(96h = hard data-expiry deadline)
        │                                         │
        └──────────►  ONE ingestion  ◄────────────┘
            dedup (on content) · TZ-normalize · ownership-validate   [JSB]
                              │
                              ▼
              clients/<slug>/narrative.md  (authored tier; DUAL-LOAD partner)
```

- **`SWEEP_WINDOW = 96h, SWEEP_INTERVAL = 12h`** [AM, ambiguity resolved]: cadence and window are different axes. The sweep _fires_ every 12h; each firing ingests any meeting inside the trailing 96h access window. 12h (not Jack's 24h) is correct _here_ because the CRM access window is a hard expiry - 12h-in-96h gives **8 independent capture attempts**, making a single missed run non-fatal and directly mitigating the Automations ~23-run silent-stop class. Jack's 24h is safe for HIM because his notes don't expire from the source; AM Brain's transcripts do.
- STREAM_A is independent of the Tier-2 cost filter and the daily loop (its own 12h timer, §10); STREAM_B is a daily skillbook sync.
- The external Google Doc (if retained) is an **upstream ingestion source only** (like Presto), distilled into `narrative.md` and recorded as `registry.narrative_source_url` for provenance - never a parallel truth store (the single-narrative ruling, §5).

### 8.8 The dead-end registry + `_system/data-access.md`

The single highest-value data-plane artifact is AM Brain's **dead-end registry** - a do-not-retry list that prevents wasted retries on known-impossible paths. Jack has the positive query recipes; AM Brain has the negative knowledge Jack lacks. **Ruling [synth]: ONE canonical `_system/data-access.md` with three sections**, with `capability-audit.md` (the L0 NATIVE/BUILDABLE/IMPOSSIBLE gate) kept separate. One file, three sections, avoids the two-doc drift the curation policy warns against.

```
_system/data-access.md
├─ (1) WORKS        per-source how-to: [transport, table/endpoint, ID rule, kernel]   [Jack recipes + AM table]
├─ (2) DEAD-ENDS    do-not-retry, with reason:                                         [AM — the unique asset]
│        • EOS on GraphQL (use dim_crm_account_plan_initiative on analytics kernel)
│        • baseline_metrics
│        • the 5-step Presto RS pipeline
│        • partner_events-direct  (needs CRM_GRAPHQL_ACCESS GK)
│        • node()...on VCSession  (introspection dead-end)
│        • all CAT-only tables: all_ads_details / fct_ad_rolling_stats /
│                               crm_key_initiative_quarterly_rolling
│        • Gmail Apps Script · WhatsApp send · GraphQL introspection on AccountPlanInitiative
└─ (3) NAMED CONSTANTS   every table / tab / kernel / flag (RUNG_0..2, ACDP_*, SHELF_*, tab ids, FBID, …)
```

### 8.9 Orchestration

`pipeline.py`: resolve `registry.yaml` → run the **two kernel-separated legs in parallel** (Leg A graphql/default-kernel: spend-live, rs, ci, transcript, calendar, email, crm_status; Leg B analytics: EOS, spend-fallback-if-triggered, p5, diagnostics-on-demand) → assemble envelopes → fill the MIRROR caches (`performance.md`, `rs-ledger.md`) with `fetched_at` → recompute the `data_freshness` block. Tier-2 cache-diff advances `days_in_stage` with **zero network** from the cached `stage_entered_at`; spend-cliff / new-CI are the only Tier-2 predicates that need a pull and wake Tier-3 (§10). STREAM_A runs on its own 12h timer, independent of all of the above.

> **Open data-plane VERIFYs (full list in §14):** the spend-zeros VERIFY (RUNG*0 unproven; RUNG_1 default until one confirmed-nonzero call); the exact `countable_ci` predicate (blocks calibrated ALG-1); Unidash widget reachability from a non-interactive host (programmatic vs screen-scrape); whether `dim_crm_rich_text_note` / `acdp*\*`/`edw_bir01`/`bi`/`fct_performance5_account`are reachable under the operator's permissions via the tunnel vs a different broker; the true`vc_sessions{summary}`window (12h interval assumes a ≥96h floor);`CRMUnifiedAPI` MCP coverage vs where the unowned tunnel remains load-bearing; and EOS unit confirmation (÷100 assumed, matching the cents/100 spend convention).

Section 9 is written. Returning it below.

-

## 9. Safety, governance, autonomy & multi-agent

This is the layer that makes a single operator safe to run a draft-producing, file-mutating agent across 33 advertiser accounts. Its thesis: **gate the outbound, guard every write, graduate autonomy on numbers, and keep exactly one writer until a disjoint-partition gate is cleared.** AM Brain contributes the crown-jewel send-side gate, the calibration honesty, the field-level ownership classes, and the read-only-subagent posture; Jack contributes the production-hardened coordination machinery (locks, task-queue, ownership matrix, danger-zone catalog) and the human-only-field carve-outs; the synthesis adds the _write-guard_, the _two explicit autonomy ladders_, and the _gated-multi-agent graduation rule_ that lets a second writer return later without re-importing Jack's silent-loss merge.

The decision posture below was adversarially stress-tested (verdict: **survives, refutes 1/3**); the three corrections the skeptics forced - the lock is defense-in-depth not a mutex, ownership binds to frontmatter not path-globs, archival is gated on a backup-confirmation check - are folded directly into the design, not deferred.

Cross-refs: the gate consumes the clearance classes defined in §7 (decision engine, `clearance_by_field` on every `AnalysisResult`) and the freshness shelf-lives from §5/§8; the ownership matrix is the same `_system/ownership.md` referenced in §5; the lock/partition machinery is the concurrency half of the §3 storage ruling. This section does not restate the storage ruling or the engine; it specifies the **controls** layered over them.

-

### 9.0 The five governance surfaces (one map)

```
                         ┌──────────────────────────────────────────┐
  generation (spans      │  CONTEXT LEDGER + DM-AUDIT (append-only)  │  every proposal+decision,
  ALL 33, no taint) ────▶│  the immutable record under everything    │  evidence-shown-at-approval
                         └──────────────────────────────────────────┘
            │
   produces a client-bound artifact?
            ▼
  ┌──────── 9.1 DRAFT-BOUNDARY CLEARANCE GATE (gate.py) ────────┐    UNBYPASSABLE.
  │  3 rules · GATE-1..5 table · claims-register-or-INVALID    │    no send path bypasses it;
  │  cross-client HARD-FAIL · escalation taxonomy (never auto) │    bypass = forbidden, blocked, logged
  └────────────────────────────┬───────────────────────────────┘
                               ▼  drafts/ (Gmail Draft; human sends)   ── governed by ──▶  9.3 SEND LADDER (rung 0→3)

  ┌──────── 9.2 WRITE-GUARD (on EVERY mutation) ───────────────┐    enforces ownership matrix
  │  ownership matrix · human-only-fields · immutability       │    + human_only_fields carve-outs
  └────────────────────────────┬───────────────────────────────┘    ── governed by ──▶  9.4 WRITE LADDER (per class)
                               ▼
  ┌──────── 9.5 CONCURRENCY (single-writer, enforced) ─────────┐    by-construction PRIMARY;
  │  owner: frontmatter · disjoint partition · lock · no-RMW   │    lock = crash/reentrancy guard
  └────────────────────────────┬───────────────────────────────┘
                               ▼
  ┌──────── 9.6 MULTI-AGENT (single-writer NOW; gated fleet) ──┐    read-only subagents now;
  │  read-only intel subagents · inverted task-queue           │    2nd writer ONLY behind the gate:
  │  GRADUATION GATE: 8 green weeks + DSS-matrix + disjoint     │    9.7 danger-zone forbidden-ops list
  └──────────────────────────────────────────────────────────┘
```

`_system/ownership.md` and `_system/clearance/` are the **single enforcement surface**: the write-guard and `gate.py` read them as data, and the L0 capability audit (§4) re-checks the forbidden-ops list before any new write surface is built.

-

### 9.1 The draft-boundary clearance gate (`gate.py`) - kept wholesale from AM Brain, made unbypassable

This is the one safety capability Jack's production system **entirely lacks** [Jack §17 is write-side only], and the catastrophic failure mode for a 33-client book is one client's data in another's send. AM Brain's gate is kept verbatim [AM I-6 / SPEC §8]; the only Jack contribution is _framing_ - promoting "gate bypass" into Jack's danger-zone catalog as a forbidden, loud-failing operation so there is no send path that does not traverse `gate.py`.

**The 3 rules** (enforced at the draft boundary, every client-bound artifact) [AM §10]:

1. **Single-recipient taint** - a draft may carry data from _exactly one_ client (its recipient). Cross-client content in one send → **BLOCK** (TEST-8). Applies to _outbound only_; internal analysis spans all 33 freely (no taint, destination = operator).
2. **No leak of sensitive figures** - no raw spend / WoW% to a client; any proof point without a cleared source renders `[NEEDS CLEARED BENCHMARK]`; the model MUST NOT improvise a benchmark.
3. **Drafts-only** - the agent writes a Gmail Draft; the human sends. Nothing auto-sends at launch (rung 0).

**Backed by the full GATE-1..5 decision table** (claim-type × source-class), default-deny [AM SPEC §8]. This is the machine-checkable core; it is _the_ answer to "may this number leave the building":

```
GATE-1  default-deny: an unclassified chunk/evidence object = internal_only.
GATE-2  decision table (claim type × source class), applied to EVERY outbound draft:

┌────────────────┬───────────────────┬──────────────────────────┬───────────────┬───────────────┬──────────────────┐
│ claim type     │ client_specific   │ aggregate_benchmark_     │ client_safe   │ internal_only │ policy_sensitive │
│                │ (same client)     │ cleared                  │               │               │                  │
├────────────────┼───────────────────┼──────────────────────────┼───────────────┼───────────────┼──────────────────┤
│ performance    │ ALLOW cited       │ ALLOW approved phrasing   │ n/a           │ DENY          │ DENY             │
│ product        │ n/a               │ ALLOW                     │ ALLOW cited   │ REWRITE/DROP  │ DENY             │
│ benchmark      │ n/a               │ ALLOW approved only       │ DENY          │ DENY          │ DENY             │
│ policy         │ n/a               │ n/a                       │ quote/link    │ DENY          │ quote/link only  │
│ billing        │ ALLOW (own data)  │ n/a                       │ ALLOW (FAQ)   │ DENY          │ DENY             │
│ recommendation │ ALLOW ≥1 valid    │ ALLOW as support          │ ALLOW support │ DENY          │ DENY             │
│                │ evidence + effort │                          │               │               │                  │
└────────────────┴───────────────────┴──────────────────────────┴───────────────┴───────────────┴──────────────────┘

GATE-3  pipeline: parse draft into claims → classify type → check provenance vs table →
        freshness (DM-6 shelf-life; expired evidence EXCLUDED) →
        cross-client check (any client_specific provenance from a DIFFERENT client = HARD FAIL, TEST-8) →
        rewrite step (internal phrasing → external register, preserving cited values;
                      if no compliant phrasing exists, DROP the claim + flag the gap to the operator).
GATE-4  results recorded in the draft envelope clearance_check + DM-AUDIT;
        a rejection MUST state WHICH claim and WHICH rule (GEN-2).
GATE-5  the cleared-benchmark library + clearance rulings are OPERATOR-supplied (_system/clearance/);
        the model MUST NOT improvise them.
```

**Claims-register-or-INVALID** [AM DM-14]: every `[n]`-marked claim in a draft body maps to a row in a claims-register table (evidence object + clearance verdict); a draft missing its register is **INVALID** and cannot reach `pending_approval` (TEST-7).

**Analysis numbers are gated too** [synth, §7 seam]: each field of every `AnalysisResult` from §7's deep analyses is _born_ with a `clearance_by_field` class (default `internal_only`, GATE-1). `gate.py`'s claim parser recognizes analysis-derived numerics and checks `clearance_by_field`. So a modeled "you can scale ~35% before CPA degrades" is `client_specific` cited (shareable, with confidence); a portfolio revenue-commentary or lever-vs-book number is `internal_only` and hard-fails to a client. An `[UNCALIBRATED CURVE]`-banner'd analysis (`calibrated=false`) MUST NOT enter a client draft at all.

**Escalation taxonomy - NEVER autonomous** [AM OUT-4]: account suspensions / policy strikes, legal/compliance topics, spend commitments beyond AM authority, and angry-client sentiment produce an **internal escalation summary**, not a client draft. The gate routes these to the operator; the agent never composes the outbound for an escalation-class topic.

**Unbypassability** [Jack §17 framing → [synth]]: `gate-bypass / direct-send-without-gate` is the first entry on the catastrophic forbidden-ops list (§9.7). It is treated like a `DM-9` write violation: blocked, logged to `DM-AUDIT`, and surfaced loud. Every `gate_pass`/`gate_reject` is a `DM-AUDIT` append-only entry preserving the evidence shown at approval time [AM SEC-4] - so the send-side and write-side governance share one immutable log.

> **Ruling - gate stays whole, no trade-off.** This is a pure capability asymmetry, not a conflict: AM Brain has the gate, Jack does not. We keep AM Brain's gate verbatim and use Jack's danger-zone _methodology_ (immutable audit + explicit catastrophic-forbidden-ops list) to make it unbypassable and permanently recorded - which Jack's framing does better than AM Brain's prose.

-

### 9.2 The write-guard - ownership matrix + human-only-fields + immutability, enforced on every write

Jack's per-section ownership table [Jack §12] is _machine-checkable documentation of write authority_ - strictly better than AM Brain's prose principle [AM I-5]. AM Brain's _field-level_ grain [AM DM-13: freeze `trust_level` even inside a `/capture`-owned file] is _finer_ than Jack's section grain. The synthesis combines them: **a matrix keyed `skill × (file + protected-field-list)` with an explicit write-mode, enforced by a write-guard on EVERY mutation.** The decomposed dossier (§5) means the _file boundary is the ownership boundary_, which is cleaner than enforcing section-parsing inside Jack's monolithic `context.md`; the three things we import from Jack are the **write-mode vocabulary**, the **human-only-field enumeration**, and the **immutability rule**.

**`_system/ownership.md` - the machine-readable contract** (the write-guard reads this as data):

```yaml
# keyed skill × (path + protected fields); write_mode ∈
#   {overwrite-free | append-only | create-only | rewrite | propose-under-suggested | confirm}
files:
  - {
      path: "clients/*/performance.md",
      owner: engine,
      class: generated,
      write_mode: overwrite-free,
      human_only_fields: [tier, scorecard_status, status],
    }
  - {
      path: "clients/*/rs-ledger.md",
      owner: engine,
      class: append-only,
      write_mode: append-only,
      human_only_fields: [impact_override, ease_override],
    }
  - {
      path: "clients/*/relationship.md",
      owner: engine,
      class: am-confirmed,
      write_mode: confirm,
      human_only_fields: [trust_level, current_mood],
    }
  - {
      path: "clients/*/interactions/raw-*.md",
      owner: engine,
      class: append-only,
      write_mode: create-only,
      human_only_fields: [],
    }
  - {
      path: "clients/*/commitments.md",
      owner: engine,
      class: append-only,
      write_mode: append-only,
      human_only_fields: [],
    }
  - {
      path: "clients/*/narrative.md",
      owner: sweep,
      class: authored,
      write_mode: append-only,
      human_only_fields: [],
    }
  - {
      path: "clients/*/profile.md",
      owner: human,
      class: human-owned,
      write_mode: propose-under-suggested,
      human_only_fields: ["*"],
    }
  - {
      path: "clients/*/style.md",
      owner: human,
      class: human-owned,
      write_mode: propose-under-suggested,
      human_only_fields: ["*"],
    }
  - {
      path: "clients/*/context.md",
      owner: brain-build-job,
      class: generated,
      write_mode: overwrite-free,
      human_only_fields: [],
    } # auto-built rollup; human READ-ONLY
  - {
      path: "_system/registry.yaml",
      owner: setup,
      class: human-owned,
      write_mode: confirm,
      human_only_fields: [tier, in_portfolio, status, search_aliases],
    }
  - {
      path: "logs/*.jsonl",
      owner: writer,
      class: append-only,
      write_mode: append-only,
      human_only_fields: [],
    } # single designated appender (§9.5)
```

**The four ownership classes** [AM DM-8] map onto Jack's write-modes [Jack §12]:

| Class            | Files                                                                                       | Agent may                                          | Operator role           | Jack write-mode |
| ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------- | --------------- |
| **human-owned**  | profile strategy, style seed, config targets, registry `tier`/`in_portfolio`/aliases        | propose diffs under `suggested:` only              | author, approve         | Propose         |
| **AM-confirmed** | `relationship` trust/mood, contact merges, past-record corrections                          | write under `suggested:{}`, operator confirms each | confirm each change     | Propose→confirm |
| **generated**    | scorecard, coverage, performance, rs-ledger, analyses, rs-queue, `context.md` (both levels) | overwrite freely (regenerable)                     | spot-check              | Overwrite       |
| **append-only**  | `interactions/raw`, commitments, rs-ledger history, narrative, logs                         | append only; correct via tombstone, never edit     | correct via new entries | Append          |

**Three Jack imports that close real holes:**

1. **Human-only-field carve-outs** [Jack §12 → enumerated]. AM Brain's "generated → overwrite freely" is true for the _file_ but **false for specific human-set fields living in it**. Jack learned in production that `status`/`tier`/`scorecard_status` and RS `impact_override`/`ease_override` live inside engine-regenerated files and must be carved out. The write-guard hard-blocks any agent write to a field in `human_only_fields` - so a regenerated `performance.md` cannot flip a human-set `tier`, and an RS re-banding pass cannot touch a human override. This closes a silent-overwrite hole `DM-8` leaves latent [verdict: "the ruling's strongest original contribution"].
2. **Immutability of `interactions/raw`** [Jack §12 → enforced]. These are `write_mode: create-only`: any write to an _existing_ interaction-raw path is **BLOCKED + logged** (extends DM-9/TEST-12). Corrections go in a **new** tombstone-referenced entry `not_true:<claim>; do_not_rederive:true` [AM DM-10], never an in-place edit - a CI record edited after the fact silently rewrites the history the pacing engine (ALG-1) counts.
3. **`trust_level`/`current_mood` change ONLY on operator confirm** [AM DM-13]: the agent records suggestions under a `suggested:` block until confirmed (TEST-12). Field-level grain beats Jack's section grain precisely here - these fields live _inside_ a `/capture`-owned file but must never graduate to auto-write.

**The write-guard procedure** (runs before every mutation):

```
write_guard(actor, path, field?, mode):
  1. resolve ownership row for path (glob match against ownership.md)
  2. assert mode == row.write_mode                          else BLOCK + DM-AUDIT(write_blocked)
  3. if field ∈ row.human_only_fields and actor == agent    → BLOCK + DM-AUDIT + park under suggested:
  4. if row.write_mode == create-only and path exists       → BLOCK + DM-AUDIT (immutability)
  5. if actor == human and row.class == generated           → BLOCK (auto-built file; human read-only)
  6. if path == _system/registry.yaml                       → schema-validate BEFORE write (corruption SPOF)
  7. concurrency precondition (§9.5)                         else BLOCK
  8. write; bump updated_at; DM-AUDIT(file_write); git-commit (authored tier) or stamp fetched_at (mirror)
```

> **Substrate note (verdict correction).** Under the §3 storage ruling the AUTHORED tier is files+local-git and the MIRROR tier may ride the host-reachable store. The ownership _classes + write-modes + human_only_fields are the contract_; the **enforcement binds to `owner:`/`human_only_fields` frontmatter** on whatever the canonical store is - the path-glob form above is how it is expressed on the file tree, and re-expresses cleanly as frontmatter if a regenerable tier ever sits on an MM2 read-projection. The write-guard reads ownership metadata, not raw filesystem path-globs, when the canonical is a memory API.

-

### 9.3 SEND autonomy ladder - draft-only at launch, numeric graduation, permanent caps

The first of **two** ladders. AM Brain's send ladder [AM OUT-5/OUT-6] is the higher-quality artifact (Jack has no graduation model at all - his outbound is implicitly always human-sent, with no defined path or numeric criteria). It is kept, with one correction the verdict forced: the graduation gate is scoped to **N-consecutive-clean-sends-in-category** rather than a fixed weekly-sample, so it is _satisfiable at solo send volume_ [I-9 correction].

| Rung                              | Categories                                                 | Advancement gate                                                     |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| **0 draft-only** (launch default) | **everything**                                             | n/a                                                                  |
| **1 one-tap approve**             | follow-up nudges, meeting confirmations, report deliveries | **N consecutive clean sends in category** (was "4 wk >90% unedited") |
| **2 batch approve**               | cadence follow-ups, routine cited answers                  | sustained rung 1 **+ zero clearance failures in QA**                 |
| **3 auto-send + notify**          | confirmations + scheduled report sends **ONLY**            | explicit policy sign-off **+ instant recall + weekly audit**         |

**Permanent caps** [AM OUT-6]: pitches, objection-handling, numeric claims, and emotionally-loaded messages are capped at **rung 1 forever**. Rung state is configuration in `_system/clearance/`; it is **never self-granted** - graduation requires an operator action and (for rung 3) explicit policy sign-off. Channel policy rides on top: WhatsApp drafts check the 24h service-window per thread (outside it, approved templates only); opt-in state must be known per contact [AM OUT-3].

-

### 9.4 WRITE autonomy ladder - the symmetry AM Brain under-specified

AM Brain conflated "autonomy" with "send autonomy." Jack's ownership matrix is, in effect, a **write-autonomy specification** ("generated = auto-overwrite; human-owned = propose-only"). Making the second ladder explicit closes that gap and gives the operator a single complete view of _what the agent can do without me_ across **both** dimensions [synth, derived from Jack's matrix].

| Write rung         | File class                                                                             | Agent authority                            | Graduates?                               |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| **rung 3**         | generated (scorecard, coverage, performance, rs-ledger, analyses, `context.md`)        | overwrite freely                           | already there day one (regenerable)      |
| **rung 2**         | append-only (interactions/raw, commitments, rs-ledger history, narrative, logs)        | append autonomously, never edit/delete     | stays rung 2 (immutability is permanent) |
| **rung 1**         | AM-confirmed (`relationship` state, contact merges)                                    | suggest under `suggested:`, human confirms | stays rung 1                             |
| **rung 0**         | human-owned (profile, style, config, registry human fields)                            | propose diffs only                         | **never**                                |
| **rung 0 forever** | `human_only_fields` (`trust_level`, `current_mood`, `tier`, `status`, RS `*_override`) | never write                                | **never**                                |

Both ladders live in `_system/ownership.md` (write) + `_system/clearance/` (send) so the full autonomy surface is legible in one place. Note the asymmetry that makes this safe: generated files are _born_ at write-rung 3 because losing or clobbering them costs nothing (they regenerate from the SoR next run, §5/§8), while the durable authored tier - the truth that compounds - is permanently propose-or-confirm-only.

-

### 9.5 Concurrency - single-writer-by-construction, enforced as defense-in-depth

AM Brain's REV3 dropped locks because it dropped multi-writer - internally consistent, but "one logical writer" is **not** "one process at a time": the scheduled cron and an interactive operator session both mutate the store and can overlap (REV3 itself flags MM2 eventual-consistency + "cron never read-modify-writes a human file"). Jack's `mkdir`-atomic lock [Jack §15] is dead-simple, POSIX-atomic, and production-proven, and it _prevents_ the collision Jack's manual calls catastrophic ("Edit files without acquiring lock → last-write-wins = data loss").

The verdict's decisive correction: **on an eventually-consistent store an API lock is only probabilistic** (a second writer may not observe a just-written sentinel for minutes), so the lock is **not** the guarantee. The real guarantee is _by construction_. State the concurrency model as **defense-in-depth with explicit precedence**:

```
PRIMARY  (a) single-writer BY CONSTRUCTION:
             the cron is the SOLE scheduled writer; human edits arrive via a DIFFERENT surface
             (Collab Files / interactive session) that the cron never read-modify-writes.
             → there is structurally one writer-of-record per file.

         (b) owner: frontmatter — static single-writer-PER-FILE policy [REV3].
             every file declares its owner skill; the write-guard refuses a write whose actor
             is not the declared owner (modulo propose-under-suggested for human-owned files).

         (c) disjoint writable partition — the FUTURE conflict-eliminator (§9.6).
             when/if a 2nd writer is admitted, no two writers share a writable path,
             so there is no shared file to race.

DEFENSE  (d) advisory atomic lock — crash/reentrancy guard + FAIL-LOUD, NOT a mutex:
             filesystem (authored tier / backup mount):  mkdir am-brain/.locks/<file|run>.lockdir
             memory-API (any regenerable read-projection): a lock sentinel {locked_by, locked_at}
             stale policy: age > LOCK_STALE_MIN (default 10 min, in config.md) → assume crashed,
                           release + proceed.  ALWAYS release on exit (trap), including failure paths.
             grain: per-FILE for human/append/am-confirmed files; per-RUN for the generated/ bundle.
             .locks/ and .git/ are EXCLUDED from any MM2 projection.

BACKSTOP (e) cron-never-RMW-a-human-file [REV3] — scheduling rule that closes the window where
             the lock's eventual-consistency propagation race could otherwise leak.
```

What each layer defends (so the lock is never oversold as the mutex): **(a)+(b)** give the single-writer-of-record invariant; **(c)** removes the conflict entirely in the multi-writer future; **(d)** catches the one realistic _launch_ contention - the cron firing while a long interactive run is mid-write (same owner, overlapping runs) - and makes a future fleet member that tries to write hit the lock and **fail loud** (Jack-catastrophic) rather than race silently; **(e)** is the belt to the lock's suspenders on an eventually-consistent store.

**`.git` MUST reside on local disk**, never on the cloud FUSE mount (§3 ruling, invariant L1-DUR); the working tree may be on the mount, markdown one-way-synced to it. The per-run `git add -A && git commit` on the authored tier is the continuous history; the nightly off-host `git bundle` + `git fsck` tripwire is DR.

**Shared append-only logs** (`event-log.jsonl`, `context-ledger.jsonl`, `audit.log`) need a **single designated appender or atomic-append** [verdict gap]: the disjoint-partition rule (§9.6) covers overwrite/RMW conflicts but **not** concurrent appends to one log. The `logs/*` ownership row names `writer` as the sole appender; any other actor that must record an event routes it through the writer (or an OS-atomic `O_APPEND` write), never an independent open-modify-close.

**No bidirectional merge, ever** [AM I-7]: there is one canonical store; the optional API/memory projection is one-way, read-only, regenerable, never written back. Jack's additive LLM merge is **demoted from a scheduled loop to a manual recovery tool** `/brain:recover-merge` (§3) - invoked only on a detected divergence, additive, deterministic-contradiction-resolution (canonical wins), diff-confirmed before commit. This keeps Jack's documented recovery _value_ (a lost edit goes from permanent to recoverable) while removing the always-on silent-loss/fabrication surface AM Brain rejects.

> **Ruling.** Single-writer-by-construction + `owner:` frontmatter is the guarantee; the `mkdir`/sentinel lock is defense-in-depth (crash/reentrancy + fail-loud) and the ready-made primitive the gated future reuses. We drop Jack's bidirectional merge and his multi-live-writer fleet (they exist solely to serve concurrent multi-daily-driver writes a solo AM lacks), and keep his lock, task-queue seam, file-health limits, and validate-before-write registry as the production-hardened concurrency layer.

-

### 9.6 Multi-agent - single writer now, gated fleet future

**Decision: single-operator-now with a gated-multi-agent-future.** This is the highest-evidence call in the corpus and the one most at risk of rubber-stamping either parent, so it is stated explicitly with its grounding.

**The evidence.** Cognition's _Don't Build Multi-Agents_ (P12, 3-0 adversarially verified): parallel writers make conflicting decisions because **actions carry implicit decisions sub-agents can't see** [ext]. Independently corroborated by Anthropic's production multi-agent research system: the lead agent writes, subagents are read-only and run synchronously _precisely because_ concurrent writes add coordination complexity [ext]. And the only production fleet datapoint - Jack's 5 concurrent writers - is itself the **cautionary** case: his fleet _works only by papering over write races_ with the bidirectional additive-merge that AM Brain's I-7 correctly rejects (his own manual: "Metamate's changes are LOST unless LLM merge recovers them" [Jack §10/§16]; the 164-silent-run disaster was _personal + bidirectional + silent_). So adopting Jack's fleet _now_ would re-import the exact merge REV3 spent itself removing.

**NOW (launch):**

- **Exactly one logical writer** - the engine + the interactive session that owns the run [AM ORCH-1].
- **Read-only intelligence subagents** [AM ORCH-2]: `evidence-finder` (signals per RS), `benchmark-fetcher` (cleared library), `meeting-prep researcher`, **plus** the read-only mobile-lookup role (Jack's MyClaw/MetaClaw - reads the same store). They return **distilled conclusions + source refs**; they MUST NOT draft outbound or write files. This keeps _all_ of Jack's read-parallelism (the value) while deferring only write-parallelism (the unproven-needed risk - over 33 accounts serialized per-client (ORCH-3) behind a ~90%-cheap-exit Tier-2 filter, the bottleneck is human review under rung-0, not write throughput).
- **Inverted task-queue** [Jack §11 → [synth]]: Jack's queue lets a _second agent act_ (re-importing the conflict). Inverted, it is the channel by which a read-only agent **requests a write from the single writer**, never acts as a second writer:

```jsonl
// logs/task-queue.jsonl  (present-but-empty at launch; the contract exists, the machinery is latent)
{"id":"tq-001","from":"mobile-lookup","to":"writer","action":"append-quick-note",
 "payload":{"slug":"acme","text":"client moved QBR to next wk"},
 "status":"requested","requested_at":"2026-06-09T14:02","claimed_by":null,"completed_at":null}
```

**THE GRADUATION GATE - a true second WRITER is admitted ONLY when ALL hold** [synth, reusing the parents' own Phase-5 criteria]:

```
(a) 8 CONSECUTIVE GREEN WEEKS on the LOOP metrics (§13)
    — the same threshold SPEC §15 Phase-5 and the v2 research doc already require.
(b) Agent IO Security DSS × Destination matrix + delegation-laundering rules IMPLEMENTED
    — deferred at launch (AM §10), a hard PREREQUISITE for any 2nd writer.
(c) DISJOINT writable PARTITION — no two writers share a writable PATH —
    verified against the ACTUAL skill→agent map, NOT asserted.
(d) NO single generated file has two agent-writers under that map.
    (Jack's context.md had 4 section-writers; the §5 decomposition makes file-disjoint
     achievable, but the gate MUST verify it for the concrete fleet config.)
```

The disjoint-partition rule is what makes the merge **unnecessary**: writers never touch the same file, so there is no conflict to merge - which is exactly what lets a second writer return _without_ Jack's silent-loss merge. Concretely, when admitted, a mobile-capture agent might own **only** `interactions/raw/` + a quick-note inbox, never `clients/*/profile` or `generated/`. Until the gate clears, the only cross-actor lane is the inverted request-queue draining to the single writer. (Re-opening `canonical = MM2` is a separate, deliberate future fork, gated independently on MM2's cap/retention/silent-stop all being closed - §3.)

> **Why this beats both parents.** It keeps Cognition/Anthropic's single-writer correctness AND Jack's production-hardened coordination machinery (locks, task-queue, ownership partition, danger-zone) as latent infrastructure, and graduates only behind a numeric + structural gate that dissolves the very conflict Jack's merge exists to paper over. Neither parent's failure mode (conflicting parallel writers / silent merge loss) is inherited.

-

### 9.7 The machine-checkable danger-zone - forbidden-ops list

Jack §17 is a production failure catalog AM Brain lacks as a consolidated artifact. Promote it from prose into a **machine-checkable forbidden-ops list** in `_system/ownership.md` - read as data by the write-guard and re-checked by the L0 capability audit (§4) before any new write surface is built. Each **CATASTROPHIC** op is agent-FORBIDDEN, loud-failing, blocked + logged.

```yaml
# _system/ownership.md  →  danger_zone:
catastrophic: # immediate, irreversible loss — agent FORBIDDEN, blocked+logged
  - gate_bypass / direct_send_without_gate # NO send path bypasses gate.py            (§9.1)
  - autonomous_delete_of_any_brain_file # deletion is OPERATOR-ONLY                 (§9.7 below)
  - in_place_edit_of_immutable_interaction # interactions/raw is create-only           (§9.2)
  - wholesale_overwrite_of_human_owned # profile/style/config — propose only       (§9.4)
  - corrupt_registry # schema-validate registry.yaml before write (§9.2 step 6)
  - second_agent_write_outside_partition # disjoint-partition violation               (§9.6)
degradation: # drift over time — watch-list, surfaced in cockpit hygiene (ALG-7)
  - file_over_100KB # MM2 ceiling / context saturation
  - nesting_over_3_levels # interactions/raw-<date>-<type>.md = flattened to ≤3 (§5)
  - stale_lock # > LOCK_STALE_MIN
  - unconfirmed_relationship_suggestion # > 14 days (ALG-7)
  - token_expired # tunnel/auth credential lapsed (loud fail, not silent zero)
```

**Two catastrophic ops earn their own enforcement detail:**

**The agent NEVER deletes** [Jack §17 → enforced as an agent-capability boundary]. Autonomous deletion is the highest-blast-radius operation with no upside - the operator can always delete. So deletion/archival that _removes from the live tree_ is operator-only, with one carefully-gated exception:

```
DELETE        → operator-only. The monthly stale-context review is a cockpit DELETE-CANDIDATE
                hygiene QUEUE (ALG-7) the human approves — NOT an autonomous delete.
ARCHIVE (move raw → monthly digest → archive/) is MOVE-not-delete and may run autonomously
                ONLY when the period's recovery is CONFIRMED:
                  backup_confirmed(period) ≜ git commit hash present for the period
                                              AND nightly off-host bundle timestamp within N hours.
                If either is unconfirmed → archival DOWNGRADES to a delete-candidate the human approves.
```

This is the genuine AM Brain advantage over Jack: Jack _hoards_ (never-delete-anything) because his additive-only sync can't safely propagate a delete; AM Brain has git + off-host bundle, so it can **archive safely** (bloat control is real - DM-11; oversized files saturate context and breach the store's per-file ceiling). We take Jack's immutability + no-autonomous-delete _floor_ and add AM Brain's recovery-enabled hygiene _ceiling_ - with the `backup_confirmed` check making the move provably reversible before it removes anything from the live tree [verdict correction].

**Registry is the corruption single-point** [Jack §6/§17 + AM]. `_system/registry.yaml` is the single file whose bad write breaks every account lookup. It is schema-validated on every load _and before every write_ (write-guard step 6), write-locked, and git-committed. It holds only **stable** join-keys (`slug`, `display_name`, `crm_name`, `search_aliases[]`, `status`, `in_portfolio`, `tier`, `org_id`, `account_team_id`, `ad_account_ids[]`, `sfid`, `narrative_path`, `narrative_source_url?`, `dossier_path`); volatile counts (`rs_count`, `scorecard_status`, `data_freshness`, `confidence`) are **excluded** (generated, live in the per-account `context.md` header + scorecard) - a master mutated on every count change is the write-amplification + single-point-corruption hazard Jack himself flags.

-

### 9.8 What was decided, and the open governance inputs

| Question                            | Ruling                                                                                                                                                                     | Provenance                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Outbound safety                     | Keep AM Brain's gate wholesale (3 rules + GATE-1..5 + claims-register + cross-client hard-fail + escalation taxonomy); make it unbypassable via Jack's danger-zone framing | [AM] gate + [Jack] framing                                      |
| Write granularity                   | Field-resolution ownership matrix = Jack's section table + AM Brain's field grain; write-guard enforces on every mutation                                                  | [AM I-5/DM-13] + [Jack §12]                                     |
| Human-set fields in generated files | Enumerate as `human_only_fields`; hard-block agent writes (closes the latent DM-8 hole)                                                                                    | [Jack §12] → [synth]                                            |
| Immutability / deletion             | Jack's immutable-interactions + agent-never-deletes floor; AM Brain's git-backed archive ceiling, gated on `backup_confirmed`                                              | [Jack] floor + [AM] ceiling                                     |
| Autonomy                            | **Two** explicit ladders (SEND rung 0→3 with permanent caps; WRITE per-class); never self-granted; SEND gate = N-consecutive-clean                                         | [AM OUT-5/6] + [synth] WRITE ladder                             |
| Concurrency                         | Single-writer-by-construction + `owner:` frontmatter (PRIMARY); lock = defense-in-depth, fail-loud, NOT a mutex; no bidirectional merge                                    | [AM I-7/ORCH-1] + [Jack §15] + [ext]                            |
| Multi-agent                         | Single writer + read-only intel subagents NOW; true 2nd writer ONLY behind 8-green-weeks + DSS-matrix + disjoint-partition + no-two-writers-per-file                       | [AM ORCH-1/2] + [Jack latent infra] + [ext Cognition/Anthropic] |
| Danger-zone                         | Promote Jack §17 prose to a machine-checkable catastrophic + degradation forbidden-ops list, re-checked by L0                                                              | [Jack §17] → [synth]                                            |

**Blocking / open governance inputs** (carried to §14):

- **`human_only_fields` enumeration is incomplete** - which operator-set fields beyond `tier`/`status`/`scorecard_status`/RS-overrides must be carved out of generated overwrites is blocked on the same lost-77-line scorecard paste as calibration (AM §14). Until supplied, the enumerated set above is the floor, not proven-complete.
- **Lock atomicity on a memory-API store is unverified** - does the regenerable-tier projection (if ever on MM2) expose a compare-and-create / ETag primitive sufficient for even an _advisory_ sentinel, or is the lock reliable only on the filesystem/backup side? "Unknown ≠ zero" - gate any MM2-writer on verifying it; the filesystem `mkdir` lock is the proven fallback.
- **Disjoint-partition boundary for the future second writer is unspecified** - the concrete writable partition (e.g. mobile-capture owns _only_ `interactions/raw/` + quick-note inbox) must be specified _before_ admission, not at admission.
- **DSS × Destination matrix integration vs build** - does Meta's Agent IO Security framework expose a concrete API/enforcement hook `gate.py` can call, or must the gate re-implement the matrix? Determines whether prerequisite (b) of the graduation gate is integration or build.
- **Inverted task-queue latency** - Jack drains his queue every 3h; a 3h write-request latency may be unacceptable for a mobile quick-correction. Needs a faster claim loop, or a narrow direct-write exception under its own disjoint partition.
- **`backup_confirmed` check precision** - the exact predicate (git commit hash present for the period AND off-host bundle timestamp within N hours) must be pinned, or autonomous archival re-opens the silent-loss risk it exists to close.

The full section is also written to `/Users/jasonli/switchboard/docs/research/meta-am-brain/_synthesis/section-9-safety-governance.md`.

## 10. Runtime, scheduling & host

This section specifies what _fires_ the loop, how the funnel keeps the daily driver cheap, how failure is made loud, and how the host evolves from a laptop you open each morning to a fully unattended scheduler - **without ever degrading the store** (the L1 ruling in §3 fixes _where state lives_; this section only governs _what wakes it_). The governing rule is **decouple where-state-lives from what-wakes-the-loop** [synth]: REV3 conflated them and let the scheduler dictate the system of record; here the canonical AUTHORED tier stays files+local-git regardless of host, and only the regenerable MIRROR tier ever rides the host-reachable store (per I-7/§3).

### 10.1 Scheduler topology - three independent timer roots

All cadences are named constants in `config.md` under `config.md.runtime.*`; no magic intervals in code.

| Root                                     | Fires                                         | Gating                                                                        | Body                                                                                                                                                          | Provenance                       |
| ---------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `DAILY_DRIVER` (Tier1)                   | 07:00 SGP, weekdays                           | `_system/working_calendar.json` (SGP public holidays); weekend/holiday → exit | the Tier2→Tier3 funnel (§10.2)                                                                                                                                | [AM] tiered poll                 |
| `TRANSCRIPT_SWEEP` (independent Tier1)   | every **12h**, unconditional                  | none - **bypasses Tier2**                                                     | ingest any meeting inside the trailing **96h** CRM access window → `narrative.md`                                                                             | [AM] 96h sweep                   |
| `HOUSEKEEPING`                           | weekly (Mon 06:30 SGP) + monthly (1st, 06:30) | none                                                                          | weekly: ALG-7 hygiene + coverage sweep + cron re-arm + **HEALTH CHECK** (§10.4); monthly: stale-context DELETE-CANDIDATE review (operator-approved, per I-12) | [AM]/[synth]                     |
| `TASK_QUEUE_WORKER` _(deferred ceiling)_ | every 3h                                      | present-but-empty                                                             | drains `logs/task-queue.jsonl`; inert until a graduated (rung>0) send must execute on a foreign surface                                                       | [Jack] §11, pre-wired by [synth] |

**Cadence vs window are different axes** [synth - resolves an AM-internal ambiguity]. AM Brain's own text said both "every 12h" (§7) and "96h sweep" (§3/§6). The settled reading: the sweep **fires** every 12h and each firing **ingests** any meeting inside the trailing 96h window. `SWEEP_INTERVAL = 12h`, `SWEEP_WINDOW = 96h`. Jack's CRM-note sync runs at **24h** [Jack] and that is safe _for him_ because his notes do not expire from the source; AM Brain's VC summaries **expire from the CRM at 96h**, so a missed run compounds. 12h × 96h = **8 independent capture attempts per meeting**, making any single missed run non-fatal - the cheapest robustness margin against the silent-stop failure class (§10.4).

**Heavy analytics are NOT in any funnel** [Jack - cadence-as-cost-control]. `/analyze` (ALG-9 health-check 180d, ALG-10 headroom, ALG-11 cpa-v-spend, ALG-12 levers) and `/refresh`'s analytics-kernel pulls run on **explicit monthly / pre-QBR / on-demand cadence**, never through Tier2. Rationale: there is no zero-cost local signal that predicts "a 180-day Presto diagnostic is due," so a Tier2 "precondition" check would itself need a Presto pull - forcing them through the gate is a _false economy_. AM Brain's funnel optimizes the high-frequency daily loop where a cheap precheck saves ~90% of LLM cost; Jack's frequency-tiering is the honest cost model for low-frequency heavy jobs. They are complementary, not competing (see §7 for the analyses themselves).

### 10.2 The tiered-poll funnel (the `DAILY_DRIVER` body)

```
Tier1  Schedule (FREE)
   cron fires → read working_calendar → holiday/weekend? → write "skip" heartbeat → exit
        │
        ▼
Tier2  Cache-diff filter (CHEAP · NO LLM · ZERO NETWORK)          ← gates ~90% of cheap exits
   in classifiers.py, advance days_in_stage LOCALLY from each RS's
   cached stage_entered_at  (NEVER modified_time — it moves on any
   edit and hides overdue RS; see §8 STATE-DIFF clock).
   Predicates, in order:
     (a) any RS crossing 14d or 28d attribution window?
     (b) any commitment overdue / due-today?
     (c) any meeting today?
   These three need ZERO I/O.  The only Tier2 predicates that need a
   pull are spend-cliff and new-CI: run them ONLY if (a)-(c) are clear
   AND a cheap-pull budget allows (§10.5 open).
   nothing due → write "no-work" heartbeat → exit silently
        │  work found
        ▼
Tier3  Agent wake (LLM — only when work found)
   1. pipeline.py: READ-ONLY no-CAT pulls, two kernel-separated legs
      (§8 data plane); standardized envelope; numeric-ID match first;
      registry IN(all ad_account_ids).  Failed pull → unknown (NEVER 0)
      + cron-errors.log line.
   2. classifiers.py: ALG-1 pace · ALG-2 cover · ALG-3 mix · ALG-4
      evidence · ALG-5 RS-rank (rules→numbers; low-conf → question)
      → generated/{scorecard,coverage,rs-queue}.md  (unknown≠0; CONF-1
      PACING UNCALIBRATED banner if uncalibrated).
   3. render.py: ALG-8 → generated/today.md (MUST-DO ≤3, OPTIONAL ≤7,
      rollover labeled).
   4. gate.py: 3 rules (single-recipient taint · no raw spend /
      [NEEDS CLEARED BENCHMARK] · drafts-only) → drafts/ Gmail Drafts.
   5. append event-log.jsonl + context-ledger.jsonl + heartbeat.jsonl;
      git commit; cron-errors.log on any failed pull.
```

The **zero-network local stage-clock** is the load-bearing cheap-correct mechanism: it advances `days_in_stage` from the cached `stage_entered_at` stamp (§8) with no I/O, which is the only way to detect the 14d/28d attribution-window and overdue-commitment crossings that drive _most_ must-dos without paying pull cost on the ~90% of days nothing is due [AM]. Jack pays full-skill cost every weekday `/morning` run [Jack]; he has no equivalent pre-gate.

**`TRANSCRIPT_SWEEP` body** (independent timer, analytics-capable kernel): for each meeting in the trailing 96h → fetch VC summary (`STREAM_A`, §8) + CRM AI-notes (`STREAM_B`, §8) → dedup / TZ-normalize / ownership-validate → append `clients/<slug>/narrative.md` → heartbeat row. The 96h window is a **hard data-expiry deadline**, so this sweep cannot be cost-optimized away and must not pass through Tier2.

### 10.3 `/cron` daemon discipline

Named guardrails on **every** timer root [AM], absent from Jack's manual:

| Guard              | Setting / rule                                                                                                                                                | Prevents                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Memory cap         | `RLIMIT_AS = 8GB`                                                                                                                                             | runaway pull/LLM memory blow-up                               |
| No double-fire     | persist `last_dispatch` per root in `logs/cron-state.json`; **refuse to fire if a prior run is unfinished**                                                   | overlapping `DAILY_DRIVER` + interactive session interleaving |
| Stagger            | root start times ≥ 1 min apart                                                                                                                                | simultaneous-fire contention                                  |
| Batch-and-assemble | **one** `today.md` per run, never partial                                                                                                                     | half-written cockpit on a mid-run crash                       |
| Kernel non-mixing  | the sweep runs on the analytics-capable kernel; the daily funnel's CI/calendar/email pulls run on the default kernel - **never mix kernels in one execution** | kernel-contention failures [Jack §13]                         |

The no-double-fire guard is the cron-level complement to the §3 single-writer-by-construction invariant + advisory lock: the lock defends crash/reentrancy _within_ a run; `last_dispatch` prevents a _second_ run starting while the first is mid-write.

### 10.4 Loud-failure / heartbeat discipline - the non-negotiable runtime contract

This is the single biggest gap in Jack's otherwise-mature production system [Jack has **none**: no heartbeat, no silent-stop mitigation, no 0-written check; his only invariant is "sync NEVER deletes," and §10 explicitly *accepts losing* Metamate's writes]. It is the lesson AM Brain paid for twice - the **164-silent-run** disaster (personal+bidirectional+silent) and the **~23-mission silent-stop** Automations bug - so it is adopted wholesale and made **host-portable** [AM, elevated to a contract].

**Per-run heartbeat.** Every scheduled run appends to `logs/heartbeat.jsonl`:

```jsonc
{ "run_id": "...", "root": "DAILY_DRIVER|TRANSCRIPT_SWEEP|HOUSEKEEPING",
  "tier_reached": 1|2|3, "started_at": "...", "finished_at": "...",
  "status": "ok|skip|no-work|hard-fail",
  "rows_written": <int>, "pulls_failed": ["spend", ...] }
```

**HARD-FAIL rule.** A run that writes **0 rows when Tier2 reported work-was-due** is a `hard-fail`, **not** a silent exit. `0-written-when-due = HARD FAIL` is the antidote to the silent-stop class (a timer that quietly dies still _looks_ like a clean "no-work" day otherwise).

**Weekly health check** (`HOUSEKEEPING`) asserts, and on any breach **pings the operator AND auto re-arms**:

| Assertion                                      | Threshold                                  | Catches                                                                      |
| ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| (a) recent `DAILY_DRIVER` heartbeat            | ≥ 1 in last **26h**                        | dead daily timer                                                             |
| (b) recent `TRANSCRIPT_SWEEP` heartbeat        | ≥ 1 in last **14h**                        | dead 12h sweep (with margin)                                                 |
| (c) cumulative run-count **strictly climbing** | week-over-week                             | the **~23-mission silent-stop** and any timer that quietly stopped advancing |
| (d) **token freshness**                        | tunnel/GraphQL token still valid           | an expired token surfacing as a _silent zero_ instead of a loud failure      |
| (e) **backup rows > 0**                        | nightly off-host `git bundle` reports rows | a silently-failing DR backup                                                 |

**Auto re-arm on breach** is host-specific: devserver → reinstall the timer; Automation nudge → delete/recreate (the documented remediation for the ~23-run stop). The health check is cheap (append-only log + five assertions) and runs regardless of which host is active - a daily driver the operator has _stopped watching_ MUST be loud on failure or it rots invisibly.

### 10.5 Host choice - reconciled with the §3 storage ruling

Because the §3 ruling keeps the **AUTHORED tier canonical as files + local-git** (the un-regenerable truth), the hosted-Automations path is **architecturally excluded for file I/O**: AM Brain's own L6 spike found Automations reach Drive by connector/API file-ID (not a FUSE mount), cannot read raw `.md` reliably, have **no git over the Drive-backed vault**, and cannot run `python3 -m engine.pipeline` natively (code must arrive via skillbook/scmquery/Dataswarm) [AM §11 REV3 finding]. The §3 tier-split dissolves the `{file+git canonical, hosted, unattended}` pick-two trilemma - but the trilemma still **binds the AUTHORED tier**, so the _AUTHORED writer's_ host must be one that can touch files+git. Hence a **two-host design keyed to the storage ruling**, optimized across all three lenses (ship-now / phased / ceiling):

```
                 SHIP-NOW (Phase 1)              MATURITY (Phase 3)
 AUTHORED writer  laptop launchd + FUSE+git  →   persistent devserver crontab
 (files+local-git) (interactive/on-demand)        (vault mclone-mounted; git on
                                                    LOCAL DISK per VERIFY-1)
 07:00 trigger    Metamate Automation NUDGE   →   (same nudge, optional)
 (laptop-closed)  (pings op / 1-cell Sheet;        OR the devserver fires itself
                   NEVER touches files)             unattended
 MIRROR tier      host-reachable store (MM2 read-projection permitted, §3) —
                  regenerable, 0-files-written heartbeat guard, NOT canonical
```

**SHIP-NOW - on-demand on the laptop** (AM Brain's own §11 option-3, the model's ship-now recommendation [AM]). macOS **launchd LaunchAgents** run `DAILY_DRIVER` (07:00 SGP weekdays) and `TRANSCRIPT_SWEEP` (every 12h) against the existing FUSE GDrive mount + local git + python. `/today` is also runnable interactively. **I-7 fully intact, zero infra, value ships day one.**

- Use **launchd**, not the harness `/cron`: harness cron is REPL-idle + 7-day-expiry, and OnDemand has an 18h reclaim - neither survives an unattended morning fire.
- **Caveat:** the laptop only fires while awake/plugged. Pair every ship-now deploy with the nudge below so a missed 07:00 is caught.

**Hosted trigger (both phases) - a tiny Metamate Automation as the 07:00 NUDGE** [synth, capturing Jack's hosted-scheduler-runs-laptop-closed strength cheaply]. It does **NOT touch files** - it pings the operator and/or writes a single "work-due?" cell to a Sheet the host reads, then the laptop (or devserver) runs the real funnel. This uses the hosted scheduler for the **trigger it is good at** without depending on the incompatible surface for **data**, sidestepping every Automations file-I/O incompatibility (no `.md`, no git, no `python -m`). It requires the **Confucius grant** [Jack §18 P4] - an explicit, easy-to-forget setup line because hosted-as-operator execution fails _silently_ when the grant lapses (see §10.6).

**MATURITY - persistent Meta devserver** crontab/systemd-timer (or MyClaw daemon) with the GDrive vault **mclone + systemd-mounted** (`gdrive-mount` skill) [AM REV2 path - the only fully-unattended, I-7-compatible host]. Tunnel pulls run natively as unixname `jasonljc`; keep `META_TRACING_DISABLE=1` (harmless on a datacenter host; saves ~75s on the Mac/VPN/IPv6 path). Gated on two opens:

1. **Provisioning request** - there is **no self-serve persistent devserver from the Mac** (the ondemand broker = ephemeral OD only); this is a separate request flow with unknown lead time and longevity/reclaim policy [AM §11 VERIFY-2]. The laptop+nudge bridge must carry production until it lands.
2. **VERIFY-1 (`git-in-mount`) closed for real** [AM §11, status ⏸ - untested]. **Invariant L1-DUR (from §3 ruling):** `.git/` **MUST reside on LOCAL DISK**, never on the cloud FUSE mount; the mount carries only the working tree (`.md`), one-way synced **TO** the mount. If `git commit` proves unreliable inside the mclone mount, the contingency is **git on local disk + rsync markdown to the mount** - the operator's own stated fallback. This closes the documented "Google Drive Sync corrupting git repositories" hole; the nightly bundle job runs `git fsck` as a corruption tripwire (loud-failure, §10.4).

**The MM2-canonical fork stays closed** (REV3 = canonical AUTHORED tier on Metamate memory) - re-open _only_ behind the operator's own flip-trigger [AM, now correctly gating the right direction]: **IF** MM2's ~100KB cap + truncation behavior, version-recovery/retention, and the silent-stop bug are **all** closed **AND** a redundancy story exists. This is a deliberate _future_ fork, not a workaround for an unprovisioned host - pinning canonical to MM2 just to satisfy one scheduler trades a durable store for an opaque late-beta one, the wrong variable to flex (§3).

### 10.6 Auth grant + token freshness

| Component                                                  | Auth model                                                   | Failure mode if it lapses                                                           | Mitigation                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Metamate Automation nudge (hosted-as-operator)             | **Confucius grant** [Jack §18 P4] - explicit L6 prerequisite | hosted run silently stops                                                           | nudge→operator latency monitored; health-check (c) catches the stop                              |
| Devserver crontab                                          | runs natively as `jasonljc` unixname - **no extra grant**    | -                                                                                   | -                                                                                                |
| Tunnel pulls (`jf graphql` → `xfb_presto`, employee token) | own credential lifetime                                      | expired token → **silent zero** (renders `unknown` per DM-4, but the _cause_ hides) | **token-freshness assertion in the weekly health check** (§10.4 d) surfaces it as a loud failure |

Jack having to _call out_ the grant [§18] is hard evidence that hosted-as-operator execution has an auth precondition that is easy to forget and fails silently when it lapses. Folding it into the explicit setup checklist **and** the weekly health-check token assertion converts a latent outage into a caught one.

### 10.7 Cross-agent task queue - pre-wired, inert at launch

At single-operator rung-0 launch the §3/§9 **single-writer** model is correct and a task queue is unnecessary (no second autonomous agent to hand off to) - adopting Jack's full **3h Task-Queue Worker** [Jack §11] now would be premature machinery. But the queue is the right answer to the **one real future need**: executing a _graduated_ send (rung > 0) on a surface the unattended host **cannot reach** (e.g. a GChat/WhatsApp send only Metamate can issue). So **pre-wire the seam now, activate later**:

- Keep `logs/task-queue.jsonl` **present-but-empty** with Jack's exact shape `{id, from, to, action, payload, status, requested_at, claimed_by, completed_at}`.
- Per §9, the queue is **inverted**: a read-only agent _requests_ a write from the single writer; it never acts as a second writer. The `TASK_QUEUE_WORKER` (3h) activates only when a graduated send needs a foreign surface.
- This avoids a later retrofit without paying complexity now (consistent with "no premature abstractions").

### 10.8 Ship-now vs maturity - the concrete schedule set

|                                                          | SHIP-NOW (day one, laptop)                                          | MATURITY (gates clear)                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DAILY_DRIVER` 07:00 + full Tier funnel                  | laptop launchd                                                      | **persistent devserver** (fully unattended)                                                                                                                                     |
| `TRANSCRIPT_SWEEP` every 12h                             | laptop launchd                                                      | devserver                                                                                                                                                                       |
| 07:00 hosted trigger                                     | Metamate Automation **nudge**                                       | nudge (optional) or devserver self-fires                                                                                                                                        |
| CRM-notes ingestion                                      | **inside** the 12h sweep (one sweep, not Jack's separate daily job) | same                                                                                                                                                                            |
| weekly hygiene + **health-check**; monthly stale-context | laptop                                                              | devserver                                                                                                                                                                       |
| `/analyze` (ALG-9/10/11/12) + `/refresh` analytics       | on-demand / pre-QBR                                                 | on-demand / pre-QBR                                                                                                                                                             |
| `TASK_QUEUE_WORKER` (3h)                                 | inert (file present, empty)                                         | **activate** once a graduated send needs a foreign surface                                                                                                                      |
| sweep tiering                                            | single 12h capture                                                  | _optional_ split into light 12h capture + deep 2×/day enrichment if `narrative.md` ingestion volume at 33 accounts demands it (mirrors Jack's light/deep tiers) - measure first |

**How the host evolves without degrading the store** [synth, the section's thesis]: the AUTHORED canonical (files+local-git) is _identical_ on laptop and devserver; only the _trigger_ and the _MIRROR-tier reach_ change as hosting matures. The ship-now laptop and the maturity devserver run the **same** `pipeline.py` / `classifiers.py` / `render.py` / `gate.py` against the **same** file tree with the **same** loud-failure contract. Nothing about graduating to unattended operation touches the system of record - which is exactly the property REV3 surrendered (by flipping canonical to MM2 to satisfy the scheduler) and that this design preserves.

> **Cross-refs:** the STATE-DIFF stage clock and two-kernel pull legs are specified in §8 (data plane); the engine functions ALG-1..13 in §7; gate.py and the single-writer/lock invariants in §9 (safety & governance); the L1 tier-split storage ruling and L1-DUR git-on-local-disk invariant in §3; the host-evolution gates appear again as Phase-3 deliverables in §12.

### 10.9 Open runtime questions (carried to §14)

- **`git-in-mclone-mount` untested** [AM VERIFY-1, ⏸]: must close before the Phase-3 unattended cutover; fallback = git-on-local-disk + markdown-rsync-to-mount.
- **Persistent-devserver provisioning** is an external dependency with unknown lead time and reclaim policy; the entire unattended path is gated on it; laptop+nudge carries production meanwhile.
- **launchd reliability asleep/on-battery**: does a LaunchAgent reliably fire 07:00 + the 12h sweep when the laptop sleeps? If not, the nudge is the _only_ laptop-closed coverage until the devserver exists - confirm nudge→operator→`/today` latency is acceptable.
- **Tier2 cheap-pull budget**: how often may the "cheap" filter pay one real spend-cliff/new-CI pull before it stops being cheap? Needs the spend-path VERIFY (2026-04 saw zeros) resolved so spend-cliff detection is trustworthy.
- **Sweep light/deep split** depends on `narrative.md` ingestion volume at 33 accounts - unknown until measured.
- **Confucius grant + token refresh cadence/expiry** is undocumented; the health-check token assertion (§10.4 d) needs the real expiry to set its threshold.

## 11. Provenance map - what each parent + external grounding contributed

The synthesis is a genuine fusion, not a winner-take-all. The clean way to see it: **AM Brain supplied the _spine_ (the laws and the tested engine), Jack supplied the _body_ (the named skills, the operational assets, the production-hardened concurrency layer), the synthesis supplied the _joints_ (the seams that let one parent's organs work inside the other's skeleton), and external grounding supplied the _spine X-rays_ (the evidence that settled the contested calls).**

### `[AM]` AM Brain - the contracts, the engine, the discipline

- **I-1 determinism-in-code** (extended to cover Jack's analyses) and **I-2 rules-first-numbers-last**.
- **I-3 unknown≠zero** + calibration honesty (CONF-1, `[NEEDS CLEARED BENCHMARK]`, the UNCALIBRATED banners).
- The **ALG-1..8 banded decision engine** (pacing/coverage/solution-mix/evidence/RS-rank/recovery/hygiene/cockpit) as tested pure functions.
- The **draft-boundary clearance gate** (`gate.py`: 3 rules + GATE-1..5 claim-type×source-class table + claims-register + cross-client hard-fail + escalation taxonomy).
- The **two-tier mirror/authored memory model** + structural freshness (fetched_at + shelf-life; staleness is structural, not policy).
- **Field-level ownership** (I-5/DM-13) + **single-threaded writer** (ORCH-1) + read-only intelligence subagents (ORCH-2).
- The **SEND autonomy ladder** (rung 0 draft-only, numeric graduation, permanent caps).
- The **one-canonical-store / no-bidirectional-merge PRINCIPLE** (I-7) - _corrected to tier-split, not rubber-stamped as bare-MM2._
- The **tiered-poll runtime** + independent 96h transcript sweep + the laptop **ship-now (option-3)** recommendation.
- The **Phase -1 capability-audit method** + the no-CAT `jf graphql→presto` data plane + l12-territory fallback + numeric-ID-match + `IN(all-ids)` 70%-undercount rule + the dead-end registry.
- Loud-failure / heartbeat durability guardrails (0-written=fail, verify-with-retry) elevated to a host-portable contract.

### `[Jack]` Jack's AM-OS - the operator surface, the assets, the production scars

- The **12 named invokable slash-skills** as the operator surface (reduced from his 14 by merges).
- The **per-section ownership matrix** with explicit write-modes + the **human-only-field carve-outs** (status/tier/scorecard_status/RS overrides) AM Brain left latent.
- The **deep-analytics suite as a capability** (health-check 180d trajectory, headroom log-curve, cpa-v-spend regression, P5/PBP levers, weekly revenue-commentary) - refactored to tested Python.
- The **enriched registry** (crm_name + display_name + status + search_aliases + resolution order `slug→name→crm_name→alias`) + **ACDP ad-account discovery** + named Presto spend tables + the Tier1/Tier2 fallback cascade.
- **Narrative dual-load discipline** ("consult BOTH structured context AND meeting notes") + provenance-clean CRM-note ingestion (dedup/TZ-norm/ownership-validate) + the `analyses/` folder as a durable artifact class.
- **Atomic-mkdir file-locking** + the cross-agent **task-queue seam** (inverted to a write-request lane) + the **danger-zone failure catalog** (promoted to a machine-checkable forbidden-ops list; gate-bypass forbidden).
- **Production-proven file-health limits** (<100KB/file, <3-level nesting, kebab-case, no spaces/unicode) + immutable-interactions + the additive-only-never-delete safety floor.
- **Kernel discipline** (default `llmvm` vs `llmvm_analytics`, never mix in one execution) as a runtime-host packaging constraint.
- The **hosted-scheduler-runs-laptop-closed** pattern + Confucius-grant prerequisite + cadence-as-cost-control for heavy analytics.
- The **`data_freshness` legible block** (recomputed from fetched_at, not hand-maintained) + **registry-is-sacred** validate-before-write.

### `[synth]` The synthesis - the joints that make the fusion load-bearing

- **Thin-wrapper skills**: the named surface FROM Jack over the tested engine FROM AM Brain (the core packaging resolution - _name is ergonomics, Python is correctness_).
- **Analyses-as-tested-Python** (the proof case: capability-from-Jack meets discipline-from-AM) + the **`AnalysisResult` contract** with born-clearance-classed fields.
- The **analysis → DM-EVID → ALG-4 → ALG-5 producer→consumer seam** (deep analyses feed ranking, band-only, pinned with a `safeParse` test) - _neither parent wired this._
- The **tier-split single-canonical-store** (AUTHORED = files+local-git+revisions; MIRROR = host-reachable+regenerable) that **dissolves the `{file+git, hosted, unattended}` pick-two trilemma**.
- The **generated read-only per-account `context.md` rollup** (Jack's single-glance value with no write-contention) + the merged registry superset + the two-granularity freshness (structural enforce + legible display).
- The **two explicit autonomy ladders** (SEND + WRITE) + the **gated-multi-agent graduation** (disjoint writable partition + DSS-matrix + 8-green-weeks + no-two-writers-per-file check).
- **Recovery-only additive merge** (Jack's recovery value, demoted from a scheduled loop) + **single-writer-by-construction** with the lock as defense-in-depth (not a hard mutex on an eventually-consistent store).
- The **Metamate-Automation-as-nudge** (hosted trigger for laptop-closed coverage, never touches files) + the engine-vs-LLM one-line split rule + the 12-skill merges (`/morning`+`/sweep` render-modes, `/post-meeting`+`/log-interaction`, 3 analyses→`/analyze`).
- **Field-resolution ownership matrix** (Jack's section table + AM Brain's field grain) + `required_kernel` tags carried as a conditional host constraint.
- **Roll-up / cap bounds** on growth-bearing files (half-year narrative shards, rs open-vs-archive split) + flatten `interactions/raw` to ≤3 levels (verdict fixes).

### `[ext]` External grounding - the evidence that settled the contested calls

- **Cognition "Don't Build Multi-Agents" P12** (3-0 adversarially verified): parallel writers make conflicting decisions - the highest-evidence claim grounding single-writer-now.
- **Anthropic production multi-agent research system**: lead agent writes, subagents read-only/synchronous - independent corroboration of the ORCH-1 posture.
- **GROUND concurrency angle** (Stacksync + single-writer/Orleans): bidirectional sync silently loses data via last-write-wins races; single-writer achieves strong consistency without merge complexity.
- **GROUND pkm-compounding angle** (Karpathy compiled-wiki + Zettelkasten/evergreen + _Blinded by Generated Contexts_, arXiv 2401.11911 + evolving-memory SSGM, arXiv 2603.11768): compounding needs one-directional flow + supersession; LLM merge biases toward generated-over-retrieved content (a hallucination sink); one-way backup is structurally safer than bidirectional sync.
- **GROUND ai-memory angle** (Salesforce write-gates + Mem0 2026 + Anthropic client-side-canonical + Oracle staleness): single-canonical-store + append-only + write-gates-before-storage is the 2026 production consensus; append-only without supersession creates "benign data corruption" (agents reuse stale facts with false confidence).
- **project-memory NaN-blind comparison gates**: `Number.isFinite`-guard every external numeric (comparison gates pass NaN as all-false) + the cross-slice-seam lesson (pin every producer→consumer seam with a `safeParse` test).
- **Verdict overturns**: the git-on-cloud-FUSE-mount corruption class (rclone instability + GDrive-sync git-corruption) forcing the git-on-local-disk invariant; the tier-split as strictly stronger than both pure-REV3 and pure-files-hybrid; the concurrency-test-before-deploy requirement.
- **Industry backup-vs-sync consensus**: one-way backup preserves deletion-recovery; bidirectional sync propagates deletions/corruptions catastrophically.

## 12. Phased build plan

The operator asked to optimize **all three lenses at once** - a ship-now solo core, a phase-sequenced path, and the mature capability ceiling. The phase plan **is** that reconciliation: **Phase 1 is a standalone, valuable, solo-AM system** that ships this week on zero new infra; Phases 2–3 are the gated climb to the ceiling; and the invariant across all of them is that **nothing in a later phase degrades anything in an earlier one** - the store, the gate, and the single-writer discipline are identical from day one, so "maturity" only ever _adds_ surface, never _reopens_ a settled safety decision. The storage tier-split (§3) is what makes this true: the host can evolve laptop → devserver without touching durability.

| Phase                                                                        | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gated on                                                                                                                                                                                                           | Exit criteria                                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **0 - capability audit + manual scaffold**                                   | Re-run NATIVE/BUILDABLE/IMPOSSIBLE against live tool schemas; record fallbacks (never silent omissions); build the machine-checkable danger-zone forbidden-ops list. Operator fills templates (top-10 dossiers, ~5 playbooks, manual ledgers) so the daily loop is usable **by hand** via the cockpit/prep/capture prompts (PRM-2..4) before any automation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | live tool schemas; operator availability for template fill                                                                                                                                                         | daily loop usable manually; integration-reality memo complete                                                              |
| **1 - SHIP-NOW solo core** _(single-writer, draft-only, laptop)_             | **L1** tier-split storage on the laptop (AUTHORED files + **local-disk** git + GDrive-revisions + nightly off-host bundle + `fsck` tripwire; MIRROR regenerable; single-writer-by-construction + advisory lock; **NO bidirectional merge**). **L2** data plane ported verbatim (two-transport pulls + envelope + numeric-ID-match + IN(all-ids) + 3-rung spend cascade + dead-ends); locked validated `registry.yaml`. **L3** decomposed two-tier dossier + dual-load + generated `context.md` rollup + simple retrieval + recall hook + CRM-note/96h ingestion → `narrative.md`. **L4** ALG-1..8 with new tests vs TEST-1..16 + the single highest-leverage analysis (**ALG-9 trajectory**, drives risk/coverage). **L5** `gate.py` (3 rules + GATE-1..5) + write-guard (ownership matrix + human-only-fields + immutability) + Context Ledger + DM-AUDIT, **gate unbypassable**, SEND ladder at rung 0. **L6** laptop `launchd` (`/morning` 07:00 SGP weekdays + 12h transcript sweep) + a tiny Metamate Automation as a hosted **07:00 nudge** + `/cron` discipline + loud-failure heartbeat. Strangler-fig cutover from the live daily driver, account-by-account, **archive-not-delete**. | Phase 0 audit + fallbacks; data paths verified; the **cron-vs-interactive concurrency test passing** (no silent loss, lock stale-timeout); git-on-local-disk confirmed                                             | operator reports "I know what to do today"; untouched-client count trending down; zero silent-loss in the concurrency test |
| **2 - calibration unblock + full analytics + RS engine + capture**           | Land the blocking operator inputs (ci_definition + targets, clearance rulings + cleared-benchmark library, SGP working calendar, book-plan tiers) so the cockpit goes **calibrated** (the `PACING UNCALIBRATED` banner clears). Add **ALG-10 headroom / ALG-11 cpa-v-spend / ALG-12 levers / ALG-13 revenue-commentary** as tested Python with golden fixtures + `[UNCALIBRATED CURVE]`/`insufficient_data` guards; wire the **analysis→DM-EVID→ALG-4→ALG-5 seam** (`safeParse`-pinned) so analyses feed ranking. Full **`/capture` batch** (CI + follow-up draft + commitment + RS-state as one approval batch) + commitments memory. Complete the 12-skill catalog as thin wrappers. Eval-judge harness + weekly grounding QA active.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 1 core stable; operator inputs supplied; spend-zeros VERIFY resolved; analyses curve-forms/thresholds supplied (golden fixtures)                                                                             | ≥10 evidence-ready packs/day; draft acceptance >70% by week 12; CI logging ~100%; overdue commitments trending to 0        |
| **3 - GATED maturity** _(unattended host, autonomy graduation, multi-agent)_ | Move the daily-driver + sweep onto a **persistent Meta devserver** `crontab`/`systemd-timer` (git on local disk per VERIFY-1; vault mclone-mounted) for fully-unattended laptop-closed operation, **once a devserver is provisioned**. Graduate SEND-ladder categories per numeric criteria (rung 1 follow-ups/confirmations after N consecutive clean sends; **pitches/numeric/emotional stay capped at rung 1 permanently**). Activate the cron→operator **task-queue handoff lane** (+ Jack's 3h worker) when a graduated send must execute on a foreign surface. Admit a true **SECOND WRITER** only behind the explicit gate: 8 consecutive green weeks + Agent-IO-Security DSS-matrix implemented + a **disjoint writable partition** verified (no two writers share a writable path under the actual skill→agent map). Re-open `canonical=MM2` only as a deliberate future fork **iff** MM2's cap/retention/silent-stop are all closed **and** a redundancy story exists.                                                                                                                                                                                                               | Phase 2 metrics green **8 consecutive weeks**; persistent-devserver provisioned + git-in-mount VERIFY closed; DSS-matrix integration; disjoint-partition specified + verified; policy sign-off for any rung-3 send | unattended loop runs laptop-closed with the weekly health-check green; any graduated autonomy passing its audit            |

### 12.1 How this maps to the prior SPEC phases

The SPEC's `Phase -1..5` `[AM]` collapses cleanly into the above: SPEC Phase -1 (audit) + Phase 0 (manual) = **Phase 0**; SPEC Phase 1 (retrieval) + Phase 2 (cockpit) = the L3/L4 core of **Phase 1**; SPEC Phase 3 (RS engine + outbound) + Phase 4 (capture) = **Phase 2**; SPEC Phase 5 (events + temporal, gated on 8 green weeks) = the autonomy/multi-agent half of **Phase 3**. The exit criteria are inherited verbatim (e.g. ">90% golden citation correctness", "draft acceptance >70% by week 12", "8 consecutive green weeks") so the conformance bar (§13) does not move.

### 12.2 The cutover is strangler-fig, not big-bang

The live AM-OS (or the current manual practice) stays the daily driver throughout. Point the new system at the **same** live data + one enriched `registry.yaml` → port the data plane → migrate **account-by-account** (old plan → two-tier dossier + narrative) → keep the existing `/morning` running until the ALG-8 cockpit reaches parity → flip the daily driver → **archive** the old shell to `_archive/` (never delete) → migrate/re-index memory **last**, after validation. At no point is the operator without a working cockpit, and at no point is un-regenerable history exposed to a one-shot migration - git + the off-host bundle cover every step.

## 13. Conformance, evaluation & metrics

Correctness is a layer (Ln), not a hope. The brain advises spend and drafts client outbound; an unverified ranking or an ungated claim is a live financial/relationship risk. Three test classes + an ongoing eval loop hold the line.

### 13.1 Engine acceptance suite (the SPEC fixtures, ported verbatim)

The 16 SPEC fixtures `[AM]` are the non-negotiable acceptance bar for the banded cortex - they encode the invariants as executable assertions against the `acme-fitness` / `bravo-retail` / `delta-beauty` mock month (day 6 of 22, behind):

| Holds the line on                                                                             | Tests              |
| --------------------------------------------------------------------------------------------- | ------------------ |
| **Pacing math + recoverability verdict**                                                      | TEST-1             |
| **Cockpit selection** (overdue commitment → must-do; rollover-labeled)                        | TEST-2, TEST-14    |
| **Mood/gate suppression** (frustrated client → value-first, no pitch, even with a pinned RS)  | TEST-3             |
| **RS gating** (blocked → parked with unblock_condition; unknown → discovery question)         | TEST-4, TEST-6     |
| **Rules-first-numbers-last ranking** (exact key comparison, no cross-band reorder)            | TEST-5             |
| **Clearance gate** (no claims-register entry → reject; **cross-client evidence → HARD FAIL**) | TEST-7, **TEST-8** |
| **Freshness exclusion** (9-day-old perf claim → out of evidence, into hygiene)                | TEST-9             |
| **Feedback flips bands** (two `client_not_ready` → `blocked` with reason)                     | TEST-10            |
| **Channel policy** (WhatsApp outside 24h window without template → refused, rule named)       | TEST-11            |
| **Human-only fields** (agent sets `trust_level` without confirm → blocked + logged)           | TEST-12            |
| **Unknown≠band** (eligibility over NaN → `unscored` + data task, never a band)                | TEST-13            |
| **Send side-effects** (approve+send → audit + CI + commitment-close + RS-history + follow-up) | TEST-15            |
| **Solution coverage** (exactly the right undercovered set at factor 0.6)                      | TEST-16            |

### 13.2 Tests the synthesis adds (because it added capability + concurrency)

- **Golden-fixture tests for ALG-9..13** `[synth]`. Each grafted analysis (trajectory/headroom/cpa-v-spend/levers/revenue) has frozen input→output fixtures so the refactor-from-LLM-to-Python is provably faithful and stays faithful. An uncalibrated curve fixture must produce the `[UNCALIBRATED CURVE]` banner and must **fail** any test that lets it into a client draft.
- **Producer→consumer seam test** `[ext]`. `AnalysisResultSchema.safeParse(analysisOutput)` and `DM_EVID_Schema.safeParse(alg4Input)` - the cross-slice-seam discipline that catches the case where a stage passes its own contract while the seam silently drifts. A decisive analysis signal must move an RS by **band**, and a test asserts it never injects a raw coefficient into a sort key (I-2).
- **Concurrency test - BEFORE deploy** `[ext]` GROUND verdict. Simulate cron-write + interactive-write in the same window and assert **no silent loss** and correct lock stale-timeout behavior. This is the single test that retires Jack's documented "Metamate's changes are LOST" failure; it gates Phase 1 exit.
- **Durability tripwires** `[synth]`. `git fsck` passes; the nightly off-host bundle has `rows > 0`; `0-files-written-when-due` raises a HARD FAIL; `.git` is asserted to live on local disk, never on the FUSE mount.

### 13.3 Ongoing evaluation (grounding never goes on autopilot)

- **Golden question set** `[AM]`: 20 per playbook (extractive, abstractive, temporal, should-escalate); rerun on **every** KB or prompt change; track citation correctness and refusal correctness. Phase-1 exit needs >90% citation correctness.
- **Weekly grounding QA** `[AM]`: sample **20 sent messages** containing claims; a human verifies each claim against its citation; **target >95%**. **Any clearance violation = sev-1 review** (a cross-client leak or an improvised benchmark is treated as an incident, not a metric dip).
- **Eval-judge harness** `[AM]+[INT]`: reuse Meta Sales AI's grounding judge where it overlaps, rather than rebuilding a grader - the reuse-not-rebuild stance from the thesis.

### 13.4 Operating metrics (is the system actually helping the AM?)

The LOOP-level health metrics `[AM]`, extended with the durability/concurrency signals the synthesis introduced `[synth]`:

| Metric                                                 | Healthy direction             | What it catches                                                                            |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Pacing attainment vs book-plan                         | → target                      | the cockpit is steering the month, not just describing it                                  |
| Draft acceptance rate + **edit distance**              | acceptance ↑, edit distance ↓ | the drafts are getting more send-ready (style.md is learning)                              |
| Overdue-commitments trend                              | → 0                           | nothing the AM promised is silently dropping                                               |
| Cockpit open rate + **%-acted-on**                     | high                          | the must-do list is real work, not noise                                                   |
| **Operator gardening minutes/week**                    | **< 15 min**                  | the maintenance budget - breach = simplify, do not add (the bounded-maintenance guarantee) |
| Sync-conflict / recovery-merge invocations             | ~0                            | the single-writer discipline is holding (a rising count means a second writer crept in)    |
| Heartbeat recency + run-count climbing + backup-rows>0 | always green                  | the unattended loop is alive and the DR layer is real (catches the silent-stop class)      |

The first five prove the system earns its place in the AM's day; the last two prove it is safe to leave running unattended. A weekly health-check asserts the green state across all of them and **auto-re-arms** the cron on any breach - loud failure, never silent drift.

## 14. Open questions & blocking operator inputs

Honesty about what is _not_ settled is itself an invariant (I-3). Three classes: inputs that block calibration (the system runs but lies on pacing until they land), platform unknowns that must be _measured_ before they are _relied on_, and design forks that need an operator decision. None of them blocks Phase 1 shipping - that is the point of the tier-split and the UNCALIBRATED banners.

### 14.1 Blocking calibration inputs (Phase 2 gate)

Until these land, **every pacing surface carries `PACING UNCALIBRATED`** and the cockpit is structure-only, not steering. `[AM]` SPEC §17 / canonical §14:

1. **Official CI definition + monthly targets** (`ci_definition`, `ci_target`, `rs_close_target`) - the real scorecard math. This is the single highest-leverage missing input; it was the lost 77-line paste. Without it the run-rate bands are placeholders.
2. **Clearance rulings + the cleared-benchmark library** - the model **must not improvise** benchmarks (GATE-5). Until supplied, every proof point renders `[NEEDS CLEARED BENCHMARK]` and no benchmark claim crosses the gate.
3. **SGP working calendar** (region + public holidays) - for correct working-day math in ALG-1/ALG-2.
4. **Book-plan tiers for the real 33-account portfolio** (excluding the 10 `in_portfolio=false`) - required-touches, mix targets, grow/defend/maintain tiers.

### 14.2 Unverified platform unknowns (measure before relying)

Each is bounded and explicitly _not_ bet on by the ship-now design `[synth]+[ext]`:

| Unknown                                                                                                        | Why it matters                                                            | Disposition until verified                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **MM2 per-file cap (~100KB), retention, lock atomicity, ~23-mission silent-stop**                              | Gates whether MM2 may ever be promoted past a read-only MIRROR projection | MM2 stays a one-way read-projection only; AUTHORED truth never rides it                                                        |
| **git-in-mclone-mount (VERIFY-1)**                                                                             | Gates the Phase-3 unattended devserver path                               | git on **local disk** + markdown rsync to the mount is the standing invariant (so VERIFY-1 failing changes nothing structural) |
| **Persistent-devserver provisioning**                                                                          | The L6 spike found it unprovisionable self-serve from the Mac             | Phase 1 ships on the laptop; the devserver is a separate request, not on the critical path                                     |
| **GDrive native revision-history retention for FUSE-mounted `.md`**                                            | Whether revisions are a _reliable_ second recovery layer                  | treated as a **bonus until verified**; the nightly off-host `git bundle` is the **primary** second layer                       |
| **Spend-zeros VERIFY** (a 2026-04 doc saw zeros on the GraphQL spend path)                                     | Whether the live spend leg is trustworthy                                 | default to the Presto fallback rung until one live call confirms nonzero                                                       |
| **Unidash programmatic access** (CI full-quarter widget)                                                       | Whether quarter-level CI can be pulled vs scraped                         | real-time GraphQL CI (~41 cap) is the primary; Unidash is a manual cross-check until proven                                    |
| **Analyses curve-forms + thresholds** (headroom log-curve, cpa-v-spend regression, diminishing-returns points) | Required to _calibrate_ ALG-10/11                                         | ship the math behind `[UNCALIBRATED CURVE]`; barred from client drafts until supplied                                          |
| **`fct_performance5_account` schema**                                                                          | Required for ALG-12 levers                                                | ALG-12 is Phase-2, after schema confirmation                                                                                   |

### 14.3 Design forks needing an operator decision

These are genuine choices the synthesis made a recommendation on but the operator owns `[synth]`:

- **The 12-skill merges vs Jack's 14 separate invocations.** We merged `/post-meeting→/capture`, `/log-interaction→/log -quick`, and the three analyses into `/analyze <type>`. If muscle memory or skillbook reuse favors the separate names, they can stay separate aliases over the same engine calls at zero cost. _Recommendation: ship the 12, keep Jack's names as aliases._
- **Keep the external meeting-notes Google Doc, or go fully in-vault?** The synthesis demotes the Doc to an _upstream ingestion source_ and makes in-vault `narrative.md` the dual-load partner. If the operator values the Doc as a human-browsable artifact (or shares it), keep it as a one-way ingestion source; if not, retire it. _Recommendation: keep as ingestion-only, do not dual-write._
- **Does freeform query deserve a 13th named skill?** It is currently the un-named "talk to the brain" path. A `/ask <client>` affordance would make it discoverable; the cost is one more surface. _Recommendation: leave un-named until the operator wants the affordance._
- **The disjoint-partition boundary for an eventual second writer.** Phase 3 admits a second writer only if no two writers share a writable path. Which partition (e.g. a research/enrichment agent owning only `analyses/` + `suggested:` blocks) is a design task deferred until the 8-green-weeks gate is in sight. _Recommendation: do not design it until Phase 2 metrics are green - premature partitioning is its own risk._
- **Whether to ever re-open `canonical = MM2`.** Only as a deliberate future fork, and only if §14.2's MM2 unknowns all close **and** a redundancy story exists. _Recommendation: not on any current roadmap; the tier-split already buys MM2's only real advantage (hosted reach) for the regenerable tier without the durability bet._

-

## Appendix - synthesis method & adversarial verdicts

**The fan-out (Workflow `am-brain-synthesis`, 34 agents).**

- **Harvest (7 agents):** one per architectural dimension (skills/loops · memory-model · storage-sync · decision-analytics · safety-governance · data-plane · runtime-host), each reconciling best-of-both with explicit conflict rulings.
- **Ground (3 agents, web-cited):** multi-writer concurrency & sync patterns · PKM-compounding (Zettelkasten / Karpathy compiled-wiki) · 2025–26 agentic-memory architectures.
- **Verify (9 agents):** 3 refute-by-default skeptics each on the 3 load-bearing rulings; 2/3 refutes overturns and forces the architect to pick the genuinely stronger model.
- **Synthesize:** 1 chief architect fixed the spine (reconciled invariants I-1..I-13, the settled storage ruling, the layer model, the section outline, the phase plan, the provenance map); per-section writers drafted the document.

**Adversarial verdicts** (refute-by-default; 2/3 to overturn - overturns _improved_ the design rather than reverting):

| Ruling                | Verdict            | Outcome                                                                                                                |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **storage-sync**      | **OVERTURNED 2/3** | tier-split single store - strictly stronger than REV3 _and_ Jack _and_ the pure-files hybrid                           |
| **memory-model**      | **OVERTURNED 2/3** | decomposed dossier **upheld**, with grain fixes (rs open/archive split, flatten interactions, ½-year narrative shards) |
| **safety-governance** | **SURVIVES 1/3**   | single-writer-now + gated fleet holds; mutex relocated off the eventually-consistent store                             |

**External sources cited by the grounding agents.** Cognition _"Don't Build Multi-Agents"_ (P12); Anthropic multi-agent research system (lead-writer / read-only-subagents); Stacksync bidirectional-sync analysis + Orleans single-writer; Andrej Karpathy compiled-wiki; Zettelkasten / evergreen notes; _Blinded by Generated Contexts_ (arXiv 2401.11911); evolving-memory SSGM (arXiv 2603.11768); Salesforce write-gates; Mem0 (2026); Anthropic client-side-canonical; Oracle staleness; the industry backup-vs-sync consensus.

**Production note.** Across two runs (~5.7M agent tokens), the reasoning core - all 34 agents through Harvest, Ground, Verify, and the architect Spine - completed in full. Transient Anthropic-side rate-limiting blocked the final prose-writer pool, so **7 of 14 sections (§4, §6, §7, §11, §12, §13, §14) were authored directly from the completed, adversarially-verified spine + the staged harvest/verdict artifacts** rather than re-running the writer pool indefinitely. Every _decision_ in those sections is workflow-derived (spine + verdicts in `_synthesis/spine.json`, `verdicts.json`, `ground.json`); the prose is the only hand-assembled layer. Sections §1, §2, §3, §5, §8, §9, §10 are verbatim workflow output.
