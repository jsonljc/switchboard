# Switchboard — Ranked Audit Plan (Phase 2)

_Read-only audit. Written 2026-06-10. Audience: non-technical founder._

## How I ranked these

Each audit is scored on two things, multiplied together:

- **Business risk** — if a defect exists here, how bad is it? (patient-data breach and "an agent did something costly that a human never approved" are the worst.)
- **Likelihood of real defects** — based on concrete signals the Phase-1 exploration already turned up, not guesswork. Where Phase 1 found actual code that looks wrong, likelihood is High.

I also weighted toward **"verify, don't re-discover."** This repo already has 12 internal audits, several with open critical findings. A good chunk of this work is confirming whether known issues are still live, with fresh eyes and proof.

One honest caveat: the Phase-1 scan read code in excerpts. Several signals below are strong but not yet 100% confirmed (a few were flagged "not fully visible"). The deep audits exist precisely to confirm or kill each one with file-and-line proof. So treat the rankings as well-founded, not final.

## The ranking at a glance

| #   | Audit                                               | Business risk    | Likelihood | Why it's here                                                                                           |
| --- | --------------------------------------------------- | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Multi-tenant data isolation                         | Critical         | High       | Several database reads fetch records by ID with no clinic filter                                        |
| 2   | Authorization & governance enforcement              | Critical         | High       | Known approval-bypass path + a global self-approval flag + routes trusting a header for clinic identity |
| 3   | Webhook & input validation at the edge              | High             | Medium     | One lead webhook flagged as possibly unauthenticated; lead data parsed without schema                   |
| 4   | Background-job safety (double-send / double-charge) | High             | Med-High   | Lead retry can re-post; multi-step creative jobs aren't transactional                                   |
| 5   | PII & PDPA exposure                                 | High             | Medium     | Full chat text sent to the LLM; raw message payloads stored with no deletion policy                     |
| 6   | Data integrity (transactions, races, constraints)   | Med-High         | Medium     | Known money-flow findings; partly mitigated already                                                     |
| 7   | Secrets & configuration                             | High if breached | Low        | Phase 1 found the code clean; risks are operational, not in code                                        |
| 8   | Dependency vulnerabilities                          | Low-Med          | Known      | Scan already done; criticals are in dev-only tooling                                                    |

---

## 1. Multi-tenant data isolation — _can Clinic A ever see Clinic B's data?_

**Risk: Critical. Likelihood: High.**

This is the single most important audit. The whole system is one shared application serving many clinics; the only thing stopping one clinic's patient list, conversations, and bookings from leaking to another is that every database query correctly filters by `organizationId`. The medical-aesthetics + Singapore/Malaysia PDPA context makes a leak both a legal and a trust catastrophe.

Phase 1 found concrete soft spots: the repo's automated gate only checks that **writes** are clinic-scoped — **reads are not equally policed**, and several store functions fetch a record by its bare ID with no clinic filter (`getById(id)` in the workflow, work-trace, recommendation, and creative-job stores). Separately, a cluster of tables (e.g. `CreatorIdentity`, `DispatchLog`, `TrustScoreRecord`) have no clinic stamp at all and reach an owner only indirectly. Whether each of these is actually reachable cross-clinic depends on whether the calling route re-checks ownership — that's exactly what this audit traces, end to end, for the highest-PII tables.

**Deep audit will:** enumerate every Prisma read/write touching PII or money; for each, trace from the HTTP route to the query and confirm a clinic filter exists somewhere on the path; produce a list of any query reachable with another clinic's ID, each with file:line and a plain-English "what could leak."

## 2. Authorization & governance enforcement — _do approvals actually hold?_

**Risk: Critical. Likelihood: High.**

You sell governance — the promise that risky/expensive agent actions are blocked until a human says yes. This audit verifies that promise is enforced by the server, not just shown in the UI.

Phase 1 surfaced specific, named concerns. (a) A fast-path approval mode (`system_auto_approved`) short-circuits the approval lookup; a prior internal audit (Riley 7.1 / issues #788, #931) flagged that this can skip spend-limit checks — needs re-confirmation that financial intents can't ride it. (b) A single global flag (`ALLOW_SELF_APPROVAL`) lets an action's originator approve their own work, with no per-clinic scoping. (c) Two API routes (`dashboard-reports`, `dashboard-automations`) overwrite the authenticated clinic identity from a request header — fine in dev, dangerous if reachable in prod. (d) The governance decision is handled with if/else where an unexpected verdict could "fall through" to execute.

**Deep audit will:** trace the approval lifecycle from "action parked" to "action runs" and prove an unapproved action cannot execute; confirm whether `system_auto_approved` and the spend gate interact safely; check every place clinic identity is set from request input; verify the approve/reject routes' own auth.

## 3. Webhook & input validation at the edge — _can someone forge an inbound message or lead?_

**Risk: High. Likelihood: Medium.**

The chat and API servers expose public "doorbell" endpoints to WhatsApp/Meta, Telegram, Slack, and Stripe. If signature checks are missing or weak, an attacker could inject fake leads (creating fake patients and triggering outbound WhatsApp), forge payment events, or poison ad actions.

Phase 1 is mostly reassuring here — WhatsApp, Telegram, Slack, Stripe, and the Meta lead webhook all appear to verify signatures with timing-safe comparisons and fail closed in production. **But** two agents disagreed about one endpoint: the Meta lead webhook (`/api/webhook/lead`) was described once as "Open (no auth)" and once as "signature-verified." That contradiction must be resolved. Also flagged: lead form data parsed without a schema, and no Content-Type checks on some webhooks.

**Deep audit will:** resolve the lead-webhook contradiction with proof; confirm every public endpoint verifies its signature (and rejects on failure) and that Zod validation runs on each body; check replay-window handling.

## 4. Background-job safety — _can a retry double-send a WhatsApp or double-charge?_

**Risk: High. Likelihood: Medium-High.**

About 23 jobs run unattended (follow-ups every 15 min, hourly reminders, weekly ad audits, token refresh, Stripe sync, creative pipelines). The danger with automatic retries is repeating a side effect: messaging a patient twice, double-booking, or re-posting a lead.

Phase 1 found the **message senders are mostly well-guarded** (dedup keys + terminal-status checks before sending) — good. The real concerns are narrower: the **lead-retry job has no idempotency on its submit**, so if one bookkeeping step fails it can re-post the same lead indefinitely; the **creative/UGC video jobs do several database writes without a transaction**, so a mid-way crash leaves a job stuck and unpublishable; and **Meta token refresh** can persist a stale token if a write fails. Double-charging looks low-risk because charges are Stripe-side, but that needs confirming.

**Deep audit will:** for every job with an outbound side effect, confirm the side effect is replay-safe (guarded before send, or naturally idempotent); confirm multi-step writes either tolerate partial failure or use a transaction; confirm exhausted retries raise an operator alert rather than vanishing.

## 5. PII & PDPA exposure — _where does patient data go that it shouldn't?_

**Risk: High. Likelihood: Medium.**

Under Singapore/Malaysia PDPA, patient and lead data (names, phones, full conversation text, booking details) must be handled with care and be deletable.

Phase 1 found good hygiene in places (phone/email hashed before Meta; contact name-only sent to the LLM with phone/email stripped) but several exposure points worth a focused look: **full conversation text is sent to Anthropic** on every agent turn (probably necessary and acceptable, but needs to be a documented, contracted data flow); **raw inbound webhook payloads are stored in a dead-letter table with no deletion/TTL policy**; **job payloads sent to Inngest Cloud** may carry conversation context; and patient **name+email are written into Google Calendar events**. The deletion-request webhook exists but its coverage needs checking.

**Deep audit will:** grep logs/errors for raw PII; map exactly what PII leaves to each third party and whether it's needed; check retention/deletion (does a patient-delete actually purge the DLQ, caches, calendar?); list each exposure with a PDPA-framed "is this defensible" note.

## 6. Data integrity — _transactions, race conditions, constraints, migrations_

**Risk: Medium-High. Likelihood: Medium.**

Concerns the accuracy of money and bookings under concurrency. Phase 1 shows the team has already applied the right tools in the hot spots — database advisory locks on bookings and the audit ledger, partial-unique constraints to prevent duplicate live bookings and duplicate payment events. A prior internal audit (receipted-bookings) nonetheless flagged critical money-flow risks (duplicate booking writes, insider revenue inflation, consent-as-precondition). This audit overlaps with #4 and largely **verifies whether those known findings are now closed**.

**Deep audit will:** re-test the known money-flow findings against current code; spot-check multi-write paths for missing transactions; confirm idempotency/unique constraints exist where concurrent writes happen; scan migrations for unsafe destructive operations.

## 7. Secrets & configuration

**Risk: High if breached. Likelihood: Low.**

Ranked lower because Phase 1 already largely cleared it: **no `.env` files or real keys are committed**, browser-shipped variables are all non-sensitive, and the apps refuse to boot in production without their encryption key. The residual risks are **operational, not code defects** — real production keys sit in this machine's local (gitignored) `.env`; there's no documented rotation plan for the encryption/session secrets; and a known deploy-config gap (`SWITCHBOARD_API_KEY` missing from the deploy file, "F-15") blocks chat ingress. Worth a short confirmation pass, not a deep hunt.

**Deep audit will:** re-confirm nothing sensitive is committed or shipped to the browser; document the key-rotation gap and the F-15 deploy gap; check that missing critical secrets fail loudly rather than silently disabling protection.

## 8. Dependency vulnerabilities

**Risk: Low-Medium. Likelihood: Known (already scanned).**

I already ran the dependency scan: **14 issues — 2 critical (1 already suppressed), 11 moderate, 1 low.** The visible high-severity ones are in **development-only build tooling** (the linter's `brace-expansion`, and `turbo`), not in code that runs in production serving patient traffic. This is the lowest-leverage item; I'll finish it quickly and tell you which (if any) touch the running product.

**Deep audit will:** classify each advisory as production-path vs dev-only, give the one-line upgrade for anything on the production path, and note the suppressed critical's justification.

---

## Suggested execution order

Run in rank order, but **1 and 2 first and deepest** — they're where a real defect would hurt most and where Phase 1 evidence is strongest. 3–6 are focused confirmations with real but contained risk. 7–8 are quick closeouts. I can fan out parallel agents per audit to move quickly.
