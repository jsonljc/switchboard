# WhatsApp Wiring Integration Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the WhatsApp → Alex transport pipeline is wired correctly with a single integration test that exercises the real production route handlers.

**Architecture:** Extract the managed webhook route handlers from `main.ts` into a reusable `registerManagedWebhookRoutes()` function. Production code imports it, test imports it with a stub registry. Three test cases: happy path, verification challenge, bad signature.

**Tech Stack:** Vitest, Fastify (inject), WhatsAppAdapter, HMAC-SHA256

---

### Task 1: Export `GatewayEntry` type from runtime-registry

The `GatewayEntry` interface is currently unexported in `apps/chat/src/managed/runtime-registry.ts`. The new route file needs it.

**Files:**

- Modify: `apps/chat/src/managed/runtime-registry.ts:9`

- [ ] **Step 1: Export the GatewayEntry interface**

Change line 9 from:

```ts
interface GatewayEntry {
```

to:

```ts
export interface GatewayEntry {
```

No other changes needed — the interface fields (`gateway`, `adapter`, `deploymentConnectionId`, `channel`, `orgId?`) stay the same.

- [ ] **Step 2: Verify typecheck passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat typecheck`
Expected: PASS (no consumers break from exporting an already-internal type)

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: export GatewayEntry type from runtime-registry"
```

---

### Task 2: Extract managed webhook routes into `routes/managed-webhook.ts`

Move the GET and POST `/webhook/managed/:webhookId` handlers from `main.ts` into a standalone route-registration function. Zero behavior change — pure extraction.

**Files:**

- Create: `apps/chat/src/routes/managed-webhook.ts`
- Modify: `apps/chat/src/main.ts:215-305`

- [ ] **Step 1: Create the route file**

Create `apps/chat/src/routes/managed-webhook.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ReplySink } from "@switchboard/core";
import type { GatewayEntry } from "../managed/runtime-registry.js";
import type { FailedMessageStore } from "../dlq/failed-message-store.js";

export interface ManagedWebhookDeps {
  registry: {
    getGatewayByWebhookPath(path: string): GatewayEntry | null;
  };
  failedMessageStore?: FailedMessageStore | null;
}

export function registerManagedWebhookRoutes(app: FastifyInstance, deps: ManagedWebhookDeps): void {
  const { registry, failedMessageStore } = deps;

  app.get("/webhook/managed/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhookPath = `/webhook/managed/${webhookId}`;
    const entry = registry.getGatewayByWebhookPath(webhookPath);

    if (!entry) {
      return reply.code(404).send("Not found");
    }

    if (entry.adapter.handleVerification) {
      const query = request.query as Record<string, string | undefined>;
      const result = entry.adapter.handleVerification(query);
      return reply.code(result.status).send(result.body);
    }

    return reply.code(200).send("OK");
  });

  app.post("/webhook/managed/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhookPath = `/webhook/managed/${webhookId}`;

    const gatewayEntry = registry.getGatewayByWebhookPath(webhookPath);
    if (!gatewayEntry) {
      app.log.warn({ webhookPath }, "No gateway entry found for webhook path");
      return reply.code(200).send({ ok: true });
    }

    const payload = request.body as Record<string, unknown>;
    if (gatewayEntry.channel === "slack" && payload["type"] === "url_verification") {
      return reply.code(200).send({ challenge: payload["challenge"] });
    }

    if (gatewayEntry.adapter.verifyRequest) {
      const rawBody =
        ((request as unknown as Record<string, unknown>).rawBody as string) ??
        JSON.stringify(request.body);
      const headers = request.headers as Record<string, string | undefined>;
      if (!gatewayEntry.adapter.verifyRequest(rawBody, headers)) {
        return reply.code(401).send({ error: "Invalid signature" });
      }
    }

    const incoming = gatewayEntry.adapter.parseIncomingMessage(request.body);
    if (!incoming) {
      return reply.code(200).send({ ok: true });
    }

    const threadId = incoming.threadId ?? incoming.principalId;
    const replySink: ReplySink = {
      send: async (text) => gatewayEntry.adapter.sendTextReply(threadId, text),
    };

    try {
      await gatewayEntry.gateway.handleIncoming(
        {
          channel: gatewayEntry.channel,
          token: gatewayEntry.deploymentConnectionId,
          sessionId: threadId,
          text: incoming.text,
        },
        replySink,
      );
    } catch (err) {
      app.log.error(err, "Gateway webhook processing error");
      failedMessageStore
        ?.record({
          channel: gatewayEntry.channel,
          webhookPath,
          rawPayload: request.body as Record<string, unknown>,
          stage: "unknown",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        .catch((dlqErr: unknown) => app.log.error(dlqErr, "DLQ record error"));
    }
    return reply.code(200).send({ ok: true });
  });
}
```

- [ ] **Step 2: Replace inline handlers in `main.ts` with the extracted function**

In `apps/chat/src/main.ts`, add the import at the top (after the existing imports around line 19):

```ts
import { registerManagedWebhookRoutes } from "./routes/managed-webhook.js";
```

Then replace the entire block from `// --- WhatsApp webhook verification (GET) ---` (line 215) through the end of the POST handler (line 305) with:

```ts
// --- Managed channel webhook routes (GET verification + POST messages) ---
if (registry) {
  registerManagedWebhookRoutes(app, { registry, failedMessageStore });
}
```

Note: The old code had `if (!registry) return 404` inside each handler. The new code guards registration with `if (registry)` — same effect since unregistered routes return Fastify's default 404.

- [ ] **Step 3: Verify typecheck passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat typecheck`
Expected: PASS

- [ ] **Step 4: Run existing tests to verify zero behavior change**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test`
Expected: All existing tests pass (the extraction doesn't change any behavior)

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: extract managed webhook routes from main.ts"
```

---

### Task 3: Write the WhatsApp wiring integration test

The core deliverable. Three test cases exercising the real production route handlers.

**Files:**

- Create: `apps/chat/src/__tests__/whatsapp-wiring.test.ts`

- [ ] **Step 1: Write the test file**

Create `apps/chat/src/__tests__/whatsapp-wiring.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";
import { registerManagedWebhookRoutes } from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";

const APP_SECRET = "test_secret";
const VERIFY_TOKEN = "verify_me";
const WEBHOOK_ID = "wa-test-123";
const WEBHOOK_PATH = `/webhook/managed/${WEBHOOK_ID}`;
const SENDER_PHONE = "6591234567";
const MESSAGE_TEXT = "Hi, I saw your ad";
const REPLY_TEXT = "Hello from Alex";

function buildTextPayload(from: string, text: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
              contacts: [{ profile: { name: "Test User" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: "wamid.test123",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("WhatsApp wiring — managed webhook", () => {
  let app: FastifyInstance;
  const handleIncoming = vi.fn(async (_msg, replySink) => {
    await replySink.send(REPLY_TEXT);
  });
  let sendTextReply: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const adapter = new WhatsAppAdapter({
      token: "test_token",
      phoneNumberId: "123456789",
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
    });

    sendTextReply = vi.fn(adapter.sendTextReply.bind(adapter));
    const spiedAdapter = Object.create(adapter);
    spiedAdapter.sendTextReply = sendTextReply;

    const gatewayEntry: GatewayEntry = {
      gateway: { handleIncoming } as never,
      adapter: spiedAdapter,
      deploymentConnectionId: "conn-wa-123",
      channel: "whatsapp",
    };

    const registry = {
      getGatewayByWebhookPath(path: string) {
        return path === WEBHOOK_PATH ? gatewayEntry : null;
      },
    };

    app = Fastify({ logger: false });
    registerManagedWebhookRoutes(app, { registry });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("routes signed text message through gateway", async () => {
    const payload = buildTextPayload(SENDER_PHONE, MESSAGE_TEXT);
    const body = JSON.stringify(payload);
    const signature = signBody(body, APP_SECRET);

    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    expect(handleIncoming).toHaveBeenCalledOnce();
    const [msg] = handleIncoming.mock.calls[0];
    expect(msg).toMatchObject({
      channel: "whatsapp",
      sessionId: SENDER_PHONE,
      text: MESSAGE_TEXT,
      token: "conn-wa-123",
    });

    expect(sendTextReply).toHaveBeenCalledOnce();
    expect(sendTextReply).toHaveBeenCalledWith(SENDER_PHONE, REPLY_TEXT);
  });

  it("returns verification challenge", async () => {
    const response = await app.inject({
      method: "GET",
      url: WEBHOOK_PATH,
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "challenge_abc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("challenge_abc");
  });

  it("rejects bad signature before reaching gateway", async () => {
    handleIncoming.mockClear();

    const payload = buildTextPayload(SENDER_PHONE, MESSAGE_TEXT);

    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": "sha256=wrong" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid signature" });
    expect(handleIncoming).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test — expect all 3 to pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected: 3 tests pass

- [ ] **Step 3: Run the full chat test suite to check for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test`
Expected: All tests pass including the 3 new ones

- [ ] **Step 4: Commit**

```bash
git commit -m "test: add WhatsApp wiring integration test"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run typecheck across the whole repo**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Confirm the 3 wiring tests pass in isolation**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected output includes:

```
✓ routes signed text message through gateway
✓ returns verification challenge
✓ rejects bad signature before reaching gateway
```
