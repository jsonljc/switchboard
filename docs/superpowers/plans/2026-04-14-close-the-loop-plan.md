# Close the Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ads-to-conversion feedback loop: Meta leads → Contact + WhatsApp outreach, revenue recorded via chat → CAPI Purchase event to Meta.

**Architecture:** Wire existing pieces — extend the lead webhook (already parses Meta payloads), restore CAPI wiring (client exists, subscriber missing), add `/sold` cockpit command for revenue recording via chat, expose revenue store via REST.

**Tech Stack:** TypeScript, Fastify, Prisma, Vitest, existing MetaCAPIClient + ConversionBus + PrismaRevenueStore + WhatsAppAdapter

**Spec:** `docs/superpowers/specs/2026-04-14-close-the-loop-design.md`

**Codebase:** `/Users/jasonljc/switchboard`

---

## File Structure

| File                                                             | Action | Purpose                                                        |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                               | Modify | Add `externalAccountId` + `greetingTemplateName` to Connection |
| `apps/api/src/bootstrap/conversion-bus-wiring.ts`                | Create | CAPI subscriber on ConversionBus                               |
| `apps/api/src/bootstrap/__tests__/conversion-bus-wiring.test.ts` | Create | Tests for CAPI wiring                                          |
| `apps/api/src/bootstrap/services.ts`                             | Modify | Replace dead `wireConversionBus` import with new wiring        |
| `apps/api/src/routes/revenue.ts`                                 | Create | Revenue CRUD routes                                            |
| `apps/api/src/routes/__tests__/revenue.test.ts`                  | Create | Tests for revenue routes                                       |
| `apps/api/src/bootstrap/routes.ts`                               | Modify | Register revenue routes                                        |
| `apps/chat/src/handlers/sold-command.ts`                         | Create | `/sold` command: parse, confirm, execute                       |
| `apps/chat/src/handlers/__tests__/sold-command.test.ts`          | Create | Tests for `/sold` command                                      |
| `apps/chat/src/message-pipeline.ts`                              | Modify | Add `/sold` + confirmation dispatch                            |
| `apps/api/src/routes/ad-optimizer.ts`                            | Modify | Extend lead webhook: create Contact + send template            |

---

## Task 0: Prisma Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma:193-209`

- [ ] **Step 1: Add fields to Connection model**

In `packages/db/prisma/schema.prisma`, add two fields to the `Connection` model after `updatedAt`:

```prisma
model Connection {
  id              String   @id @default(uuid())
  serviceId       String
  serviceName     String
  organizationId  String?
  authType        String
  credentials     Json
  scopes          String[]
  refreshStrategy String   @default("auto")
  status          String   @default("connected")
  lastHealthCheck DateTime?
  externalAccountId    String?
  greetingTemplateName String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([serviceId, organizationId])
  @@index([organizationId])
  @@index([externalAccountId])
}
```

- [ ] **Step 2: Generate migration**

```bash
npx pnpm@9.15.4 db:generate
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add externalAccountId and greetingTemplateName to Connection model"
```

---

## Task 1: CAPI Wiring

**Files:**

- Create: `apps/api/src/bootstrap/conversion-bus-wiring.ts`
- Create: `apps/api/src/bootstrap/__tests__/conversion-bus-wiring.test.ts`
- Modify: `apps/api/src/bootstrap/services.ts:28-30,82-89`

**Reference:**

- `packages/core/src/events/conversion-bus.ts` — `ConversionBus` interface with `subscribe(type, handler)`
- `packages/core/src/ad-optimizer/meta-capi-client.ts` — `MetaCAPIClient` with `dispatchEvent(event)`
- `apps/api/src/bootstrap/services.ts:30` — dead import `wireConversionBus` from removed source file
- `apps/api/src/bootstrap/services.ts:82-89` — existing call to `wireConversionBus()`

The `@switchboard/digital-ads` package no longer exists in source. The old `wireConversionBus` used `CAPIDispatcher` from that package. We replace it with a simpler direct wiring to `MetaCAPIClient`.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/bootstrap/__tests__/conversion-bus-wiring.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { wireCAPIDispatcher } from "../conversion-bus-wiring.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";

// Mock fetch to intercept CAPI calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ events_received: 1 }),
});
vi.stubGlobal("fetch", mockFetch);

describe("wireCAPIDispatcher", () => {
  it("sends Purchase event to Meta CAPI when purchased event emitted", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    const event: ConversionEvent = {
      type: "purchased",
      contactId: "c1",
      organizationId: "org-1",
      value: 388,
      sourceAdId: "ad-456",
      sourceCampaignId: "camp-789",
      timestamp: new Date("2026-04-14T10:00:00Z"),
      metadata: {},
    };

    bus.emit(event);
    // Allow async handler to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain("px-123/events");
    const body = JSON.parse(opts.body);
    expect(body.data[0].event_name).toBe("Purchase");
    expect(body.data[0].custom_data.value).toBe(388);
  });

  it("skips events without sourceAdId", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    bus.emit({
      type: "purchased",
      contactId: "c1",
      organizationId: "org-1",
      value: 100,
      timestamp: new Date(),
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends Lead event for non-purchased types", async () => {
    const bus = new InMemoryConversionBus();
    wireCAPIDispatcher(bus, { pixelId: "px-123", accessToken: "token-abc" });

    bus.emit({
      type: "inquiry",
      contactId: "c1",
      organizationId: "org-1",
      value: 0,
      sourceAdId: "ad-1",
      timestamp: new Date(),
      metadata: {},
    });

    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.data[0].event_name).toBe("Lead");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run conversion-bus-wiring
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement CAPI wiring**

Create `apps/api/src/bootstrap/conversion-bus-wiring.ts`:

```typescript
import type { ConversionBus } from "@switchboard/core";
import { MetaCAPIClient } from "@switchboard/core/ad-optimizer";

export function wireCAPIDispatcher(
  bus: ConversionBus,
  config: { pixelId: string; accessToken: string },
): void {
  const client = new MetaCAPIClient(config);

  bus.subscribe("*", async (event) => {
    if (!event.sourceAdId) return;

    const eventName = event.type === "purchased" ? "Purchase" : "Lead";

    try {
      await client.dispatchEvent({
        eventName,
        eventTime: Math.floor(event.timestamp.getTime() / 1000),
        userData: { fbclid: (event.metadata["fbclid"] as string) ?? null },
        customData: event.value ? { value: event.value, currency: "SGD" } : undefined,
      });
    } catch (err) {
      console.error("[CAPIWiring] Failed to dispatch event:", err);
    }
  });
}
```

Note: The `MetaCAPIClient.dispatchEvent()` method does NOT accept `eventId` — the `CAPIEventSchema` has no such field. Meta's server-side dedup uses `event_name` + `event_time` + `user_data` matching. If we need explicit `event_id` dedup in the future, add `eventId: z.string().optional()` to `CAPIEventSchema` and pass it through in `MetaCAPIClient.dispatchEvent()`'s body construction. For v1, the existing dedup is sufficient.

- [ ] **Step 4: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run conversion-bus-wiring
```

Expected: PASS.

- [ ] **Step 5: Replace dead import in services.ts**

In `apps/api/src/bootstrap/services.ts`:

Replace line 28 (dead type import from removed package):

```typescript
// OLD: import type { MetaAdsWriteProvider } from "@switchboard/digital-ads";
// Remove entirely — this type is no longer used after the wireConversionBus removal
```

Replace line 30:

```typescript
// OLD: import { wireConversionBus } from "./conversion-bus-bootstrap.js";
// NEW:
import { wireCAPIDispatcher } from "./conversion-bus-wiring.js";
```

Update `ServicesBootstrapInput` interface to remove `adsWriteProvider`:

```typescript
// Remove the adsWriteProvider field from the interface, or change to:
// adsWriteProvider?: unknown; // deprecated — CAPI wiring uses env vars now
```

Replace lines 82-89 (the `wireConversionBus` call):

```typescript
// --- ConversionBus wiring (CRM → ads feedback loop) ---
const conversionBus = new InMemoryConversionBus();
const pixelId = process.env["META_PIXEL_ID"];
const accessToken = process.env["META_ACCESS_TOKEN"];
if (pixelId && accessToken) {
  wireCAPIDispatcher(conversionBus, { pixelId, accessToken });
  logger.info("CAPI dispatcher wired to ConversionBus");
}
```

- [ ] **Step 6: Run full API tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run
```

Expected: PASS — the old `wireConversionBus` import was broken anyway (source file missing).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bootstrap/conversion-bus-wiring.ts apps/api/src/bootstrap/__tests__/conversion-bus-wiring.test.ts apps/api/src/bootstrap/services.ts
git commit -m "feat(api): wire CAPI dispatcher to ConversionBus — conversions flow to Meta"
```

---

## Task 2: Revenue API Route

**Files:**

- Create: `apps/api/src/routes/revenue.ts`
- Create: `apps/api/src/routes/__tests__/revenue.test.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

**Reference:**

- `packages/core/src/lifecycle/revenue-store.ts` — `RevenueStore` interface: `record(input)`, `findByOpportunity()`, `sumByOrg()`, `sumByCampaign()`
- `packages/db/src/stores/prisma-revenue-store.ts` — `PrismaRevenueStore` implementation
- `apps/api/src/routes/marketplace.ts` — route pattern: Zod validation, auth, org scope
- `apps/api/src/utils/require-org.ts` — `requireOrganizationScope(request, reply)` returns `string | null`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/__tests__/revenue.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";

const RecordRevenueInputSchema = z.object({
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

describe("RecordRevenueInputSchema", () => {
  it("validates valid input", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      amount: 388,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("SGD");
      expect(result.data.type).toBe("payment");
      expect(result.data.recordedBy).toBe("owner");
    }
  });

  it("rejects negative amount", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      amount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing contactId", () => {
    const result = RecordRevenueInputSchema.safeParse({ amount: 100 });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Implement revenue routes**

Create `apps/api/src/routes/revenue.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PrismaRevenueStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

const RecordRevenueInputSchema = z.object({
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

export const revenueRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/:orgId/revenue — record a revenue event
  app.post<{ Params: { orgId: string } }>("/:orgId/revenue", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = RecordRevenueInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const input = parsed.data;
    const opportunityId = input.opportunityId ?? `rev-${input.contactId}-${Date.now()}`;

    const store = new PrismaRevenueStore(app.prisma);
    const event = await store.record({
      organizationId: orgId,
      contactId: input.contactId,
      opportunityId,
      amount: input.amount,
      currency: input.currency,
      type: input.type,
      recordedBy: input.recordedBy,
      externalReference: input.externalReference ?? null,
      sourceCampaignId: input.sourceCampaignId ?? null,
      sourceAdId: input.sourceAdId ?? null,
    });

    // Emit conversion event for CAPI
    if (app.conversionBus) {
      app.conversionBus.emit({
        type: "purchased",
        contactId: input.contactId,
        organizationId: orgId,
        value: input.amount,
        sourceAdId: input.sourceAdId ?? undefined,
        sourceCampaignId: input.sourceCampaignId ?? undefined,
        timestamp: new Date(),
        metadata: {},
      });
    }

    return reply.code(201).send(event);
  });

  // GET /api/:orgId/revenue — list revenue events
  app.get<{ Params: { orgId: string }; Querystring: { opportunityId?: string } }>(
    "/:orgId/revenue",
    async (request, reply) => {
      if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const store = new PrismaRevenueStore(app.prisma);
      const opportunityId = request.query.opportunityId;
      if (opportunityId) {
        const events = await store.findByOpportunity(orgId, opportunityId);
        return reply.send(events);
      }
      const summary = await store.sumByOrg(orgId);
      return reply.send(summary);
    },
  );

  // GET /api/:orgId/revenue/summary — total revenue by org
  app.get<{ Params: { orgId: string } }>("/:orgId/revenue/summary", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const summary = await store.sumByOrg(orgId);
    return reply.send(summary);
  });

  // GET /api/:orgId/revenue/by-campaign — revenue grouped by campaign
  app.get<{ Params: { orgId: string } }>("/:orgId/revenue/by-campaign", async (request, reply) => {
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const store = new PrismaRevenueStore(app.prisma);
    const campaigns = await store.sumByCampaign(orgId);
    return reply.send(campaigns);
  });
};
```

- [ ] **Step 3: Register routes**

In `apps/api/src/bootstrap/routes.ts`, add import and registration:

```typescript
import { revenueRoutes } from "../routes/revenue.js";
```

Add after the `adOptimizerRoutes` registration line:

```typescript
await app.register(revenueRoutes, { prefix: "/api" });
```

- [ ] **Step 4: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run revenue
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/revenue.ts apps/api/src/routes/__tests__/revenue.test.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(api): add revenue recording API routes — POST + GET + summary + by-campaign"
```

---

## Task 3: Revenue Chat Command `/sold`

**Files:**

- Create: `apps/chat/src/handlers/sold-command.ts`
- Create: `apps/chat/src/handlers/__tests__/sold-command.test.ts`
- Modify: `apps/chat/src/message-pipeline.ts:274-340`

**Reference:**

- `apps/chat/src/handlers/cockpit-commands.ts` — existing command handler pattern: function takes `(ctx: HandlerContext, threadId, principalId, organizationId)`, calls `ctx.sendFilteredReply()`
- `apps/chat/src/message-pipeline.ts:274-340` — `handleCommands()` dispatches via regex matching
- `apps/chat/src/handlers/handler-context.ts` — `HandlerContext` type

- [ ] **Step 1: Write failing tests**

Create `apps/chat/src/handlers/__tests__/sold-command.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseSoldInput,
  checkPendingSale,
  setPendingSale,
  clearPendingSale,
} from "../sold-command.js";

describe("parseSoldInput", () => {
  it("parses name + amount + description", () => {
    const result = parseSoldInput("Sarah 388 Pico Laser");
    expect(result).toEqual({ name: "Sarah", amount: 388, description: "Pico Laser" });
  });

  it("parses name + dollar amount", () => {
    const result = parseSoldInput("John $150 consultation");
    expect(result).toEqual({ name: "John", amount: 150, description: "consultation" });
  });

  it("parses amount only", () => {
    const result = parseSoldInput("500");
    expect(result).toEqual({ name: null, amount: 500, description: "" });
  });

  it("parses decimal amount", () => {
    const result = parseSoldInput("Sarah 99.50 facial");
    expect(result).toEqual({ name: "Sarah", amount: 99.5, description: "facial" });
  });

  it("returns null for invalid input", () => {
    expect(parseSoldInput("")).toBeNull();
    expect(parseSoldInput("no numbers here")).toBeNull();
  });
});

describe("pendingSale state", () => {
  it("stores and retrieves pending sale", () => {
    setPendingSale("thread-1", {
      contactId: "c-1",
      contactName: "Sarah",
      amount: 388,
      description: "Pico Laser",
      sourceCampaignId: null,
      sourceAdId: null,
      createdAt: Date.now(),
    });

    const sale = checkPendingSale("thread-1");
    expect(sale).toBeTruthy();
    expect(sale!.amount).toBe(388);

    clearPendingSale("thread-1");
    expect(checkPendingSale("thread-1")).toBeNull();
  });

  it("expires after 5 minutes", () => {
    setPendingSale("thread-2", {
      contactId: "c-1",
      contactName: "John",
      amount: 100,
      description: "",
      sourceCampaignId: null,
      sourceAdId: null,
      createdAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
    });

    expect(checkPendingSale("thread-2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --run sold-command
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement sold command**

Create `apps/chat/src/handlers/sold-command.ts`:

```typescript
// ---------------------------------------------------------------------------
// /sold command — record revenue via chat
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";

export interface PendingSale {
  contactId: string | null;
  contactName: string | null;
  amount: number;
  description: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  createdAt: number;
}

const EXPIRY_MS = 5 * 60 * 1000;
const pendingSales = new Map<string, PendingSale>();

export function parseSoldInput(
  input: string,
): { name: string | null; amount: number; description: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(?:([A-Za-z][\w\s]*?)\s+)?(?:\$?)(\d+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!match) return null;

  const name = match[1]?.trim() ?? null;
  const amount = parseFloat(match[2]!);
  const description = match[3]?.trim() ?? "";

  if (isNaN(amount) || amount <= 0) return null;

  return { name, amount, description };
}

export function setPendingSale(threadId: string, sale: PendingSale): void {
  pendingSales.set(threadId, sale);
}

export function checkPendingSale(threadId: string): PendingSale | null {
  const sale = pendingSales.get(threadId);
  if (!sale) return null;

  if (Date.now() - sale.createdAt > EXPIRY_MS) {
    pendingSales.delete(threadId);
    return null;
  }

  return sale;
}

export function clearPendingSale(threadId: string): void {
  pendingSales.delete(threadId);
}

export async function handleSoldCommand(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
  input: string,
): Promise<void> {
  if (!organizationId) {
    await ctx.sendFilteredReply(threadId, "Cannot record revenue: no organization context.");
    return;
  }

  const parsed = parseSoldInput(input);
  if (!parsed) {
    await ctx.sendFilteredReply(
      threadId,
      "Usage: /sold [name] amount [description]\nExample: /sold Sarah 388 Pico Laser",
    );
    return;
  }

  // Build confirmation message
  const parts = [`Record $${parsed.amount}`];
  if (parsed.name) parts.push(`from ${parsed.name}`);
  if (parsed.description) parts.push(`for ${parsed.description}`);
  parts.push("?\n\nReply Y to confirm.");

  setPendingSale(threadId, {
    contactId: null, // Resolved during confirmation
    contactName: parsed.name,
    amount: parsed.amount,
    description: parsed.description,
    sourceCampaignId: null,
    sourceAdId: null,
    createdAt: Date.now(),
  });

  await ctx.sendFilteredReply(threadId, parts.join(" "));
}

export async function handleSoldConfirmation(
  ctx: HandlerContext,
  threadId: string,
  _principalId: string,
  organizationId: string | null,
  reply: string,
): Promise<boolean> {
  const sale = checkPendingSale(threadId);
  if (!sale) return false;

  clearPendingSale(threadId);

  const isYes = /^y(es)?$/i.test(reply.trim());
  if (!isYes) {
    await ctx.sendFilteredReply(threadId, "Sale recording cancelled.");
    return true;
  }

  if (!organizationId || !ctx.apiBaseUrl) {
    await ctx.sendFilteredReply(threadId, "Cannot record: no API connection.");
    return true;
  }

  try {
    const res = await fetch(`${ctx.apiBaseUrl}/api/${organizationId}/revenue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: sale.contactId ?? "unknown",
        amount: sale.amount,
        recordedBy: "owner",
      }),
    });

    if (!res.ok) {
      await ctx.sendFilteredReply(threadId, "Failed to record sale. Please try again.");
      return true;
    }

    const displayName = sale.contactName ?? "unknown contact";
    const desc = sale.description ? ` for ${sale.description}` : "";
    await ctx.sendFilteredReply(
      threadId,
      `Recorded: $${sale.amount} from ${displayName}${desc}. Meta has been notified.`,
    );
  } catch {
    await ctx.sendFilteredReply(threadId, "Failed to record sale. Please try again.");
  }

  return true;
}
```

- [ ] **Step 4: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --run sold-command
```

Expected: PASS.

- [ ] **Step 5: Wire into message pipeline**

In `apps/chat/src/message-pipeline.ts`, add import at the top:

```typescript
import {
  handleSoldCommand,
  handleSoldConfirmation,
  checkPendingSale,
} from "./handlers/sold-command.js";
```

In `handleCommands()`, add these checks **before** the existing help command check:

```typescript
// Check for pending sale confirmation (only intercept Y/yes/N/no — let other commands pass through)
const pending = checkPendingSale(threadId);
if (pending && /^(y(es)?|no?)$/i.test(message.text.trim())) {
  const ctx = deps.buildHandlerContext();
  const handled = await handleSoldConfirmation(
    ctx,
    threadId,
    message.principalId,
    message.organizationId,
    message.text,
  );
  if (handled) return true;
}

// Handle /sold command
const soldMatch = message.text.trim().match(/^\/?sold\s+(.+)$/i);
if (soldMatch) {
  const ctx = deps.buildHandlerContext();
  await handleSoldCommand(
    ctx,
    threadId,
    message.principalId,
    message.organizationId,
    soldMatch[1]!,
  );
  return true;
}
```

- [ ] **Step 6: Run chat tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/chat test -- --run
```

Expected: PASS — all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/chat/src/handlers/sold-command.ts apps/chat/src/handlers/__tests__/sold-command.test.ts apps/chat/src/message-pipeline.ts
git commit -m "feat(chat): add /sold command — record revenue via WhatsApp/Telegram"
```

---

## Task 4: Extend Lead Ingestion Webhook

**Files:**

- Modify: `apps/api/src/routes/ad-optimizer.ts`

**Reference:**

- `apps/api/src/routes/ad-optimizer.ts:26-42` — existing POST handler that logs leads
- `packages/core/src/ad-optimizer/meta-leads-ingester.ts` — `parseLeadWebhook(payload)` returns `LeadData[]`
- `packages/core/src/lifecycle/contact-store.ts` — `ContactStore` with `create()` and `findByPhone()`
- `apps/chat/src/adapters/whatsapp.ts:173-195` — `sendTemplateMessage(to, templateName, languageCode, components)`

- [ ] **Step 1: Extend the POST handler**

Replace the existing POST handler in `apps/api/src/routes/ad-optimizer.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { parseLeadWebhook } from "@switchboard/core/ad-optimizer";

const VERIFY_TOKEN = process.env["META_WEBHOOK_VERIFY_TOKEN"] ?? "switchboard-verify";

export const adOptimizerRoutes: FastifyPluginAsync = async (app) => {
  // Meta Leads webhook verification (GET) — unchanged
  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/leads/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: "Verification failed" });
  });

  // Meta Leads webhook receiver (POST) — extended with Contact creation + WhatsApp outreach
  app.post("/leads/webhook", async (request, reply) => {
    const leads = parseLeadWebhook(request.body);

    if (leads.length === 0) {
      return reply.code(200).send({ received: 0 });
    }

    // Resolve org from the webhook entry ID
    const payload = request.body as { entry?: Array<{ id?: string }> };
    const entryId = payload.entry?.[0]?.id;

    let organizationId: string | null = null;
    let greetingTemplateName = "lead_welcome";

    if (entryId && app.prisma) {
      const connection = await app.prisma.connection.findFirst({
        where: { serviceId: "meta-ads", externalAccountId: entryId },
      });
      if (connection?.organizationId) {
        organizationId = connection.organizationId;
        greetingTemplateName = connection.greetingTemplateName ?? "lead_welcome";
      }
    }

    let created = 0;
    for (const lead of leads) {
      app.log.info(
        { leadId: lead.leadId, adId: lead.adId, email: lead.email ? "[redacted]" : undefined },
        "Received Meta lead",
      );

      if (!lead.phone || !organizationId) continue;

      // Dedup: check if contact already exists with same phone + adId
      if (app.prisma) {
        const { PrismaContactStore } = await import("@switchboard/db");
        const contactStore = new PrismaContactStore(app.prisma);

        const existing = await contactStore.findByPhone(organizationId, lead.phone);
        if (existing) {
          const existingAdId = (existing.attribution as Record<string, unknown>)?.sourceAdId;
          if (existingAdId === lead.adId) {
            app.log.info({ phone: "[redacted]", adId: lead.adId }, "Duplicate lead, skipping");
            continue;
          }
        }

        // Create contact
        await contactStore.create({
          organizationId,
          name: lead.name ?? null,
          phone: lead.phone,
          email: lead.email ?? null,
          primaryChannel: "whatsapp",
          source: "meta-instant-form",
          attribution: {
            sourceAdId: lead.adId,
            fbclid: null,
            gclid: null,
            ttclid: null,
            sourceCampaignId: null,
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
          },
        });
        created++;

        // Send WhatsApp template greeting
        try {
          const waToken = process.env["WHATSAPP_ACCESS_TOKEN"];
          const waPhoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
          if (waToken && waPhoneId) {
            const firstName = lead.name?.split(" ")[0] ?? "there";
            await sendWhatsAppTemplate(
              waToken,
              waPhoneId,
              lead.phone,
              greetingTemplateName,
              firstName,
            );
          }
        } catch (err) {
          app.log.error({ err, phone: "[redacted]" }, "Failed to send lead greeting template");
        }

        // Emit inquiry event for CAPI Lead event
        if (app.conversionBus) {
          app.conversionBus.emit({
            type: "inquiry",
            contactId: lead.leadId,
            organizationId,
            value: 0,
            sourceAdId: lead.adId,
            timestamp: new Date(),
            metadata: {},
          });
        }
      }
    }

    return reply.code(200).send({ received: leads.length, created });
  });
};

async function sendWhatsAppTemplate(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  firstName: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: firstName }],
          },
        ],
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp template send failed: ${res.status} ${body}`);
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/api test -- --run
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/ad-optimizer.ts
git commit -m "feat(api): extend lead webhook — create Contact + send WhatsApp template + emit CAPI Lead"
```

---

## Task 5: Integration Verification

- [ ] **Step 1: Run all tests**

```bash
npx pnpm@9.15.4 test
```

Expected: PASS across all packages.

- [ ] **Step 2: Lint**

```bash
npx pnpm@9.15.4 --filter @switchboard/api exec eslint src --ext .ts
npx pnpm@9.15.4 --filter @switchboard/chat exec eslint src --ext .ts
```

Expected: 0 errors.

- [ ] **Step 3: Type check (if build works)**

```bash
npx pnpm@9.15.4 --filter @switchboard/api typecheck 2>&1 | tail -5
npx pnpm@9.15.4 --filter @switchboard/chat typecheck 2>&1 | tail -5
```

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "chore: lint and format fixes for close-the-loop"
```
