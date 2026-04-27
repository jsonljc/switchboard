---
date: 2026-04-27
task: fix/launch-alex-context-and-calendar
type: read-only-audit-gate
---

# Fix/Launch Alex Context and Calendar — Prep Notes

Read-only diagnostic for branch `fix/launch-alex-context-and-calendar`. No source code modified.

---

## Step 1: Confirm `ChannelGatewayConfig` shape and package boundary

**Command:**

```bash
sed -n '1,80p' packages/core/src/channel-gateway/types.ts
```

**Finding:**
File exists at `packages/core/src/channel-gateway/types.ts`. Interface `ChannelGatewayConfig` confirmed with exact expected shape:

- `conversationStore: GatewayConversationStore` ✓
- `deploymentResolver: DeploymentResolver` ✓
- `platformIngress: { submit(request: CanonicalSubmitRequest): Promise<SubmitWorkResponse> }` ✓
- `onMessageRecorded?: (info: { ... }) => void` ✓ (optional, takes phone/channel/sessionId)

**STATUS: PASS**

---

## Step 2: Confirm `PrismaContactStore` API compatibility

**Command:**

```bash
grep -n "findByPhone\|^  async create\|export class PrismaContactStore" packages/db/src/stores/prisma-contact-store.ts
grep -rn "PrismaContactStore" packages/db/src/index.ts packages/db/src/stores/index.ts 2>/dev/null
```

**Finding:**

- `PrismaContactStore` class exists at `packages/db/src/stores/prisma-contact-store.ts:41`
- `async create(input: CreateContactInput): Promise<Contact>` at line 44 ✓
- `async findByPhone(orgId: string, phone: string): Promise<Contact | null>` at line 83 ✓
- Exported from `@switchboard/db` via `packages/db/src/index.ts:64` ✓

**STATUS: PASS**

---

## Step 3: Confirm WhatsApp `sessionId` is the sender phone (E.164)

**Command:**

```bash
grep -n "sessionId\|fromPhoneNumber\|from\.phone\|wa_id" apps/chat/src/adapters/whatsapp.ts apps/chat/src/managed/managed-whatsapp-adapter.ts 2>/dev/null
grep -rln "IncomingChannelMessage\|sessionId:" apps/chat/src --include="*.ts"
```

**Finding:**
Files checked at `apps/chat/src/adapters/whatsapp-parsers.ts` and `apps/chat/src/routes/managed-webhook.ts`.

Parser functions (`parseTextMessage`, `parseMediaMessage`, `parseInteractiveMessage`, `parseUnsupportedMessage`) in `whatsapp-parsers.ts`:

- All set `principalId: from ?? "unknown"` where `from = msg["from"] as string` (WhatsApp WABA from field, which is E.164 phone)
- All set `threadId: from` (same source)

In `managed-webhook.ts:167`:

- `sessionId: threadId` is passed to `gateway.handleIncoming()`
- `threadId = incoming.threadId ?? incoming.principalId` (line 157)
- Both resolve to the E.164 sender phone from WhatsApp API

**Exact line (whatsapp-parsers.ts:214):**

```typescript
principalId: from ?? "unknown",
```

**STATUS: PASS** — `sessionId` equals sender's E.164 phone, not hashed/meta-internal id.

---

## Step 4: Confirm `resolved.organizationId` available before `ingress.submit`

**Command:**

```bash
sed -n '13,34p' packages/core/src/channel-gateway/channel-gateway.ts
```

**Finding:**
Read `packages/core/src/channel-gateway/channel-gateway.ts` lines 13–100.

- Line 16: `resolved = await deploymentResolver.resolveByChannelToken(message.channel, message.token)`
- Line 48: `organizationId: resolved.organizationId` is **already** used in `onMessageRecorded` callback (outside the if-error path, so guaranteed resolved)
- Line 75: `organizationId: resolved.organizationId` passed to `CanonicalSubmitRequest` before line 94 `platformIngress.submit(request)`

**STATUS: PASS** — `resolved.organizationId` is available and already used upstream before `ingress.submit()`.

---

## Step 5: Audit `LocalBookingStore.findOverlapping` consumers

**Command:**

```bash
grep -rn "findOverlapping\|LocalBookingStore" packages apps --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v ".worktrees" | grep -v node_modules
```

**Finding:**
Only these real consumers exist:

1. `packages/core/src/calendar/local-calendar-provider.ts` — interface declaration + implementation
2. `apps/api/src/bootstrap/skill-mode.ts:320` — wrapper closure instantiation

No third unexpected consumer found. Test files excluded.

**STATUS: PASS**

---

## Step 6: Resend sender-address env var situation

**Command:**

```bash
grep -rn "RESEND_API_KEY\|resend\.com\|from:.*@\|EmailSender\b" apps/api/src packages/core/src --include="*.ts" 2>/dev/null | grep -v __tests__ | grep -v ".test."
```

**Finding:**
Checked `apps/api/src/bootstrap/skill-mode.ts` and `apps/api/src/services/notifications/email-escalation-notifier.ts`.

Existing escalation email implementation:

- `EmailEscalationNotifier` class accepts `config.fromAddress: string` (line 6 in notifier)
- Initialized at `apps/api/src/bootstrap/skill-mode.ts:82` with:
  ```typescript
  fromAddress: process.env["EMAIL_FROM"] ?? "noreply@switchboard.app",
  ```

**Decision:** `SECTION_3_DECISION: REUSE`

An existing env var **`EMAIL_FROM`** holds the sender address. Use this name everywhere `BOOKING_FROM_EMAIL` would appear (do NOT add new env var; use `EMAIL_FROM`).

**STATUS: PASS**

---

## Step 7: Confirm `alexBuilder` config type accepts `phone` and `channel`

**Command:**

```bash
grep -n "config\.phone\|config\.channel\|ParameterBuilder" packages/core/src/skill-runtime/builders/alex.ts packages/core/src/skill-runtime/parameter-builder.ts
```

**Finding:**
Read `packages/core/src/skill-runtime/parameter-builder.ts` lines 48–58.

`ParameterBuilder` type signature (line 48):

```typescript
export type ParameterBuilder = (
  ctx: AgentContext,
  config: {
    deploymentId: string;
    orgId: string;
    contactId: string;
    phone?: string; // ← present
    channel?: string; // ← present
  },
  stores: SkillStores,
) => Promise<Record<string, unknown>>;
```

`packages/core/src/skill-runtime/builders/alex.ts`:

- Line 19: `const phone = config.phone;` ✓
- Line 20: `const channel = config.channel ?? "whatsapp";` ✓

**STATUS: PASS** — Config type already has `phone?: string` and `channel?: string`.

---

## Summary

All seven verification steps completed.

| Step | Finding                                                                       | Status |
| ---- | ----------------------------------------------------------------------------- | ------ |
| 1    | `ChannelGatewayConfig` shape confirmed at correct path                        | PASS   |
| 2    | `PrismaContactStore.findByPhone` and `.create` API confirmed                  | PASS   |
| 3    | WhatsApp `sessionId` equals E.164 sender phone (line whatsapp-parsers.ts:214) | PASS   |
| 4    | `resolved.organizationId` available before `ingress.submit()`                 | PASS   |
| 5    | `LocalBookingStore.findOverlapping` has 2 real consumers (no third party)     | PASS   |
| 6    | Existing `EMAIL_FROM` env var found; will be reused (no new env var needed)   | PASS   |
| 7    | `ParameterBuilder` config already accepts `phone?` and `channel?`             | PASS   |

**Critical Decision:** `SECTION_3_DECISION: REUSE` — Use existing `EMAIL_FROM` env var for booking confirmation sender address.

**Blocked Tasks:** None. All critical paths are clear.

**Downstream Task Gate:**

- **Task 2** (Capture contact phone in chat gateway + write to ContactStore): **UNBLOCKED**
- **Task 3** (Assemble calendar context in alex builder): **UNBLOCKED** (decision: SECTION_3_DECISION=REUSE guides this)
- **Task 4** (Add `findOverlapping` call to alex booking eligibility): **UNBLOCKED**
- **Task 5** (Implement emailSender callback in local-calendar-provider): **UNBLOCKED**
- **Task 6** (Implement alexBuilder parameter extraction): **UNBLOCKED**
- **Task 7** (BookingConfirmationEmail schema + Resend send): **UNBLOCKED**
- **Task 8** (e2e test for full flow): **UNBLOCKED**
- **Task 9** (Update deployment config UI): **UNBLOCKED** (skipped per Task 5 audit finding — no third consumer)

---

_Audit completed 2026-04-27. All hard stops cleared._
