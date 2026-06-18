# Robin v1: recovery and show-rate (scope and determination)

Status: scope spec (captured 2026-06-18). This is the design-spec slice for Robin v1, the last new
agent in the revenue-proof MVP roster (Alex, Casey, Ledger-lite, Quinn-lite, Robin). Unlike the
Casey and Quinn-lite determinations, Robin is **genuinely new**: the recovery workflows and the
mass-outbound approval gate do not exist on `main`. But Robin v1 is still **lean by reuse**: it
builds on Casey's consent gates, Quinn-lite's GovernanceGate, the attendance read foundation, and
the existing proactive-send infrastructure, adding only the two pieces the roster reserves for it.

Parent direction: `docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md` (PR #1052).
Related memory: `project_revenue_proof_direction`, `project_show_rate_recovery`. Sibling
determinations: Casey v1 (`2026-06-16-casey-consent-identity.md`, PR #1122), Quinn-lite v1
(`2026-06-17-quinn-lite-policy-approvals.md`, PR #1136).

## One-line

Robin is the governed capability that owns the **recovery and show-rate leg** of the
receipted-bookings thesis: it re-engages lost appointments to recover bookings and lift the held
appointment rate. Following the Ledger-lite, Casey, and Quinn-lite precedent, "Robin" is a
capability (a governed campaign intent + an approval gate + a consent-gated send path + observe
reads), **not** an LLM agent shell.

## Determination (the headline)

Ground truth on `main` (verified 2026-06-18, file:line below) shows the recovery leg is genuinely
unbuilt: there is no recovery, reconversion, cancellation-recovery, or waitlist workflow or intent,
no "robin" agent, and the mass-outbound approval gate that Quinn-lite explicitly deferred to Robin
does not exist (grep confirms zero live matches). What **does** exist is the entire substrate Robin
reuses, so Robin v1 is a small, bounded build, not a from-scratch agent.

Robin v1 adds exactly the two pieces the roster reserves for it, and nothing else:

1. **The mass-outbound approval gate** (Quinn-lite's deferred prerequisite). Every recovery campaign
   routes through `GovernanceGate` for manager sign-off via a seeded `require_approval` policy, the
   same mechanism Riley's budget moves already use.
2. **One recovery workflow**: **no-show reconversion**. A consent-gated, approval-gated re-engagement
   of patients recorded as `no_show`, to recover the lost booking. Chosen over the three other
   candidate workflows for the reasons in fork (a).

Everything else (additional recovery workflows, the recipient-count auto-approve threshold, a
two-way confirmation flow) is deferred with a documented reason. Robin v1 is **safe by
construction**: it sends nothing until an operator both flips a default-off per-org flag and (for
every campaign) approves it. The proactive-patient-outreach compliance posture is therefore an
**operational go-live decision**, not a build blocker, exactly as Casey's `consentState.mode` flip is.

## Ground-truth map: what already exists vs the genuine gap

| Robin responsibility                                       | Status                   | Evidence (file:line on `main`)                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attendance data (the no-show signal)                       | BUILT                    | `Booking.attendance` nullable `attended`/`no_show` + `@@index([organizationId, attendance])` `packages/db/prisma/schema.prisma:2056-2069`; `recordAttendance` `packages/db/src/stores/prisma-booking-store.ts:186-195`; staff check-in UI (#1050)                                             |
| Held-rate read (the metric)                                | BUILT                    | `computeHeldRate` (attended/matured, NaN-safe) `packages/core/src/reports/compute-held-rate.ts:5-16`; `countMaturedAttendance` `prisma-booking-store.ts:285-301`                                                                                                                              |
| Booked->held promotion                                     | BUILT                    | `promoteCalendarBookedToHeld` `packages/db/src/stores/prisma-receipt-store.ts:56-74`, called from `record_attendance` on `attended` `apps/api/src/bootstrap/operator-intents/attendance.ts:59-64`                                                                                             |
| Consent send-eligibility (reuse, never bypass)             | BUILT                    | `evaluateProactiveSendEligibility(input) -> {eligible:true,template} \| {eligible:false,reason}` `packages/core/src/notifications/proactive-eligibility.ts:39-88`; PDPA proactive matrix blocks pending+revoked `packages/schemas/src/pdpa-consent.ts:75-104`; 24h window + approved-template |
| Org-scoped consent reader                                  | BUILT                    | `ContactConsentReader.read(orgId, contactId)` `packages/core/src/consent/contact-consent-reader.ts:11-15`; impl org-scoped post-IDOR-fix #1134 `packages/db/src/prisma-contact-consent-reader.ts:12-13`                                                                                       |
| GovernanceGate + approval lifecycle                        | BUILT                    | `GovernanceGate.evaluate` `packages/core/src/platform/governance/governance-gate.ts:143-271`; `require_approval` from a seeded policy `packages/core/src/engine/policy-engine.ts:327`; park->notify->approve->dispatch `platform-ingress.ts:304-395` + `lifecycle-dispatch.ts`                |
| Proactive-send infra (reuse)                               | BUILT                    | `conversation.reminder.send` / `conversation.followup.send` / `meta.lead.greeting.send` workflows `apps/api/src/bootstrap/contained-workflows.ts:383-537`; Inngest crons; seeded `{id:"system",type:"system"}` principal `apps/api/src/services/workflows/reminder-send-request.ts:13-26`     |
| Send-dedup primitive                                       | BUILT (reusable pattern) | `ScheduledReminder.dedupeKey` / `ScheduledFollowUp.dedupeKey` unique `schema.prisma:2237-2294`                                                                                                                                                                                                |
| Recovery / reconversion workflow or intent                 | NOT BUILT                | grep: zero live matches for recovery/reconversion/no_show_recovery/cancellation_recovery intents; not in `contained-workflows.ts`                                                                                                                                                             |
| Mass-outbound approval gate                                | NOT BUILT (Robin's job)  | Quinn-lite spec fork (c): today's transactional sends are correctly `approvalPolicy:"none"`; no mass/campaign send path exists yet                                                                                                                                                            |
| Org-scoped list-by-status / by-attendance / by-window read | NOT BUILT (gap)          | `prisma-booking-store.ts` has only counts (`countMaturedAttendance`, `countConfirmed`) + per-contact `findUpcomingByContact`; no org-level list of no-shows in a window                                                                                                                       |

## The four product forks, resolved

### (a) Which single recovery workflow: NO-SHOW RECONVERSION

Candidates considered, against the criteria "genuinely new + reliably-populated trigger + highest
leverage + leanest":

- **Appointment confirmation (rejected for v1).** A show-up reminder already exists
  (`conversation-reminder`, hourly, over `status="confirmed"` bookings in a +-24h window, consent-gated).
  A "confirmation of unconfirmed upcoming bookings" workflow would target `status="pending_confirmation"`,
  but Alex **auto-confirms** inside the booking transaction (`calendar-book.ts:431` sets
  `status:"confirmed"` on success), so `pending_confirmation` is transient and that cohort is
  effectively empty (only failed/abandoned bookings linger). A two-way confirm/reschedule reply flow
  is a real v2 enhancement, but it overlaps the existing reminder and is not the leanest new lever.
- **Cancellation recovery (deferred to v2).** Re-engage `status="cancelled"` bookings. Genuinely new
  and viable (cancellations are reliably recorded by `cancel()`), but lower-leverage than a no-show
  for held-rate (a cancellation is an explicit decline; a no-show is a slot the clinic held and lost)
  and structurally identical to no-show reconversion, so it is the natural second workflow once the
  campaign machinery exists.
- **Waitlist fill (deferred).** Needs a new waitlist data model (the existing `WaitlistEntry` is the
  unrelated public marketing signup), the heaviest build, and depends on a slot-availability read
  Robin does not yet have. Out of v1.
- **No-show reconversion (CHOSEN).** Re-engage patients recorded `attendance="no_show"` to rebook the
  lost appointment. It is genuinely new (zero existing infra), it sits on the substrate built **for
  Robin** (the attendance axis, the `@@index([organizationId, attendance])`, the booked->held weld),
  its trigger is reliably populated by the staff check-in UI, and it is the highest-dollar recovery
  play (a no-show is a fully-lost held slot).

Honest note on the metric: the held appointment rate (attended/matured) is most **directly** lifted
by preventing upcoming no-shows, which the existing reminder already partly serves. No-show
reconversion lifts the metric **indirectly but durably**: a recovered patient who rebooks and attends
is a new held appointment, and it recovers revenue the reminder cannot. v1 picks the genuinely-new,
reliably-populated, highest-dollar lever and defers the confirmation enhancement.

### (b) The mass-outbound approval gate: a seeded require_approval policy, every campaign

A recovery campaign is a batch proactive send, exactly the mass-outbound case Quinn-lite reserved for
Robin. Ground truth on the gate mechanism:

- `approvalPolicy` on an intent is `"none" | "threshold" | "always"`, but `"always"` is **not consumed**
  by `GovernanceGate` (it is only metadata, `work-unit-adapter.ts:57`). The `require_approval` outcome
  is produced by the **policy engine** from a **seeded anchored policy** with
  `effect:"require_approval"` and a mandatory `approvalRequirement` (`policy-engine.ts:327`). This is
  the same mechanism Riley's budget moves use (`packages/db/src/seed/riley-budget-governance.ts`: "the
  seeded require_approval(mandatory) policy is the real human gate").
- The approval `threshold` machinery is **spend-amount only** (`spend-approval-threshold.ts:56` no-ops
  on a non-financial action; the spend extractor reads only `SPEND_KEYS`). It **cannot** key on a
  recipient count without re-architecting the post-processor.

**v1 gate (chosen, leanest correct):** register a `robin.recovery_campaign.send` intent that is **not**
`system_auto_approved` (so it does not short-circuit the approval lookup), and seed an anchored
governance policy unit for it that yields `require_approval`, mirroring `riley-budget-governance`. The
implementation follows the Riley pattern exactly, not a lone policy: an anchored **allow** policy
paired with a mandatory **require_approval** policy for the same intent (the seed's own doctrine is
"never seed one without the other", because the engine default-denies an unmatched intent), plus a
**real-gate seed test** asserting that a submitted campaign actually parks, so the allow/approval
coupling cannot silently drift. (A lone require_approval policy does happen to work, the engine flips a
null decision to allow while setting the approval override at `policy-engine.ts:329-331`, but matching
the precedent and its test is the safer choice.) Every recovery campaign therefore parks for manager
sign-off through the existing lifecycle (park -> notify -> approve -> dispatch). This is the
mass-outbound gate in its simplest correct form: nothing in a campaign sends without a human approving
the campaign.

**Deferred to v2 (recipient-count auto-approve-below-N):** relaxing small campaigns to auto-execute
needs either a policy rule conditioned on a `recipientCount` payload field (a policy-condition
capability to verify) or a generalization of the spend threshold to an arbitrary dimension (a
governance-engine change). Neither is required for a safe v1; requiring approval for every campaign is
strictly safer and simpler. The recipient count is still carried on the campaign payload and surfaced
on the approval card so the manager sees the blast radius.

### (c) Trigger and governance: a cron assembles a campaign, submits one governed intent

- **Trigger:** an Inngest cron (mirroring `appointment-reminder-dispatch`) that, for each org whose
  recovery flag is `enforce`, scans no-show recovery candidates over a recent window (a new org-scoped
  store read on the attendance index), assembles a campaign, and submits **one**
  `robin.recovery_campaign.send` intent through `PlatformIngress.submit()` with the seeded
  `{id:"system",type:"system"}` principal (a bespoke `system:<x>` id would hard-deny). The intent is
  non-financial (a recovery send carries no outbound money, so it is not on the
  `FINANCIAL_AUTO_APPROVE_DENYLIST` and does not trip the financial guard), `mutationClass:"write"`,
  idempotent, with `allowedTriggers` covering the cron path.
- **Gate:** the seeded `require_approval` policy parks the campaign. `PlatformIngress` creates the
  gated lifecycle, notifies the approver, and on approval dispatches the **frozen** campaign payload.
- **Send:** the executor, on dispatch, iterates the campaign's candidate cohort and for **each**
  recipient calls `evaluateProactiveSendEligibility` (consent proactive matrix + 24h window + approved
  template). Ineligible recipients are skipped with a recorded reason; eligible recipients get the
  re-engagement WhatsApp template. Consent is never bypassed.
- **Persistence and dedup:** a durable per-(org, booking, campaign-kind) record gives idempotent
  dedup (never re-contact the same no-show within a cooldown, a patient-comms safety requirement) and
  an audit trail, following the `ScheduledReminder.dedupeKey` pattern. The exact column shape is pinned
  in the implementation plan; the write is a normal store write (not inside the canonical booking tx),
  so the "infallible-by-construction inside the booking tx" constraint does not apply here.
- **WorkTrace:** every campaign submission and every send outcome is WorkTraced and org-scoped; the
  receipted-booking read-model is never a parallel control plane.

### (d) Enforcement vs measurement: v1 sends, but is safe by construction

v1 **sends** (queued-and-observe-only would not exercise the gate or the consent path, the two pieces
worth building), but every layer is fail-safe and default-off:

- **Per-org flag** `governanceConfig.recovery.mode`, reusing the existing `GovernanceModeSchema`
  (`off`/`observe`/`enforce`, default `off`) for consistency with `consentState.mode`, no new enum:
  - `off` (default): fully inert. No candidate scan, no campaigns, no sends.
  - `observe`: identify candidates and surface the observe tile, but submit no campaign and send
    nothing (telemetry-only rollout).
  - `enforce`: the live behavior, the cron assembles and submits campaigns, which then require manager
    approval before any send, each send consent-gated.
- The flag ships with its producer (the resolver + the cron's read of it) in the **same PR**, tested
  from real defaults so an unconfigured org is provably inert.

Nothing reaches a patient until an operator flips the org to `enforce` **and** approves the campaign
**and** the recipient passes the consent gate. The compliance question "must every recovery send be
manager-approved?" is therefore answered **yes, by construction** in v1. This is why v1 needs no
compliance ruling to build; see "Go-live levers" for the operational decisions the owner owns.

## v1 architecture (the units)

Layering holds throughout: schemas (L1) -> core (L3, no db) -> db (L4) -> apps (L5).

1. **Recovery-candidate read (db + core).** `PrismaBookingStore.findNoShowRecoveryCandidates(orgId,
window, now)` (org-scoped, on the attendance index), plus a pure `selectRecoveryCandidates` in
   `core/recovery` that filters the cohort (exclude patients who already hold a future booking, exclude
   recently-contacted via the dedup record). NaN-safe.
2. **Observe surface (core reports + dashboard).** A read-only owner-report tile counting no-show
   recovery candidates in the period, mirroring the held-rate tile (store count -> `computeX`
   sub-rollup -> `ReportDataV1` field -> tile). Delivers value in `observe` mode before any send.
3. **The recovery flag (schemas).** `governanceConfig.recovery.mode` + `resolveRecoveryConfig`,
   default `off`.
4. **The campaign intent + gate (core platform + db seed).** `robin.recovery_campaign.send`
   registration (not `system_auto_approved`) + the seeded anchored `require_approval` policy.
5. **The executor + consent-gated send (apps/api).** The dispatch handler iterating the cohort,
   consent-gating each send via `evaluateProactiveSendEligibility`, sending the WhatsApp template.
6. **The cron trigger + dedup persistence (apps/api + db).** The Inngest cron and the durable
   campaign/send dedup record (+ migration).

## Slice plan (PR-sized, build-loop)

| Slice | Scope                                                               | Merge-stop globs touched                            | Expected disposition |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------- | -------------------- |
| S0    | This scope spec                                                     | none (path has no consent/governance/send token)    | auto-merge candidate |
| S1    | Recovery-candidate read + observe tile                              | none (pure read, no schema/governance/send)         | auto-merge candidate |
| S2    | `recovery.mode` flag + resolver + producer                          | `**/*governance*` (governance-config)               | surface merge-ready  |
| S3    | Campaign intent + seeded require_approval policy + executor         | governance + PlatformIngress + external send        | surface merge-ready  |
| S4    | Cron trigger + consent-gated send + dedup persistence (+ migration) | external send + `**/prisma/**` + `**/migrations/**` | surface merge-ready  |

S3 depends on S2 (reads the flag); S4 depends on S3 (submits the intent). S1 is independent of S2-S4
and can land first as the observe deliverable.

## Go-live levers (operational, not a build)

To turn Robin on for a clinic, no code ships beyond v1:

1. Ensure consent is populated (Casey's `operator.grant_consent` or inbound capture) so recovery sends
   pass the PDPA proactive gate; ensure an approved re-engagement WhatsApp template exists.
2. Set per-org WhatsApp send credentials (the known multi-tenant creds follow-up in
   `project_revenue_proof_direction`) so the org sends from its own number.
3. Flip `governanceConfig.recovery.mode`: `off` -> `observe` (watch the candidate tile) -> `enforce`
   (campaigns submit and await approval).
4. The owner/manager approves each parked recovery campaign from the decisions surface.

## Open decisions (compliance/product calls, owed at v2 or go-live)

These are owner/compliance calls, not engineering defaults:

1. **Proactive-outreach jurisdiction posture.** v1 requires manager approval for every campaign and
   consent for every recipient, which is the safe default for SG/MY PDPA and TCPA-adjacent contexts.
   Whether a jurisdiction permits **auto-approved** (no manager sign-off) recovery outreach, and under
   what consent basis, is the owner/compliance call that gates the v2 recipient-count threshold. Until
   ruled, v1's every-campaign-approved posture stands.
2. **Recipient-count auto-approve threshold** (v2): the count below which a campaign auto-executes, and
   whether it is per-org or per-campaign. Depends on (1) and on a governance-engine capability.
3. **Cooldown and frequency caps**: how long after a no-show before re-engagement, and the maximum
   recovery attempts per patient. v1 picks a single conservative attempt with a cooldown; the exact
   values are an owner preference.
4. **The second workflow** (cancellation recovery, then confirmation reply-handling, then waitlist):
   sequenced after v1 proves the campaign machinery.

## Out of scope

- Cancellation recovery, waitlist fill, and two-way confirmation reply-handling (each its own later
  slice, reusing the v1 campaign machinery).
- The recipient-count auto-approve threshold (v2; needs a policy-condition or threshold
  generalization, and decision (1) above).
- Mira (creative) and any LLM agent shell. Robin is a governed capability, not a character.
- Rebuilding GovernanceGate, the approval lifecycle, the consent gate, or the proactive-send infra
  (all reused).

## Non-negotiables (inherited, for any Robin slice)

PlatformIngress is the only mutating entry; WorkTrace stays canonical; approval is lifecycle state,
not a route-owned side effect; the receipted-booking read-model is never a parallel control plane.
Layering schemas L1 -> core L3 (no db) -> db L4 -> apps L5. Every read/write leg org-scoped (the
F12 / consent-reader IDOR lesson: any `*Reader` / `*Store` read keyed on a bare id needs an
`organizationId` filter). NaN-safe math. **Consent-gate every proactive send** via
`evaluateProactiveSendEligibility`, never bypass it. **Mass/proactive campaigns are approval-gated**
through the seeded `require_approval` policy. `system_auto_approved` is never used for a recovery
campaign (it would skip the approval gate); the campaign intent is non-financial but still parks. Any
flag-gated control ships with its producer population in the same PR, tested from real defaults.
Schema change implies a migration in the same commit. No em-dashes.
