# F-14: Telegram inbound cannot create a ConversationThread — no Contact is resolved for non-WhatsApp channels, so the `contactId` FK violates on every message

- **Severity:** blocks-pilot
- **Journey/step:** J3-S3 (booking conversation — conversation persistence)
- **Verdict:** BROKEN (exercised live; every Telegram inbound P2003-fails at thread create)
- **Location:**
  - `packages/core/src/channel-gateway/resolve-contact-identity.ts:19-21` — `if (channel !== "whatsapp") return { contactId: null, ... }`. Only WhatsApp resolves/creates a Contact.
  - `apps/chat/src/gateway/gateway-conversation-store.ts:28` — `const contactId = identity?.contactId ?? \`visitor-${sessionId}\``. For Telegram this is always the `visitor-…` literal.
  - `gateway-conversation-store.ts:49-57` — `conversationThread.create({ data: { contactId, ... } })` with that literal.
  - DB constraint: `ConversationThread.contactId` is `NOT NULL` with FK `ConversationThread_contactId_fkey → Contact(id)`. The `visitor-…` id has no backing Contact row, so the insert violates the FK.
  - Caller: `packages/core/src/channel-gateway/channel-gateway.ts:193-207` resolves identity then calls `getOrCreateBySession`.
    (verified against `audit/pilot-spine` worktree, 2026-06-08)

## What was exercised

After bridging F-13 (D-03), I injected a Telegram inbound for the audit org. The deployment resolved correctly (`resolved deployment=…0002 skillSlug=alex org=org_4f79…`), `getOrCreateBySession` found no existing thread, and the `conversationThread.create()` threw:

```
PrismaClientKnownRequestError P2003
Invalid `prisma.conversationThread.create()` invocation:
Foreign key constraint violated on the constraint: `ConversationThread_contactId_fkey`
  at PrismaGatewayConversationStore.getOrCreateBySession (gateway-conversation-store.js:32)
  at ChannelGateway.handleIncoming (channel-gateway.js:156)
```

The message was DLQ'd. Artifact: `evidence/j3-inbound-routing-broken.txt` (second injection block).

Note the deliberate comment at `gateway-conversation-store.ts:24-30`: "Safe today only because WhatsApp (the sole contact-resolving channel) resolves identity on turn 1." Telegram is NOT contact-resolving, so the `visitor-…` fallback is reached and the FK fails. The fallback id was apparently designed for a no-FK/visitor-table world; against the current `Contact` FK it can never satisfy the constraint.

## What happened vs expected

Expected: a Telegram lead messages the bot → a Contact + ConversationThread are created → Alex replies. Observed: the thread create FK-fails on the very first inbound; no contact, no thread, no reply, no booking. Combined with F-13, **the Telegram managed-channel path — the only channel a pilot can self-serve connect today without Meta App Review (WhatsApp) — is fully non-functional for inbound.** The medspa pilot loop (lead → conversation → booking) cannot start on Telegram.

Contrast: the alex skill-runtime builder (`packages/core/src/skill-runtime/builders/alex.ts:45-65`) DOES auto-create a Contact + Opportunity for a new lead — but that runs only after the conversation thread exists and the skill is dispatched. The gateway's thread-create happens first and dies before the skill ever runs.

## Suggested fix scope

Resolve/create a Contact for Telegram (and any non-WhatsApp managed channel) in `resolveContactIdentity` — keyed on the channel principal id (Telegram `from.id`), with `primaryChannel: "telegram"`, `source: "telegram_inbound"` — mirroring the WhatsApp branch, so `getOrCreateBySession` always receives a real `contactId`. Alternatively, have `getOrCreateBySession` create the Contact before the thread when `contactId` is null. Add a seam-pin/integration test that runs a Telegram inbound through `ChannelGateway.handleIncoming` against a real (mock-Prisma) store and asserts the thread is created (FK satisfied), not thrown.

## Cross-reference

Downstream of F-13 (routing). Together F-13 + F-14 make the Telegram pilot spine BROKEN end-to-end at prod defaults. The Spec-1A "chain weld" (thread keyed off resolved contact) assumes a contact-resolving channel; Telegram breaks that assumption.
