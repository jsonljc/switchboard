---
name: WhatsApp Business API — 3 Code Blockers
description: Verified WhatsApp/Alex launch blockers (consent tracking, data deletion endpoint, template wiring) with exact file paths, line numbers, and implementation specs. Scoped to lead-to-booking/Alex wedge only — creative-pipeline DLQ is out of scope.
type: project
originSessionId: 77b3620e-bd79-4313-8d73-8d17e5680d8d
---

## Context

WhatsApp Business API readiness audit completed 2026-05-04. Full audit at Obsidian: `artifacts/2026-05-04-whatsapp-biz-api-readiness-audit.md`. Codebase verification confirmed 35/37 claims accurate.

**Scope:** Alex lead-to-booking wedge + WhatsApp Cloud API Tech Provider readiness. Creative-pipeline is OUT OF SCOPE for this workstream.

**What's already built and verified (do NOT rebuild):**

- WhatsApp Cloud API adapter: `apps/chat/src/adapters/whatsapp.ts` (449 lines) — rate limiter, HMAC verification, template messages, media, interactive messages, 24hr window enforcement
- Embedded Signup (ESU): `apps/api/src/routes/whatsapp-onboarding.ts` (201 lines) — full 8-step Tech Provider onboarding, `automated_type: "3p_full"`
- Graph API helpers: `apps/api/src/lib/whatsapp-meta.ts` (155 lines)
- Alex skill: `skills/alex.md` (249 lines), builder at `packages/core/src/skill-runtime/builders/alex.ts`, calendar-book tool at `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Alex registration: `apps/api/src/bootstrap/skill-mode.ts:228`
- CAPI attribution: `MetaCAPIDispatcher` wired at `apps/api/src/bootstrap/conversion-bus-bootstrap.ts:53-87`
- All 12 CRITICAL+HIGH security findings shipped (PRs #330-334)
- 17/18 general launch blockers shipped (the 18th is creative-pipeline DLQ, out of scope here)

## Blocker 1: WhatsApp Messaging Consent/Opt-In Tracking

**Problem:** No consent tracking for WhatsApp messaging. `ConsentRecord` model (schema.prisma:1787-1807) is for creative-pipeline creator consent (scopeOfUse, territory, mediaTypes, creatorIdentities) — NOT messaging. `ContactLifecycle.optedOut` (schema.prisma:839) is a bare boolean with no timestamp, no source, and **zero code reads it** to gate message sending.

**WhatsApp rules:**

- Users who message first = implicit opt-in for 24hr session window
- Template messages (proactive outbound, outside 24hr window) require explicit prior opt-in
- Users must be able to opt out at any time

**Implementation:**

1. Add consent fields to `Contact` model in `packages/db/prisma/schema.prisma`:

   ```prisma
   messagingOptIn       Boolean   @default(false)
   messagingOptInAt     DateTime?
   messagingOptInSource String?   // "ctwa" | "organic_inbound" | "web_form" | "manual"
   messagingOptOutAt    DateTime?
   ```

2. Set opt-in on lead creation in `packages/core/src/skill-runtime/builders/alex.ts` — when auto-creating Contact for inbound WhatsApp, set `messagingOptIn: true` with source

3. Guard template sends — in `WhatsAppAdapter.sendTemplateMessage()` (whatsapp.ts:184) or its callers: if outside 24hr window, verify `contact.messagingOptIn === true`

4. Opt-out keyword detection — in chat message handler before skill dispatch (`apps/chat/src/`): detect "stop"/"unsubscribe"/"opt out", set `messagingOptIn: false`, `messagingOptOutAt: now()`, reply with confirmation

5. Decide what to do with `ContactLifecycle.optedOut` — deprecate or drive from new Contact fields

**Files to modify:**

- `packages/db/prisma/schema.prisma` — Contact model + migration
- `packages/core/src/skill-runtime/builders/alex.ts` — set consent on contact creation
- `apps/chat/src/` — opt-out keyword detection in message handler
- Template-sending callers — consent check guard

**Effort:** M (1 day)

## Blocker 2: Data Deletion Callback Endpoint

**Problem:** Meta App Dashboard requires a Data Deletion Callback URL before App Review submission. No such endpoint exists. No `DELETE` routes for contacts exist at all.

**How it works:**

- Meta POSTs to your callback with `signed_request` param (HMAC-SHA256 signed with app secret)
- Payload contains app-scoped user ID
- Must return `{ url: "https://your-domain/deletion-status?code=X", confirmation_code: "X" }`

**Implementation:**

1. Create `apps/api/src/routes/meta-deletion.ts`:
   - Parse signed_request (split on ".", base64url decode)
   - Verify HMAC-SHA256 with app secret (use `timingSafeEqual`)
   - Extract user_id, generate confirmation code
   - Queue/execute contact deletion cascade
   - Return required JSON response

2. Add auth exemption in `apps/api/src/middleware/auth.ts:108-118` (same pattern as Stripe webhook exemption)

3. Register route in `apps/api/src/bootstrap/routes.ts`

4. Add `delete()` to `packages/db/src/stores/prisma-contact-store.ts` — cascade through:
   - `Contact` (primary)
   - `ConversationThread` (FK cascade)
   - `Opportunity` (FK cascade)
   - `LifecycleRevenueEvent` (FK cascade)
   - `OwnerTask` (FK cascade)
   - `ContactLifecycle` (manual — no FK)
   - `ConversationMessage` (manual — no FK)
   - `ConversationState` (manual — by phone/principalId)
   - `WhatsAppMessageStatus` (manual — by phone/recipientId)
   - `EscalationRecord` (manual — by contactId)
   - `Handoff` (manual — by leadId)
   - `InteractionSummary` (manual — by contactId)
   - `Booking` (nullify contactId or delete)

5. Reference pattern: `FailedMessage` model (schema.prisma:502-521) + `apps/chat/src/dlq/failed-message-store.ts` (124 lines) for fire-and-forget `.record().catch()`

**Files to modify:**

- New: `apps/api/src/routes/meta-deletion.ts`
- `apps/api/src/middleware/auth.ts` — auth exemption
- `apps/api/src/bootstrap/routes.ts` — register
- `packages/db/src/stores/prisma-contact-store.ts` — add `delete()` with cascade

**Effort:** M (1 day)

## Blocker 3: WhatsApp Message Templates (External — No Code)

**Problem:** `sendTemplateMessage()` works (whatsapp.ts:184) but no actual templates exist in Meta Business Manager.

**Minimum viable templates:**

1. **booking_confirmation** (UTILITY) — "Hi {{1}}, your {{2}} appointment is confirmed for {{3}} at {{4}}. Arrive 10 min early. Reply CHANGE or CANCEL." + Quick Reply buttons
2. **booking_reminder** (UTILITY) — "Reminder: {{1}} appointment tomorrow at {{2}} with {{3}}." + Confirm/Cancel buttons
3. **lead_followup** (MARKETING) — "Hi {{1}}, interested in {{2}} at {{3}}? Book now?" + Yes/Not now buttons

**Template rules:** Use `{{1}}` format, no URL shorteners, submit with sample values, ~24hr approval turnaround.

**Code change after approval:** Update `calendar-book.ts` booking confirmation to call `sendTemplateMessage("booking_confirmation", "en", [...params])` instead of `sendTextReply()` when outside 24hr window.

**Effort:** S (external 1-3 days for approval, 1hr code wiring)

## External Admin Gates (7 steps, no code, ~2-3 weeks calendar time)

1. Meta Developer Account (1hr)
2. Business App + WhatsApp product (1hr, needs #1)
3. Business Verification (1-2 weeks, needs #1)
4. Facebook Login Config for ESU (1hr, needs #2)
5. System User + SUAT (1hr, needs #3)
6. App Review — 3 permissions: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging` (1-2 weeks, needs #2 + #3 + code blockers done)
7. Message templates (1-3 days, needs #2)

**Critical path:** Business Verification + App Review are the long poles (parallel with code work).

## Post-Launch (30-day window)

10 fix-soon security items (MEDIUM severity): TI-7 through TI-10, AI-4 through AI-6, AU-3, AU-4, OW-3. Full list in `.audit/12-pre-launch-security-audit.md`.
