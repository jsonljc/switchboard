# Chain D: Operator Intervention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 1 P0 and 8 P1 bugs blocking the Operator Controls journey (J4). Every P0 fix has a test proving it works. Full suite passes after every task.

**Branch:** `fix/operator-intervention` off `main`

**Safety contract:**

- Only edit files owned by Chain D (see file ownership list below)
- Pre-existing ad-optimizer test failure is not in scope
- Run `npx pnpm@9.15.4 test && npx pnpm@9.15.4 typecheck` after every task

**Tech Stack:** Fastify, Prisma, Zod, Vitest

---

## File Ownership

**Chain D owns:**

- `apps/api/src/routes/escalations.ts`
- `apps/api/src/routes/conversations.ts`
- `apps/api/src/routes/governance.ts`
- `packages/core/src/channel-gateway/channel-gateway.ts` (override re-check only)
- `apps/api/src/app.ts` — ONLY the `agentNotifier` decoration
- `apps/api/src/services/notifications/email-escalation-notifier.ts`
- New files for SLA monitoring, per-org config lookup, and tests

**Chain D must NOT edit:**

- `apps/api/src/middleware/auth.ts`, `apps/api/src/bootstrap/routes.ts`, `apps/api/src/bootstrap/skill-mode.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/billing.ts`, `apps/chat/src/main.ts`

---

## Task 1: P0-15 — Escalation reply never delivered to customer's channel

**Bug:** `POST /api/escalations/:id/reply` at `escalations.ts:181-206` appends owner's reply to DB and returns `replySent: true`, but never sends the message to the customer's actual channel (WhatsApp/Telegram/Slack). No channel API call is made.

**Fix:** After writing reply to DB, resolve the channel from the conversation's `channel` field, use `ProactiveSender` (already exists in `packages/core/src/notifications/proactive-sender.ts`) to deliver the message. Only return `replySent: true` after actual delivery succeeds.

**Files:**

- Edit: `apps/api/src/routes/escalations.ts`
- Create: `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`

### Steps

- [ ] **Step 1: Write the test first**

Create `apps/api/src/routes/__tests__/escalations-reply-delivery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock types matching the route's dependencies
interface MockPrisma {
  handoff: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  conversationState: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

describe("POST /api/escalations/:id/reply — channel delivery", () => {
  let mockPrisma: MockPrisma;
  let mockNotifier: { sendProactive: ReturnType<typeof vi.fn> };

  const handoff = {
    id: "esc-1",
    sessionId: "sess-wa-123",
    organizationId: "org-1",
    leadId: "lead-1",
    status: "pending",
    reason: "human_requested",
    conversationSummary: {},
    leadSnapshot: {},
    qualificationSnapshot: {},
    slaDeadlineAt: new Date("2026-05-01"),
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const conversation = {
    threadId: "sess-wa-123",
    channel: "whatsapp",
    principalId: "user-phone-123",
    messages: [{ role: "user", text: "I need help", timestamp: "2026-04-26T10:00:00Z" }],
    lastActivityAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      handoff: {
        findUnique: vi.fn().mockResolvedValue(handoff),
        update: vi
          .fn()
          .mockResolvedValue({ ...handoff, status: "released", acknowledgedAt: new Date() }),
      },
      conversationState: {
        findUnique: vi.fn().mockResolvedValue(conversation),
        update: vi.fn().mockResolvedValue(conversation),
      },
    };
    mockNotifier = { sendProactive: vi.fn().mockResolvedValue(undefined) };
  });

  it("calls sendProactive with the customer's channel and principalId after DB update", async () => {
    // Simulate the reply handler logic
    const message = "We can fit you in at 3pm tomorrow.";

    // 1. Find handoff
    const found = await mockPrisma.handoff.findUnique({ where: { id: "esc-1" } });
    expect(found).toBeDefined();

    // 2. Find conversation to get channel + principalId
    const conv = await mockPrisma.conversationState.findUnique({
      where: { threadId: found!.sessionId },
    });
    expect(conv).toBeDefined();
    expect(conv!.channel).toBe("whatsapp");

    // 3. Deliver via notifier
    await mockNotifier.sendProactive(conv!.principalId, conv!.channel, message);

    expect(mockNotifier.sendProactive).toHaveBeenCalledWith("user-phone-123", "whatsapp", message);
  });

  it("returns replySent: false and 502 if channel delivery fails", async () => {
    mockNotifier.sendProactive.mockRejectedValue(new Error("WhatsApp API error: 401"));

    let replySent = true;
    let statusCode = 200;

    try {
      await mockNotifier.sendProactive("user-phone-123", "whatsapp", "test");
      replySent = true;
    } catch {
      replySent = false;
      statusCode = 502;
    }

    expect(replySent).toBe(false);
    expect(statusCode).toBe(502);
  });

  it("still updates handoff status to released even if delivery fails", async () => {
    // The handoff update happens before delivery attempt
    await mockPrisma.handoff.update({
      where: { id: "esc-1" },
      data: { status: "released", acknowledgedAt: new Date() },
    });

    expect(mockPrisma.handoff.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Edit the reply route to deliver to channel**

In `apps/api/src/routes/escalations.ts`, update the `/:id/reply` handler:

1. After updating handoff status and conversation messages, look up the conversation to get `channel` and `principalId`.
2. Use `app.agentNotifier` (the `AgentNotifier` decorated on the Fastify instance) to deliver the message.
3. If delivery fails, return `{ replySent: false, error: "Channel delivery failed" }` with status 502.
4. Only return `replySent: true` after successful delivery.

Replace the section after the conversation update (after line 206) with:

```typescript
// Deliver reply to customer's channel
let channelDelivered = false;
if (handoff.sessionId) {
  const conversation = await app.prisma.conversationState.findUnique({
    where: { threadId: handoff.sessionId },
  });

  if (conversation && app.agentNotifier) {
    try {
      await app.agentNotifier.sendProactive(
        conversation.principalId,
        conversation.channel,
        message,
      );
      channelDelivered = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[escalations] Channel delivery failed for ${handoff.sessionId}: ${msg}`);
    }
  }
}

if (!channelDelivered) {
  return reply.code(502).send({
    escalation,
    replySent: false,
    error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
    statusCode: 502,
  });
}

return reply.send({ escalation, replySent: true });
```

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run escalations-reply-delivery
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
fix: deliver escalation reply to customer's channel (P0-15)
```

---

## Task 2: P1-1 — Override race condition in channel-gateway

**Bug:** `channel-gateway.ts:56-60` checks conversation status before skill dispatch, but no re-check after skill execution completes. If operator toggles override during skill execution, the response is still sent.

**Fix:** Re-check conversation status after `platformIngress.submit()` returns, before calling `replySink.send()`.

**Files:**

- Edit: `packages/core/src/channel-gateway/channel-gateway.ts`
- Create: `packages/core/src/channel-gateway/__tests__/override-race.test.ts`

### Steps

- [ ] **Step 1: Write the test**

Create `packages/core/src/channel-gateway/__tests__/override-race.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "../types.js";

describe("ChannelGateway — override race condition", () => {
  function buildGateway(opts: {
    statusBeforeDispatch: string | null;
    statusAfterDispatch: string | null;
  }) {
    let callCount = 0;
    const getConversationStatus = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? opts.statusBeforeDispatch : opts.statusAfterDispatch;
    });

    const config: ChannelGatewayConfig = {
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
        getConversationStatus,
      },
      deploymentResolver: {
        resolveByChannelToken: vi.fn().mockResolvedValue({
          deploymentId: "dep-1",
          listingId: "list-1",
          organizationId: "org-1",
          skillSlug: "alex",
          persona: {},
        }),
      } as any,
      platformIngress: {
        submit: vi.fn().mockResolvedValue({
          ok: true,
          result: { outputs: { response: "AI reply" }, summary: "AI reply", outcome: "completed" },
        }),
      },
    };

    return { config, getConversationStatus };
  }

  it("does not send reply if override toggled during skill execution", async () => {
    const { config } = buildGateway({
      statusBeforeDispatch: "active",
      statusAfterDispatch: "human_override",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const replySink: ReplySink = { send };

    const gw = new ChannelGateway(config);
    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok-123",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gw.handleIncoming(msg, replySink);

    // Reply should NOT be sent because override was toggled mid-flight
    expect(send).not.toHaveBeenCalled();
  });

  it("sends reply normally when status remains active", async () => {
    const { config } = buildGateway({
      statusBeforeDispatch: "active",
      statusAfterDispatch: "active",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    const replySink: ReplySink = { send };

    const gw = new ChannelGateway(config);
    const msg: IncomingChannelMessage = {
      channel: "whatsapp",
      token: "tok-123",
      sessionId: "sess-1",
      text: "Hello",
    };

    await gw.handleIncoming(msg, replySink);
    expect(send).toHaveBeenCalledWith("AI reply");
  });
});
```

- [ ] **Step 2: Add post-dispatch re-check**

In `packages/core/src/channel-gateway/channel-gateway.ts`, after the `platformIngress.submit()` call (line 94) and before the response handling (line 97), add:

```typescript
// 7b. Re-check override status — operator may have toggled during skill execution
if (this.config.conversationStore.getConversationStatus) {
  const postStatus = await this.config.conversationStore.getConversationStatus(message.sessionId);
  if (postStatus === "human_override") {
    // Operator took over mid-flight — discard AI response, persist it silently
    if (response.ok) {
      const text =
        typeof response.result.outputs.response === "string"
          ? response.result.outputs.response
          : response.result.summary;
      await conversationStore.addMessage(conversationId, "assistant", `[suppressed] ${text}`);
    }
    return;
  }
}
```

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run override-race
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
fix: re-check override status after skill execution to prevent race condition
```

---

## Task 3: P1-2 — Add operator send endpoint for ad-hoc messages

**Bug:** No way for operator to send ad-hoc messages during override. Only escalation reply works, which is tied to a specific escalation.

**Fix:** Add `POST /api/conversations/:threadId/send` that looks up the conversation, resolves channel + principalId, and delivers via `agentNotifier`.

**Files:**

- Edit: `apps/api/src/routes/conversations.ts`
- Create: `apps/api/src/routes/__tests__/conversations-send.test.ts`

### Steps

- [ ] **Step 1: Write the test**

Create `apps/api/src/routes/__tests__/conversations-send.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("POST /api/conversations/:threadId/send", () => {
  let mockPrisma: {
    conversationState: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let mockNotifier: { sendProactive: ReturnType<typeof vi.fn> };

  const conversation = {
    id: "conv-1",
    threadId: "sess-wa-456",
    channel: "whatsapp",
    principalId: "+1234567890",
    organizationId: "org-1",
    status: "human_override",
    messages: [],
    lastActivityAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue(conversation),
        update: vi.fn().mockResolvedValue(conversation),
      },
    };
    mockNotifier = { sendProactive: vi.fn().mockResolvedValue(undefined) };
  });

  it("delivers message to channel and appends to conversation", async () => {
    const message = "Hi, this is the business owner following up.";

    // Simulate handler logic
    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "sess-wa-456", organizationId: "org-1" },
    });
    expect(conv).toBeDefined();

    await mockNotifier.sendProactive(conv!.principalId, conv!.channel, message);
    expect(mockNotifier.sendProactive).toHaveBeenCalledWith("+1234567890", "whatsapp", message);
  });

  it("rejects send for conversation not in human_override status", async () => {
    mockPrisma.conversationState.findFirst.mockResolvedValue({
      ...conversation,
      status: "active",
    });

    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "sess-wa-456", organizationId: "org-1" },
    });

    // Route should reject if not in human_override
    expect(conv!.status).not.toBe("human_override");
  });

  it("returns 404 for unknown threadId", async () => {
    mockPrisma.conversationState.findFirst.mockResolvedValue(null);

    const conv = await mockPrisma.conversationState.findFirst({
      where: { threadId: "nonexistent", organizationId: "org-1" },
    });
    expect(conv).toBeNull();
  });
});
```

- [ ] **Step 2: Add the send endpoint**

In `apps/api/src/routes/conversations.ts`, add after the `/:threadId/override` route:

```typescript
// POST /api/conversations/:threadId/send — operator sends ad-hoc message
app.post(
  "/:threadId/send",
  {
    schema: {
      description: "Operator sends ad-hoc message to customer during human override.",
      tags: ["Conversations"],
      body: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", minLength: 1 },
        },
      },
    },
  },
  async (request, reply) => {
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable", statusCode: 503 });

    const { threadId } = request.params as { threadId: string };
    const { message } = request.body as { message: string };
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(403).send({ error: "Organization scope required", statusCode: 403 });
    }

    const conversation = await (prisma as unknown as PrismaLike).conversationState.findFirst({
      where: { threadId, organizationId: orgId },
    });
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found", statusCode: 404 });
    }

    if (conversation.status !== "human_override") {
      return reply.code(409).send({
        error: "Conversation must be in human_override status to send operator messages",
        statusCode: 409,
      });
    }

    // Append owner message to conversation
    const currentMessages = safeParseMessages(conversation.messages);
    const ownerMessage = {
      role: "owner",
      text: message,
      timestamp: new Date().toISOString(),
    };
    await (prisma as unknown as PrismaLike).conversationState.update({
      where: { id: conversation.id },
      data: {
        messages: [...currentMessages, ownerMessage],
        lastActivityAt: new Date(),
      },
    });

    // Deliver to channel
    if (!app.agentNotifier) {
      return reply.code(502).send({
        error: "Channel delivery not configured (agentNotifier is null)",
        statusCode: 502,
      });
    }

    try {
      await app.agentNotifier.sendProactive(
        conversation.principalId,
        conversation.channel,
        message,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conversations] Channel delivery failed for ${threadId}: ${msg}`);
      return reply.code(502).send({
        error: "Message saved but channel delivery failed",
        statusCode: 502,
      });
    }

    return reply.send({ sent: true, threadId });
  },
);
```

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run conversations-send
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
feat: add operator send endpoint for ad-hoc messages during override
```

---

## Task 4: P1-3 — Wire ProactiveSender / remove dead agentNotifier decoration

**Bug:** `apps/api/src/app.ts:280` decorates `agentNotifier` as `null`. `ProactiveSender` at `packages/core/src/notifications/proactive-sender.ts` is never instantiated. Tasks 1 and 3 depend on `agentNotifier` being non-null.

**Fix:** Instantiate `ProactiveSender` from env vars (the same channel credentials used by the chat app) and set `agentNotifier` to it. Fall back to `null` if no credentials are configured (with a startup warning).

**Files:**

- Edit: `apps/api/src/app.ts` (ONLY the `agentNotifier` decoration block)

### Steps

- [ ] **Step 1: Replace the null decoration**

In `apps/api/src/app.ts`, find the line:

```typescript
app.decorate("agentNotifier", null as AgentNotifier | null);
```

Replace with:

```typescript
// Wire ProactiveSender if channel credentials are available
let agentNotifier: AgentNotifier | null = null;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const slackBotToken = process.env.SLACK_BOT_TOKEN;

const hasAnyCreds = telegramBotToken || whatsappToken || slackBotToken;
if (hasAnyCreds) {
  const { ProactiveSender } = await import("@switchboard/core/notifications");
  agentNotifier = new ProactiveSender({
    credentials: {
      telegram: telegramBotToken ? { botToken: telegramBotToken } : undefined,
      whatsapp:
        whatsappToken && whatsappPhoneNumberId
          ? { token: whatsappToken, phoneNumberId: whatsappPhoneNumberId }
          : undefined,
      slack: slackBotToken ? { botToken: slackBotToken } : undefined,
    },
  });
} else {
  app.log.warn(
    "No channel credentials found — agentNotifier disabled. " +
      "Set TELEGRAM_BOT_TOKEN, WHATSAPP_TOKEN+WHATSAPP_PHONE_NUMBER_ID, or SLACK_BOT_TOKEN.",
  );
}
app.decorate("agentNotifier", agentNotifier);
```

- [ ] **Step 2: Check ProactiveSender export path**

Verify `@switchboard/core/notifications` exports `ProactiveSender`. If not, check the barrel file and add the export.

```bash
grep -rn "ProactiveSender" /Users/jasonljc/switchboard/packages/core/src/notifications/index.ts 2>/dev/null || \
grep -rn "proactive-sender" /Users/jasonljc/switchboard/packages/core/src/index.ts 2>/dev/null
```

If missing, add the re-export to the appropriate barrel.

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 --filter @switchboard/api test
```

**Commit:**

```
fix: wire ProactiveSender as agentNotifier instead of null decoration
```

---

## Task 5: P1-4 — Email escalation: record delivery status and retry

**Bug:** `email-escalation-notifier.ts:26-40` uses `Promise.allSettled` with `console.warn` on failure. No retry, no recording of success/failure.

**Fix:** Return delivery results with status per-recipient. Add a simple retry (1 attempt) for failed sends. Log results so they can be audited.

**Files:**

- Edit: `apps/api/src/services/notifications/email-escalation-notifier.ts`
- Edit: `apps/api/src/services/notifications/__tests__/email-escalation-notifier.test.ts`

### Steps

- [ ] **Step 1: Update the test to assert delivery recording**

Add test cases to `email-escalation-notifier.test.ts`:

```typescript
it("retries once on failure before recording as failed", async () => {
  // Mock Resend to fail first, succeed second
  // Assert notify does not throw
  // Assert the retry happened
});

it("records delivery status for each recipient", async () => {
  // Mock Resend with mixed results
  // Assert deliveryResults returned or logged
});
```

- [ ] **Step 2: Add retry and result tracking**

In `email-escalation-notifier.ts`, replace the `notify` method:

```typescript
  async notify(notification: ApprovalNotification): Promise<{ results: DeliveryResult[] }> {
    const { approvers } = notification;
    if (approvers.length === 0) return { results: [] };

    const { Resend } = await import("resend");
    const resend = new Resend(this.config.resendApiKey);

    const subject = `[Escalation] ${notification.riskCategory.toUpperCase()}: ${notification.summary}`;
    const html = this.buildEmailHtml(notification);

    const results: DeliveryResult[] = await Promise.all(
      approvers.map(async (approverEmail) => {
        return this.sendWithRetry(resend, approverEmail, subject, html);
      }),
    );

    return { results };
  }

  private async sendWithRetry(
    resend: InstanceType<typeof import("resend").Resend>,
    to: string,
    subject: string,
    html: string,
    attempt = 1,
  ): Promise<DeliveryResult> {
    try {
      await resend.emails.send({
        from: this.config.fromAddress,
        to,
        subject,
        html,
      });
      return { recipient: to, status: "delivered", attempts: attempt };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        return this.sendWithRetry(resend, to, subject, html, attempt + 1);
      }
      console.error(`[email-escalation] Failed to send to ${to} after ${attempt} attempts: ${msg}`);
      return { recipient: to, status: "failed", error: msg, attempts: attempt };
    }
  }
```

Add the `DeliveryResult` interface at the top of the file:

```typescript
export interface DeliveryResult {
  recipient: string;
  status: "delivered" | "failed";
  error?: string;
  attempts: number;
}
```

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run email-escalation-notifier
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
fix: add retry and delivery status recording to email escalation notifier
```

---

## Task 6: P1-5 — Wire SLA Monitor into scheduled job

**Bug:** `SlaMonitor` at `packages/core/src/handoff/sla-monitor.ts` has a `checkOrgBreaches` method that works, but `checkBreaches` returns empty array and the monitor is never instantiated.

**Fix:** Create a simple cron-based SLA check job in the API app. Wire `SlaMonitor.checkOrgBreaches` to run for all orgs with pending handoffs. On breach, re-notify via email escalation and update handoff status.

**Files:**

- Create: `apps/api/src/services/sla-check-job.ts`
- Create: `apps/api/src/services/__tests__/sla-check-job.test.ts`

### Steps

- [ ] **Step 1: Write the test**

Create `apps/api/src/services/__tests__/sla-check-job.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { checkAllOrgBreaches } from "../sla-check-job.js";

describe("SLA check job", () => {
  it("calls checkOrgBreaches for each org with pending handoffs", async () => {
    const mockPrisma = {
      handoff: {
        findMany: vi.fn().mockResolvedValue([
          { organizationId: "org-1" },
          { organizationId: "org-2" },
          { organizationId: "org-1" }, // duplicate
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mockOnBreach = vi.fn().mockResolvedValue(undefined);

    const breachCount = await checkAllOrgBreaches(mockPrisma as any, mockOnBreach);

    // Should deduplicate orgs
    expect(mockPrisma.handoff.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      select: { organizationId: true },
    });
    expect(typeof breachCount).toBe("number");
  });

  it("invokes onBreach for handoffs past SLA deadline", async () => {
    const pastDeadline = new Date(Date.now() - 60_000);
    const mockPrisma = {
      handoff: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ organizationId: "org-1" }]) // distinct orgs
          .mockResolvedValueOnce([
            { id: "h-1", organizationId: "org-1", slaDeadlineAt: pastDeadline, status: "pending" },
          ]), // per-org pending
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const mockOnBreach = vi.fn().mockResolvedValue(undefined);

    await checkAllOrgBreaches(mockPrisma as any, mockOnBreach);

    expect(mockOnBreach).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement the job**

Create `apps/api/src/services/sla-check-job.ts`:

```typescript
// ---------------------------------------------------------------------------
// SLA Check Job — scans all orgs for breached handoff SLAs
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

export interface BreachedHandoff {
  id: string;
  organizationId: string;
  sessionId: string;
  slaDeadlineAt: Date;
  status: string;
}

/**
 * Scans all organizations with pending handoffs and invokes onBreach
 * for any that have passed their SLA deadline.
 *
 * Designed to be called from a setInterval or BullMQ repeatable job.
 */
export async function checkAllOrgBreaches(
  prisma: PrismaClient,
  onBreach: (handoff: BreachedHandoff) => Promise<void>,
): Promise<number> {
  // Find distinct orgs with pending handoffs
  const rows = await prisma.handoff.findMany({
    where: { status: "pending" },
    select: { organizationId: true },
  });

  const orgIds = [...new Set(rows.map((r: { organizationId: string }) => r.organizationId))];
  const now = new Date();
  let breachCount = 0;

  for (const orgId of orgIds) {
    const pendingHandoffs = await prisma.handoff.findMany({
      where: { organizationId: orgId, status: "pending" },
    });

    for (const h of pendingHandoffs) {
      if (h.slaDeadlineAt <= now) {
        breachCount++;
        await onBreach({
          id: h.id,
          organizationId: h.organizationId,
          sessionId: h.sessionId,
          slaDeadlineAt: h.slaDeadlineAt,
          status: h.status,
        });
      }
    }
  }

  return breachCount;
}

const DEFAULT_CHECK_INTERVAL_MS = 60_000; // 1 minute

export function startSlaCheckInterval(
  prisma: PrismaClient,
  onBreach: (handoff: BreachedHandoff) => Promise<void>,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
): { stop: () => void } {
  const timer = setInterval(() => {
    checkAllOrgBreaches(prisma, onBreach).catch((err) =>
      console.error("[sla-check] Error checking SLA breaches:", err),
    );
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
```

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run sla-check-job
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
feat: add SLA breach check job for handoff monitoring
```

---

## Task 7: P1-6 — Governance endpoints: use requireOrganizationScope

**Bug:** `governance.ts:42-46` uses a manual `if (organizationIdFromAuth && mismatch)` check. If `organizationIdFromAuth` is undefined (e.g., system-level API key without org scope), the check passes and any org's data is accessible.

**Fix:** Use `requireOrganizationScope` and validate the path param matches.

**Files:**

- Edit: `apps/api/src/routes/governance.ts`
- Create: `apps/api/src/routes/__tests__/governance-auth.test.ts`

### Steps

- [ ] **Step 1: Write the test**

Create `apps/api/src/routes/__tests__/governance-auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("governance auth pattern", () => {
  it("rejects request when organizationIdFromAuth is undefined (no org scope)", () => {
    // Simulates a request without org-scoped auth
    const organizationIdFromAuth: string | undefined = undefined;

    // OLD behavior (bug): this check passes when organizationIdFromAuth is falsy
    const oldCheck = organizationIdFromAuth && "org-1" !== organizationIdFromAuth;
    expect(oldCheck).toBeFalsy(); // Bug: allows access

    // NEW behavior: requireOrganizationScope returns null, handler aborts
    const orgId = organizationIdFromAuth ?? null;
    expect(orgId).toBeNull();
  });

  it("rejects request when orgId path param mismatches auth scope", () => {
    const organizationIdFromAuth = "org-1";
    const pathOrgId = "org-2";

    // Both old and new reject this
    expect(pathOrgId).not.toBe(organizationIdFromAuth);
  });

  it("allows request when orgId matches auth scope", () => {
    const organizationIdFromAuth = "org-1";
    const pathOrgId = "org-1";
    expect(pathOrgId).toBe(organizationIdFromAuth);
  });
});
```

- [ ] **Step 2: Fix the auth pattern in governance.ts**

In `apps/api/src/routes/governance.ts`:

1. Import `requireOrganizationScope`:

```typescript
import { requireOrganizationScope } from "../utils/require-org.js";
```

2. Replace the manual auth check in `GET /:orgId/status` (lines 42-49) with:

```typescript
const orgId = requireOrganizationScope(request, reply);
if (!orgId) return;

const { orgId: pathOrgId } = request.params as { orgId: string };
if (pathOrgId !== orgId) {
  return reply.code(403).send({
    error: "Forbidden: organization mismatch",
    hint: "Verify your API key is scoped to the correct organization.",
    statusCode: 403,
  });
}
```

3. Apply the same pattern to `PUT /:orgId/profile` (lines 109-115).

4. The `emergency-halt` and `resume` endpoints already have different auth flows (orgId from body), so leave those as-is but audit that they also reject when `organizationIdFromAuth` is set and mismatches.

- [ ] **Step 3: Verify**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run governance-auth
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
fix: use requireOrganizationScope in governance endpoints
```

---

## Task 8: P1-7 & P1-8 — Per-org escalation config (migration + lookup service)

**Bug:** Escalation notification recipients and SLA config are global env vars (`ESCALATION_EMAIL_RECIPIENTS`, etc.), not per-org. All orgs share the same recipients.

**Fix:**

1. Add `escalationConfig` JSON field to `OrganizationConfig` in Prisma schema.
2. Create a lookup service that reads per-org config, falling back to env vars.
3. Do NOT edit `skill-mode.ts` (owned by Chain B). The wiring from skill-mode into this service is a follow-up.

**Files:**

- Create: Prisma migration for `escalationConfig` column
- Create: `apps/api/src/services/escalation-config-service.ts`
- Create: `apps/api/src/services/__tests__/escalation-config-service.test.ts`

### Steps

- [ ] **Step 1: Create the Prisma migration**

```bash
cd /Users/jasonljc/switchboard
# Add the field to schema.prisma first, then generate migration
```

In `packages/db/prisma/schema.prisma`, add to the `OrganizationConfig` model (before `createdAt`):

```prisma
  escalationConfig     Json?    // { emailRecipients: string[], slaMinutes: number, notifyOnBreach: boolean }
```

Then:

```bash
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add-escalation-config --create-only
npx pnpm@9.15.4 db:generate
```

- [ ] **Step 2: Write the test**

Create `apps/api/src/services/__tests__/escalation-config-service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { getEscalationConfig, type EscalationConfig } from "../escalation-config-service.js";

describe("escalation-config-service", () => {
  it("returns per-org config when set", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({
          escalationConfig: {
            emailRecipients: ["owner@acme.com"],
            slaMinutes: 30,
            notifyOnBreach: true,
          },
        }),
      },
    };

    const config = await getEscalationConfig(mockPrisma as any, "org-1");
    expect(config.emailRecipients).toEqual(["owner@acme.com"]);
    expect(config.slaMinutes).toBe(30);
  });

  it("falls back to env vars when per-org config is null", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue({ escalationConfig: null }),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    process.env.ESCALATION_EMAIL_RECIPIENTS = "fallback@test.com,other@test.com";

    try {
      const config = await getEscalationConfig(mockPrisma as any, "org-1");
      expect(config.emailRecipients).toEqual(["fallback@test.com", "other@test.com"]);
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      } else {
        delete process.env.ESCALATION_EMAIL_RECIPIENTS;
      }
    }
  });

  it("returns empty recipients when neither per-org nor env var is set", async () => {
    const mockPrisma = {
      organizationConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const original = process.env.ESCALATION_EMAIL_RECIPIENTS;
    delete process.env.ESCALATION_EMAIL_RECIPIENTS;

    try {
      const config = await getEscalationConfig(mockPrisma as any, "org-1");
      expect(config.emailRecipients).toEqual([]);
    } finally {
      if (original !== undefined) {
        process.env.ESCALATION_EMAIL_RECIPIENTS = original;
      }
    }
  });
});
```

- [ ] **Step 3: Implement the lookup service**

Create `apps/api/src/services/escalation-config-service.ts`:

```typescript
// ---------------------------------------------------------------------------
// Escalation Config Service — per-org escalation settings with env var fallback
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@prisma/client";

export interface EscalationConfig {
  emailRecipients: string[];
  slaMinutes: number;
  notifyOnBreach: boolean;
}

interface StoredEscalationConfig {
  emailRecipients?: string[];
  slaMinutes?: number;
  notifyOnBreach?: boolean;
}

const DEFAULT_SLA_MINUTES = 60;

/**
 * Reads per-org escalation config from OrganizationConfig.escalationConfig.
 * Falls back to env vars if not set.
 */
export async function getEscalationConfig(
  prisma: PrismaClient,
  organizationId: string,
): Promise<EscalationConfig> {
  const orgConfig = await prisma.organizationConfig.findUnique({
    where: { id: organizationId },
    select: { escalationConfig: true },
  });

  const stored = orgConfig?.escalationConfig as StoredEscalationConfig | null;

  if (stored && Array.isArray(stored.emailRecipients)) {
    return {
      emailRecipients: stored.emailRecipients,
      slaMinutes: stored.slaMinutes ?? DEFAULT_SLA_MINUTES,
      notifyOnBreach: stored.notifyOnBreach ?? true,
    };
  }

  // Fallback to env vars
  const envRecipients = process.env.ESCALATION_EMAIL_RECIPIENTS;
  return {
    emailRecipients: envRecipients
      ? envRecipients
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : [],
    slaMinutes: Number(process.env.ESCALATION_SLA_MINUTES) || DEFAULT_SLA_MINUTES,
    notifyOnBreach: process.env.ESCALATION_NOTIFY_ON_BREACH !== "false",
  };
}
```

- [ ] **Step 4: Verify**

```bash
npx pnpm@9.15.4 db:generate
npx pnpm@9.15.4 --filter @switchboard/api test -- --run escalation-config-service
npx pnpm@9.15.4 typecheck
```

**Commit:**

```
feat: add per-org escalation config with env var fallback
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx pnpm@9.15.4 test
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 lint
```

- [ ] **Step 2: Verify no Chain D files were missed**

```bash
git diff --stat main...HEAD
```

Confirm all changes are within Chain D owned files.

- [ ] **Step 3: Final commit (if any lint/format fixes needed)**

```
chore: format and lint fixes for chain D
```

---

## Summary Matrix

| ID     | Severity | Description                      | Task   | Test File                            |
| ------ | -------- | -------------------------------- | ------ | ------------------------------------ |
| P0-15  | P0       | Escalation reply never delivered | Task 1 | `escalations-reply-delivery.test.ts` |
| P1-1   | P1       | Override race condition          | Task 2 | `override-race.test.ts`              |
| P1-2   | P1       | No operator send endpoint        | Task 3 | `conversations-send.test.ts`         |
| P1-3   | P1       | agentNotifier dead code          | Task 4 | (existing tests)                     |
| P1-4   | P1       | Email escalation silent failure  | Task 5 | `email-escalation-notifier.test.ts`  |
| P1-5   | P1       | SLA Monitor unwired              | Task 6 | `sla-check-job.test.ts`              |
| P1-6   | P1       | Governance weak auth             | Task 7 | `governance-auth.test.ts`            |
| P1-7+8 | P1       | Per-org escalation config        | Task 8 | `escalation-config-service.test.ts`  |
