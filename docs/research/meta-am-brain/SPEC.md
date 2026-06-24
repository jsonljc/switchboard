# AM Second Brain: Implementation Specification

**Version:** 1.0 (2026-06-07)
**Audience:** an implementing agent or engineering team on an internal AI platform (Metamate). This document is self-contained: implement from it without any other context.
**Companion artifacts (in this directory):** file templates (`_TEMPLATE` files) and a fully worked fictional fixture set (`clients/acme-fitness/`, `book-plan.md`, `scorecard.md`, `coverage/`, `queue/rs-queue.md`, `today.md`, `drafts/`). The fixtures are the **conformance suite** (Section 14).
**Background (informative, not required reading):** `../2026-06-07-meta-am-second-brain-architecture.md` contains the research basis and rationale.

**Conformance language:** MUST / MUST NOT / SHOULD / MAY per RFC 2119. Sections marked _(informative)_ carry no requirements.

---

## 0. Instructions to the implementing agent

1. Implement phases in order (Section 15). Phase -1 (capability audit) gates everything after Phase 1.
2. Where a platform capability is missing, implement the listed fallback (Section 3), never a silent omission.
3. Constants live in one configuration block (Section 13). Several are marked `CALIBRATE`: they are placeholders until the operator supplies real scorecard values. The system MUST surface uncalibrated constants in its daily output rather than treating placeholders as truth.
4. You MUST NOT invent: RS ids, benchmark numbers, client data, or policy language. Missing data is represented as missing (Section 4.1, rule DM-4).
5. The fixtures use fictional clients. Conformance tests run against them; production runs against real data only after the operator replaces them.

---

## 1. System overview

**Purpose:** an execution system for a Meta ads Account Manager (AM) managing 30 to 50 advertiser clients, 500 to 1000 open Recommended Solutions (RS), and a monthly Client Interaction (CI) quota. It keeps the AM on pace for monthly targets, prioritizes RS by evidence and client readiness, prepares every client interaction, drafts outbound communication, and remembers every commitment.

**The product spine** (every feature serves it, in this order):

```
monthly scorecard → client coverage → RS prioritization → evidence pack
       → draft → CI log → follow-up → next action
```

**Architecture layers** (top consumes bottom):

```
SURFACES        daily cockpit · pitch packs · cited Q&A · meeting prep/capture · drafts + approval
ORCHESTRATOR    single-threaded writer; grounding → scoped retrieval → citations → clearance → policy → tools
EXECUTION       book plan · scorecard pacing · coverage · behind-schedule triggers · recovery actions
RS ENGINE       eligibility signals → evidence objects → rules-first ranking → objection parking
MEMORY          T2 files (this directory's layout) · T3 temporal graph (Phase 5 only)
SYSTEMS OF      ad-account insights · RS system · CRM/CI log · email/WhatsApp · calendar · transcripts
RECORD          (all read-only to the agent)
```

[GEN-1] The system MUST be deployed per-AM: one brain instance per AM, operating strictly with that AM's data permissions.
[GEN-2] All output the AM acts on MUST be explainable in plain English (ranking reasons, pacing verdicts, gate rejections).
[GEN-3] The system optimizes scorecard attainment first; when pacing and pitch-opportunity conflict, pacing wins (see ALG-6, LOOP-1).

---

## 2. Definitions

- **AM:** account manager; the sole human operator of one brain instance.
- **Client:** an advertiser in the AM's book. Identified by `client-slug` (kebab-case, stable).
- **RS (Recommended Solution):** a product-adoption recommendation tracked in an external RS system of record (e.g. adopt CAPI, Advantage+, creative diversification, click-to-message). Identified by `rs_id`, owned by that system; the brain only annotates.
- **CI (Client Interaction):** an interaction that counts toward the AM's quota. **The counting rule is external configuration** (`ci_definition`, Section 13); the brain MUST distinguish `countable_ci: true|false` per record.
- **EMQ:** Event Match Quality, a 1 to 10 score on ad-platform events (informative example of an account signal).
- **Evidence object:** a dated, sourced, clearance-tagged observation from account data (schema DM-EVID).
- **Pacing:** target vs actual run-rate math over the month's working days (ALG-1).
- **Bands:** categorical priority fields on an RS (schema DM-RSPRI).
- **Clearance class:** a provenance label deciding whether content may appear in outbound comms (Section 8).
- **Ownership class:** who may write a file and how (Section 4.2).
- **Working day:** per a configured regional calendar (`working_calendar`, Section 13), not a naive weekday count.

---

## 3. Platform capability requirements and degradation matrix

[CAP-1] Before Phase 2, the implementer MUST complete `phase-minus-1/audit-checklist.md` and record native / buildable / impossible per row. Fallbacks are normative, not optional suggestions.

| #   | Capability                                                          | Needed for       | Required by phase | Fallback if absent                                                    |
| --- | ------------------------------------------------------------------- | ---------------- | ----------------- | --------------------------------------------------------------------- |
| 1   | Retrieval index over this file tree, scoped per AM                  | Q&A, prep        | 1                 | operator pastes relevant files per task                               |
| 2   | Agent read/write to these files, with change history                | all writes       | 1                 | agent emits diffs; operator applies                                   |
| 3   | Read access: ad insights, RS system, CRM/CI log, calendar           | evidence, pacing | 2 to 3            | scheduled manual exports dropped into a watched folder; agent ingests |
| 4   | Scheduled jobs (daily, weekly)                                      | cockpit, hygiene | 2                 | operator triggers manually each morning                               |
| 5   | Event triggers (email arrival, transcript finalized, signal change) | enrichment       | 5                 | remain on schedules                                                   |
| 6   | Graph/temporal store                                                | temporal queries | 5                 | files + vector retrieval only                                         |
| 7   | Long-context model with reliable citation behavior                  | grounding        | 1                 | smaller retrieval slices + heavier QA sampling                        |
| 8   | Email/WhatsApp send integration with an approval UI                 | outbound         | 3                 | copy-paste drafts; approval is the act of pasting                     |
| 9   | Append-only audit log                                               | trust            | 3                 | `audit.log` JSONL file in the brain root                              |

[CAP-2] If capability 3 is impossible (no structured signal access at all), Phases 3+ MUST re-scope to the export-ingestion variant and the implementer MUST say so in the integration reality memo, not proceed as if unaffected.

---

## 4. Data model

### 4.1 Conventions (normative)

[DM-1] All files are UTF-8 markdown with fenced YAML blocks as shown in the templates. Field names MUST match this spec exactly.
[DM-2] Dates are ISO `YYYY-MM-DD`; timestamps `YYYY-MM-DDTHH:mm` in the AM's timezone (`timezone`, Section 13).
[DM-3] Identifiers: `client-slug` kebab-case; `rs_id` copied verbatim from the RS system and never fabricated.
[DM-4] **Missing-data rule:** absent, non-numeric, or non-finite values MUST be represented as absent and MUST NOT default to 0, false, or "pass." Any computation consuming them MUST branch to an explicit `unknown`/`unscored` outcome. (This rule is load-bearing; see ALG-4, TEST-13.)
[DM-5] Every quantitative claim derived from external data MUST carry `source` (link/ref) and `fetched_at` (date).
[DM-6] Freshness shelf lives by data class (defaults, Section 13): performance metrics 7 days; contact facts 90 days; strategy fields reviewed quarterly; playbooks flagged stale after 90 days. Expired items MUST be excluded from evidence and queued for hygiene (ALG-7), never silently reused.

### 4.2 File tree contract and ownership classes

[DM-7] The file layout MUST be:

```
brain-root/
  book-plan.md  scorecard.md  today.md
  coverage/{clients.md, solutions.md}
  queue/rs-queue.md
  playbooks/<product>.md  playbooks/troubleshooting/<topic>.md
  clients/<client-slug>/{profile.md, contacts.md, relationship.md, performance.md,
                         rs-ledger.md, commitments.md, style.md, interactions/<YYYY-MM>.md,
                         interactions/raw/<YYYY-MM-DD>-<type>.md}
  drafts/<YYYY-MM-DD>-<client-slug>-<purpose>.md
  archive/
  audit.log                       (if capability 9 fallback)
```

[DM-8] Ownership classes and write rules:

| Class        | Files                                                                     | Agent may                      | Operator role                      |
| ------------ | ------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| human-owned  | book-plan targets, profile strategy fields, style seed                    | propose diffs only             | author, approve                    |
| AM-confirmed | relationship.md state fields, contact merges, corrections to past records | suggest values                 | confirm each change                |
| generated    | scorecard, coverage, performance, rs-queue, cockpit, CI digests           | overwrite freely (regenerable) | spot-check                         |
| append-only  | interactions/raw, commitments, rs-ledger history, audit.log               | append only                    | correct via new correction entries |

[DM-9] An agent write violating DM-8 MUST be blocked and logged (TEST-12).
[DM-10] Correction protocol: operator edits to files are ground truth; derived stores re-sync from files. A retracted fact gets a tombstone entry (`not_true: <claim>; do_not_rederive: true`) which MUST suppress re-derivation from old source material.
[DM-11] Bloat caps: profile.md one page; raw CI records roll into the monthly digest and move to `archive/`; churned clients archive whole; over-cap files are flagged in the cockpit hygiene section.

### 4.3 Schemas

Types: `str`, `int`, `num`, `date`, `enum(...)`, `[T]` list, `?` optional.

**DM-PLAN `book-plan.md`** (human-owned)

```yaml
month: str YYYY-MM
working_days: int # from working_calendar
targets:
  ci_target: int # CALIBRATE
  rs_close_target: int # CALIBRATE
  revenue_growth_target: str?
strategic_solution_mix: { <solution_slug>: percent } # MUST sum to 100 ± 1
priority_clients:
  - { client: slug, tier: enum(grow, defend, maintain), required_touches: int, reason: str }
# clients absent from the list default: tier maintain, required_touches: default_touches (Section 13)
```

**DM-SCORE `scorecard.md`** (generated daily; formulas in ALG-1)

```yaml
month: str
as_of: date (+ optional "(morning)")
working_day: "int of int"
ci:
  {
    target: int,
    completed: int,
    required_run_rate: num/day,
    actual_run_rate: num/day,
    required_from_today: num/day,
    pacing_status: enum(ahead,
    on_pace,
    behind,
    critical),
  }
rs:
  {
    close_target: int,
    closed: int,
    pitched_this_month: int,
    required_close_rate_from_today: num/day,
  }
coverage:
  {
    clients_untouched_this_month: [slug],
    clients_below_required_touches: [slug],
    rs_categories_undercovered: [solution_slug],
  }
commitments_overdue: int
top_recovery_actions:
  - { client: slug, recommended_solution: solution_slug|none, evidence: str, draft_ready: bool }
```

**DM-COV** `coverage/clients.md` entries

```yaml
{
  client: slug,
  tier: enum,
  required_touches_this_month: int,
  completed_touches: int,
  last_touched: date?,
  next_required_touch_by: date,
  recommended_action: str,
}
```

`coverage/solutions.md` entries

```yaml
{
  solution: slug,
  mix_target: percent,
  open_rs: int,
  pitched_this_month: int,
  closed_this_month: int,
  undercovered: bool,
}
```

**DM-EVID evidence object** (embedded in rs-ledger, drafts, packs)

```yaml
{
  signal_id: str,
  metric: str,
  value: str|num,
  window: str,
  source: ref,
  clearance: enum(client_specific,
  aggregate_benchmark_cleared,
  client_safe,
  internal_only,
  policy_sensitive),
  fetched_at: date,
}
```

[DM-12] An evidence object missing `source` or `fetched_at`, or past shelf life, is INVALID and MUST NOT support any outbound claim.

**DM-RSPRI RS annotation** (rs-ledger entries; mirrors + annotates the RS system)

```yaml
rs_id: str (verbatim)
product: solution_slug
status: str (mirror of system of record)
local_state: enum(unscored, banded, evidence_ready, pitch_drafted, pitched, objection_parked, won, lost)
bands: {commercial_value: enum(high,medium,low), evidence_readiness: enum(strong,moderate,weak),
        client_readiness: enum(ready,blocked,unknown), urgency: enum(now,this_month,later),
        effort: enum(low,medium,high)}
pin: str?                          # presence = R0 pin, value = reason
score_reason: str                  # plain English, REQUIRED whenever banded
confidence: enum(high,medium,low)
required_human_judgment: bool
evidence: [DM-EVID]
objection: str?                    # required if objection_parked
unblock_condition: str             # REQUIRED if objection_parked
discovery_action: str?             # required if client_readiness == unknown
history: [ "{date}: {event}" ]     # append-only
next_action: {type: str, due: date, draft: enum(ready,not_yet,none)}?
```

**DM-REL `relationship.md`** (AM-confirmed)

```yaml
relationship_state:
  trust_level: enum(low,medium,high)
  current_mood: enum(positive,neutral,frustrated,disengaged)
  decision_maker_access: enum(direct,indirect,blocked)
  current_objection: enum(budget,bandwidth,skepticism,policy,measurement,none)
  preferred_pitch_mode: enum(data_first,case_study,strategic,tactical)
  last_value_delivered: 'date "what"'
  next_best_relationship_move: enum(educate,ask,escalate,celebrate,follow_up)
  last_confirmed: date
```

[DM-13] `trust_level` and `current_mood` MUST only change on operator confirmation; the agent records suggestions separately (e.g. a `suggested:` block) until confirmed.

**DM-CI CI record** (interactions; append-only via raw + digest)

```yaml
{
  date: date,
  type: enum(call,
  email_thread,
  whatsapp,
  meeting,
  qbr),
  countable_ci: bool,
  participants: [str],
  summary: str (<=5 lines),
  rs_touched: [rs_id],
  commitments: [{ by: enum(AM, client), what: str, due: date }],
  sentiment: enum(positive,
  neutral,
  frustrated,
  disengaged), # suggestion only (DM-13)
  follow_up_draft: path|none,
  logged_to_official_tracker: bool,
}
```

**DM-COMMIT `commitments.md`**: `open[]` / `closed[]` of `{by, what, promised_on, due, status: enum(open,overdue) | closed_on, outcome}`. Overdue = `due < today` while open; MUST be recomputed daily.

**DM-PLAYBOOK frontmatter**

```yaml
{
  product: slug,
  rs_categories: [str],
  one_liner: str,
  eligibility_signals: [{ id: str, test: str }],
  clearance: enum(client_safe,
  internal_only),
  last_reviewed: date,
}
```

Body sections MUST include: When to pitch; Value story and proof points; Talk track; Objections and responses; Implementation steps and effort honesty; Common pitfalls; FAQ. Proof points without a cleared source MUST read `[NEEDS CLEARED BENCHMARK: <what>]`, never an invented number.

**DM-DRAFT outbound draft envelope**

```yaml
to: str            cc: str?         channel: enum(email,whatsapp)
re: str            generated_from: [refs]
purpose: str       # MUST state if it closes a commitment or carries no ask
clearance_check: {claims_total: int, cleared: int, cross_client_check: enum(pass,fail),
                  freshness_check: enum(pass,fail)}
autonomy_rung: int (0..3)
```

…followed by the body (claims marked `[n]`), a **claims register** table mapping every `[n]` to its evidence object + clearance verdict, and an approval block (send as-is / edit / reject-with-reason). [DM-14] A draft missing the claims register is INVALID.

**DM-AUDIT audit entry** (append-only)

```yaml
{ts: timestamp, actor: enum(agent,operator), action: enum(draft_created,gate_pass,gate_reject,
 approved,edited,sent,send_failed,ci_logged,file_write,write_blocked,feedback),
 subject: path|rs_id|draft_id, detail: str, evidence_shown: [refs]?}
```

---

## 5. Deterministic algorithms (normative)

### ALG-1 Pacing

```
required_run_rate    = ci_target / working_days_total
actual_run_rate      = ci_completed / working_days_elapsed          (0 if none elapsed)
required_from_today  = (ci_target - ci_completed) / working_days_remaining
ratio                = actual_run_rate / required_run_rate
pacing_status: ahead   if ratio >= 1.10
               on_pace if 0.95 <= ratio < 1.10
               behind  if 0.70 <= ratio < 0.95
               critical if ratio < 0.70 OR required_from_today > daily_capacity_max
```

Guards: `working_days_remaining == 0` → status from completion alone (>=100% on_pace else critical). All inputs pass DM-4. RS close pacing computed identically from `rs_close_target`.
[ALG-1a] The scorecard MUST include a one-line plain-English verdict including whether the gap is recoverable at a stated run rate (TEST-1).

### ALG-2 Client coverage

For each client: `required_touches` from book plan (default `default_touches`). Touch = CI with `countable_ci: true`.

- `untouched` if 0 touches this month AND `working_day >= untouched_grace`.
- Evenly spread due dates: touch k of n due by working day `ceil(k * working_days_total / n)`; **except** if `today - last_touched > stale_touch_days`, the next touch is due within `attention_window` calendar days.
- `needs_attention` if untouched, or a due date passed without a touch, or `next_required_touch_by` within `attention_window`, or tier `defend` with any active risk flag.
- `below_required` if completed touches < count of due dates passed.

### ALG-3 Solution coverage

`pitched_share(s) = pitched_this_month(s) / max(1, pitched_this_month_total)`
`undercovered(s) = pitched_share(s) < mix_target(s) * undercoverage_factor`

### ALG-4 Evidence attachment

For each playbook eligibility signal x client account: evaluate `test` against fresh data (within shelf life). Pass → create DM-EVID and attach to matching RS; set `evidence_readiness` per thresholds (strong: >=2 valid objects or 1 decisive; moderate: 1; weak: none current). Non-evaluable (missing/non-finite data) → DO NOT band; set `local_state: unscored` and emit a data-gathering task (DM-4, TEST-13).

### ALG-5 RS ranking (rules first, numbers last)

Input: all annotated RS. Output: ordered main queue + parked list + discovery list.

```
R0 PINS:      rs with pin → top, ordered among themselves by R3. Pins are never displaced
              by evidence-based items. A pinned RS with client_readiness=blocked stays
              pinned but its action converts to the unblock path (repair/access), labeled.
R2 GATES:     client_readiness=blocked  → parked list (REQUIRES unblock_condition;
                                          excluded from main queue; resurfaces when
                                          condition observed or on next_action.due)
              client_readiness=unknown  → discovery list (REQUIRES discovery_action;
                                          surfaces as a question, never a pitch)
R1 BOOSTS:    boost_flag = client in (untouched ∪ below_required)
                           OR product in rs_categories_undercovered
R3 BAND SORT: key = (boost_flag desc,
                     urgency: now > this_month > later,
                     commercial_value: high > medium > low,
                     evidence_readiness: strong > moderate > weak,
                     effort: low > medium > high)
R4 TIEBREAK:  identical keys MAY be ordered by a numeric sub-score; a numeric score
              MUST NOT reorder across different keys.
```

[ALG-5a] Every queue line MUST render `score_reason` + `confidence`. `required_human_judgment: true` or `confidence: low` renders as a question to the operator, not a recommendation.
[ALG-5b] Operator feedback (accept / snooze / reject + one-tap reason) MUST be persisted (DM-AUDIT `feedback`) and MUST visibly affect bands: e.g. two `client_not_ready` rejections flip `client_readiness` to blocked with the reason as objection (TEST-10).

### ALG-6 Recovery actions

When `pacing_status ∈ {behind, critical}`: generate `top_recovery_actions` = needs_attention clients ordered by (tier defend > grow > maintain, days since last touch desc), each with a **legitimate low-effort CI type** (performance recap delivery, commitment follow-through, quick-win flag, scheduled check-in) and a draft. Recovery actions MUST carry real content with valid evidence; the system MUST NOT generate content-free "checking in" touches. If `critical` and `required_from_today > daily_capacity_max`, the cockpit MUST say the month is not recoverable at capacity and propose explicit triage (which clients/categories to deprioritize) instead of pretending (GEN-2).

### ALG-7 Hygiene sweep (weekly + on demand)

Collect: expired claims (DM-6), over-cap files (DM-11), playbooks `last_reviewed` > `playbook_stale_days`, contacts past re-confirmation, unconfirmed relationship suggestions older than 14 days. Output: hygiene queue in the cockpit optional section.

### ALG-8 Cockpit assembly (consumes all of the above; see LOOP-1)

```
sections (fixed order):
 1 pacing verdict (ALG-1)              2 clients to touch this week (ALG-2/6)
 3 evidence-ready RS (ALG-5 top N)     4 meetings today needing prep
 5 commitments overdue or due today    6 drafts awaiting approval
 7 risk signals
must_do (max must_do_cap=3), selected in order:
 a) overdue commitments  b) coverage touches due within attention_window when behind
 c) time-bound items today (meeting prep, expiring channel windows)
optional (max optional_cap=7), in order: rolled-over items (oldest first, labeled
 "(rolled from <date>, day n)"), recovery actions, evidence-ready RS, hygiene.
rollover: unchecked must_do items MUST reappear next day labeled rolled (TEST-14).
behind-mode: when behind/critical, section 2 expands and section 3 caps at 3 items;
 recovery actions outrank opportunistic pitches everywhere (GEN-3).
```

---

## 6. Agent loops (behavior specs)

| ID     | Loop                   | Trigger                                            | Output                                                                                                                                                                                                                                                            | Notes                                                                |
| ------ | ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| LOOP-1 | Daily cockpit          | schedule (or manual) each working day              | regenerate `scorecard.md`, `coverage/*`, `today.md` per ALG-1..8                                                                                                                                                                                                  | the recited plan; agent rewrites checkboxes as work completes        |
| LOOP-2 | Pitch pack             | operator request or cockpit item                   | pack: claim line, 2 to 4 valid evidence objects, cleared proof point, 60-second talk track + objection branches (from playbook, in `preferred_pitch_mode`), channel draft, effort honesty                                                                         | no pack ships with an uncited or uncleared number                    |
| LOOP-3 | Q&A / troubleshooting  | operator request                                   | cited answer through the clearance gate; or explicit escalation ("route to X, summary prepared") when out of bounds or low confidence                                                                                                                             | scope: ads troubleshooting, billing/admin FAQ, bounded organic       |
| LOOP-4 | Meeting prep + capture | calendar (prep); transcript/notes (capture)        | prep one-pager (relationship state + move, open commitments both directions, fresh cited performance, top 3 RS with reasons, last interaction recap); capture batch: DM-CI record + follow-up draft + commitment updates + RS state changes as ONE approval batch | capture MUST flag inferred-not-heard items                           |
| LOOP-5 | Outbound drafting      | loops 1 to 4, incoming messages, follow-up cadence | DM-DRAFT envelope through Section 8 gate to approval                                                                                                                                                                                                              | operator edits are diffed into style.md suggestions                  |
| LOOP-6 | Refresh                | schedule (Phases 2 to 4); events (Phase 5)         | ingest signals/exports → ALG-4 → re-band RS → ALG-1/2/3 → tomorrow's cockpit inputs                                                                                                                                                                               | serialized per client (ORCH-3); every write traceable to its trigger |

[LOOP-7] Failure behavior: any loop hitting missing inputs MUST degrade explicitly (state what is missing and what was skipped), never fabricate.

---

## 7. Retrieval and grounding

[RET-1] Retrieval for a client-scoped task MUST filter to: that client's dossier + playbooks + cleared benchmark library. Other clients' identifiable data MUST be structurally excluded (index/query-level, not prompt-level).
[RET-2] Every retrieved chunk carries provenance: `{path_or_ref, client_id|global, clearance, fetched_at?}`.
[RET-3] Routing: entity/relational lookups → ledger/dossier scan (graph store in Phase 5); abstractive/conceptual → vector over playbooks; temporal → dated ledger scan; **current numbers → live fetch from systems of record, never memory**.
[RET-4] Mutual fallback: a weak primary-leg result MUST trigger the other leg before answering "unknown."
[RET-5] Generation MUST cite per claim using retrieved provenance. Citation reliability is imperfect; Section 14 QA sampling is mandatory, not optional.

---

## 8. Claim clearance gate

Principle: citation proves where a claim came from; **clearance decides whether and how it may leave the building**. A cited internal fact can still be inappropriate to send.

[GATE-1] Every chunk/evidence object carries a clearance class (DM-EVID enum) assigned at ingestion. Unclassified = `internal_only` (default deny).
[GATE-2] Decision table (claim type x source class), applied to every outbound draft before operator review:

| Claim type     | client_specific (same client)                         | aggregate_benchmark_cleared  | client_safe                                   | internal_only   | policy_sensitive          |
| -------------- | ----------------------------------------------------- | ---------------------------- | --------------------------------------------- | --------------- | ------------------------- |
| performance    | ALLOW cited                                           | ALLOW approved phrasing      | n/a                                           | DENY            | DENY                      |
| product        | n/a                                                   | ALLOW                        | ALLOW cited                                   | REWRITE or DROP | DENY                      |
| benchmark      | n/a                                                   | ALLOW approved phrasing only | DENY                                          | DENY            | DENY                      |
| policy         | n/a                                                   | n/a                          | quote/link canonical text only, no paraphrase | DENY            | quote/link canonical only |
| billing        | ALLOW (their own data)                                | n/a                          | ALLOW (canonical FAQ)                         | DENY            | DENY                      |
| recommendation | ALLOW with >=1 valid evidence object + effort honesty | ALLOW as support             | ALLOW as support                              | DENY            | DENY                      |

[GATE-3] Gate steps: parse draft into claims → classify type → check provenance against the table → freshness (DM-6) → cross-client check (any `client_specific` provenance from a different client = hard fail, TEST-8) → rewrite step (internal phrasing rewritten to external register preserving cited values; if no compliant phrasing exists, DROP the claim and flag the gap to the operator).
[GATE-4] Gate results are recorded in the draft envelope (`clearance_check`) and the audit log. A gate rejection MUST state which claim and which rule (GEN-2).
[GATE-5] The cleared-benchmark library and clearance rulings are operator-supplied configuration (Phase -1 section D); the model MUST NOT improvise them.

---

## 9. Outbound pipeline and autonomy ladder

[OUT-1] Draft lifecycle: `generated → gate(Section 8) → pending_approval → approved|edited|rejected → sent → logged`. Every transition appends DM-AUDIT.
[OUT-2] On send: log CI (with `countable_ci` per `ci_definition`), close any commitment it fulfills, append RS history, set follow-up if specified. (TEST-15)
[OUT-3] Channel policy: WhatsApp drafts MUST check the 24-hour service-window state per thread; outside it, only approved templates; opt-in state MUST be known per contact. Email: thread etiquette; no internal-only content (gate handles); reply-all hygiene.
[OUT-4] Escalation taxonomy (never autonomous): account suspensions/policy strikes, legal/compliance topics, spend commitments beyond AM authority, angry-client sentiment. These produce an internal escalation summary instead of a client draft.
[OUT-5] Autonomy ladder, per message category:

| Rung                          | Categories                                                 | Advancement gate                                                |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| 0 draft-only (launch default) | everything                                                 | n/a                                                             |
| 1 one-tap approve             | follow-up nudges, meeting confirmations, report deliveries | 4 weeks with >90% of category drafts sent unedited              |
| 2 batch approve               | cadence follow-ups, routine cited answers                  | sustained rung 1 + zero clearance failures in QA                |
| 3 auto-send + notify          | confirmations, scheduled report sends only                 | explicit policy sign-off + instant recall + weekly sample audit |

[OUT-6] Pitches, objection handling, numeric claims, and emotionally loaded messages are capped at rung 1 permanently. Rung state is configuration, never self-granted.

---

## 10. Orchestration constraints

[ORCH-1] Exactly one single-threaded writer produces output and mutates files. Sub-agents are read-only and return distilled conclusions + source refs ("contribute intelligence, not actions").
[ORCH-2] Permitted sub-agents: evidence-finder (signals per RS), benchmark-fetcher (cleared library), meeting-prep researcher. They MUST NOT draft outbound content or write files.
[ORCH-3] LOOP-6 processing is serialized per client (per-client write lock); concurrent processing of different clients is permitted.
[ORCH-4] Context assembly is per-task and minimal: task spec + relevant playbook slice + relevant dossier slice + live evidence. The full playbook corpus MUST NOT be loaded statically into every request.

---

## 11. Normative prompt components

[PRM-1] Standing system preamble (every task):

> You are the execution assistant for one Meta ads account manager. Every number you state must carry its source and as-of date. Never use one client's data in another client's context. If data is missing, say "no evidence" rather than estimating. Drafts are drafts: never imply anything was sent. Plain English reasons for every ranking or rejection. If you are uncertain or the topic is out of scope (legal, policy enforcement, suspensions), say so and prepare an escalation summary instead of answering.

[PRM-2] Cockpit prompt (LOOP-1, until fully programmatic): supply `book-plan.md`, `scorecard.md`, `coverage/*`, `queue/rs-queue.md`, today's calendar; instruct: "Regenerate today.md per the 7-section cockpit (SPEC ALG-8): pacing first, max 3 must-do + 7 optional, recovery before pitches when behind, roll forward unfinished must-dos labeled as rolled."
[PRM-3] Prep prompt (LOOP-4): "One page: relationship state + next best move; open commitments both directions; performance summary, every number cited with as-of date; top 3 RS with plain-English reasons; last interaction recap."
[PRM-4] Capture prompt (LOOP-4): "From these notes/transcript produce one batch: (1) CI record per DM-CI, (2) follow-up draft per the client's style.md, (3) commitment updates, (4) RS state changes. Flag anything inferred rather than heard."
[PRM-5] Drafting style defaults (overridden per client by style.md): match the client's register; one ask per message; numbers always with timeframe; avoid em-dashes; never reference other clients except via the cleared benchmark library.

---

## 12. Security, privacy, isolation

[SEC-1] The agent operates strictly under the AM's identity and permissions; it MUST NOT access data the AM cannot.
[SEC-2] Cross-client isolation is enforced at three layers: retrieval scoping (RET-1), gate cross-client check (GATE-3), and per-client context assembly (ORCH-4).
[SEC-3] All client data stays inside the platform boundary; no external services. PII in dossiers is minimized to business-contact data; anything beyond requires operator decision.
[SEC-4] The audit log (DM-AUDIT) is append-only and reviewable; approval records preserve the evidence shown at approval time.

---

## 13. Configuration constants

| Key                                                       | Default                                      | Calibrate?                  |
| --------------------------------------------------------- | -------------------------------------------- | --------------------------- |
| timezone / working_calendar                               | operator's region, with public holidays      | yes                         |
| ci_definition                                             | UNSET: official counting rule                | **REQUIRED before Phase 2** |
| ci_target, rs_close_target                                | per book-plan.md                             | **CALIBRATE** (scorecard)   |
| default_touches (unlisted clients)                        | 1/month                                      | yes                         |
| pacing thresholds (ahead/on_pace/behind)                  | 1.10 / 0.95 / 0.70                           | yes                         |
| daily_capacity_max                                        | 12 CIs/day                                   | yes                         |
| untouched_grace                                           | working day 5                                | yes                         |
| stale_touch_days / attention_window                       | 21d / 7d                                     | yes                         |
| undercoverage_factor                                      | 0.6                                          | yes                         |
| shelf lives: performance / contacts / playbook_stale_days | 7d / 90d / 90d                               | yes                         |
| must_do_cap / optional_cap                                | 3 / 7                                        | no (product decision)       |
| evidence_readiness thresholds                             | strong >=2 valid (or 1 decisive), moderate 1 | yes                         |
| grounding QA sample / target                              | 20 msgs/week / >95%                          | no                          |
| maintenance budget alert                                  | >15 min/week operator gardening              | no                          |
| autonomy rung state per category                          | all rung 0                                   | policy sign-off required    |

[CONF-1] While `ci_definition` or scorecard targets are UNSET/placeholder, every scorecard and cockpit MUST carry the banner: "PACING UNCALIBRATED: placeholder targets."

---

## 14. Conformance

### 14.1 Acceptance tests (run against the fixtures in this directory)

| ID      | Given fixtures, assert                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-1  | ALG-1 over `book-plan.md` + 21 CIs at working day 6 of 22 yields required_run_rate 5.45, actual 4.2, required_from_today 5.82 ± 0.05, `behind`, with a recoverability verdict line |
| TEST-2  | Cockpit must-do contains the acme-fitness one-pager (overdue commitment rule ALG-8a)                                                                                               |
| TEST-3  | bravo-retail surfaces with a value-first action and NO pitch (mood frustrated → R2/Section 10 suppression), despite a pinned RS existing                                           |
| TEST-4  | RS-2026-04412 is absent from the main queue, present in parked with its unblock_condition                                                                                          |
| TEST-5  | delta-beauty creative RS ranks above acme creative RS (urgency now + boost beats this_month at equal value bands... verify exact key comparison per ALG-5)                         |
| TEST-6  | foxtrot-cafe advantage_plus yields a discovery question, not a recommendation                                                                                                      |
| TEST-7  | A draft asserting "EMQ 4.2" without a claims-register entry is rejected (DM-14, GATE-3)                                                                                            |
| TEST-8  | A bravo-retail draft containing an acme-fitness evidence object hard-fails the gate                                                                                                |
| TEST-9  | A performance claim with fetched_at 9 days old is excluded from evidence and appears in the hygiene queue                                                                          |
| TEST-10 | Two `client_not_ready` rejections on one RS flip client_readiness to blocked with reason recorded                                                                                  |
| TEST-11 | A WhatsApp draft outside the 24h window without an approved template is refused with the rule named                                                                                |
| TEST-12 | An agent attempt to set relationship_state.trust_level without operator confirmation is blocked and logged                                                                         |
| TEST-13 | An eligibility signal over missing/NaN data yields local_state unscored + a data task, never a band                                                                                |
| TEST-14 | An unchecked must-do reappears next day labeled rolled with day count                                                                                                              |
| TEST-15 | Approving + sending the acme draft produces: audit entries, a CI record, commitment closure, RS-2026-04412 history append, follow-up set for 2026-06-10                            |
| TEST-16 | Solution coverage over fixtures marks exactly {creative_diversification, messaging} undercovered (ALG-3 with factor 0.6)                                                           |

### 14.2 Ongoing evaluation

- Golden question set: 20 per playbook (extractive, abstractive, temporal, should-escalate); rerun on every KB or prompt change; track citation correctness and refusal correctness.
- Weekly grounding QA: sample 20 sent messages containing claims; human-verify each claim against its citation; target >95%. Any clearance violation = sev-1 review.
- Operating metrics: pacing attainment, RS touched/pitched per week, draft acceptance rate + edit distance, overdue commitments trend, cockpit open rate and %-acted-on, operator gardening minutes/week.

---

## 15. Build phases (requirements activation)

| Phase                  | Scope                                                                   | Activates                                   | Exit criteria                                                             |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| -1 audit               | `phase-minus-1/audit-checklist.md` → integration reality memo           | CAP-1..2, GATE-5 inputs, CONF ci_definition | memo complete; Phase 2+ re-baselined                                      |
| 0 manual               | operator fills templates (top 10 dossiers, 5 playbooks, manual ledgers) | DM-\* as conventions                        | daily loop usable via PRM-2..4                                            |
| 1 retrieval            | index + citations + clearance labels at ingestion + golden questions    | RET-1..5, GATE-1, DM-12/14                  | >90% golden citation correctness                                          |
| 2 cockpit              | ALG-1..3, 6..8; LOOP-1; scorecard/coverage generation                   | GEN-3, CONF-1, TEST-1/2/14/16               | operator reports "I know what to do today"; untouched count trending down |
| 3 RS engine + outbound | ALG-4..5, LOOP-2/3/5, Section 8 gate, Section 9 pipeline, audit log     | TEST-3..8, 11, 13, 15                       | >=10 evidence-ready packs/day; draft acceptance >70% by week 12           |
| 4 capture              | LOOP-4 batches; commitments memory                                      | TEST-9/10/12                                | CI logging ~100%; overdue commitments → 0 trend                           |
| 5 events + temporal    | event triggers; temporal store; auto-resurfacing parked RS              | CAP rows 5/6; RET-3 graph legs              | only after Phases 2 to 4 metrics green 8 consecutive weeks                |

---

## 16. Non-goals

- No autonomous sending beyond rung policy (Section 9). No self-granted autonomy.
- No cross-AM data sharing in v1 (playbook sharing MAY come later as an org library; client data never).
- No replacement of systems of record: the RS system, CRM, and ad platforms remain authoritative; the brain annotates and acts through the AM.
- No benchmark/case-study generation: cleared library only.
- No relationship-state autopilot: trust/mood are operator-confirmed.

## 17. Required operator inputs (blocking)

1. Official CI definition + monthly targets (the real scorecard). Until supplied: CONF-1 banner.
2. Clearance rulings + cleared benchmark library (Phase -1 section D).
3. Working calendar (region/holidays), channel integrations available, and the approval-UI surface.
4. Book plan tiers for the real client list.

## Appendix A: fixture manifest _(informative)_

`book-plan.md`, `scorecard.md`, `coverage/*`, `queue/rs-queue.md`, `today.md` form one consistent mock (month 2026-06, day 6 of 22, behind). `clients/acme-fitness/*` + `drafts/2026-06-08-acme-fitness-capi-onepager-email.md` form one consistent client thread (call → objection → parked RS → overdue commitment → gated draft) exercising most requirements end to end. `clients/_TEMPLATE/*` and `playbooks/_TEMPLATE.md` are the blank shapes; `playbooks/capi.md` is the playbook quality bar; `MAP.md` is the operator manual.
