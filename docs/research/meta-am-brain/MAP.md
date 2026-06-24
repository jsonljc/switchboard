# The AM Second Brain: Map

This directory is the **Phase 0 skeleton** of the architecture in
[`../2026-06-07-meta-am-second-brain-architecture.md`](../2026-06-07-meta-am-second-brain-architecture.md) (v2).
It is usable today with nothing but Metamate chat + these files. Every file is either a TEMPLATE (copy, then fill) or an EXAMPLE (fictional data showing the quality bar; replace).

The spine everything serves:

```
monthly scorecard → client coverage → RS prioritization → evidence pack
       → draft → CI log → follow-up → next action
```

---

## Directory map

| Path                               | What it is                                                                                     | Owner class                           | Automated in              | Doc section  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------- | ------------ |
| `MAP.md`                           | this file: structure + operating loops                                                         | n/a                                   | never                     | n/a          |
| `SPEC.md`                          | normative implementation spec for the platform (schemas, algorithms, gates, conformance tests) | n/a                                   | n/a                       | all          |
| `phase-minus-1/audit-checklist.md` | capability + source-of-truth audit worksheet                                                   | you                                   | n/a (do FIRST)            | §14 Phase -1 |
| `book-plan.md`                     | monthly targets, priority clients, solution mix                                                | **human-owned**                       | drafted by agent, Phase 2 | §6.1         |
| `scorecard.md`                     | daily pacing math                                                                              | generated (manual in Phase 0, ~2 min) | Phase 2                   | §6.2         |
| `coverage/clients.md`              | who needs touching, by when                                                                    | generated                             | Phase 2                   | §6.3         |
| `coverage/solutions.md`            | solution-mix coverage vs plan                                                                  | generated                             | Phase 2                   | §6.3         |
| `today.md`                         | the daily cockpit (7 questions, pacing first)                                                  | generated                             | Phase 2                   | §11 L1       |
| `queue/rs-queue.md`                | ranked RS queue snapshot                                                                       | generated                             | Phase 3                   | §9           |
| `playbooks/_TEMPLATE.md`           | playbook template                                                                              | template                              | n/a                       | §7.3         |
| `playbooks/capi.md`                | worked playbook, the quality bar                                                               | EXAMPLE                               | n/a                       | §7.3         |
| `clients/_TEMPLATE/`               | dossier template (8 files)                                                                     | template                              | n/a                       | §7.2         |
| `clients/acme-fitness/`            | worked dossier, fictional client                                                               | EXAMPLE                               | enrichment Phase 4-5      | §7.2         |
| `drafts/`                          | outbound drafts awaiting approval                                                              | agent-generated, you approve          | Phase 3                   | §12          |
| `archive/`                         | closed RS, churned clients, stale playbooks                                                    | append                                | n/a                       | §7.4         |

Ownership classes (§7.4): **human-owned** = agent proposes diffs only. **AM-confirmed** = agent suggests, you confirm (relationship.md, contact merges). **Generated** = regenerable, agent/you overwrite freely. **Append-only** = ledgers; correct via correction entries, never edits.

---

## Operating loops (Phase 0: you are the pipeline)

**Daily (10 to 15 min, morning):**

1. Update `scorecard.md` counts (2 min: CIs logged yesterday, RS movement).
2. Regenerate `today.md` with Prompt A below.
3. Work the cockpit top-down. Approve/edit drafts; everything sent gets a CI entry.
4. Unfinished must-dos roll forward visibly tomorrow.

**Per client interaction:**

- Before: Prompt B (meeting prep one-pager).
- After: Prompt C (CI record + follow-up draft + commitment updates). Append the CI record to `clients/<x>/interactions/`, log it officially wherever CIs are counted.

**Weekly (Monday, 20 min):**

- Book review: pacing vs targets, coverage gaps, RS funnel movement, at-risk accounts.
- Hygiene queue: stale claims past shelf life (performance >7d, contacts >90d), dossiers over cap.
- Update `coverage/*.md`.

**Monthly:**

- Close out `scorecard.md`, archive it.
- Write next month's `book-plan.md` (you set targets; agent may draft).
- Quarterly: review profile.md strategy fields + playbook `last_reviewed` dates.

**Maintenance budget:** if file gardening exceeds ~15 min/week at steady state, the system is failing; simplify before adding anything.

---

## Phase 0 prompt recipes (until automation exists)

**Prompt A: cockpit.** Paste `book-plan.md` + `scorecard.md` + `coverage/*.md` + `queue/rs-queue.md` + today's calendar, then:

> Regenerate today.md per the 7-question cockpit format (pacing first). Max 3 must-do + 7 optional. If pacing is behind, recovery actions outrank pitches. Roll forward yesterday's unfinished must-dos and mark them as rolled.

**Prompt B: meeting prep.** Paste the client's dossier files, then:

> One-page meeting prep: relationship state + next best relationship move, open commitments both directions, performance summary (cite source + as-of date for every number), top 3 RS with plain-English reasons, last interaction recap.

**Prompt C: post-meeting capture.** Paste your raw notes/transcript + the dossier, then:

> Produce as one batch: (1) CI record in the standard format, (2) follow-up draft in this client's style.md register, (3) commitment updates, (4) RS state changes. Flag anything you inferred rather than heard.

**Standing rules for every prompt** (put in your Metamate system preamble if possible):

> Every number you state must carry its source and as-of date. Never use one client's data in another client's context. If data is missing, say "no evidence" rather than estimating. Drafts are drafts: never imply anything was sent.

---

## Fill order

**Week 1:**

1. Do `phase-minus-1/audit-checklist.md` in parallel with everything below.
2. `book-plan.md` with real targets (needs the real scorecard definitions: CI counting rules, RS targets).
3. Copy `clients/_TEMPLATE/` for your top 10 clients by book strategy (grow + defend tiers first). Fill profile, contacts, relationship, style honestly; leave performance/rs-ledger thin.
4. Adapt `playbooks/capi.md`; write 4 more for your highest-revenue RS families (likely advantage_plus, creative_diversification, click_to_message, billing-admin/troubleshooting FAQ).

**Week 2:** 5. RS ledgers for the top 10 clients (mirror only what you annotate; the RS system stays the source of record). 6. Start the daily loop. Measure: minutes-to-answer, prep time per meeting, CIs/day.

**Calibration warning:** all targets and percentages in the example files are placeholders. They must be calibrated to the real AM scorecard (the lost 77-line paste). Wrong pacing math is worse than none.
