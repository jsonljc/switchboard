# WhatsApp Wiring Integration Test

**Date:** 2026-04-20
**Goal:** Prove the WhatsApp → Alex pipeline is wired correctly with a single integration test file.

## Success Criterion

A signed WhatsApp webhook payload POSTed to `/webhook/managed/:webhookId` produces one PlatformIngress.submit() call and triggers one outbound WhatsApp send call.

## Scope

One test file: `apps/chat/src/__tests__/whatsapp-wiring.test.ts`

This test exercises the **managed webhook route** in `apps/chat/src/main.ts` (lines 239–305) through to the reply path. It proves the full transport wiring without touching LLM, database, or external APIs.

## What Is Real vs Mocked

| Component                                         | Real/Mock | Rationale                                                              |
| ------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| Fastify HTTP server                               | Real      | Proves route registration and request handling                         |
| WhatsApp webhook signature verification           | Real      | Proves security path; easy to set up with known `appSecret`            |
| WhatsApp message parsing (`parseIncomingMessage`) | Real      | Core thing under test                                                  |
| Managed webhook route handler                     | Real      | The glue we're proving works                                           |
| `RuntimeRegistry.getGatewayByWebhookPath`         | Stub      | Returns a pre-built gateway entry with WhatsApp adapter + mock gateway |
| `ChannelGateway.handleIncoming`                   | Spy       | Captures the `IncomingChannelMessage` and `ReplySink` args             |
| WhatsApp `sendTextReply`                          | Spy       | Asserts outbound reply is triggered                                    |
| Database (Prisma)                                 | None      | Not needed — gateway is stubbed at the registry level                  |
| PlatformIngress                                   | None      | Not needed — gateway.handleIncoming is the spy boundary                |

### Why spy on ChannelGateway instead of PlatformIngress

The managed webhook route in `main.ts` calls `gatewayEntry.gateway.handleIncoming()`. That is the boundary between transport (what this test proves) and execution (what a separate test should prove). Spying here keeps the test focused on: did the webhook route correctly parse, verify, and dispatch?

The ChannelGateway → PlatformIngress path is already unit-tested in `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`.

## Test Cases

### 1. Happy path — text message (must-have)

**Setup:**

- Create a `WhatsAppAdapter` with known credentials: `token: "test_token"`, `phoneNumberId: "123456789"`, `appSecret: "test_secret"`, `verifyToken: "verify_me"`
- Create a mock `ChannelGateway` with a spy on `handleIncoming` that calls `replySink.send("Hello from Alex")`
- Register a gateway entry at webhook path `/webhook/managed/wa-test-123`
- Build the Fastify app with this registry

**Payload:** Standard WhatsApp Cloud API text message from `+6591234567` saying "Hi, I saw your ad"

**Signature:** Compute real HMAC-SHA256 of the JSON body using `test_secret`

**Assertions:**

1. POST returns 200 with `{ ok: true }`
2. `gateway.handleIncoming` called once
3. The `IncomingChannelMessage` arg has:
   - `channel: "whatsapp"`
   - `sessionId: "6591234567"` (the phone number from the `from` field)
   - `text: "Hi, I saw your ad"`
   - `token` matching the deployment connection ID
4. `adapter.sendTextReply` called once with text `"Hello from Alex"` (proves replySink is wired end-to-end, not just invoked)

### 2. Verification challenge (should-have)

**Setup:** Same registry and adapter as test 1.

**Request:** GET `/webhook/managed/wa-test-123?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=challenge_abc`

**Assertions:**

1. Returns 200 with body `"challenge_abc"`

### 3. Bad signature (should-have)

**Setup:** Same registry and adapter as test 1.

**Payload:** Same WhatsApp payload as test 1, but with `x-hub-signature-256: sha256=wrong`

**Assertions:**

1. Returns 401 with `{ error: "Invalid signature" }`
2. `gateway.handleIncoming` NOT called

## Implementation Approach

The test must exercise the actual production route handlers, not copies. Otherwise the test proves the route logic shape but not the real app wiring.

**Approach:** Extract a `registerManagedWebhookRoutes(app, deps)` helper from `main.ts`. Production `main.ts` calls it. The test imports it and injects a stub registry. This is a small refactor (~40 lines moved, zero behavior change) that gives the test a real proof.

**Extraction target:** The GET handler (lines 216–236) and POST handler (lines 239–305) in `main.ts` move into `apps/chat/src/routes/managed-webhook.ts`. The function signature:

```ts
export function registerManagedWebhookRoutes(
  app: FastifyInstance,
  deps: {
    registry: { getGatewayByWebhookPath(path: string): GatewayEntry | undefined };
    failedMessageStore?: FailedMessageStore;
  },
): void;
```

`main.ts` then calls `registerManagedWebhookRoutes(app, { registry, failedMessageStore })`.

## Test File Structure

```
apps/chat/src/__tests__/whatsapp-wiring.test.ts
```

```
imports
  - vitest (describe, it, expect, vi)
  - fastify
  - registerManagedWebhookRoutes from ../routes/managed-webhook.js
  - WhatsAppAdapter from ../adapters/whatsapp.js
  - crypto (for HMAC computation)

helpers
  - buildTestPayload(from, text): WhatsApp Cloud API payload object
  - signPayload(body, secret): computes x-hub-signature-256 header

describe("WhatsApp wiring — managed webhook")
  beforeAll: create Fastify app, call registerManagedWebhookRoutes with stub registry
  afterAll: close Fastify app

  test 1: "routes signed text message through gateway"
  test 2: "returns verification challenge"
  test 3: "rejects bad signature before reaching gateway"
```

## Not In Scope

- LLM execution, tool calls, CRM, booking, escalation
- Multi-turn conversation continuity
- Database persistence
- Real WhatsApp API calls
- Conversation compounding / memory
- Rate limiting behavior
- Non-text message handling (images, video) — already covered in `whatsapp.test.ts`

## Exit Criteria

All 3 tests pass. The happy path test proves: webhook POST → parse → verify → gateway dispatch → reply send. That is the minimum wiring proof for WhatsApp transport.
