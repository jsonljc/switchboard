# Close the Loop — Lead Ingestion, Revenue Recording, CAPI Wiring

**Date:** 2026-04-14
**Status:** Draft
**Goal:** Close the ads-to-conversion feedback loop: leads from Meta ads create contacts and trigger WhatsApp outreach, revenue recorded via owner chat flows back to Meta CAPI.
**Predecessor:** `2026-04-14-governance-hardening-design.md`

---

## 1. Problem

Switchboard has a complete mid-funnel (chat → qualify → nurture → close) but the loop is broken at both ends:

- **Entry:** Meta sends lead data to an existing webhook that logs and discards it. No Contact is created, no WhatsApp message is sent. Speed-to-lead is infinite.
- **Exit:** When a lead converts, Switchboard records it internally but Meta never finds out. The ad algorithm optimizes for form fills, not paying customers.
- **Recording:** The owner has no way to record a sale. `PrismaRevenueStore` exists but has no route or chat command to call it.

## 2. Architecture

Three wiring tasks that connect existing infrastructure:

```
Meta Instant Form
  → POST /api/marketplace/leads/webhook (existing route, extend)
  → ContactStore.create() with attribution
  → WhatsAppAdapter.sendTemplateMessage() to lead
  → Lead replies → chat agent takes over

Owner in WhatsApp/Telegram
  → "Sarah paid $388 for Pico Laser"
  → /sold command handler (new cockpit command)
  → PrismaRevenueStore.record()
  → ConversionBus.emit("purchased")
  → CAPIDispatcher → Meta CAPI (existing client, restore wiring)
```

No new infrastructure. No new packages. One prerequisite: two new fields on the `Connection` model (see Section 3.4).

---

## 3. Lead Ingestion Webhook

### 3.1 Current State

`apps/api/src/routes/ad-optimizer.ts` has:

- `GET /api/marketplace/leads/webhook` — Meta verification handshake (working)
- `POST /api/marketplace/leads/webhook` — parses via `parseLeadWebhook()`, logs, returns 200

`packages/core/src/ad-optimizer/meta-leads-ingester.ts` has `parseLeadWebhook(payload): LeadData[]` returning `{ leadId, adId, formId, name, email, phone }`.

### 3.2 Changes

Extend the POST handler to:

1. Parse leads (existing)
2. For each lead with a phone number:
   a. Resolve organization — look up `Connection` where `serviceId === "meta-ads"` and `externalAccountId` matches `entry[].id`. If no match, log and skip.
   b. Deduplicate — `ContactStore.findByPhone(orgId, phone)`. If contact exists, check `contact.attribution?.sourceAdId === lead.adId` — if match, this is a duplicate, skip. If different ad or no existing contact, proceed.
   c. Create Contact — `ContactStore.create({ organizationId, name, phone, email, primaryChannel: "whatsapp", source: "meta-instant-form", attribution: { sourceAdId: lead.adId, fbclid: null, gclid: null, ttclid: null, sourceCampaignId: null, utmSource: null, utmMedium: null, utmCampaign: null } })`
   d. Send WhatsApp template — call a new `sendLeadGreeting(phone, name, orgWhatsAppConfig)` function that uses `WhatsAppAdapter.sendTemplateMessage()` with the org's configured greeting template name
   e. Emit `"inquiry"` event on ConversionBus (for CAPI Lead event)

3. Return 200 immediately (Meta requires response within 20 seconds)

### 3.3 Template Message

The org's `Connection` for WhatsApp stores a `greetingTemplateName` field (see 3.4 for migration). The template must be pre-approved in Meta Business Manager. Default: `"lead_welcome"` with parameter `{{1}}` = lead's first name.

If template send fails (template not approved, phone invalid), log the error but still return 200 to Meta. The Contact is created regardless — the lead can still message in.

### 3.4 Org Resolution + Prerequisites

The `Connection` model currently has `serviceId` and `organizationId` but no external account identifier or template name. Two fields must be added:

```prisma
model Connection {
  // ... existing fields ...
  externalAccountId    String?   // Meta page/ad account ID for webhook matching
  greetingTemplateName String?   // WhatsApp template name for lead greeting
}
```

This requires a Prisma migration as a prerequisite task.

The Meta webhook payload structure:

```json
{
  "entry": [{ "id": "PAGE_OR_AD_ACCOUNT_ID", "changes": [...] }]
}
```

We match `entry[].id` against `Connection.externalAccountId` where `serviceId === "meta-ads"`.

### 3.5 Files

| File                                  | Action                                 | Lines |
| ------------------------------------- | -------------------------------------- | ----- |
| `apps/api/src/routes/ad-optimizer.ts` | Modify — extend POST handler           | ~40   |
| `apps/api/src/routes/ad-optimizer.ts` | Modify — add `sendLeadGreeting` helper | ~20   |

---

## 4. Revenue Recording via Chat

### 4.1 Design

A new cockpit command `/sold` that the owner or staff uses in WhatsApp/Telegram:

**Usage patterns:**

```
/sold Sarah $388 Pico Laser
/sold John 150 consultation
/sold 500                        ← amount only, no contact match
```

**Flow:**

1. Regex match: `/^\/?sold\s+(.+)$/i`
2. Parse the input — extract amount (required), name (optional), description (optional)
3. If name provided, fuzzy match against recent contacts via `ContactStore.list(orgId)` filtered by name
4. Reply with confirmation: `"Record $388 from Sarah Chen for Pico Laser?\n\nReply Y to confirm."`
5. On "Y" reply:
   a. `PrismaRevenueStore.record({ organizationId, contactId, amount, type: "payment", recordedBy: "owner", ... })`
   b. `ConversionBus.emit({ type: "purchased", contactId, value: amount, sourceAdId, sourceCampaignId })`
   c. If contact has a lifecycle stage, update to `"converted"` via `ContactStore.updateStage()`
   d. Reply: `"Recorded: $388 from Sarah Chen. Meta has been notified."`

### 4.2 Parsing

Simple regex, not LLM — deterministic and fast:

```typescript
// Pattern: /sold [name] $amount [description]
// Amount is required. $ prefix optional. Name and description are optional.
const match = input.match(/^(?:([A-Za-z][\w\s]*?)\s+)?(?:\$?)(\d+(?:\.\d{1,2})?)\s*(.*)$/);
// match[1] = name (optional)
// match[2] = amount
// match[3] = description (optional)
```

If parsing fails: `"Usage: /sold [name] amount [description]\nExample: /sold Sarah 388 Pico Laser"`

### 4.3 Confirmation State

The confirmation uses an in-memory `Map<string, PendingSale>` keyed by `threadId`, stored on the `sold-command.ts` module. This avoids adding fields to the `ConversationThreadSchema`.

```typescript
const pendingSales = new Map<
  string,
  {
    contactId: string | null;
    contactName: string | null;
    amount: number;
    description: string;
    sourceCampaignId: string | null;
    sourceAdId: string | null;
  }
>();
```

After sending the confirmation, the handler stores the pending sale. In `handleCommands()`, before the `/sold` regex check, check if `pendingSales.has(threadId)` — if yes and the reply is "Y"/"yes", execute the sale and delete from map. If anything else, cancel and delete.

Pending sales expire after 5 minutes (check timestamp, clean up on access). This prevents stale confirmations from executing hours later.

### 4.4 Files

| File                                                    | Action                                                           | Lines |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----- |
| `apps/chat/src/handlers/sold-command.ts`                | Create — parse input, match contact, build confirmation, execute | ~100  |
| `apps/chat/src/handlers/__tests__/sold-command.test.ts` | Create — tests                                                   | ~80   |
| `apps/chat/src/message-pipeline.ts`                     | Modify — add `/sold` regex match + handler call                  | ~10   |

---

## 5. Revenue Recording API Route

### 5.1 Design

REST endpoint as backend for the chat command and dashboard:

```
POST   /api/:orgId/revenue          — record a revenue event
GET    /api/:orgId/revenue          — list revenue events
GET    /api/:orgId/revenue/summary  — total revenue by org
GET    /api/:orgId/revenue/by-campaign — revenue grouped by campaign
```

### 5.2 POST /api/:orgId/revenue

Input (Zod validated):

```typescript
z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});
```

If `opportunityId` is not provided, auto-generate one: `rev-${contactId}-${Date.now()}`. This satisfies `RecordRevenueInput.opportunityId` which is required.

After recording:

1. Call `revenueStore.record(input)`
2. Emit `ConversionEvent` on the bus: `{ type: "purchased", contactId, value: amount, sourceAdId, sourceCampaignId }`
3. Return the created `LifecycleRevenueEvent`

Auth: Bearer token + org scope + role check (`admin` or `operator`).

### 5.3 Files

| File                                            | Action                           | Lines |
| ----------------------------------------------- | -------------------------------- | ----- |
| `apps/api/src/routes/revenue.ts`                | Create — 4 routes                | ~120  |
| `apps/api/src/routes/__tests__/revenue.test.ts` | Create — tests                   | ~80   |
| `apps/api/src/bootstrap/routes.ts`              | Modify — register revenue routes | ~2    |

---

## 6. CAPI Wiring

### 6.1 Current State

- `MetaCAPIClient` at `packages/core/src/ad-optimizer/meta-capi-client.ts` — fully implemented, makes real HTTP calls to `graph.facebook.com/v21.0/{pixelId}/events`
- `InMemoryConversionBus` at `packages/core/src/events/conversion-bus.ts` — pub/sub with `subscribe(type, handler)`
- `CAPIDispatcher` was wired in `apps/api/dist/bootstrap/conversion-bus-bootstrap.js` (source removed/moved to `@switchboard/digital-ads`)

### 6.2 Changes

Create a new `apps/api/src/bootstrap/conversion-bus-wiring.ts` that subscribes a CAPI handler to the ConversionBus:

```typescript
export function wireCAPIDispatcher(
  bus: ConversionBus,
  config: { pixelId: string; accessToken: string },
): void {
  const client = new MetaCAPIClient(config);

  bus.subscribe("*", async (event) => {
    // Only forward events that have ad attribution
    if (!event.sourceAdId) return;

    const eventName = event.type === "purchased" ? "Purchase" : "Lead";
    // Dedup key: Meta ignores duplicate event_id values
    const eventId = `${event.contactId}-${event.type}-${Math.floor(event.timestamp.getTime() / 1000)}`;
    await client.dispatchEvent({
      eventName,
      eventTime: Math.floor(event.timestamp.getTime() / 1000),
      eventId,
      userData: { fbclid: event.metadata["fbclid"] as string | undefined },
      customData: event.value ? { value: event.value, currency: "SGD" } : undefined,
    });
  });
}
```

**Prerequisite:** The existing `services.ts` imports `wireConversionBus` from a source file that no longer exists (`./conversion-bus-bootstrap.js`). This import must be **replaced** with the new `wireCAPIDispatcher` import — not added alongside. The old `wireConversionBus` call must be removed and replaced with:

```typescript
import { wireCAPIDispatcher } from "./conversion-bus-wiring.js";

// In bootstrapServices(), after conversionBus creation:
const pixelId = process.env["META_PIXEL_ID"];
const accessToken = process.env["META_ACCESS_TOKEN"];
if (pixelId && accessToken) {
  wireCAPIDispatcher(conversionBus, { pixelId, accessToken });
}
```

Called from `apps/api/src/bootstrap/services.ts`, gated on `META_PIXEL_ID` and `META_ACCESS_TOKEN` env vars.

**CAPI event_id dedup:** Meta's CAPI deduplicates events with the same `event_id` within a 48-hour window. We generate `event_id` as `${contactId}-${type}-${timestamp}` so retries/double-emits are safely ignored by Meta.

### 6.3 Files

| File                                                             | Action                             | Lines |
| ---------------------------------------------------------------- | ---------------------------------- | ----- |
| `apps/api/src/bootstrap/conversion-bus-wiring.ts`                | Create — CAPI subscriber           | ~30   |
| `apps/api/src/bootstrap/__tests__/conversion-bus-wiring.test.ts` | Create — tests                     | ~40   |
| `apps/api/src/bootstrap/services.ts`                             | Modify — call `wireCAPIDispatcher` | ~5    |

---

## 7. Total Scope

~580 new lines across 5 new files, ~70 modified lines across 4 existing files. One Prisma migration (2 fields on Connection). No new packages. No new infrastructure.

## 8. Implementation Order

1. Prisma migration (Task 0) — add `externalAccountId` and `greetingTemplateName` to Connection
2. CAPI wiring (Task 1) — replace dead import, wire CAPI dispatcher
3. Revenue API route (Task 2) — backend needed by chat command
4. Revenue chat command `/sold` (Task 3) — primary owner UX
5. Lead ingestion webhook (Task 4) — extend existing route
6. Integration verification (Task 5) — full test suite

## 9. Success Criteria

- Lead fills out Meta Instant Form → Contact created in < 5 seconds → WhatsApp template sent
- Owner types `/sold Sarah 388 Pico Laser` → confirmation → revenue recorded → CAPI Purchase event sent to Meta
- `GET /api/:orgId/revenue/by-campaign` returns revenue grouped by campaign ID
- Duplicate leads (same phone + same adId) are skipped
- Template send failure does not prevent Contact creation
