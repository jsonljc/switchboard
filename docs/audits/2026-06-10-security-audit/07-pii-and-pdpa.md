# Audit 5 — PII & PDPA Exposure

_Question (SG/MY clinics, PDPA applies): where does patient data go that it shouldn't, and can it actually be deleted? Read-only._

**One-line verdict:** the privacy _design_ is good where people usually fail — the AI never sees patient phone/email, Meta gets only hashes, logs mostly use IDs, errors are scrubbed. **What would fail a PDPA review is "right to erasure": a deletion request does not actually erase the person.**

## CONFIRMED gaps (would weaken a PDPA review)

### F5 — Right-to-erasure is incomplete — HIGH

The deletion handler (`apps/api/src/routes/meta-deletion.ts:88-91`) deletes the Contact graph thoroughly — threads, messages, bookings, opportunities, escalations, etc. (`prisma-contact-store.ts:177-219`). **But it omits every PII store not keyed by `contactId`:**

- **Dead-letter queue (`FailedMessage`)** — `rawPayload` holds the entire inbound webhook (message text + phone). Keyed by org, not contactId → never reached. No purge anywhere in the repo.
- **`WorkTrace`** — has `contactId` plus `parameters`/`executionOutputs` text carrying booking details derived from the conversation. Not in the cascade.
- **Google Calendar event** — the local `Booking` row is deleted but `cancelBooking()` is never called, so the calendar event (title = `service — patientName`, attendee = patient email) stays in Google indefinitely.
- **`DataDeletionRequest.userId`** stores the raw phone/wa-id permanently (arguably a Meta audit trail, but document it).

So telling a patient "we deleted your data" would currently be false. **Fix:** extend deletion to purge `FailedMessage` by phone, `WorkTrace` by `contactId`, and call `cancelBooking()` on the external calendar.

### F6 — Dead-letter queue has no retention/purge — HIGH (compounds F5)

`apps/chat/src/dlq/failed-message-store.ts` stores `rawPayload` verbatim. Its only "cleanup" (`sweepExhausted`, `:94-112`) flips a status flag — it **never deletes**. There's no TTL, no `expiresAt`, no purge cron. Every webhook that ever failed to parse keeps a patient's message text + phone forever — a PDPA retention-limitation problem on its own. **Fix:** add a scheduled purge (delete resolved/exhausted older than N days).

### F10 — Phone numbers written to logs — MEDIUM

- `packages/core/src/notifications/proactive-sender.ts:136` logs the recipient WhatsApp phone number.
- `apps/api/src/routes/meta-deletion.ts:93,115` logs the patient phone/wa-id on the deletion endpoint's error paths.

The operational intent is served by an org id + a hashed or last-4 phone; the full number isn't needed. **Fix:** hash or truncate phone in logs.

## Verified clean — defensible by design

- **The LLM never receives patient phone/email.** `sanitizeContactForPrompt` (`packages/core/src/skill-runtime/pii.ts:13-24`) is a strict allow-list — only `name`, `stage`, `source` survive; phone/email/id are dropped by construction, applied on every contact→prompt path. The _message text itself_ is sent to Claude verbatim, which is unavoidable for the agent to function and is a deliberate, documented choice — disclose Anthropic as a sub-processor in your privacy notice, but it's not a gap.
- **Meta CAPI gets only SHA-256 hashes** of email/phone (`meta-capi-dispatcher.ts:94-98`) — exactly Meta's required format. Raw values never leave.
- **Inngest Cloud event payloads carry IDs, not conversation content** (verified across all emit sites).
- **Production error responses are scrubbed** — 5xx returns "Internal server error" with no message/stack (`error-handler.ts:26-43`). Caveat: keyed on `NODE_ENV==="production"`, so Vercel/preview must set it (matches your known gotcha).

## Lower-confidence watch items

- **Sentry** (`bootstrap/sentry.ts`) has no `beforeSend` scrubber and captures the full error object; only active if `SENTRY_DSN_SERVER` is set. Add a PII scrubber before enabling in production.
- **OpenTelemetry** auto-instruments HTTP with no PII filter on `http.url` query strings; only active if an OTLP endpoint is set. Add a span scrubber before pointing it at a third party.

## Bottom line

Collection and third-party sharing are well-minimised — the hard parts are done right. The failure is on the **retention and deletion** side: the dead-letter queue never expires (F6) and "delete this patient" leaves data behind (F5). Both should be fixed before you make erasure promises to patients or regulators. F10 (phone in logs) is a quick win.
