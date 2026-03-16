# Closed-Loop Revenue Attribution — Pre-Launch Design

**Date:** 2026-03-17
**Status:** Approved
**Approach:** Bottom-up wiring (schema foundations first, then event wiring, then dispatchers)

## Context

Switchboard's north star: "Every lead handled. Every booking captured. Every ad dollar pointed at people who actually pay." A deep codebase audit validated that the architecture is sound but the loop has gaps. This design closes them.

### What's already strong

- Multi-channel lead capture (WhatsApp, Instagram, Telegram, Slack, SMS, forms, web chat)
- Governance layer (10-step policy engine, consent gates, risk scoring, approval workflows)
- Booking flow (calendar integration, cadence templates, conversion tracking)
- Meta CAPI + Google offline conversion dispatchers with real dollar values
- Production readiness (multi-tenancy, auth, CI/CD, 200+ test files, error handling)

### What this design fixes

| #   | Gap                                        | Impact                                   |
| --- | ------------------------------------------ | ---------------------------------------- |
| 1   | `fbclid`/`ttclid` not stored on CrmContact | Attribution leaks for Meta and TikTok    |
| 2   | No cross-channel identity resolution       | Same person = multiple unlinked contacts |
| 3   | Payments don't emit to ConversionBus       | The loop literally breaks at revenue     |
| 4   | No TikTok Events API dispatcher            | Zero feedback for TikTok campaigns       |
| 5   | No CAPI event deduplication                | Meta counts duplicate conversions        |
| 6   | Non-text messages silently dropped         | Leads lost on voice/image/location       |
| 7   | Multi-language is schema-only              | No runtime support for SEA market        |

Blocker #2 (LLM-driven "feels human" conversations) is being addressed separately.

---

## Section 1: Schema Foundations

### 1a. Click ID fields on CrmContact

Add to `packages/schemas/src/crm-provider.ts` and Prisma schema:

- `fbclid: string | null` — Facebook Click ID
- `ttclid: string | null` — TikTok Click ID

Alongside existing `gclid`. Extracted from URL params, form submissions, or chat referral data at contact creation.

### 1b. Normalized identity fields

Add indexed fields for identity resolution:

- `normalizedPhone: string | null` — E.164 format, derived from `phone` at write time
- `normalizedEmail: string | null` — lowercased/trimmed, derived from `email` at write time

### 1c. Prisma migration

Single migration adding 4 columns with indexes on `normalizedPhone` and `normalizedEmail`.

---

## Section 2: Cross-Channel Identity Resolution

### 2a. Contact Merge Service

New file: `packages/core/src/identity/contact-merger.ts`

Public method: `resolveContact(candidate: ContactCandidate): CrmContact`

Called at every contact creation point. Before creating a new contact:

1. Normalize phone (E.164) and email (lowercase/trim)
2. Look up existing contacts: match on `normalizedPhone` first, fall back to `normalizedEmail`
3. Match found: enrich existing contact (fill nulls, don't overwrite), add channel alias, return existing
4. No match: create new contact with normalized fields

### 2b. External ID aliasing

New Prisma model: `ContactAlias`

- `id`, `contactId` (FK to CrmContact), `channel` (whatsapp | instagram | telegram | sms | facebook | web), `externalId`
- Unique constraint: `@@unique([channel, externalId])`

Replaces 1:1 `externalId` with 1:many. `findByExternalId(id, channel)` queries this table.

### 2c. Retroactive merge

One-time idempotent migration script. Scans existing contacts, normalizes phone/email, merges duplicates. Logs all merges for audit.

### 2d. Attribution preservation on merge

When merging B into A: copy B's attribution to A only if A has none. First-touch wins.

---

## Section 3: Revenue Recording & Attribution Wiring

### Design principle

Most SEA service businesses use offline POS (cash, card terminal, GrabPay, TouchNGo). Switchboard's job is to know that payment happened, not to process it. The primary risk is data completeness — staff forgetting to record.

### 3a. Revenue Event schema

New file: `packages/schemas/src/revenue-event.ts`

- `contactId`, `amount`, `currency`
- `source`: `manual | chat | batch | pos_sync | stripe | crm_sync | api`
- `reference`: optional external ID (receipt number, POS transaction ID)
- `recordedBy`, `timestamp`

### 3b. Four recording paths

**Path 1 — Chat-first (primary).** Staff sends natural language in ops channel: "john paid 350." AI parses, fuzzy-matches to CRM contact via identity resolution, confirms with staff, records. New action: `revenue.record`.

**Path 2 — Batch reconciliation (end-of-day).** Scheduled job at business close (configurable per profile). Sends interactive message listing today's appointments: "6 appointments, 4 paid, 2 unresolved" with confirm/adjust buttons per item. Unconfirmed items roll into gap detection.

**Path 3 — Dashboard.** "Mark as Paid" on deal/appointment. Updates deal stage + emits revenue event.

**Path 4 — API endpoint.** `POST /api/revenue` for POS integrations or Zapier.

### 3c. Gap detection + nudges

Background job in `apps/api/src/jobs/`, runs every 2 hours during business hours.

1. Find appointments where `scheduledTime` > 2 hours ago, no matching revenue event
2. Send nudge to ops channel: "Appointment with John at 2pm — was payment collected?"
3. If unresolved after 24 hours: escalate to business owner

Configurable: nudge timing, escalation threshold, quiet hours.

### 3d. ConversionBus emission

All paths converge: resolve CRM contact, read `sourceAdId`/`sourceCampaignId`, emit `ConversionEvent` type `"purchased"` with actual amount. Dispatchers pick it up.

### 3e. Stripe path (kept, not primary)

For businesses using Stripe for deposits/payment links. Webhook handler reads `metadata.switchboard_contact_id`, same emission pattern.

### 3f. Layer boundaries

`revenue.record` action in cartridge. Batch reconciliation and gap detection jobs in `apps/api`. ConversionBus emission at app layer via callback pattern.

---

## Section 4: TikTok Events API Dispatcher

### 4a. Dispatcher

New file: `cartridges/digital-ads/src/tracking/tiktok-dispatcher.ts`

Same pattern as CAPI and Google dispatchers:

- Subscribe to ConversionBus wildcard `*`
- Look up CRM contact, read `ttclid`
- Call TikTok Events API v2 with hashed PII, `ttclid`, `event_id`, value, currency
- Skip if no `ttclid` and no PII

Event mapping:

| Internal    | TikTok            |
| ----------- | ----------------- |
| `inquiry`   | `SubmitForm`      |
| `qualified` | `Contact`         |
| `booked`    | `Schedule`        |
| `purchased` | `CompletePayment` |
| `completed` | `CompletePayment` |

### 4b. Write provider

Extend `tiktok-provider.ts` with `sendEvent(pixelId, event)` method.

### 4c. Tests

Mirror CAPI dispatcher test structure.

---

## Section 5: CAPI Event Deduplication

### 5a. Deterministic `event_id`

In `capi-dispatcher.ts`, generate `event_id` as `sha256(contactId + eventType + timestamp)`.

- Same event retried = same ID = Meta deduplicates
- Different events for same contact = unique IDs

### 5b. Apply to TikTok dispatcher

TikTok Events API also supports `event_id`. Same generation logic.

Google offline conversions deduplicate on `gclid` + `conversion_action` + `conversion_date_time` — no change needed.

---

## Section 6: Non-Text Message Handling

### 6a. Capture leads from unsupported message types

Currently: adapters return `null` for images, voice notes, locations, stickers. Runtime silently drops at line 330. Lead is lost.

Change: adapters return `{ type: "unsupported", originalType: "image" | "voice" | ... }` instead of `null`.

Runtime handles `unsupported` by:

1. Creating CRM contact + conversation (lead is captured)
2. Sending acknowledgment: "Thanks for reaching out! I'm better with text — could you describe what you need?" (configurable per skin/profile)
3. Emitting `inquiry` to ConversionBus (attribution preserved)

### 6b. Scope

No media processing. Just ensuring the lead isn't lost and gets a response.

---

## Section 7: Multi-Language Runtime

### 7a. Language detection

`ConversationStateData.detectedLanguage` field exists but is never set. Set it on first inbound message via the LLM interpreter — instruct the model to identify the language and respond in kind. No separate detection library.

### 7b. Interpreter prompt update

In `skin-aware-interpreter.ts`, add to system prompt:

- If `detectedLanguage` set: "Continue this conversation in {detectedLanguage}"
- If `profile.localisation.languages` set: "You may communicate in: {languages}. Match the customer's language."
- Follow customer language switches

### 7c. Template localization

Add `translations` map to skin reply templates:

```
replyTemplates: {
  bookingConfirmed: {
    en: "Your appointment is confirmed for {{date}}",
    zh: "Your appointment is confirmed for {{date}}",
    ms: "Temu janji anda disahkan pada {{date}}"
  }
}
```

Fallback to English. Covers EN/ZH/MS for SG/MY market.

### 7d. Scope

- LLM responds in customer's language (free-form)
- Structured templates have translations for key languages
- Dashboard and admin UI remain English-only

---

## Implementation Order

Bottom-up, each layer solid before the next:

1. Schema foundations (Section 1)
2. Identity resolution (Section 2)
3. Revenue recording + attribution wiring (Section 3)
4. TikTok dispatcher (Section 4)
5. CAPI deduplication (Section 5)
6. Non-text message handling (Section 6)
7. Multi-language runtime (Section 7)
