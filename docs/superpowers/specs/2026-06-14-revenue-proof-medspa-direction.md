# Revenue-proof medspa: product direction

Status: direction spec (captured 2026-06-14). Drives the agent roadmap below.
Related: `docs/audits/2026-06-05-receipted-bookings-architecture/receipted-bookings-architecture-map.md`,
`project_receipted_bookings_architecture` (memory), `project_show_rate_recovery` (memory).

## One-line thesis

Switchboard converts AI work into **receipted bookings and receipted revenue** for medspas.
It is not "an AI receptionist for medspas". It is the system that turns AI actions into auditable revenue receipts.

## Why this framing (and not "AI revenue" / "AI receptionist")

The surrounding market is already crowded with vendors promising AI receptionists, concierges, lead managers,
and marketing automation for appointment-based and aesthetic businesses (Zenoti AI Workforce + AI Receptionist,
PatientNow Concierge, Podium Avery, HighLevel AI voice/booking). Competing on "our AI books more appointments"
means entering Zenoti's arena on Zenoti's home field.

The defensible position sits between the crowded layers: not just a booking bot, not just attribution, not just a
CRM, not just an observability console. It is the **reconciliation and proof layer across them**. The strongest
external analogues are not other chatbots; they are payment and observability systems:

- Stripe Payment Records: one primary record plus attempt records and an append-only event log that reconstructs
  the lifecycle of a payment. Activity logs carry actor, timestamp, affected resources, metadata. Role model
  recommends the lowest permission required.
- LLM observability (LangSmith, Langfuse, Arize Phoenix, Datadog): the **trace** is the core unit for knowing what
  an agent actually did across prompts, tool calls, and outputs.

Switchboard's moat combines both patterns for service-business revenue operations.

## North-star metric

**Weekly receipted bookings**: the count of bookings created in a week for which Switchboard can produce a
complete, reviewable proof chain. Not messages sent, leads answered, or conversations handled.

Secondary metrics: booked revenue, consent completeness, held appointment rate, attribution accuracy.

Two counting principles:

1. **Unattributed is not uncounted.** A booking with valid consent, trace, and booking evidence but weak source
   data still counts as a receipted booking, marked `unattributed` or low-confidence. This stops the product from
   gaming attribution accuracy by hiding hard cases.
2. **Held rate matures.** Held appointment rate is measured on receipted bookings that have passed their
   appointment date, not on all raw bookings.

## The receipted-booking object (the moat)

A receipted booking is a booking for which the system can show source, consent, trace, booking, attendance, and
(where available) payment evidence. Mental model: a financial event ledger, not a CRM note.

| Field                    | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `receipt_id`             | Stable identifier for the proof object                                          |
| `booking_id`             | Source-of-record booking identifier                                             |
| `contact_key`            | Pseudonymous patient/prospect key                                               |
| `source_evidence[]`      | Campaign IDs, lead-form IDs, UTM, call source, referral or self-reported source |
| `consent_id`             | Latest consent record used for the action                                       |
| `trace_id`               | Conversation / call / tool-execution trace                                      |
| `policy_check_id`        | Which guardrail or approval rule fired                                          |
| `human_approval_id`      | If any action required a person to approve it                                   |
| `expected_value`         | Quoted or catalogue expected revenue                                            |
| `attendance_state`       | confirmed, held, cancelled, no-show, rescheduled                                |
| `payment_event_ids[]`    | POS or payment evidence, if available                                           |
| `attribution_confidence` | deterministic, high, medium, low, or unattributed                               |
| `exceptions[]`           | missing source, missing consent, manual override, duplicate-contact risk        |

Receipt chain: ad/inbound source -> consent event -> conversation/call trace -> booking event in system of record
-> confirmation and attendance state -> POS/payment event -> receipted-booking object, with policy checks,
approvals, and confidence scoring attached.

## Launch agent roster

Important correction to the originating brief: the brief assigned recovery/show-rate to "Riley". In Switchboard,
**Riley is the ads optimizer and stays that way (not repurposed).** Recovery/show-rate is a **separate new agent,
Robin.**

| Agent      | Status              | Role                                                                                                                                                                                                               |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Alex       | existing            | Inbound demand capture and booking                                                                                                                                                                                 |
| Riley      | existing, unchanged | Ads optimizer (Spec-1B act-leg, budget reallocation, etc.)                                                                                                                                                         |
| Mira       | existing, deferred  | Creative / message variation. Returns later, trained on proven receipted outcomes                                                                                                                                  |
| Casey      | new                 | Consent, intake, and identity. Channel-scoped, seller-specific, time-stamped consent; revocation state; intake completeness                                                                                        |
| Ledger     | new                 | Receipt and attribution. Builds the receipted-booking object; reconciles source/consent/trace/booking/attendance/payment; computes attribution confidence; produces the weekly owner report. This is the core moat |
| Robin      | new                 | Recovery and show-rate. Confirmation, cancellation recovery, waitlist fill, no-show reconversion. Lifts held appointment rate                                                                                      |
| Quinn-lite | new, mostly hidden  | Policy, approvals, escalation. Decides auto-approve vs manager sign-off vs block; records every decision even when automatic. Exists from day one even if not marketed                                             |

Launch priority order: Alex + Casey + Ledger first (capture, consent, proof), with Quinn-lite thin but mandatory
behind the scenes. Add Robin once the booking proof spine is stable. Reintroduce Mira only after Ledger has a dense
corpus of receipted outcomes to learn from.

Buyer: owner / general manager / operations lead of a medspa, with a secondary committee of front-desk lead,
patient coordinator, or practice manager. Sold as a revenue-operations product with AI operators inside it, not as
a bundle of AI characters looking for a problem.

## Non-negotiable infrastructure layers

Switchboard does not own the canonical booking or clinical record on day one. The incumbents (Zenoti, Aesthetic
Record, Boulevard, PatientNow, NexHealth) do. Launch architecture is integration-first, not replacement-first:
one canonical event model with adapter connectors, one primary system-of-record adapter first.

1. Booking / EMR / POS system-of-record access (read + webhook/event at minimum).
2. Consent-aware communications hub (SMS, voice, WhatsApp, human takeover) as one orchestration layer.
3. Trace and observability store; attach a `trace_id` to every receipt.
4. Policy and approval layer (Quinn-lite) from day one.
5. Independent attribution data plane; Ledger computes source confidence and preserves unattributed cases.

## Compliance posture

Assume US healthcare-adjacent sensitivity unless proven otherwise. Key constraints that shape design:

- HIPAA safeguards: encrypt in transit and at rest, segment environments, log access, scope AI access by role.
- Minimum necessary / least privilege: agents get the lowest scope they need; separate booking logic from
  clinical data unless needed.
- Business associate agreements with any vendor touching PHI (comms, observability, tracking).
- Online tracking risk: appointment dates, emails, IPs, and authenticated-page data may be PHI in context. Do not
  put ad/analytics trackers on authenticated intake or booking flows for covered customers; use server-side,
  minimised, permissioned event forwarding.
- Consent is a compliance problem, not just a UX one: FCC/TCPA prior express written consent, A2P 10DLC, and
  WhatsApp opt-in are channel-specific and revocable. Casey stores channel, scope, seller, timestamp, and
  revocation state. Mass outbound is approval-gated through Quinn-lite.

Attribution itself is a compliance problem: do not copy the e-commerce "pixel everything" playbook. Use first-party
event collection, pseudonymous identifiers, server-side mapping, and explicit policy on what can be sent where.

## Current state vs target (delta as of 2026-06-14)

What already exists on `main` (the start of the receipt spine, feeding **Robin**, not Riley):

- Attendance foundation: `Booking.attendance` + `recordAttendance` + `booking.record_attendance` operator intent +
  attendance route (PR #1041).
- Held-appointment-rate read on the owner report (PR #1042).
- Consent-completeness read on the owner report (PR #1044). This is the early `consent_id` / registry signal Casey
  will own.
- Staff check-in UI that records attendance (PR #1050).

What is missing (gap to the receipted-booking object and the new agents):

- `receipt.ts` status enum is still `booked | held | paid | void`. No `exceptions[]`, `attribution_confidence`, or
  `source_evidence[]` on the receipt model yet.
- The next receipt-spine slice was `exceptions[]` (worktree `feat/receipt-exceptions` was initialized but no work
  committed).
- Casey, Ledger, Robin, and Quinn-lite do not exist in code or as agent specs. They are direction only until
  specced.

## Roadmap (directional)

| Window      | Focus                                        | Agent work                                             |
| ----------- | -------------------------------------------- | ------------------------------------------------------ |
| 0-3 months  | Establish the proof spine                    | Alex v1, Casey v1, Ledger-lite, Quinn-lite             |
| 3-6 months  | Make the weekly report indispensable         | Ledger v1, Robin v1, stronger Quinn-lite workflows     |
| 6-12 months | Expand from capture to reliable optimisation | Robin v2, Quinn full approval flows, Alex v2, Casey v2 |

MVP launch sequence:

1. Pick one system-of-record family only (chosen by design-partner concentration, not theoretical market size).
2. Ship Alex with Casey-dependent consent checks. No booking without permission control.
3. Ship Ledger-lite before Robin. If you cannot prove what Alex created, Robin optimises a foggy funnel.
4. Ship Robin once confirmation and attendance data are trustworthy.
5. Keep Quinn-lite thin but mandatory from day one.

## Positioning line

"Switchboard books your leads and proves which AI actions became receipted bookings."

Do not lead with "AI agents for medspa revenue", "AI receptionist", or "AI marketing automation".
