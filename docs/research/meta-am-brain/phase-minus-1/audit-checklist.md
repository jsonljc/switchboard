# Phase -1: Capability and Source-of-Truth Audit

Do this before committing any build beyond Phase 1. Output = the one-page **integration reality memo** at the bottom. Architecture doc reference: §14 Phase -1.

## A. Systems of record

| Question                                                                                                               | Answer | Verified how |
| ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------ |
| Where does RS state officially live? Update cadence?                                                                   |        |              |
| Can that system be subscribed to (events) or only polled/exported?                                                     |        |              |
| Where do CI logs officially live?                                                                                      |        |              |
| **What officially counts as a CI?** (the pacing layer is fake until this is exact)                                     |        |              |
| Where are ad-account signals queryable in structured form (spend, CPA, EMQ, creative age, frequency, learning status)? |        |              |
| Calendar access? Transcript access (calls/VC)?                                                                         |        |              |
| Email/WhatsApp thread visibility?                                                                                      |        |              |

## B. Metamate capability matrix

Status: native / buildable / impossible. If impossible, the fallback becomes the plan.

| #   | Capability                                                  | Status | Fallback                              | Owner | Notes |
| --- | ----------------------------------------------------------- | ------ | ------------------------------------- | ----- | ----- |
| 1   | Retrieval index over an AM-controlled corpus, per-AM scoped |        | paste-relevant-file workflow          |       |       |
| 2   | Agent read/write to files with history                      |        | agent proposes diffs, you apply       |       |       |
| 3   | Tool calls: ad insights, RS system, CRM/CI log, calendar    |        | scheduled manual exports              |       |       |
| 4   | Scheduled jobs (daily cockpit)                              |        | run it manually each morning          |       |       |
| 5   | Event triggers (email in, transcript final, signal change)  |        | stay on schedules (Phase 5 blocked)   |       |       |
| 6   | Graph/temporal store                                        |        | files + vector only (Phase 5 blocked) |       |       |
| 7   | Long-context model with reliable citation behavior          |        | tighter slices + heavier QA           |       |       |
| 8   | Email/WhatsApp send integration + approval UI               |        | copy-paste drafts                     |       |       |
| 9   | Audit log of agent actions                                  |        | append-only log file                  |       |       |

## C. Permissions and boundaries

- [ ] Agent acts strictly as me: same data visibility, no more.
- [ ] Read vs write confirmed per system in section A.
- [ ] Export fallbacks confirmed where APIs are absent (what can I download, how often).
- [ ] Client-data boundaries: what client A data may never appear near client B (confirm against policy, not intuition).

## D. Clearance rulings (configures the claim clearance gate, doc §8.3)

- [ ] What may be cited to clients from internal dashboards (their own account data: presumably yes; confirm format rules).
- [ ] The approved benchmark library: does one exist? Who owns it? What phrasings are approved?
- [ ] Policy claims: confirmed canonical sources to quote (help center / policy pages), and the no-paraphrase rule.
- [ ] Billing/finance claims: what is safe beyond the client's own invoices + canonical FAQ.
- [ ] AI-drafted comms policy: is disclosure required? Is per-message human approval mandated (assume yes)? Any category that may ever auto-send?
- [ ] WhatsApp specifics for AM-to-client messaging: window rules, template rules, opt-in records.

## E. The minimum viable manual loop

Define deliberately what stays manual in Phase 0:

- [ ] Who updates scorecard counts each morning (you, 2 min).
- [ ] Where official CI logging happens and how the brain's CI records map to it.
- [ ] Which dashboards you export weekly and where the files land.
- [ ] What you will NOT track yet (so it is a decision, not an accident).

## Integration reality memo (the deliverable)

> **Date:**
> **Systems of record:** RS = … (poll/export cadence …). CI = … (counting rule: …). Signals = … (export: …).
> **Metamate can:** …
> **Metamate cannot (fallbacks engaged):** …
> **Clearance rulings:** …
> **Phase 2 feasible by:** … **Phase 3 feasible by:** … **Phase 5 blocked on:** …
> **Decision:** proceed / re-scope.
