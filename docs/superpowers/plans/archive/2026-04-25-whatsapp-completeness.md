# WhatsApp Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WhatsApp a complete revenue-critical channel — self-serve client onboarding via Embedded Signup + messaging richness (delivery status, read receipts, media, dedup, Flows).

**Architecture:** Two parallel tracks with zero shared dependencies. Track 1 (Tasks 1-3) adds Embedded Signup onboarding in the dashboard + API. Track 2 (Tasks 4-9) adds messaging capabilities to the chat adapter. Either track can be executed independently.

**Tech Stack:** TypeScript, Fastify, Next.js 14, Prisma, Meta Graph API v21.0, Meta JS SDK, WhatsApp Cloud API, Redis (dedup), node:crypto (Flows encryption)

**Spec:** `docs/superpowers/specs/2026-04-25-whatsapp-completeness-design.md`

---

## Track 2: Messaging Richness (No Blockers — Start Here)

### Task 1: Delivery Status Webhooks — Prisma Model + Store

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/stores/prisma-whatsapp-status-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-whatsapp-status-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-whatsapp-status-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaWhatsAppStatusStore } from "../prisma-whatsapp-status-store.js";

describe("PrismaWhatsAppStatusStore", () => {
  let store: PrismaWhatsAppStatusStore;
  let mockPrisma: Record<string, unknown>;

  beforeEach(() => {
    mockPrisma = {
      whatsAppMessageStatus: {
        upsert: async (args: Record<string, unknown>) => ({
          id: "status_1",
          ...(args as Record<string, unknown>)["create"],
        }),
        findMany: async () => [],
      },
    };
    store = new PrismaWhatsAppStatusStore(mockPrisma as never);
  });

  it("should upsert a delivery status", async () => {
    const result = await store.upsert({
      messageId: "wamid.abc123",
      recipientId: "15551234567",
      status: "delivered",
      timestamp: new Date("2026-04-25T10:00:00Z"),
    });

    expect(result.messageId).toBe("wamid.abc123");
    expect(result.status).toBe("delivered");
  });

  it("should query statuses by messageId", async () => {
    const results = await store.getByMessageId("wamid.abc123");
    expect(Array.isArray(results)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-whatsapp-status-store`
Expected: FAIL — module not found

- [ ] **Step 3: Add Prisma model**

Add to `packages/db/prisma/schema.prisma` after the `DeploymentConnection` model:

```prisma
model WhatsAppMessageStatus {
  id              String   @id @default(cuid())
  messageId       String
  recipientId     String
  status          String
  timestamp       DateTime
  errorCode       String?
  errorTitle      String?
  pricingCategory String?
  billable        Boolean?
  organizationId  String?
  createdAt       DateTime @default(now())

  @@unique([messageId, status])
  @@index([messageId])
  @@index([organizationId, createdAt])
}
```

- [ ] **Step 4: Generate Prisma client**

Run: `npx pnpm@9.15.4 db:generate`
Expected: Prisma client regenerated with `WhatsAppMessageStatus`

- [ ] **Step 5: Write the store implementation**

```typescript
// packages/db/src/stores/prisma-whatsapp-status-store.ts
import type { PrismaClient } from "@prisma/client";

export interface WhatsAppStatusRecord {
  id: string;
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string | null;
  errorTitle?: string | null;
  pricingCategory?: string | null;
  billable?: boolean | null;
  organizationId?: string | null;
}

export interface UpsertStatusInput {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string;
  errorTitle?: string;
  pricingCategory?: string;
  billable?: boolean;
  organizationId?: string;
}

export class PrismaWhatsAppStatusStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: UpsertStatusInput): Promise<WhatsAppStatusRecord> {
    return this.prisma.whatsAppMessageStatus.upsert({
      where: {
        messageId_status: {
          messageId: input.messageId,
          status: input.status,
        },
      },
      update: {
        timestamp: input.timestamp,
        errorCode: input.errorCode,
        errorTitle: input.errorTitle,
      },
      create: {
        messageId: input.messageId,
        recipientId: input.recipientId,
        status: input.status,
        timestamp: input.timestamp,
        errorCode: input.errorCode,
        errorTitle: input.errorTitle,
        pricingCategory: input.pricingCategory,
        billable: input.billable,
        organizationId: input.organizationId,
      },
    });
  }

  async getByMessageId(messageId: string): Promise<WhatsAppStatusRecord[]> {
    return this.prisma.whatsAppMessageStatus.findMany({
      where: { messageId },
      orderBy: { timestamp: "asc" },
    });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-whatsapp-status-store`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/stores/prisma-whatsapp-status-store.ts packages/db/src/stores/__tests__/prisma-whatsapp-status-store.test.ts
git commit -m "$(cat <<'EOF'
feat: add WhatsAppMessageStatus model and store for delivery tracking
EOF
)"
```

---

### Task 2: Delivery Status Webhooks — Adapter Parsing

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts`
- Create: `apps/chat/src/__tests__/whatsapp-status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat/src/__tests__/whatsapp-status.test.ts
import { describe, it, expect } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

function buildStatusPayload(
  status: string,
  messageId: string,
  options?: { errorCode?: string; errorTitle?: string; category?: string },
) {
  const statusObj: Record<string, unknown> = {
    id: messageId,
    recipient_id: "15551234567",
    status,
    timestamp: "1700000000",
  };
  if (status === "failed" && options?.errorCode) {
    statusObj["errors"] = [{ code: options.errorCode, title: options.errorTitle }];
  }
  if (options?.category) {
    statusObj["pricing"] = {
      pricing_model: "PMP",
      billable: true,
      category: options.category,
    };
  }
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
              statuses: [statusObj],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

describe("WhatsAppAdapter — status parsing", () => {
  it("should parse a delivered status", () => {
    const payload = buildStatusPayload("delivered", "wamid.abc123");
    const result = adapter.parseStatusUpdate(payload);

    expect(result).not.toBeNull();
    expect(result!.messageId).toBe("wamid.abc123");
    expect(result!.status).toBe("delivered");
    expect(result!.recipientId).toBe("15551234567");
    expect(result!.timestamp).toEqual(new Date(1700000000 * 1000));
  });

  it("should parse a failed status with error details", () => {
    const payload = buildStatusPayload("failed", "wamid.fail1", {
      errorCode: "131031",
      errorTitle: "Business Account locked",
    });
    const result = adapter.parseStatusUpdate(payload);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("failed");
    expect(result!.errorCode).toBe("131031");
    expect(result!.errorTitle).toBe("Business Account locked");
  });

  it("should parse pricing info from status", () => {
    const payload = buildStatusPayload("sent", "wamid.sent1", { category: "utility" });
    const result = adapter.parseStatusUpdate(payload);

    expect(result).not.toBeNull();
    expect(result!.pricingCategory).toBe("utility");
    expect(result!.billable).toBe(true);
  });

  it("should return null for message payloads (no statuses)", () => {
    const messagePayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "15551234567", id: "wamid.msg1", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(adapter.parseStatusUpdate(messagePayload)).toBeNull();
  });

  it("should return null for empty payload", () => {
    expect(adapter.parseStatusUpdate(null)).toBeNull();
    expect(adapter.parseStatusUpdate({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-status`
Expected: FAIL — `parseStatusUpdate` is not a function

- [ ] **Step 3: Implement parseStatusUpdate on WhatsAppAdapter**

Add to `apps/chat/src/adapters/whatsapp.ts` inside `WhatsAppAdapter` class, after `extractMessageId()`:

```typescript
parseStatusUpdate(rawPayload: unknown): {
  messageId: string;
  recipientId: string;
  status: string;
  timestamp: Date;
  errorCode?: string;
  errorTitle?: string;
  pricingCategory?: string;
  billable?: boolean;
} | null {
  const payload = rawPayload as Record<string, unknown>;
  if (!payload) return null;

  const value = extractWhatsAppValue(payload);
  if (!value) return null;

  const statuses = value["statuses"] as Array<Record<string, unknown>> | undefined;
  if (!statuses || statuses.length === 0) return null;

  const s = statuses[0]!;
  const result: {
    messageId: string;
    recipientId: string;
    status: string;
    timestamp: Date;
    errorCode?: string;
    errorTitle?: string;
    pricingCategory?: string;
    billable?: boolean;
  } = {
    messageId: s["id"] as string,
    recipientId: s["recipient_id"] as string,
    status: s["status"] as string,
    timestamp: new Date(parseInt(s["timestamp"] as string) * 1000),
  };

  const errors = s["errors"] as Array<Record<string, unknown>> | undefined;
  if (errors && errors.length > 0) {
    result.errorCode = String(errors[0]!["code"]);
    result.errorTitle = errors[0]!["title"] as string;
  }

  const pricing = s["pricing"] as Record<string, unknown> | undefined;
  if (pricing) {
    result.pricingCategory = pricing["category"] as string;
    result.billable = pricing["billable"] as boolean;
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-status`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/adapters/whatsapp.ts apps/chat/src/__tests__/whatsapp-status.test.ts
git commit -m "$(cat <<'EOF'
feat: add delivery status webhook parsing to WhatsApp adapter
EOF
)"
```

---

### Task 3: Delivery Status Webhooks — Wire Into Managed Webhook

**Files:**

- Modify: `apps/chat/src/routes/managed-webhook.ts`
- Modify: `apps/chat/src/__tests__/whatsapp-wiring.test.ts`

- [ ] **Step 1: Add test for status webhook routing**

Append to `apps/chat/src/__tests__/whatsapp-wiring.test.ts`:

```typescript
it("handles status webhook without dispatching to gateway", async () => {
  handleIncoming.mockClear();

  const statusPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
              statuses: [
                {
                  id: "wamid.status1",
                  recipient_id: SENDER_PHONE,
                  status: "delivered",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };

  const body = JSON.stringify(statusPayload);
  const signature = signBody(body, APP_SECRET);

  const response = await app.inject({
    method: "POST",
    url: WEBHOOK_PATH,
    payload: statusPayload,
    headers: { "x-hub-signature-256": signature },
  });

  expect(response.statusCode).toBe(200);
  expect(handleIncoming).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected: FAIL — the status payload currently gets parsed as null by `parseIncomingMessage` and returns `{ ok: true }`, but `handleIncoming` is not called. This test might actually pass since `parseIncomingMessage` returns null for status payloads. If it passes, the wiring already works correctly for the "don't dispatch" case. Add a status callback hook instead.

- [ ] **Step 3: Add optional onStatusUpdate callback to ManagedWebhookDeps**

Modify `apps/chat/src/routes/managed-webhook.ts`:

```typescript
export interface ManagedWebhookDeps {
  registry: {
    getGatewayByWebhookPath(path: string): GatewayEntry | null;
  };
  failedMessageStore?: FailedMessageStore | null;
  onStatusUpdate?: (
    status: {
      messageId: string;
      recipientId: string;
      status: string;
      timestamp: Date;
      errorCode?: string;
      errorTitle?: string;
      pricingCategory?: string;
      billable?: boolean;
    },
    orgId?: string,
  ) => Promise<void>;
}
```

Then in the POST handler, after signature verification and before `parseIncomingMessage`, add:

```typescript
if (gatewayEntry.channel === "whatsapp" && deps.onStatusUpdate) {
  const wa = gatewayEntry.adapter as import("../adapters/whatsapp.js").WhatsAppAdapter;
  if (typeof wa.parseStatusUpdate === "function") {
    const statusUpdate = wa.parseStatusUpdate(request.body);
    if (statusUpdate) {
      deps
        .onStatusUpdate(statusUpdate, gatewayEntry.orgId)
        .catch((err: unknown) => app.log.error(err, "Status update processing error"));
      return reply.code(200).send({ ok: true });
    }
  }
}
```

- [ ] **Step 4: Run all whatsapp-wiring tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/routes/managed-webhook.ts apps/chat/src/__tests__/whatsapp-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat: wire delivery status webhooks through managed webhook handler
EOF
)"
```

---

### Task 4: Read Receipts

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts`
- Modify: `apps/chat/src/__tests__/whatsapp.test.ts`

- [ ] **Step 1: Add test for markAsRead**

Append to `apps/chat/src/__tests__/whatsapp.test.ts`:

```typescript
describe("markAsRead", () => {
  it("should send read receipt to WhatsApp API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await adapter.markAsRead("wamid.abc123");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/123456789/messages");
    const body = JSON.parse(options!.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.abc123",
    });

    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp`
Expected: FAIL — `markAsRead` is not a function

- [ ] **Step 3: Implement markAsRead**

Add to `WhatsAppAdapter` class in `apps/chat/src/adapters/whatsapp.ts`:

```typescript
async markAsRead(messageId: string): Promise<void> {
  const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch {
    // Fire-and-forget — don't block message processing
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp`
Expected: PASS

- [ ] **Step 5: Wire markAsRead into managed-webhook.ts**

In `apps/chat/src/routes/managed-webhook.ts`, after `parseIncomingMessage` succeeds and before `handleIncoming`, add:

```typescript
const rawMessageId = gatewayEntry.adapter.extractMessageId(request.body);
if (rawMessageId && gatewayEntry.channel === "whatsapp") {
  const wa = gatewayEntry.adapter as import("../adapters/whatsapp.js").WhatsAppAdapter;
  if (typeof wa.markAsRead === "function") {
    wa.markAsRead(rawMessageId).catch(() => {});
  }
}
```

- [ ] **Step 6: Run all chat tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/adapters/whatsapp.ts apps/chat/src/__tests__/whatsapp.test.ts apps/chat/src/routes/managed-webhook.ts
git commit -m "$(cat <<'EOF'
feat: add read receipts to WhatsApp adapter (blue checkmarks)
EOF
)"
```

---

### Task 5: Media Receiving

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts`
- Create: `apps/chat/src/__tests__/whatsapp-media.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat/src/__tests__/whatsapp-media.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

function buildMediaPayload(type: string, mediaId: string) {
  const mediaObj: Record<string, unknown> = { id: mediaId };
  if (type === "document") {
    mediaObj["filename"] = "receipt.pdf";
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Media User" }, wa_id: "15551234567" }],
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.media1",
                  timestamp: "1700000000",
                  type,
                  [type]: mediaObj,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsAppAdapter — media receiving", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should parse image message with attachment metadata", () => {
    const payload = buildMediaPayload("image", "img_123");
    const msg = adapter.parseIncomingMessage(payload);

    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("");
    expect(msg!.metadata?.["originalType"]).toBe("image");
    expect(msg!.metadata?.["mediaId"]).toBe("img_123");
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]).toMatchObject({
      type: "image",
      url: null,
      data: { mediaId: "img_123" },
    });
  });

  it("should parse document message with filename", () => {
    const payload = buildMediaPayload("document", "doc_456");
    const msg = adapter.parseIncomingMessage(payload);

    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]).toMatchObject({
      type: "document",
      filename: "receipt.pdf",
      data: { mediaId: "doc_456" },
    });
  });

  it("should parse video message", () => {
    const payload = buildMediaPayload("video", "vid_789");
    const msg = adapter.parseIncomingMessage(payload);

    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]!.type).toBe("video");
  });

  it("should parse audio message", () => {
    const payload = buildMediaPayload("audio", "aud_012");
    const msg = adapter.parseIncomingMessage(payload);

    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]!.type).toBe("audio");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-media`
Expected: FAIL — currently image messages are parsed as "unsupported" with empty attachments

- [ ] **Step 3: Replace parseUnsupportedMessage with parseMediaMessage**

In `apps/chat/src/adapters/whatsapp.ts`, add a new function and update the `parseIncomingMessage` routing:

```typescript
const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

function parseMediaMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
  msgType: string,
): IncomingMessage {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const mediaObj = msg[msgType] as Record<string, unknown> | undefined;
  const mediaId = mediaObj?.["id"] as string | undefined;
  const filename = mediaObj?.["filename"] as string | undefined;

  const metadata: Record<string, unknown> = { originalType: msgType };
  if (contactName) metadata["contactName"] = contactName;
  if (mediaId) metadata["mediaId"] = mediaId;

  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  const attachments: Array<{
    type: string;
    url: string | null;
    data: unknown;
    filename: string | null;
  }> = [];
  if (mediaId) {
    attachments.push({
      type: msgType,
      url: null,
      data: { mediaId },
      filename: filename ?? null,
    });
  }

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text: "",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments,
    organizationId: null,
  };
}
```

Then update `parseIncomingMessage` to route media types to the new function:

```typescript
// Replace the non-text catch-all
if (msgType !== "text" && msgType !== "interactive") {
  if (MEDIA_TYPES.has(msgType)) {
    return parseMediaMessage(msg, value, msgType);
  }
  return parseUnsupportedMessage(msg, value, msgType);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-media`
Expected: PASS

- [ ] **Step 5: Run existing whatsapp tests to check for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp`
Expected: PASS — the existing "unsupported message" test for images will now fail because images are no longer "unsupported". Update that test:

In `apps/chat/src/__tests__/whatsapp.test.ts`, update the test "should return unsupported message for non-text messages" to expect the new media parsing behavior:

```typescript
it("should parse image as media message with attachment", () => {
  // ... same payload ...
  const msg = adapter.parseIncomingMessage(payload);
  expect(msg).not.toBeNull();
  expect(msg?.text).toBe("");
  expect(msg?.metadata?.["originalType"]).toBe("image");
  expect(msg?.metadata?.["mediaId"]).toBe("img_123");
  expect(msg?.attachments).toHaveLength(1);
});
```

- [ ] **Step 6: Run all chat tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/adapters/whatsapp.ts apps/chat/src/__tests__/whatsapp-media.test.ts apps/chat/src/__tests__/whatsapp.test.ts
git commit -m "$(cat <<'EOF'
feat: parse incoming WhatsApp media messages with attachment metadata
EOF
)"
```

---

### Task 6: Media Sending

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts`
- Modify: `apps/chat/src/adapters/adapter.ts`
- Modify: `apps/chat/src/__tests__/whatsapp-media.test.ts`

- [ ] **Step 1: Add tests for sendMedia**

Append to `apps/chat/src/__tests__/whatsapp-media.test.ts`:

```typescript
describe("WhatsAppAdapter — media sending", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send image by URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.sent1" }] }), { status: 200 }),
      );

    await adapter.sendMedia(
      "15551234567",
      "image",
      { url: "https://example.com/photo.jpg" },
      "Check this out",
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "image",
      image: { link: "https://example.com/photo.jpg", caption: "Check this out" },
    });
  });

  it("should send document by URL with filename", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.sent2" }] }), { status: 200 }),
      );

    await adapter.sendMedia(
      "15551234567",
      "document",
      { url: "https://example.com/receipt.pdf" },
      "Your receipt",
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.type).toBe("document");
    expect(body.document.link).toBe("https://example.com/receipt.pdf");
    expect(body.document.caption).toBe("Your receipt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-media`
Expected: FAIL — `sendMedia` is not a function

- [ ] **Step 3: Add optional sendMedia to ChannelAdapter interface**

In `apps/chat/src/adapters/adapter.ts`, add:

```typescript
sendMedia?(
  threadId: string,
  type: "image" | "audio" | "video" | "document",
  source: { url: string } | { buffer: Buffer; mimeType: string; filename?: string },
  caption?: string,
): Promise<void>;
```

- [ ] **Step 4: Implement sendMedia on WhatsAppAdapter**

Add to `WhatsAppAdapter` class in `apps/chat/src/adapters/whatsapp.ts`:

```typescript
async sendMedia(
  threadId: string,
  type: "image" | "audio" | "video" | "document",
  source: { url: string } | { buffer: Buffer; mimeType: string; filename?: string },
  caption?: string,
): Promise<void> {
  if ("url" in source) {
    const mediaPayload: Record<string, unknown> = { link: source.url };
    if (caption) mediaPayload["caption"] = caption;
    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type,
      [type]: mediaPayload,
    });
  } else {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", source.mimeType);
    formData.append("file", new Blob([source.buffer], { type: source.mimeType }), source.filename ?? "file");
    const uploadUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/media`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!uploadRes.ok) {
      throw new WhatsAppApiError(`Media upload failed (${uploadRes.status})`, uploadRes.status);
    }
    const { id: mediaId } = (await uploadRes.json()) as { id: string };
    const mediaPayload: Record<string, unknown> = { id: mediaId };
    if (caption) mediaPayload["caption"] = caption;
    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type,
      [type]: mediaPayload,
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-media`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/adapters/whatsapp.ts apps/chat/src/adapters/adapter.ts apps/chat/src/__tests__/whatsapp-media.test.ts
git commit -m "$(cat <<'EOF'
feat: add media sending to WhatsApp adapter (URL and upload paths)
EOF
)"
```

---

### Task 7: Message Deduplication

**Files:**

- Modify: `apps/chat/src/routes/managed-webhook.ts`
- Modify: `apps/chat/src/__tests__/whatsapp-wiring.test.ts`

- [ ] **Step 1: Add test for dedup**

Append to `apps/chat/src/__tests__/whatsapp-wiring.test.ts`:

```typescript
it("deduplicates repeated WhatsApp webhooks", async () => {
  handleIncoming.mockClear();

  const payload = buildTextPayload(SENDER_PHONE, "duplicate test");
  const body = JSON.stringify(payload);
  const signature = signBody(body, APP_SECRET);
  const headers = { "x-hub-signature-256": signature };

  // First request should process
  const res1 = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
  expect(res1.statusCode).toBe(200);
  expect(handleIncoming).toHaveBeenCalledOnce();

  handleIncoming.mockClear();

  // Second request with same payload should be deduped
  const res2 = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
  expect(res2.statusCode).toBe(200);
  expect(handleIncoming).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected: FAIL — no dedup, `handleIncoming` called twice

- [ ] **Step 3: Add dedup to managed-webhook.ts**

In `apps/chat/src/routes/managed-webhook.ts`, add a dedup import and check:

Add to `ManagedWebhookDeps`:

```typescript
dedup?: {
  checkDedup(channel: string, messageId: string): Promise<boolean>;
};
```

In the POST handler, after signature verification and status check, before `parseIncomingMessage`:

```typescript
if (deps.dedup && gatewayEntry.adapter.extractMessageId) {
  const msgId = gatewayEntry.adapter.extractMessageId(request.body);
  if (msgId) {
    const isNew = await deps.dedup.checkDedup(gatewayEntry.channel, msgId);
    if (!isNew) {
      return reply.code(200).send({ ok: true });
    }
  }
}
```

- [ ] **Step 4: Update the wiring test to provide a dedup implementation**

In the `beforeAll` of `apps/chat/src/__tests__/whatsapp-wiring.test.ts`, add an in-memory dedup to the deps:

```typescript
const seenMessages = new Set<string>();
const dedup = {
  async checkDedup(_channel: string, messageId: string): Promise<boolean> {
    const key = `${_channel}:${messageId}`;
    if (seenMessages.has(key)) return false;
    seenMessages.add(key);
    return true;
  },
};

registerManagedWebhookRoutes(app, { registry, dedup });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-wiring`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/chat/src/routes/managed-webhook.ts apps/chat/src/__tests__/whatsapp-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat: add message deduplication for WhatsApp webhooks
EOF
)"
```

---

### Task 8: WhatsApp Flows — Send Flow Message + Parse Completion

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts`
- Modify: `apps/chat/src/adapters/adapter.ts`
- Create: `apps/chat/src/__tests__/whatsapp-flows.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/chat/src/__tests__/whatsapp-flows.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

describe("WhatsAppAdapter — Flows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendFlowMessage", () => {
    it("should send a Flow interactive message", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages: [{ id: "wamid.flow1" }] }), { status: 200 }),
        );

      await adapter.sendFlowMessage("15551234567", {
        flowId: "flow_123",
        flowToken: "token_abc",
        ctaText: "Book Now",
        bodyText: "Ready to book?",
        screen: "SERVICE_SELECTION",
        data: { org: "acme" },
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.type).toBe("interactive");
      expect(body.interactive.type).toBe("flow");
      expect(body.interactive.action.name).toBe("flow");
      expect(body.interactive.action.parameters.flow_id).toBe("flow_123");
      expect(body.interactive.action.parameters.flow_cta).toBe("Book Now");
      expect(body.interactive.action.parameters.flow_action).toBe("navigate");
      expect(body.interactive.action.parameters.flow_action_payload.screen).toBe(
        "SERVICE_SELECTION",
      );
    });
  });

  describe("parseIncomingMessage — nfm_reply", () => {
    it("should parse Flow completion as incoming message", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Flow User" }, wa_id: "15551234567" }],
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.flow_complete",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "nfm_reply",
                        nfm_reply: {
                          response_json: JSON.stringify({
                            service: "haircut",
                            date: "2026-05-01",
                            time: "14:00",
                          }),
                          body: "Sent",
                          name: "flow",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata?.["interactiveType"]).toBe("nfm_reply");
      expect(msg!.metadata?.["flowResponse"]).toEqual({
        service: "haircut",
        date: "2026-05-01",
        time: "14:00",
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-flows`
Expected: FAIL — `sendFlowMessage` not a function, `nfm_reply` not handled

- [ ] **Step 3: Add sendFlowMessage to WhatsAppAdapter**

Add to `WhatsAppAdapter` class:

```typescript
async sendFlowMessage(
  threadId: string,
  options: {
    flowId: string;
    flowToken: string;
    ctaText: string;
    bodyText: string;
    screen: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await this.sendMessage(threadId, {
    messaging_product: "whatsapp",
    to: threadId,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: options.bodyText },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: options.flowToken,
          flow_id: options.flowId,
          flow_cta: options.ctaText,
          mode: "published",
          flow_action: "navigate",
          flow_action_payload: {
            screen: options.screen,
            data: options.data ?? {},
          },
        },
      },
    },
  });
}
```

- [ ] **Step 4: Handle nfm_reply in parseInteractiveMessage**

In `apps/chat/src/adapters/whatsapp.ts`, update `parseInteractiveMessage` to handle `nfm_reply`:

```typescript
// Add after the list_reply handling
} else if (interactiveType === "nfm_reply") {
  const nfmReply = interactive["nfm_reply"] as Record<string, unknown> | undefined;
  if (nfmReply?.["response_json"]) {
    try {
      const flowResponse = JSON.parse(nfmReply["response_json"] as string);
      const from = msg["from"] as string;
      const msgId = msg["id"] as string;
      const timestamp = msg["timestamp"] as string;
      const contactName = extractContactName(value);

      const metadata: Record<string, unknown> = {
        interactiveType: "nfm_reply",
        flowResponse,
      };
      if (contactName) metadata["contactName"] = contactName;

      return {
        id: msgId ?? `wa_${Date.now()}`,
        channel: "whatsapp",
        channelMessageId: msgId ?? `wa_${Date.now()}`,
        principalId: from ?? "unknown",
        text: JSON.stringify(flowResponse),
        threadId: from,
        timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
        metadata,
        attachments: [],
        organizationId: null,
      };
    } catch {
      // Invalid JSON in response_json — fall through
    }
  }
}
```

- [ ] **Step 5: Add optional sendFlowMessage to ChannelAdapter interface**

In `apps/chat/src/adapters/adapter.ts`:

```typescript
sendFlowMessage?(
  threadId: string,
  options: {
    flowId: string;
    flowToken: string;
    ctaText: string;
    bodyText: string;
    screen: string;
    data?: Record<string, unknown>;
  },
): Promise<void>;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run whatsapp-flows`
Expected: PASS

- [ ] **Step 7: Run all chat tests for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/chat/src/adapters/whatsapp.ts apps/chat/src/adapters/adapter.ts apps/chat/src/__tests__/whatsapp-flows.test.ts
git commit -m "$(cat <<'EOF'
feat: add WhatsApp Flows — sendFlowMessage + nfm_reply completion parsing
EOF
)"
```

---

### Task 9: WhatsApp Flows — Encrypted Data Endpoint

**Files:**

- Create: `apps/api/src/routes/whatsapp-flows.ts`
- Create: `apps/api/src/routes/__tests__/whatsapp-flows.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/whatsapp-flows.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  generateKeyPairSync,
  publicEncrypt,
  createCipheriv,
  randomBytes,
  constants,
} from "node:crypto";
import { whatsappFlowsRoutes } from "../whatsapp-flows.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function encryptFlowRequest(
  payload: Record<string, unknown>,
  rsaPublicKey: string,
): { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string } {
  const aesKey = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const encryptedAesKey = publicEncrypt(
    { key: rsaPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey,
  );
  return {
    encrypted_aes_key: encryptedAesKey.toString("base64"),
    encrypted_flow_data: encrypted.toString("base64"),
    initial_vector: iv.toString("base64"),
  };
}

describe("WhatsApp Flows data endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(whatsappFlowsRoutes, {
      privateKey,
      getFlowHandler: () => ({
        handleInit: async () => ({
          screen: "SERVICE_SELECTION",
          data: { services: ["haircut", "color"] },
        }),
        handleDataExchange: async (screen: string, data: Record<string, unknown>) => ({
          screen: "DATE_TIME",
          data: { slots: ["10:00", "14:00"] },
        }),
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should decrypt INIT request and return encrypted response", async () => {
    const flowPayload = { action: "INIT", flow_token: "test_token" };
    const encrypted = encryptFlowRequest(flowPayload, publicKey);

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: encrypted,
    });

    expect(response.statusCode).toBe(200);
    // Response is a Base64-encoded AES-encrypted string
    const body = response.body;
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(0);
  });

  it("should return 400 for invalid encrypted data", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: {
        encrypted_aes_key: "invalid",
        encrypted_flow_data: "invalid",
        initial_vector: "invalid",
      },
    });

    expect(response.statusCode).toBe(421);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run whatsapp-flows`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Flows data endpoint**

```typescript
// apps/api/src/routes/whatsapp-flows.ts
import type { FastifyPluginAsync } from "fastify";
import { privateDecrypt, createDecipheriv, createCipheriv, constants } from "node:crypto";

export interface FlowHandler {
  handleInit: () => Promise<{ screen: string; data: Record<string, unknown> }>;
  handleDataExchange: (
    screen: string,
    data: Record<string, unknown>,
  ) => Promise<{ screen: string; data: Record<string, unknown> }>;
}

interface FlowsPluginOptions {
  privateKey: string;
  getFlowHandler: () => FlowHandler;
}

function decryptRequest(
  body: { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string },
  rsaPrivateKey: string,
): { decryptedData: Record<string, unknown>; aesKey: Buffer; iv: Buffer } {
  const encryptedAesKey = Buffer.from(body.encrypted_aes_key, "base64");
  const aesKey = privateDecrypt(
    { key: rsaPrivateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    encryptedAesKey,
  );
  const iv = Buffer.from(body.initial_vector, "base64");
  const encryptedData = Buffer.from(body.encrypted_flow_data, "base64");

  const authTagLength = 16;
  const ciphertext = encryptedData.subarray(0, encryptedData.length - authTagLength);
  const authTag = encryptedData.subarray(encryptedData.length - authTagLength);

  const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return { decryptedData: JSON.parse(decrypted.toString("utf-8")), aesKey, iv };
}

function encryptResponse(response: Record<string, unknown>, aesKey: Buffer, iv: Buffer): string {
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return encrypted.toString("base64");
}

export const whatsappFlowsRoutes: FastifyPluginAsync<FlowsPluginOptions> = async (app, opts) => {
  app.post<{
    Body: { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string };
  }>("/whatsapp/flows", async (request, reply) => {
    let decryptedData: Record<string, unknown>;
    let aesKey: Buffer;
    let iv: Buffer;

    try {
      ({ decryptedData, aesKey, iv } = decryptRequest(request.body, opts.privateKey));
    } catch {
      return reply.code(421).send("Decryption failed");
    }

    const action = decryptedData["action"] as string;
    const handler = opts.getFlowHandler();
    let responseData: { screen: string; data: Record<string, unknown> };

    if (action === "INIT") {
      responseData = await handler.handleInit();
    } else if (action === "DATA_EXCHANGE") {
      const screen = decryptedData["screen"] as string;
      const data = decryptedData["data"] as Record<string, unknown>;
      responseData = await handler.handleDataExchange(screen, data);
    } else if (action === "ping") {
      const encrypted = encryptResponse({ data: { status: "active" } }, aesKey, iv);
      return reply.code(200).send(encrypted);
    } else {
      return reply.code(400).send("Unknown action");
    }

    const encrypted = encryptResponse(responseData, aesKey, iv);
    return reply.code(200).send(encrypted);
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run whatsapp-flows`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/whatsapp-flows.ts apps/api/src/routes/__tests__/whatsapp-flows.test.ts
git commit -m "$(cat <<'EOF'
feat: add encrypted WhatsApp Flows data endpoint
EOF
)"
```

---

## Track 1: Onboarding (Can Build Now, Go-Live Blocked on Phase 0)

### Task 10: Onboarding API Backend

**Files:**

- Create: `apps/api/src/routes/whatsapp-onboarding.ts`
- Create: `apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappOnboardingRoutes } from "../whatsapp-onboarding.js";

describe("WhatsApp onboarding routes", () => {
  let app: FastifyInstance;
  const mockGraphApi = vi.fn();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(whatsappOnboardingRoutes, {
      metaSystemUserToken: "suat_test",
      metaSystemUserId: "sys_user_123",
      appSecret: "test_secret",
      apiVersion: "v21.0",
      webhookBaseUrl: "https://switchboard.example.com",
      graphApiFetch: mockGraphApi,
      createConnection: vi.fn(async () => ({
        id: "conn_1",
        webhookPath: "/webhook/managed/conn_1",
      })),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    mockGraphApi.mockReset();
  });

  it("should complete onboarding with valid ES token", async () => {
    // debug_token → returns WABA ID
    mockGraphApi.mockResolvedValueOnce({
      data: {
        granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: ["waba_123"] },
          { scope: "whatsapp_business_messaging", target_ids: ["waba_123"] },
        ],
      },
    });
    // assigned_users
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // phone_numbers
    mockGraphApi.mockResolvedValueOnce({
      data: [{ id: "phone_456", verified_name: "Test Biz", display_phone_number: "+1555123" }],
    });
    // register phone
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // subscribed_apps
    mockGraphApi.mockResolvedValueOnce({ success: true });
    // business profile
    mockGraphApi.mockResolvedValueOnce({ success: true });

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "short_lived_token_123" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.wabaId).toBe("waba_123");
    expect(body.phoneNumberId).toBe("phone_456");
  });

  it("should return 400 for missing token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 502 when debug_token fails", async () => {
    mockGraphApi.mockRejectedValueOnce(new Error("Network error"));

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/onboard",
      payload: { esToken: "bad_token" },
    });

    expect(response.statusCode).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run whatsapp-onboarding`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the onboarding route**

```typescript
// apps/api/src/routes/whatsapp-onboarding.ts
import type { FastifyPluginAsync } from "fastify";

interface OnboardingOptions {
  metaSystemUserToken: string;
  metaSystemUserId: string;
  appSecret: string;
  apiVersion: string;
  webhookBaseUrl: string;
  graphApiFetch: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  createConnection: (data: {
    wabaId: string;
    phoneNumberId: string;
    verifiedName?: string;
    displayPhoneNumber?: string;
  }) => Promise<{ id: string; webhookPath: string }>;
}

export const whatsappOnboardingRoutes: FastifyPluginAsync<OnboardingOptions> = async (
  app,
  opts,
) => {
  const { metaSystemUserToken, metaSystemUserId, apiVersion, webhookBaseUrl, graphApiFetch } = opts;
  const graphBase = `https://graph.facebook.com/${apiVersion}`;

  async function graphCall(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${graphBase}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${metaSystemUserToken}`,
        "Content-Type": "application/json",
      },
    };
    if (body) init.body = JSON.stringify(body);
    return graphApiFetch(url, init);
  }

  app.post<{ Body: { esToken?: string } }>("/whatsapp/onboard", async (request, reply) => {
    const { esToken } = request.body ?? {};
    if (!esToken) {
      return reply.code(400).send({ error: "esToken is required" });
    }

    try {
      // 1. Extract WABA ID from debug_token
      const tokenInfo = await graphCall(`/debug_token?input_token=${esToken}`);
      const data = tokenInfo["data"] as Record<string, unknown>;
      const scopes = data["granular_scopes"] as Array<{ scope: string; target_ids: string[] }>;
      const wabaScope = scopes.find((s) => s.scope === "whatsapp_business_management");
      if (!wabaScope?.target_ids?.[0]) {
        return reply.code(400).send({ error: "No WABA found in token scopes" });
      }
      const wabaId = wabaScope.target_ids[0];

      // 2. Add system user to WABA
      await graphCall(
        `/${wabaId}/assigned_users?user=${metaSystemUserId}&tasks=['MANAGE']`,
        "POST",
      );

      // 3. Get phone number ID
      const phoneData = await graphCall(`/${wabaId}/phone_numbers`);
      const phones = phoneData["data"] as Array<{
        id: string;
        verified_name?: string;
        display_phone_number?: string;
      }>;
      if (!phones?.[0]) {
        return reply.code(400).send({ error: "No phone number found for this WABA" });
      }
      const phone = phones[0];

      // 4. Register phone for Cloud API
      await graphCall(`/${phone.id}/register`, "POST", {
        messaging_product: "whatsapp",
        pin: "000000",
      });

      // 5. Create connection and get webhook path
      const connection = await opts.createConnection({
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
      });

      // 6. Subscribe to webhooks with per-WABA override
      const webhookUrl = `${webhookBaseUrl}${connection.webhookPath}`;
      await graphCall(`/${wabaId}/subscribed_apps`, "POST", {
        override_callback_uri: webhookUrl,
        verify_token: opts.appSecret,
      });

      // 7. Set bot profile
      await graphCall(`/${phone.id}/whatsapp_business_profile`, "POST", {
        messaging_product: "whatsapp",
        automated_type: "3p_full",
      });

      return reply.code(200).send({
        success: true,
        wabaId,
        phoneNumberId: phone.id,
        verifiedName: phone.verified_name,
        displayPhoneNumber: phone.display_phone_number,
        connectionId: connection.id,
      });
    } catch (err) {
      app.log.error(err, "WhatsApp onboarding failed");
      return reply.code(502).send({
        error: "Onboarding failed — could not complete setup with Meta",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run whatsapp-onboarding`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/whatsapp-onboarding.ts apps/api/src/routes/__tests__/whatsapp-onboarding.test.ts
git commit -m "$(cat <<'EOF'
feat: add WhatsApp Embedded Signup onboarding API route
EOF
)"
```

---

### Task 11: Dashboard Embedded Signup Component

**Files:**

- Create: `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`
- Modify: `apps/dashboard/src/components/settings/connections-list.tsx`
- Create: `apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts`

- [ ] **Step 1: Create the Next.js proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts
import { NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export async function POST(request: Request) {
  const body = await request.json();

  const res = await fetch(`${API_BASE}/whatsapp/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Create the Embedded Signup component**

```tsx
// apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx
"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

declare global {
  interface Window {
    FB?: {
      init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
      login(
        callback: (response: { authResponse?: { accessToken: string } }) => void,
        params: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: Record<string, unknown>;
        },
      ): void;
    };
  }
}

interface Props {
  metaAppId: string;
  metaConfigId: string;
  onSuccess?: (data: { wabaId: string; phoneNumberId: string; connectionId: string }) => void;
}

type Status = "idle" | "connecting" | "processing" | "success" | "error";

export function WhatsAppEmbeddedSignup({ metaAppId, metaConfigId, onSuccess }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    verifiedName?: string;
    displayPhoneNumber?: string;
  } | null>(null);

  const handleConnect = useCallback(() => {
    if (!window.FB) {
      setError("Meta SDK not loaded. Please refresh the page.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);

    window.FB.login(
      async (response) => {
        if (!response.authResponse?.accessToken) {
          setStatus("idle");
          return;
        }

        setStatus("processing");

        try {
          const res = await fetch("/api/dashboard/connections/whatsapp-embedded", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ esToken: response.authResponse.accessToken }),
          });

          const data = await res.json();

          if (data.success) {
            setStatus("success");
            setResult({
              verifiedName: data.verifiedName,
              displayPhoneNumber: data.displayPhoneNumber,
            });
            onSuccess?.({
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
              connectionId: data.connectionId,
            });
          } else {
            setError(data.error || "Onboarding failed");
            setStatus("error");
          }
        } catch {
          setError("Could not complete setup. Please try again.");
          setStatus("error");
        }
      },
      {
        config_id: metaConfigId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          feature: "whatsapp_embedded_signup",
          sessionInfoVersion: "2",
        },
      },
    );
  }, [metaAppId, metaConfigId, onSuccess]);

  return (
    <Card>
      <CardContent className="p-6">
        {status === "success" && result ? (
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="font-medium">WhatsApp Connected</p>
              <p className="text-sm text-muted-foreground">
                {result.verifiedName} ({result.displayPhoneNumber})
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect your WhatsApp Business Account in one click. You'll select or create a
              business account and verify your phone number.
            </p>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button
              onClick={handleConnect}
              disabled={status === "connecting" || status === "processing"}
              className="w-full"
            >
              {status === "connecting" || status === "processing" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {status === "connecting" ? "Opening Meta..." : "Setting up..."}
                </>
              ) : (
                "Connect WhatsApp"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Add WhatsApp Embedded Signup option to connections-list.tsx**

In `apps/dashboard/src/components/settings/connections-list.tsx`, import and render the component when `serviceId === "whatsapp"` in the form dialog. Add after the OAuth section:

```tsx
{
  serviceId === "whatsapp" && process.env.NEXT_PUBLIC_META_APP_ID && (
    <div className="space-y-3">
      <WhatsAppEmbeddedSignup
        metaAppId={process.env.NEXT_PUBLIC_META_APP_ID}
        metaConfigId={process.env.NEXT_PUBLIC_META_CONFIG_ID ?? ""}
        onSuccess={() => {
          setFormOpen(false);
          refetch();
        }}
      />
      <p className="text-xs text-center text-muted-foreground">
        Or enter credentials manually below
      </p>
    </div>
  );
}
```

Add the import at the top:

```tsx
import { WhatsAppEmbeddedSignup } from "./whatsapp-embedded-signup";
```

- [ ] **Step 4: Add Meta JS SDK script to layout**

In `apps/dashboard/src/app/layout.tsx`, add the Meta JS SDK script tag conditionally inside `<body>`, before the closing tag. Use Next.js `Script` component:

```tsx
import Script from "next/script";

// Inside the body, add:
{
  process.env.NEXT_PUBLIC_META_APP_ID && (
    <Script
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="lazyOnload"
      onLoad={() => {
        window.FB?.init({
          appId: process.env.NEXT_PUBLIC_META_APP_ID!,
          cookie: true,
          xfbml: true,
          version: "v21.0",
        });
      }}
    />
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx apps/dashboard/src/components/settings/connections-list.tsx apps/dashboard/src/app/api/dashboard/connections/whatsapp-embedded/route.ts apps/dashboard/src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat: add WhatsApp Embedded Signup UI component and proxy route
EOF
)"
```

---

### Task 12: Environment Variables + .env.example Update

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Add after the existing WhatsApp section:

```env
# WhatsApp Tech Provider (Embedded Signup)
META_APP_ID=                   # Meta App ID for JS SDK
META_CONFIG_ID=                # Facebook Login configuration ID for Embedded Signup
META_SYSTEM_USER_TOKEN=        # Permanent SUAT for all client WABAs
META_SYSTEM_USER_ID=           # System User ID for assigned_users calls
```

And add to the dashboard env section (if one exists, or create):

```env
# Dashboard — WhatsApp Embedded Signup
NEXT_PUBLIC_META_APP_ID=       # Same as META_APP_ID, exposed to browser
NEXT_PUBLIC_META_CONFIG_ID=    # Same as META_CONFIG_ID, exposed to browser
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "$(cat <<'EOF'
chore: add WhatsApp Tech Provider env vars to .env.example
EOF
)"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
npx pnpm@9.15.4 test
```

Expected: PASS

- [ ] **Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: PASS

- [ ] **Run lint**

```bash
npx pnpm@9.15.4 lint
```

Expected: PASS
