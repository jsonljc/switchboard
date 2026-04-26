# WhatsApp Completeness — Design Spec

> Revenue-critical WhatsApp features: Tech Provider onboarding + messaging richness.
> Two parallel tracks, zero shared dependencies.

---

## Context

Switchboard's WhatsApp adapter handles text send/receive, template messages, interactive
buttons (3 max), referral/CTWA extraction, webhook verification, signature verification,
rate limiting (80 msg/sec), and 24-hour window compliance. This is a solid foundation but
leaves conversion-critical capabilities on the table.

**Goal:** Make WhatsApp a complete revenue-critical channel for the Alex lead-to-booking
wedge. Not platform parity — only features that directly improve client onboarding or
booking conversion.

**Approach:** Two parallel tracks (Approach C). Track 1 touches dashboard + API routes.
Track 2 touches the chat adapter + webhook handler. No shared dependencies.

---

## Phase 0: Tech Provider Approval (Prerequisite — Ops, Not Code)

One-time setup before Embedded Signup works. Runs in background while code is built.

| Step | Action                                                                                              | Duration |
| ---- | --------------------------------------------------------------------------------------------------- | -------- |
| 1    | Create Meta App with WhatsApp use case + connected business portfolio                               | 30 min   |
| 2    | Business Verification (name, address, phone, email, website, documents)                             | 1-3 days |
| 3    | App Review — submit 2 videos: (a) cURL sending test message, (b) WhatsApp Manager creating template | 1-5 days |
| 4    | Configure TP Config — Cloud API only, allowed domains, scopes                                       | 30 min   |

**Required permissions (Advanced Access via App Review):**

- `whatsapp_business_messaging` — send messages for customers
- `whatsapp_business_management` — onboard customers, manage assets
- `business_management` — Embedded Signup asset selection

**App settings needed:** app icon, privacy policy URL, app category.

---

## Track 1: Onboarding (Embedded Signup)

### Overview

Replace manual credential copy-paste with a one-click Embedded Signup flow. Client clicks
"Connect WhatsApp" → Meta popup → selects/creates WABA → verifies phone → done.

### Architecture

```
Dashboard "Connect WhatsApp" button
  → FB.login() popup (ES v4, TP config: Cloud API only)
  → Unified screen: select/create WABA + add phone + OTP
  → Popup closes → returns short-lived user token
  → POST /api/dashboard/connections/whatsapp-embedded
  → API backend (using Switchboard's own permanent SUAT):
      1. Call debug_token?input_token={user_token} → extract WABA ID
         from granular_scopes[whatsapp_business_management].target_ids[0]
      2. Add system user to WABA: POST /{waba_id}/assigned_users
         ?user={system_user_id}&tasks=['MANAGE']
      3. Get phone_number_id: GET /{waba_id}/phone_numbers
      4. Register phone for Cloud API: POST /{phone_number_id}/register
         { messaging_product: "whatsapp", pin: "123456" }
      5. Subscribe to webhooks: POST /{waba_id}/subscribed_apps
         { override_callback_uri: "{managed_webhook_url}", verify_token: "{token}" }
      6. Set business profile: automated_type=3p_full via
         POST /{phone_number_id}/whatsapp_business_profile
      7. Store waba_id + phone_number_id in DeploymentConnection (encrypted)
         (No per-client token stored — Switchboard's SUAT covers all clients)
      8. Create ManagedChannel with generated webhookPath
      → Return success
```

**Token model:** Switchboard uses a single permanent System User Access Token (SUAT)
for all client WABAs. The ES short-lived token is used once (for debug_token) and
discarded. Each client WABA is added to Switchboard's system user via assigned_users.
This is simpler and more secure than managing per-client tokens.

### New Files

| File                                                                          | Purpose                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`         | Connect WhatsApp UI — Meta JS SDK, FB.login(), callback handler        |
| `apps/api/src/routes/whatsapp-onboarding.ts`                                  | Backend: token exchange, WABA setup, webhook registration, bot profile |
| `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts` | Next.js proxy route to API backend                                     |

### Modified Files

| File                                                          | Change                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/dashboard/src/components/settings/connections-list.tsx` | Add Embedded Signup option alongside manual credential entry |
| `apps/dashboard/src/app/layout.tsx`                           | Conditionally load Meta JS SDK script                        |

### Data Model

No new Prisma models. Reuses existing:

- `DeploymentConnection` (type: `"whatsapp"`, credentials: encrypted `{ phoneNumberId, wabaId, flowsPrivateKey? }`)
  No per-client token — Switchboard's SUAT covers all clients. flowsPrivateKey added when Flows are enabled.
- `ManagedChannel` (channel: `"whatsapp"`, webhookPath, webhookRegistered)

### Environment Variables (New)

```
META_APP_ID=              # Meta app ID for JS SDK
META_CONFIG_ID=           # Facebook Login configuration ID for ES
META_SYSTEM_USER_TOKEN=   # Permanent SUAT — single token for all client WABAs
META_SYSTEM_USER_ID=      # System User ID for assigned_users calls
```

`WHATSAPP_APP_SECRET` (existing) serves double duty: webhook signature verification for
all clients (it's the Meta App Secret, not per-client). No per-client tokens are stored —
Switchboard's single SUAT manages all onboarded WABAs.

### Key Design Decisions

1. **Single SUAT for all clients.** Switchboard creates one permanent System User Access
   Token in Business Manager. Each client WABA is added to this system user via
   `assigned_users`. No per-client tokens to rotate or manage.

2. **TP Config: Cloud API only.** Minimizes asset pickers (WABA + phone number). No ad
   account, page, catalog, or IG pickers. Fewer pickers = less drop-off from the ~29%
   baseline conversion rate.

3. **Manual path stays as fallback.** 71% drop off from Embedded Signup. Some clients
   prefer to set up their own WABA manually. Keep the existing credential form.

4. **Per-WABA webhook routing.** Each `POST /{WABA_ID}/subscribed_apps` uses
   `override_callback_uri` pointing to that client's unique `ManagedChannel.webhookPath`.
   Priority: phone number > WABA override > app default.

5. **Bot profile set at onboarding time.** `automated_type=3p_full` ensures WhatsApp shows
   the "messages are automated" disclosure from message one.

6. **Phone number registration required.** After getting `phone_number_id`, must call
   `POST /{phone_number_id}/register` before the number can send/receive via Cloud API.

### Error Handling

- ES popup closed without completing → show "Setup cancelled" with retry button
- Token exchange fails → show error with manual fallback option
- Webhook registration fails → store credentials, retry registration on next health check
- WABA already shared with another partner → show clear error explaining the conflict

---

## Track 2: Messaging Richness

Six capabilities ordered by conversion impact. Each is independently shippable.

### 2a. Delivery Status Webhooks

**What:** Parse `statuses[]` from webhook payloads. Track sent → delivered → read → failed
lifecycle per outbound message.

**Where:**

- `apps/chat/src/adapters/whatsapp.ts` — new `parseStatusUpdate()` alongside `parseIncomingMessage()`
- `apps/chat/src/routes/managed-webhook.ts` — detect status vs message payloads, route accordingly

**New Prisma model:**

```prisma
model WhatsAppMessageStatus {
  id          String   @id @default(cuid())
  messageId   String   // wamid
  recipientId String   // phone number
  status      String   // sent | delivered | read | failed | deleted | warning
  timestamp   DateTime // from payload, NOT insertion time (statuses arrive out of order)
  errorCode   String?  // populated when status=failed
  errorTitle  String?
  pricingCategory String? // marketing | utility | authentication | service
  billable    Boolean?
  organizationId String?
  createdAt   DateTime @default(now())

  @@index([messageId])
  @@index([organizationId, createdAt])
}
```

**Key constraint:** Statuses can arrive out of order (delivered before sent). Use payload
`timestamp` for ordering, not insertion time. Handle idempotently — upsert by messageId +
status.

### 2b. Read Receipts

**What:** Mark inbound messages as read via the API. Gives users blue checkmarks.

**Where:** New `markAsRead(messageId: string)` method on `WhatsAppAdapter`.

**API call:**

```json
POST /{phoneNumberId}/messages
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "{wamid}"
}
```

**Call site:** Invoke from managed-webhook.ts after successful message parse, fire-and-forget
(don't block message processing on read receipt delivery).

**Rate limits:** Read receipts are exempt from the 80 msg/sec throughput limit.

### 2c. Media Receiving

**What:** Parse image/audio/video/document payloads from incoming messages. Download media
via the Media API and populate `IncomingMessage.attachments[]`.

**Where:**

- `apps/chat/src/adapters/whatsapp.ts` — replace `parseUnsupportedMessage()` with
  type-specific parsers for image, audio, video, document
- New `downloadMedia(mediaId: string)` private method

**Media download flow:**

1. Extract `mediaId` from message payload (e.g., `msg.image.id`)
2. `GET /{mediaId}` → returns `{ url, mime_type, sha256, file_size }`
3. `GET {url}` with `Authorization: Bearer {token}` → binary data
4. Store binary (local filesystem or object storage — configurable)
5. Return local URL in `attachments[{ type, url, mimeType, filename?, sha256 }]`

**Critical:** Media URLs expire after 5 minutes. Download must happen synchronously during
webhook processing, not lazily.

**Size limits:** image 5MB, audio 16MB, video 16MB, document 100MB.

### 2d. Media Sending

**What:** Send images, documents, video, audio back to users.

**Where:** New `sendMedia()` method on `WhatsAppAdapter`. Optional method on `ChannelAdapter`
interface.

**Interface:**

```typescript
async sendMedia(
  threadId: string,
  type: "image" | "audio" | "video" | "document",
  source: { url: string } | { buffer: Buffer; mimeType: string; filename?: string },
  caption?: string,
): Promise<void>
```

**Two paths:**

- **URL source:** Send directly with `link` field. URL must serve `Content-Disposition: inline`.
- **Buffer source:** Upload via `POST /{phoneNumberId}/media` (multipart/form-data, NOT
  base64), get `media_id`, then send referencing the ID.

**Use cases:** Booking confirmation images, PDF receipts, location screenshots.

### 2e. Message Deduplication

**What:** Prevent duplicate message processing when WhatsApp retries webhook delivery.

**Where:** `apps/chat/src/routes/managed-webhook.ts` — add dedup check before dispatching
to the adapter.

**Implementation:** Reuse existing `RedisDedup` class from `apps/chat/src/dedup/redis-dedup.ts`
(already used for Telegram). Key = `wamid`, TTL = 5 minutes.

```typescript
const messageId = adapter.extractMessageId(rawPayload);
if (messageId && (await dedup.isDuplicate(`wa:${messageId}`))) {
  return reply.status(200).send("OK"); // ack but don't process
}
```

### 2f. WhatsApp Flows (Booking Form)

**What:** Structured multi-screen booking experience rendered natively in WhatsApp.
User taps "Book Now" → native form: service selection → date/time → confirmation.

**Architecture:**

```
Skill decides to trigger booking flow
  → WhatsAppAdapter.sendFlowMessage(threadId, flowId, flowToken, initialData)
  → User sees CTA button "Book Now" in chat
  → User taps → native Flow UI opens
  → Flow calls data endpoint for dynamic data (available slots)
  → User completes form
  → Webhook delivers nfm_reply with response_json + flow_token
  → Adapter parses as IncomingMessage with metadata.flowResponse
  → Skill processes booking
```

**New files:**

| File                                                   | Purpose                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `apps/api/src/routes/whatsapp-flows.ts`                | Data endpoint — handles INIT, DATA_EXCHANGE, COMPLETE actions |
| `apps/api/src/routes/__tests__/whatsapp-flows.test.ts` | Tests for data endpoint encryption + action handling          |

**Modified files:**

| File                                 | Change                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| `apps/chat/src/adapters/whatsapp.ts` | Add `sendFlowMessage()`, parse `nfm_reply` in incoming messages |
| `apps/chat/src/adapters/adapter.ts`  | Add optional `sendFlowMessage?()` to `ChannelAdapter` interface |

**Send Flow message payload:**

```json
{
  "messaging_product": "whatsapp",
  "to": "<phone>",
  "type": "interactive",
  "interactive": {
    "type": "flow",
    "body": { "text": "Ready to book your appointment?" },
    "action": {
      "name": "flow",
      "parameters": {
        "flow_message_version": "3",
        "flow_token": "<unique-per-message>",
        "flow_id": "<FLOW_ID>",
        "flow_cta": "Book Now",
        "mode": "published",
        "flow_action": "navigate",
        "flow_action_payload": {
          "screen": "SERVICE_SELECTION",
          "data": {}
        }
      }
    }
  }
}
```

**Data endpoint encryption (mandatory):**

WhatsApp encrypts all requests to the data endpoint using envelope encryption:

1. WhatsApp encrypts the request payload with a per-request AES-128-GCM key
2. The AES key is encrypted with the endpoint's RSA-2048 public key (OAEP padding)
3. Endpoint decrypts AES key with RSA private key, then decrypts payload with AES key
4. Endpoint encrypts response with the same AES key
5. Returns as Base64 string

**Per-WABA encryption keys:** Public keys are registered at the WABA level via the
WhatsApp Business Encryption API (`/{waba_id}/whatsapp-business-encryption`). Each
client WABA needs its own key pair. Switchboard generates a key pair per client during
onboarding and stores the private key encrypted in `DeploymentConnection.credentials`.

**Environment variables (new):**

```
(No global env vars for Flows — keys are per-WABA, stored in DeploymentConnection)
```

**Flow definition:** Created once per business via WhatsApp Manager UI or Graph API.
Not part of this codebase — it's a configuration artifact. The data endpoint is what
we build.

**Completion webhook parsing:**

```typescript
// In parseIncomingMessage, handle type "interactive" with nfm_reply
if (interactiveType === "nfm_reply") {
  const nfmReply = interactive["nfm_reply"] as Record<string, unknown>;
  const responseJson = JSON.parse(nfmReply["response_json"] as string);
  // Return IncomingMessage with metadata.flowResponse = responseJson
  // and metadata.flowToken = nfmReply["flow_token"]
}
```

**Booking flow screens (reference — configured in WhatsApp Manager, not code):**

1. `SERVICE_SELECTION` — Dropdown or RadioButtonsGroup for service type
2. `DATE_TIME` — DatePicker/CalendarPicker for date, Dropdown for time slot (populated via DATA_EXCHANGE from business calendar)
3. `CONFIRMATION` — TextBody summary, Footer with "Confirm" button

---

## Dependency Map

```
Track 1 (Onboarding)          Track 2 (Messaging)
──────────────────             ──────────────────
Phase 0: TP Approval           2a: Delivery Status
    ↓ (blocks go-live)         2b: Read Receipts
T1: Embedded Signup            2c: Media Receiving
                               2d: Media Sending
                               2e: Message Dedup
                               2f: WhatsApp Flows
                                    ↑
                                    needs 2a (status tracking)
                                    needs 2d (confirmation media)
```

Track 1 and Track 2 are fully independent. Within Track 2, items 2a-2e are independent.
Item 2f (Flows) benefits from 2a and 2d being done first but does not strictly require them.

---

## Out of Scope

- Commerce/catalog messages
- Reactions (send/receive)
- Sticker/location/contact sending
- List messages (outbound) — interactive buttons sufficient for current UX
- Broadcast/bulk messaging
- WhatsApp Payments (consumer payment collection)
- BSP credit line management
- WhatsApp Business Calling (voice)

---

## Testing Strategy

Each capability gets co-located tests:

| Capability              | Test File                                                           |
| ----------------------- | ------------------------------------------------------------------- |
| Delivery status parsing | `apps/chat/src/__tests__/whatsapp-status.test.ts`                   |
| Read receipts           | `apps/chat/src/__tests__/whatsapp.test.ts` (extend existing)        |
| Media receiving         | `apps/chat/src/__tests__/whatsapp-media.test.ts`                    |
| Media sending           | `apps/chat/src/__tests__/whatsapp-media.test.ts`                    |
| Message dedup           | `apps/chat/src/__tests__/whatsapp-wiring.test.ts` (extend existing) |
| Flow message sending    | `apps/chat/src/__tests__/whatsapp-flows.test.ts`                    |
| Flow data endpoint      | `apps/api/src/routes/__tests__/whatsapp-flows.test.ts`              |
| Flow completion parsing | `apps/chat/src/__tests__/whatsapp-flows.test.ts`                    |
| Embedded Signup backend | `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts`         |

All tests mock the Graph API. Encryption tests for the Flow data endpoint use known
test keys.

---

## Success Criteria

- Client can onboard WhatsApp in <3 minutes via Embedded Signup (Track 1)
- Outbound messages have delivery status visibility (2a)
- Booking flow completes natively in WhatsApp without text-based back-and-forth (2f)
- Media attachments (images, PDFs) can be sent and received (2c, 2d)
- No duplicate message processing under webhook retries (2e)
