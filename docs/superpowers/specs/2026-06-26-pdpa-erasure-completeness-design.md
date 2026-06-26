# PDPA/GDPR right-to-erasure completeness — design

Date: 2026-06-26
Status: approved (autonomous session; user pre-authorized the full superpowers chain, no check-ins)
Slug: `fix/pdpa-erasure-completeness`
Origin: 2026-06-24 exhaustive-agent-eval, system-review gap #8 ("PDPA erasure P1"). Verified
still-open on `main` (b05076c8b) on 2026-06-26.

## Problem

A right-to-erasure request (Meta Data Deletion callback, or operator-initiated) must leave **no
contact PII** behind, and must **report its true outcome**. Three independent holes break that
guarantee today. Each was re-verified against live code before this design (memory and the eval
README had gone stale on adjacent items, so every claim here is grounded in a file:line read).

### Gap 1 — Meta deletion matches the wrong phone column

`apps/api/src/routes/meta-deletion.ts:122-135` finds contacts to erase by matching the raw
`Contact.phone` column against two hand-built shapes: `[userId, "+"+userId]` (or the `+`-stripped
pair). But canonical contact identity is `Contact.phoneE164` — `resolveContactIdentity`
(`packages/core/src/channel-gateway/resolve-contact-identity.ts:26`) stores every WhatsApp contact
as `normalizeToE164(wa_id)` = `+E.164`, and `findByPhone`
(`packages/db/src/stores/prisma-contact-store.ts:131-134`) resolves on `phoneE164`. A contact whose
stored `phone` shape differs from the two guessed shapes (spaces/dashes, a `phoneE164`-only row, a
differently-formatted import) is **not matched** and its PII survives the deletion.

### Gap 2 — the erasure cascade omits contactId/phone-bearing tables

`PrismaContactStore.delete()` (`packages/db/src/stores/prisma-contact-store.ts:168-257`) manually
deletes every dependent row (no DB-level FK cascades exist for `Contact`). A schema-wide grep for
every `contactId` / phone FK shows it currently **misses**:

- `ConversationLifecycleSnapshot` (`contactId`, `organizationId`) — survives because the parent
  `ConversationThread` is deleted by `contactId` but the 1:1 snapshot has no FK cascade.
- `ConversationLifecycleTransition` (`contactId`, `organizationId`) — full lifecycle audit trail
  with `evidence` JSON.
- `ScheduledFollowUp` (`contactId`, `organizationId`) — Alex re-engagement nudges (`note` free text).
- `ScheduledReminder` (`contactId`, `organizationId`) — appointment reminders.
- `RobinRecoverySend` (`contactId`, `organizationId`) — no-show recovery send log.
- `WhatsAppTestSend` (`toNumber`, `organizationId`) — phone-bearing operator test-send log; a
  `toNumber` equal to the contact's number is that person's PII.

It **also** has a latent shape-mismatch in the phone-keyed deletes it already performs:
`whatsAppMessageStatus.recipientId` and `conversationState.principalId` are matched with exact
`= phone` (the `+E.164` value), but `recipientId` is the WhatsApp `recipient_id` = wa-id =
**digits-only, no `+`** (`apps/chat/src/adapters/whatsapp.ts:349`). So `"6591234567" === "+6591234567"`
is false and those status rows survive. (The `FailedMessage` DLQ scan via `payloadMentionsPhone`
already digit-normalizes both sides, so it is shape-robust and unchanged.)

### Gap 3 — erasure reports "completed" on a swallowed external-calendar cancel

`eraseContactFully` (`apps/api/src/lib/erase-contact.ts`) cancels the contact's external Google
Calendar events before the DB cascade. By design (correctly) it never lets a calendar failure block
the DB erasure — leaving DB PII would be the worse outcome. But it swallows two failure modes
silently: a per-event `cancelBooking` throw is only `logger.warn`'d (`:52-61`), and an unresolved
provider returns `null` (`:69-83`). The function returns `void` regardless, so `meta-deletion.ts:153`
sets `status = "completed"` and the operator path (`app.ts:1007`, `operator-intents/erase-contact.ts`)
records `"completed"` — even though the patient's appointment (with their name/time) still exists in
the clinic's external calendar. The deletion record lies.

## The canonical erasure contract (what "erased" must mean)

For a contact identified by a deletion request, "erased" means **every** row keyed by that contact's
`id` OR any shape of their phone is removed, across:

1. **contactId-keyed** (immutable key, no shape risk): ConversationThread, ConversationMessage,
   ContactLifecycle, ConversationLifecycleSnapshot, ConversationLifecycleTransition, Opportunity,
   LifecycleRevenueEvent, OwnerTask, EscalationRecord, InteractionSummary, Booking, ConversionRecord,
   WorkTrace, ScheduledFollowUp, ScheduledReminder, RobinRecoverySend.
2. **leadId-keyed**: Handoff, PendingLeadRetry.
3. **phone-keyed** (must match every stored shape): WhatsAppMessageStatus.recipientId,
   ConversationState.principalId, WhatsAppTestSend.toNumber, FailedMessage.rawPayload (DLQ scan).
4. **the Contact row itself** (last, inside the same transaction).

Out of scope (documented, not contact-graph PII reachable by a phone/contactId deletion key):
`WaitlistEntry` (email-only pre-registration list, no phone/contact link, unreachable from a Meta
phone-keyed callback); `ConsentRecord` (creative-pipeline UGC creator consent — `personName`, not a
patient/contact); operator/agent `principalId` tables (Principal, DashboardUser, AgentSession, etc.).
`Booking.attendeeEmail` and `Contact.email` are erased transitively (those rows are deleted).

"completed" must require: the DB cascade succeeded for **every** matched contact **and** every
contact's external-calendar cancellation fully succeeded (or there was nothing to cancel). Otherwise
the outcome is "partial" (DB erased, external calendar incomplete) or "failed" (DB cascade threw).

## Design

Three coherent changes, one surfaced PR, three commits (one per gap) so the reviewer can read each
independently. **No schema migration** — every delete uses existing columns; `"partial"` is a new
value of the existing free-`String` `DataDeletionRequest.status` (no DB enum, no strict parser).

### Change A (commit 1, `packages/db`) — complete + shape-robust cascade

In `PrismaContactStore.delete()`:
- Add `deleteMany` for the 5 missing contactId tables (each `{ contactId: id, organizationId: orgId }`,
  each annotated `// route-governance: store-mutation-global`, mirroring the existing siblings).
- Add `whatsAppTestSend.deleteMany` to the phone-keyed branch.
- Replace exact `recipientId: phone` / `principalId: phone` with `{ in: phoneCandidates }`, where
  `phoneCandidates` is built once from `existing.phone` + `existing.phoneE164` via a local
  `buildPhoneMatchCandidates(phone, phoneE164)` helper: the unique non-empty set of
  `{ phone, phoneE164, digitsOnly(phone) }`, each digits form guarded by `MIN_PHONE_DIGITS` (≥7) to
  avoid junk collisions. `digitsOnly(phoneE164) === digitsOnly(phone)` so it dedupes to one digits
  form. This is exact-equality (`in`), org-scoped — no substring, no cross-patient over-deletion.
- The DLQ scan keeps `payloadMentionsPhone` (already digit-robust) but sourced from
  `existing.phone ?? existing.phoneE164` so a `phoneE164`-only contact is still scanned.
- The whole phone-keyed branch runs when `phoneCandidates.length > 0` (was `if (phone)`), so a
  contact with only `phoneE164` set still has its phone-keyed rows purged.

### Change B (commit 2, `apps/api`) — match Meta deletion by canonical phoneE164

In `meta-deletion.ts`, build the find clause as a union of the canonical column and the legacy raw
shapes:

```ts
const normalizedE164 = normalizeToE164(userId);           // "6591234567" -> "+6591234567"
const where = normalizedE164
  ? { OR: [{ phoneE164: normalizedE164 }, { phone: { in: candidateValues } }] }
  : { phone: { in: candidateValues } };
```

`phoneE164` is the shape-robust canonical match; the raw `phone IN [...]` arm is retained as a
fallback for legacy rows whose `phoneE164` is null/unnormalized. Strictly more complete than today;
the FIND stays cross-org by design (Meta deletion is global per user; the cascade is org-scoped).

### Change C (commit 3, `apps/api`) — honest partial/failed outcome

`eraseContactFully` returns a structured result instead of `void`:

```ts
export type CalendarErasureOutcome = "completed" | "partial" | "failed" | "skipped";
export interface EraseContactResult {
  contactErased: true;                 // resolves only if the DB cascade succeeded (else it throws)
  calendar: CalendarErasureOutcome;    // skipped = nothing to cancel; failed = events existed, none cancelled
  calendarEventsFound: number;
  calendarEventsCancelled: number;
}
```

- `skipped`: no external event ids found (clean — counts toward "completed").
- `completed`: events found, all cancelled.
- `partial`: events found, some cancelled, ≥1 failed.
- `failed`: events found, provider unresolved or every cancel failed (none cancelled).

DB erasure still **never** blocks on calendar failure (behavior preserved); only the reported outcome
becomes honest.

`meta-deletion.ts`: accumulate results across matched contacts. After a clean DB cascade, overall
`status = "completed"` iff every contact's `calendar ∈ {completed, skipped}`, else `"partial"` with
`failureReason = "external calendar cancellation incomplete (event(s) may linger; reconcile from logs)"`
(no phone — log-safe) and `completedAt = new Date()` (our data is erased). A thrown DB cascade stays
`"failed"` / `completedAt = null` (unchanged). The consumer gates on the explicit success set, not
`!==` ([[feedback_threaded_outcome_failclosed_at_seam]]).

Operator path: extend `EraseRequestStatus` to `"completed" | "partial" | "failed"` and
`OperatorContactEraser.erase` to return the calendar outcome. The handler records `"partial"` when DB
succeeded but calendar did not (still HTTP 200 — the contact IS erased from our system; the lingering
external event is surfaced in the audit row + `outputs.calendarErasure`), `"failed"` + rethrow only
when the cascade throws (unchanged). `app.ts` `recordRequest`: `deletedContactIds`/`completedAt`
populate for both `completed` and `partial` (DB done), empty/null only for `failed`.

## Testing (TDD, mirrors existing erasure tests)

- `packages/db/.../prisma-contact-store-erasure.test.ts`: a contact with a row in **every**
  contactId-bearing table is fully purged (assert a `deleteMany` per added table, org-scoped); a
  digits-only `recipientId`/`principalId` and a `+E.164` one are BOTH purged via the candidate set; a
  `phoneE164`-only contact still purges phone-keyed rows; no over-deletion of a different patient.
- `apps/api/.../api-meta-deletion.test.ts`: a `+6591234567` / `6591234567` / phoneE164-only contact
  is matched (the existing `{ phone: { in: [...] } }` assertion is updated to the new OR clause); a
  swallowed calendar cancel records `status: "partial"` (not `completed`); clean path still
  `completed`; thrown cascade still `failed`.
- `apps/api/.../erase-contact.test.ts`: `eraseContactFully` returns `calendar: "partial"` when one of
  two cancels throws, `"failed"` when the provider is unresolved but events exist, `"skipped"` when no
  events, `"completed"` when all cancel — while STILL deleting the contact in every case.
- `apps/api/.../operator-contact-erasure.test.ts`: operator erase records `"partial"` when the
  calendar lingered (DB still erased, HTTP 200).

## Risks / non-goals

- No schema change → no migration, Postgres-down-safe (all tests mock Prisma).
- No new metric (the `DataDeletionRequest` row + `failureReason` + logs are the audit trail; avoids
  the 3-registry burden and scope creep).
- Compliance-sensitive surface → SURFACE the PR for human review; do NOT self-merge; gate on real
  `gh pr checks`.
