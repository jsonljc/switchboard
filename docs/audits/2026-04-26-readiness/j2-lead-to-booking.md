# J2: Lead → Response → Booking — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

---

### [P0] J2.3 — Completeness

**Alex skill parameter builder is never registered — skill runs without structured context**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:210-216` — `BuilderRegistry` is instantiated empty and passed to `SkillMode`, but `alexBuilder` (exported from `packages/core/src/skill-runtime/builders/alex.ts:6`) is never registered via `builderRegistry.register("alex", ...)`. In `packages/core/src/platform/modes/skill-mode.ts:96-98`, when no builder is found, `resolveParameters` falls through to returning raw `workUnit.parameters`.

The alex skill template (`skills/alex.md:65`) expects `{{BUSINESS_NAME}}`, `{{OPPORTUNITY_ID}}`, `{{LEAD_PROFILE}}`, `{{PERSONA_CONFIG.*}}`, and `{{BUSINESS_FACTS}}`. Without the builder, the template interpolation receives `message`, `conversation`, and `persona` from the channel gateway instead. Every `{{...}}` placeholder resolves to empty string or `undefined`.

**Customer Impact:** Alex responds with an uninterpolated prompt — no business name, no qualification criteria, no escalation rules, no business facts. The LLM sees blank sections where operating instructions belong. Responses will be generic, un-grounded, and unable to answer any business-specific questions. The entire skill is effectively lobotomized.

**Fix:** Register alexBuilder in `skill-mode.ts` bootstrap: `builderRegistry.register("alex", alexBuilderAdapter)` with appropriate signature adaptation from the legacy `ParameterBuilder` to `RegisteredBuilder`. (scope: 2-4 hours)

---

### [P0] J2.3 — Completeness

**No contact record created for new WhatsApp leads — alex builder will throw on first message**

**Evidence:** `packages/core/src/skill-runtime/builders/alex.ts:9` calls `stores.opportunityStore.findActiveByContact(config.orgId, contactId)`. The `contactId` comes from `config.contactId` which must be set by the caller. However, the channel gateway (`packages/core/src/channel-gateway/channel-gateway.ts:74-91`) passes `sessionId` (the WhatsApp phone number) as the actor ID, but never creates a Contact record or maps the phone number to a contactId.

Even if the builder were registered, it would receive the WhatsApp phone number as `contactId`. The `opportunityStore.findActiveByContact` query would return empty (no opportunity exists for a brand-new lead), and `alex.ts:12-15` throws `ParameterResolutionError("no-active-opportunity")`. The customer receives the fallback message: "I'd like to help, but there's no active deal found for this conversation."

**Customer Impact:** Every first-time WhatsApp lead hits a wall. The agent cannot engage in conversation because no opportunity exists. The self-serve operator has no way to pre-create opportunities for unknown inbound leads.

**Fix:** Either (a) auto-create Contact + Opportunity on first inbound message in the channel gateway or builder, or (b) make the alex builder handle the cold-start case by creating an opportunity. (scope: 4-8 hours)

---

### [P0] J2.4 — Production Reality

**NoopCalendarProvider returns fake bookings when no calendar is configured**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:245-407` — `resolveCalendarProvider` has a 3-tier fallback: Google Calendar (needs `GOOGLE_CALENDAR_CREDENTIALS` + `GOOGLE_CALENDAR_ID`), LocalCalendarProvider (needs `businessHours` in org config), NoopCalendarProvider (final fallback).

`apps/api/src/bootstrap/noop-calendar-provider.ts:18-19` — `listAvailableSlots` returns `[]` (empty array). This means Alex will say "I'm having trouble checking availability" per the skill prompt instructions.

More critically, `noop-calendar-provider.ts:23-44` — `createBooking` returns a stub booking with `status: "pending_confirmation"` and `id: "noop-${randomUUID()}"`. If a booking.create call somehow reaches the noop provider, it returns a fake booking object that looks successful but creates nothing real.

**Customer Impact:** With no calendar configured (the default for a self-serve operator who hasn't set up Google Calendar credentials), the calendar-book tool's slot query returns empty. Alex follows the failure path and tells the customer "Let me have someone reach out to confirm a time with you." No booking is created. The entire J2 conversion funnel dead-ends.

For operators who have business hours configured but no Google Calendar: `LocalCalendarProvider` works correctly against the database but creates `local-*` calendar event IDs that don't correspond to any real calendar invite. The customer gets a "confirmed" booking but never receives a calendar invite.

**Fix:** (a) Make calendar setup a mandatory part of onboarding gating, or (b) surface a clear warning when NoopCalendarProvider is active that bookings are disabled, or (c) wire LocalCalendarProvider to send email confirmations as a fallback. (scope: 1-2 days)

---

### [P0] J2.4 — Production Reality

**LocalCalendarProvider bookings never generate calendar invites**

**Evidence:** `packages/core/src/calendar/local-calendar-provider.ts:76-77` — `createBooking` generates `calendarEventId: "local-${randomUUID()}"`. This is a synthetic ID. No Google Calendar event is created, no invite email is sent. The booking is persisted to the database with status "confirmed" but the attendee never receives any notification.

Compare with `packages/core/src/calendar/google-calendar-adapter.ts:74-85` which calls `this.client.events.insert(...)` to create a real Google Calendar event with attendee emails.

**Customer Impact:** Operator configures business hours (completing the dashboard setup). A lead goes through the full conversation and "books" an appointment. Alex confirms "You're all set!" The lead receives nothing. The operator has a booking in the database but no calendar event. Both parties may miss the appointment.

**Fix:** Add email confirmation sending to LocalCalendarProvider bookings, or require Google Calendar for production bookings. (scope: 1-2 days)

---

### [P1] J2.1 — Security

**Webhook signature verification fails open when appSecret is not configured**

**Evidence:** `apps/chat/src/adapters/whatsapp.ts:97-103` — `verifyRequest` returns `false` when `appSecret` is null. This is fail-closed, which is correct. However, `apps/chat/src/managed/runtime-registry.ts:170-172` — `appSecret` is extracted from connection credentials as `creds["appSecret"]`. If the operator did not provide an app secret during channel setup, it will be `undefined`, and the adapter is constructed without it.

`apps/chat/src/routes/managed-webhook.ts:64-72` — signature verification is conditional: `if (gatewayEntry.adapter.verifyRequest)`. Since `WhatsAppAdapter` always has `verifyRequest` defined, verification always runs. With no appSecret, it returns false and the webhook returns 401.

This is actually correct behavior (fail-closed). However, the operator has no dashboard feedback about why their webhook is being rejected. All inbound messages silently fail with 401.

**Customer Impact:** An operator who doesn't configure the app secret will have all WhatsApp messages rejected silently. No error surfaces in the dashboard. The operator believes the agent is live but it's receiving zero messages.

**Fix:** Add a connection health check that validates appSecret is present, and surface a warning in the dashboard if signature verification is likely to fail. (scope: 4-8 hours)

---

### [P1] J2.2 — Completeness

**Gateway connection loading uses two separate paths — managed channels and gateway connections**

**Evidence:** `apps/chat/src/managed/runtime-registry.ts:32-53` — `loadAll` loads from `prisma.managedChannel` table. Lines 86-111 — `loadGatewayConnections` loads from `prisma.deploymentConnection` table. These are two separate tables with different schemas and loading paths. The `loadAll` path extracts credentials via `connectionStore.getById` (decryption happens inside the store), while `loadGatewayConnections` calls `decryptCredentials(conn.credentials)` directly.

The `loadAll` path sets `orgId` on the GatewayEntry (line 84), but `loadGatewayConnections` does NOT set `orgId` (line 101). This means status updates routed through the `onStatusUpdate` callback (`managed-webhook.ts:81`) will have `orgId: undefined` for deploymentConnection-loaded entries.

**Customer Impact:** If a WhatsApp connection was provisioned via the deploymentConnection path (the self-serve onboarding flow), status delivery receipts and billing data are not attributed to any org. This may affect ROI tracking and conversation analytics.

**Fix:** Ensure `orgId` is populated in `loadGatewayConnections` by joining through the deployment to get the organization ID. (scope: 2-4 hours)

---

### [P1] J2.5 — Reliability & State Integrity

**Booking confirmation reply has no delivery guarantee**

**Evidence:** `packages/core/src/channel-gateway/channel-gateway.ts:97-115` — after `platformIngress.submit` returns success, the gateway calls `replySink.send(text)`. If `replySink.send` (which calls `WhatsAppAdapter.sendTextReply`) throws after the booking is already confirmed in the database, the booking exists but the customer never received confirmation.

The `sendTextReply` has retry logic (`apps/chat/src/adapters/whatsapp.ts:417-447` — `withRetry` with 3 attempts), but if all 3 retries fail (e.g., WhatsApp token expired, rate limit), the error propagates to the webhook handler which catches it and writes to the DLQ (`managed-webhook.ts:127-138`). The DLQ records the raw payload but there's no mechanism to retry the outbound confirmation message.

**Customer Impact:** In a transient WhatsApp API failure scenario, the customer's booking is confirmed but they receive no confirmation message. They don't know if the booking went through. The DLQ has the inbound message but not the outbound reply that failed.

**Fix:** Add an outbound message queue with retry for critical booking confirmations. Consider separating booking confirmation from the synchronous webhook flow. (scope: 1-2 days)

---

### [P1] J2.6 — Ops Readiness

**WorkTrace persistence is fire-and-forget — failures are silently logged**

**Evidence:** `packages/core/src/platform/platform-ingress.ts:265-288` — `persistTrace` wraps the store call in try/catch and logs errors with `console.error`. If the trace store write fails, the execution result is still returned to the caller. No retry, no DLQ.

**Customer Impact:** If the database is under load or briefly unavailable, work traces are silently dropped. The operator loses visibility into what happened — the conversation happened, the booking may have been created, but there's no audit trail. The ROI dashboard (which depends on ConversionRecords, not WorkTraces) is unaffected, but the conversation browser and governance audit log may show gaps.

**Fix:** Add a local buffer or retry for trace persistence failures. At minimum, emit a metric that can be alerted on. (scope: 4-8 hours)

---

### [P0] J2.7 — Completeness

**MetaCAPIDispatcher is never wired as a ConversionBus subscriber**

**Evidence:** `apps/api/src/bootstrap/conversion-bus-bootstrap.ts:43` — the only subscriber registered on the ConversionBus is the `conversionRecordStore.record` handler that persists events to the database. There is no code anywhere in `apps/api/src/` that imports or instantiates `MetaCAPIDispatcher` (`packages/ad-optimizer/src/meta-capi-dispatcher.ts`). Search across all app files for "MetaCAPIDispatcher" or "capi" returns zero results in bootstrap code.

The `MetaCAPIDispatcher` class exists and is fully implemented (lines 1-135), but it requires `pixelId` and `accessToken` configuration, and is never instantiated or subscribed to the conversion bus.

**Customer Impact:** No conversion events are sent to Meta's Conversions API. Operators running Meta ads get zero signal back for optimization. Their ad spend optimization relies on CAPI data which never arrives. This silently degrades ad performance over time with no error or warning.

**Fix:** Wire `MetaCAPIDispatcher` as a ConversionBus subscriber in the bootstrap, gated on `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` env vars. (scope: 4-8 hours)

---

### [P1] J2.4 — Self-Serve Integrity

**Google Calendar credentials require founder-provisioned service account**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:258-259` — `resolveCalendarProvider` reads `GOOGLE_CALENDAR_CREDENTIALS` and `GOOGLE_CALENDAR_ID` from environment variables. These are server-level env vars, not per-org configuration. A self-serve operator cannot set these through the dashboard.

There is no dashboard UI for uploading Google Calendar service account credentials. The operator would need to (a) create a Google Cloud project, (b) create a service account, (c) share their calendar with the service account, (d) have the founder inject the credentials into the server environment.

**Customer Impact:** No self-serve operator can connect their calendar. Every operator requires founder assistance to enable the booking flow. This is the core revenue action of J2.

**Fix:** Build a per-org Google Calendar OAuth flow in the dashboard that stores credentials per organization. Until then, LocalCalendarProvider with business hours is the self-serve fallback, but it needs the invite/notification gap fixed (see P0 finding above). (scope: 3-5 days)

---

### [P1] J2.4 — Security / Multi-tenancy

**Calendar provider is global singleton — all orgs share one calendar**

**Evidence:** `apps/api/src/bootstrap/skill-mode.ts:65` — `resolveCalendarProvider` is called once at bootstrap and returns a single `CalendarProvider` instance. This instance is shared across all organizations. If Google Calendar is configured, all orgs book into the same Google Calendar. If LocalCalendarProvider is active, slot conflict detection queries all bookings globally (`packages/core/src/calendar/local-calendar-provider.ts:55` passes empty string as orgId, and `apps/api/src/bootstrap/skill-mode.ts:286-295` queries without org scoping).

The `findOverlapping` query at line 287-295 does `prisma.booking.findMany` with only time-range filters, no `organizationId` filter. One org's bookings will block slots for all other orgs.

**Customer Impact:** If two orgs use LocalCalendarProvider, they share the same availability pool. Org A's bookings reduce Org B's available slots. With Google Calendar, all bookings go to the founder's calendar regardless of which org the lead belongs to.

**Fix:** Make calendar provider resolution per-org using org-scoped credentials stored in the database. For LocalCalendarProvider, add `organizationId` to the overlap query. (scope: 1-2 days)

---

### [P2] J2.1 — Completeness

**Media messages arrive with empty text — Alex receives a blank message**

**Evidence:** `apps/chat/src/adapters/whatsapp-parsers.ts:148` — `parseMediaMessage` returns `text: ""` (empty string) for image, audio, video, document, and sticker messages. The channel gateway passes this empty text to `platformIngress.submit` via `channel-gateway.ts:79`. Alex sees a user turn with no content.

**Customer Impact:** If a lead sends a photo (e.g., of a product they want to discuss), Alex sees an empty message and responds as if no message was sent. The media attachment metadata is in the `IncomingMessage.metadata` field but is not forwarded to the skill — only `message.text` reaches the LLM.

**Fix:** Generate a placeholder text for media messages (e.g., "[Customer sent an image]") so the LLM is aware. Forward attachment metadata to the skill context. (scope: 4-8 hours)

---

### [P2] J2.1 — Reliability

**Dedup check is optional and may not be configured**

**Evidence:** `apps/chat/src/routes/managed-webhook.ts:88-96` — dedup runs only `if (deps.dedup && gatewayEntry.adapter.extractMessageId)`. The `dedup` dependency is typed as optional (`dedup?: { checkDedup(...) }`). If not wired at startup, duplicate webhook deliveries from Meta (which are common during retries) will be processed twice, potentially leading to duplicate responses.

**Customer Impact:** Under network instability, the customer may receive duplicate responses from Alex. Not blocking but degrades trust.

**Fix:** Verify dedup is wired in the chat server bootstrap. If not, add it. (scope: 2-4 hours)

---

### [P2] J2.5 — Ops Readiness

**Generic error message on skill execution failure**

**Evidence:** `packages/core/src/channel-gateway/channel-gateway.ts:114` — when `response.ok` is false, the gateway sends: "I'm having trouble right now. Let me connect you with the team." No escalation is created, no handoff is recorded, no notification is sent to the operator. The promise to "connect you with the team" is hollow.

**Customer Impact:** The customer is told someone will reach out, but no one is notified. The failed response is logged in the WorkTrace (if persistence succeeds) but there's no proactive alert to the operator.

**Fix:** Create a handoff/escalation record on skill failure so the operator is notified. (scope: 4-8 hours)

---

### [P2] J2.8 — Completeness

**ROI dashboard data is properly org-scoped**

**Evidence:** `apps/api/src/routes/roi.ts:16` — `requireOrganizationScope(request, reply)` extracts orgId from auth. `packages/db/src/stores/prisma-conversion-record-store.ts:70` — `funnelByOrg` filters by `organizationId: orgId`. All conversion record queries include the org filter. This is correct.

No finding — this step passes all lenses.

---

### [P1] J2.8 — Completeness

**ConversionRecord lacks booking linkage — ROI funnel counts conversions but cannot trace to individual bookings**

**Evidence:** `packages/core/src/skill-runtime/tools/calendar-book.ts:221-240` — the outbox event payload includes `bookingId` and `opportunityId` in `metadata`, but `packages/db/src/stores/prisma-conversion-record-store.ts:49-66` — the `record` method stores these in the `metadata` JSON column, not in indexed columns. The `funnelByOrg` query (line 69-80) groups by `type` and sums values but cannot drill down to individual bookings.

**Customer Impact:** The operator sees aggregate funnel counts (X inquiries, Y qualified, Z booked) but cannot click through to see which specific leads booked. The dashboard overview (`apps/api/src/routes/dashboard-overview.ts:246`) does show today's bookings separately from the booking store, so the information is available but through a separate query path, not linked to the conversion funnel.

**Fix:** Add `bookingId` as an indexed column on ConversionRecord, or provide a drill-down API that joins conversion records with bookings via metadata. (scope: 4-8 hours)

---

## Summary

| Priority | Count | Key Blockers                                                                                                                                                        |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | 4     | Alex builder not registered, no contact/opportunity auto-creation, NoopCalendarProvider fake bookings, CAPI not wired                                               |
| P1       | 5     | Calendar is global singleton, Google Calendar requires founder assist, no booking confirmation delivery guarantee, gateway orgId gap, conversion-to-booking linkage |
| P2       | 4     | Media messages blank, dedup optional, error message hollow, ROI scoping correct                                                                                     |

### Critical Path

The P0 findings form a chain that blocks the entire J2 journey:

1. **Alex builder not registered** -- even if a lead reaches Alex, the skill runs without business context, qualification criteria, or operating instructions.
2. **No contact/opportunity auto-creation** -- even with the builder registered, new leads have no opportunity, causing the builder to throw before the LLM is called.
3. **Calendar not self-serve** -- even with (1) and (2) fixed, the booking step requires founder-provisioned Google Calendar credentials or a LocalCalendarProvider that doesn't send invites.
4. **CAPI not wired** -- even with the full J2 journey working, conversion data never reaches Meta for ad optimization.

**Verdict:** J2 is not launch-ready. The conversation path from webhook to response has correct plumbing (signature verification, dedup, DLQ, retry on send), but the skill execution layer has a critical wiring gap (builder not registered) that prevents Alex from functioning as designed. The booking path has a self-serve gap (calendar credentials) that requires founder action for every operator.

**Status: DONE**
