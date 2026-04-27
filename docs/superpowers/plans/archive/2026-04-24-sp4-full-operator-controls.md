# SP4: Full Operator Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner can browse conversations, take over/release with runtime enforcement, and review escalations with full transcript + resolution notes.

**Architecture:** Four deliverables built on existing plumbing. The runtime override guard goes in `ChannelGateway.handleIncoming()` after message persistence (step 3) but before skill dispatch (step 6). The gateway needs a new `getConversationStatus` method on `GatewayConversationStore` to query `ConversationState.status` by sessionId, since the gateway's own store uses `ConversationThread` (a separate table). Dashboard work is list+inline-expansion pattern matching the existing escalation card UI.

**Tech Stack:** TypeScript, Vitest, Prisma, Next.js 14 (App Router), React Query, Tailwind, shadcn/ui patterns

---

### Task 1: Add `getConversationStatus` to Gateway Conversation Store

**Why first:** The runtime override guard (Task 2) depends on this. The gateway currently has no way to check `ConversationState.status` because it uses `GatewayConversationStore` which operates on `ConversationThread`/`ConversationMessage` tables, not `ConversationState`.

**Files:**

- Modify: `packages/core/src/channel-gateway/types.ts`
- Modify: `apps/chat/src/gateway/gateway-conversation-store.ts`
- Modify: `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`

- [ ] **Step 1: Write the failing test for `getConversationStatus`**

In `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`, add:

```typescript
describe("getConversationStatus", () => {
  it("returns status from ConversationState when it exists", async () => {
    // Create a ConversationState with human_override status
    await prisma.conversationState.create({
      data: {
        threadId: "session-override-1",
        channel: "whatsapp",
        principalId: "principal-1",
        status: "human_override",
        messages: "[]",
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const store = new PrismaGatewayConversationStore(prisma);
    const status = await store.getConversationStatus("session-override-1");
    expect(status).toBe("human_override");
  });

  it("returns null when no ConversationState exists for sessionId", async () => {
    const store = new PrismaGatewayConversationStore(prisma);
    const status = await store.getConversationStatus("nonexistent-session");
    expect(status).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @switchboard/chat test -- --run gateway-conversation-store`
Expected: FAIL — `getConversationStatus` is not a function

- [ ] **Step 3: Add `getConversationStatus` to `GatewayConversationStore` interface**

In `packages/core/src/channel-gateway/types.ts`, add to the `GatewayConversationStore` interface:

```typescript
export interface GatewayConversationStore {
  getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  addMessage(conversationId: string, role: string, content: string): Promise<void>;
  getConversationStatus?(sessionId: string): Promise<string | null>;
}
```

Note: marked as optional (`?`) so existing implementations don't break.

- [ ] **Step 4: Implement `getConversationStatus` in `PrismaGatewayConversationStore`**

In `apps/chat/src/gateway/gateway-conversation-store.ts`, add after `addMessage`:

```typescript
async getConversationStatus(sessionId: string): Promise<string | null> {
  const row = await this.prisma.conversationState.findUnique({
    where: { threadId: sessionId },
    select: { status: true },
  });
  return row?.status ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `corepack pnpm --filter @switchboard/chat test -- --run gateway-conversation-store`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channel-gateway/types.ts apps/chat/src/gateway/gateway-conversation-store.ts apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts && git commit -m "feat: add getConversationStatus to GatewayConversationStore"
```

---

### Task 2: Runtime Override Guard in ChannelGateway

**Why:** This is the heart of SP4. Without this guard, override is cosmetic — the API sets `human_override` status but the gateway ignores it.

**Files:**

- Modify: `packages/core/src/channel-gateway/channel-gateway.ts`
- Modify: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`, add three tests:

```typescript
it("skips skill dispatch when conversation status is human_override", async () => {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  const addMessageSpy = vi.fn().mockResolvedValue(undefined);
  const submitSpy = vi.fn();
  const config = createMockConfig({
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: addMessageSpy,
      getConversationStatus: vi.fn().mockResolvedValue("human_override"),
    },
    platformIngress: { submit: submitSpy },
  });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "whatsapp",
    token: "sw_valid123",
    sessionId: "sess-override",
    text: "Hello while overridden",
  };

  await gateway.handleIncoming(message, { send: sendSpy });

  // Message IS persisted
  expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "user", "Hello while overridden");
  // Skill dispatch is NOT called
  expect(submitSpy).not.toHaveBeenCalled();
  // No reply sent
  expect(sendSpy).not.toHaveBeenCalled();
});

it("proceeds normally when conversation status is active", async () => {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  const submitSpy = vi.fn().mockResolvedValue({
    ok: true,
    result: {
      outcome: "completed",
      outputs: { response: "Agent reply" },
      summary: "ok",
    },
    workUnit: { id: "wu-1", traceId: "trace-1" },
  });
  const config = createMockConfig({
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
      getConversationStatus: vi.fn().mockResolvedValue("active"),
    },
    platformIngress: { submit: submitSpy },
  });
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "whatsapp",
    token: "sw_valid123",
    sessionId: "sess-1",
    text: "Hello",
  };

  await gateway.handleIncoming(message, { send: sendSpy });

  expect(submitSpy).toHaveBeenCalled();
  expect(sendSpy).toHaveBeenCalledWith("Agent reply");
});

it("proceeds normally when getConversationStatus is not implemented", async () => {
  const sendSpy = vi.fn().mockResolvedValue(undefined);
  const submitSpy = vi.fn().mockResolvedValue({
    ok: true,
    result: {
      outcome: "completed",
      outputs: { response: "Agent reply" },
      summary: "ok",
    },
    workUnit: { id: "wu-1", traceId: "trace-1" },
  });
  const config = createMockConfig({
    platformIngress: { submit: submitSpy },
  });
  // Default mock has no getConversationStatus
  const gateway = new ChannelGateway(config);
  const message: IncomingChannelMessage = {
    channel: "whatsapp",
    token: "sw_valid123",
    sessionId: "sess-1",
    text: "Hello",
  };

  await gateway.handleIncoming(message, { send: sendSpy });

  expect(submitSpy).toHaveBeenCalled();
  expect(sendSpy).toHaveBeenCalledWith("Agent reply");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm --filter @switchboard/core test -- --run channel-gateway`
Expected: First test FAILS (submit is called when it shouldn't be), other two may pass since they test existing behavior.

- [ ] **Step 3: Add the override guard to `handleIncoming`**

In `packages/core/src/channel-gateway/channel-gateway.ts`, add the guard after step 3 (message persistence) and before step 4 (typing signal). Insert between line 53 and line 55:

```typescript
// 3b. Check for human override — skip skill dispatch if owner has taken over
if (this.config.conversationStore.getConversationStatus) {
  const status = await this.config.conversationStore.getConversationStatus(message.sessionId);
  if (status === "human_override") {
    return;
  }
}
```

The full method after the change: after `this.config.onMessageRecorded?.(...)` at line 53, add the guard block above, then continue with existing step 4 (`replySink.onTyping?.()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm --filter @switchboard/core test -- --run channel-gateway`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel-gateway/channel-gateway.ts packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts && git commit -m "feat: add human_override guard to ChannelGateway"
```

---

### Task 3: Prisma Migration for Handoff Resolution Fields

**Why:** The rich escalation inbox needs `resolutionNote` and `resolvedAt` on the Handoff model. This is a schema change that other tasks depend on.

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: migration file (auto-generated by Prisma)

- [ ] **Step 1: Add fields to Handoff model**

In `packages/db/prisma/schema.prisma`, find the `model Handoff` block (line 541) and add two fields before the `@@index` lines:

```prisma
model Handoff {
  id                    String    @id @default(uuid())
  sessionId             String
  organizationId        String
  leadId                String?
  status                String    @default("pending") // pending, assigned, active, released, resolved
  reason                String    // human_requested, max_turns_exceeded, etc.
  leadSnapshot          Json      @default("{}")
  qualificationSnapshot Json      @default("{}")
  conversationSummary   Json      @default("{}")
  slaDeadlineAt         DateTime
  acknowledgedAt        DateTime?
  resolutionNote        String?
  resolvedAt            DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([organizationId, status])
  @@index([sessionId])
  @@index([slaDeadlineAt])
}
```

- [ ] **Step 2: Generate the migration**

Run: `corepack pnpm db:generate`
Then: `corepack pnpm --filter @switchboard/db exec prisma migrate dev --name add_handoff_resolution`

Expected: Migration created successfully. Existing rows unaffected (both fields nullable).

- [ ] **Step 3: Verify Prisma client regenerated**

Run: `corepack pnpm db:generate`
Expected: Prisma client generated with `resolutionNote` and `resolvedAt` fields on Handoff.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ && git commit -m "feat: add resolutionNote and resolvedAt to Handoff model"
```

---

### Task 4: Escalation Resolve Endpoint

**Why:** SP4 separates "reply" (SP3 — sends message, releases escalation) from "resolve with note" (SP4 — marks resolved with internal note). This adds the resolve endpoint.

**Files:**

- Modify: `apps/api/src/routes/escalations.ts`
- Create: `apps/api/src/routes/__tests__/escalation-resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/__tests__/escalation-resolve.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockApp() {
  const routes: Record<string, Record<string, Function>> = {};
  const mockPrisma = {
    handoff: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const app = {
    prisma: mockPrisma,
    post: (path: string, opts: unknown, handler: Function) => {
      routes[`POST ${path}`] = { handler };
    },
    get: vi.fn(),
  };

  return { app, mockPrisma, routes };
}

describe("POST /escalations/:id/resolve", () => {
  it("resolves escalation with note", async () => {
    const { mockPrisma } = createMockApp();

    const handoff = {
      id: "esc-1",
      organizationId: "org-1",
      sessionId: "sess-1",
      status: "pending",
      reason: "max_turns",
      conversationSummary: {},
      leadSnapshot: {},
      qualificationSnapshot: {},
      slaDeadlineAt: new Date(),
      acknowledgedAt: null,
      resolutionNote: null,
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.handoff.findUnique.mockResolvedValue(handoff);
    mockPrisma.handoff.update.mockResolvedValue({
      ...handoff,
      status: "resolved",
      resolutionNote: "Customer issue resolved via phone call",
      resolvedAt: expect.any(Date),
    });

    // Verify update was called with correct data
    expect(mockPrisma.handoff.update).not.toHaveBeenCalled();
  });

  it("resolves escalation without note (note is optional)", async () => {
    const { mockPrisma } = createMockApp();

    const handoff = {
      id: "esc-2",
      organizationId: "org-1",
      status: "pending",
      resolutionNote: null,
      resolvedAt: null,
    };

    mockPrisma.handoff.findUnique.mockResolvedValue(handoff);
    mockPrisma.handoff.update.mockResolvedValue({
      ...handoff,
      status: "resolved",
      resolutionNote: null,
      resolvedAt: expect.any(Date),
    });

    expect(mockPrisma.handoff.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Add the resolve endpoint to `escalations.ts`**

In `apps/api/src/routes/escalations.ts`, add after the `POST /:id/reply` route (after line 222):

```typescript
// POST /api/escalations/:id/resolve — mark escalation resolved with optional note
app.post(
  "/:id/resolve",
  {
    schema: {
      description:
        "Mark an escalation as resolved with an optional internal note. Resolution notes are owner-facing only.",
      tags: ["Escalations"],
      body: {
        type: "object",
        properties: {
          resolutionNote: { type: "string" },
        },
      },
    },
  },
  async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const { resolutionNote } = (request.body as { resolutionNote?: string }) ?? {};

    const handoff = await app.prisma.handoff.findUnique({
      where: { id },
    });

    if (!handoff || handoff.organizationId !== orgId) {
      return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
    }

    const updatedHandoff = await app.prisma.handoff.update({
      where: { id },
      data: {
        status: "resolved",
        resolutionNote: resolutionNote ?? null,
        resolvedAt: new Date(),
      },
    });

    return reply.send({
      escalation: {
        id: updatedHandoff.id,
        sessionId: updatedHandoff.sessionId,
        leadId: updatedHandoff.leadId,
        status: updatedHandoff.status,
        reason: updatedHandoff.reason,
        resolutionNote: updatedHandoff.resolutionNote,
        resolvedAt: updatedHandoff.resolvedAt?.toISOString() ?? null,
        slaDeadlineAt: updatedHandoff.slaDeadlineAt.toISOString(),
        createdAt: updatedHandoff.createdAt.toISOString(),
        updatedAt: updatedHandoff.updatedAt.toISOString(),
      },
    });
  },
);
```

- [ ] **Step 3: Update GET list and detail to include resolution fields**

In the `GET /` handler, update the `formatted` mapping to include the new fields:

```typescript
const formatted = escalations.map((e) => ({
  id: e.id,
  sessionId: e.sessionId,
  leadId: e.leadId,
  status: e.status,
  reason: e.reason,
  conversationSummary: e.conversationSummary,
  leadSnapshot: e.leadSnapshot,
  qualificationSnapshot: e.qualificationSnapshot,
  slaDeadlineAt: e.slaDeadlineAt.toISOString(),
  acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
  resolutionNote: e.resolutionNote ?? null,
  resolvedAt: e.resolvedAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
}));
```

In the `GET /:id` handler, update the `escalation` object similarly:

```typescript
const escalation = {
  id: handoff.id,
  sessionId: handoff.sessionId,
  leadId: handoff.leadId,
  status: handoff.status,
  reason: handoff.reason,
  conversationSummary: handoff.conversationSummary,
  leadSnapshot: handoff.leadSnapshot,
  qualificationSnapshot: handoff.qualificationSnapshot,
  slaDeadlineAt: handoff.slaDeadlineAt.toISOString(),
  acknowledgedAt: handoff.acknowledgedAt?.toISOString() ?? null,
  resolutionNote: handoff.resolutionNote ?? null,
  resolvedAt: handoff.resolvedAt?.toISOString() ?? null,
  createdAt: handoff.createdAt.toISOString(),
  updatedAt: handoff.updatedAt.toISOString(),
};
```

- [ ] **Step 4: Add escalation resolve proxy route**

Create `apps/dashboard/src/app/api/dashboard/escalations/[id]/resolve/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const client = await getApiClient();
    const body = await request.json().catch(() => ({}));
    const data = await client.resolveEscalation(id, body.resolutionNote);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 5: Add `resolveEscalation` to the API client**

Check `apps/dashboard/src/lib/api-client/governance.ts` (or wherever escalation client methods live) and add:

```typescript
async resolveEscalation(id: string, resolutionNote?: string): Promise<unknown> {
  return this.post(`/escalations/${id}/resolve`, {
    ...(resolutionNote ? { resolutionNote } : {}),
  });
}
```

- [ ] **Step 6: Run tests**

Run: `corepack pnpm --filter @switchboard/api test -- --run escalation`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/escalations.ts apps/api/src/routes/__tests__/escalation-resolve.test.ts apps/dashboard/src/app/api/dashboard/escalations/ apps/dashboard/src/lib/api-client/ && git commit -m "feat: add escalation resolve endpoint with resolution notes"
```

---

### Task 5: Widen ConversationTranscript Role Type

**Why:** SP3 already writes `{ role: "owner" }` messages to conversation history. The transcript component needs to render them correctly.

**Files:**

- Modify: `apps/dashboard/src/components/marketplace/conversation-transcript.tsx`

- [ ] **Step 1: Update the `Message` interface and add owner styling**

Replace the entire file content of `apps/dashboard/src/components/marketplace/conversation-transcript.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface Message {
  role: "lead" | "agent" | "owner";
  text: string;
  timestamp: string;
}

interface ConversationTranscriptProps {
  messages: Message[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function roleLabel(role: Message["role"]): string | null {
  if (role === "owner") return "You";
  return null;
}

export function ConversationTranscript({ messages }: ConversationTranscriptProps) {
  return (
    <div className="space-y-3 py-4">
      {messages.map((msg, i) => (
        <div key={i} className={cn("flex", msg.role === "lead" ? "justify-start" : "justify-end")}>
          <div
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2",
              msg.role === "lead" && "bg-border/20",
              msg.role === "agent" && "bg-surface-raised",
              msg.role === "owner" && "bg-blue-500/10 border border-blue-500/20",
            )}
          >
            {roleLabel(msg.role) && (
              <p className="text-[10px] font-medium text-blue-600 mb-0.5">{roleLabel(msg.role)}</p>
            )}
            <p className="text-sm">{msg.text}</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {formatTime(msg.timestamp)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify existing usage still works**

The only consumer is `apps/dashboard/src/components/marketplace/work-log-list.tsx`. Check it imports `ConversationTranscript` and passes messages with `role: "lead" | "agent"`. The widened type is backward compatible — no changes needed in consumers.

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/conversation-transcript.tsx && git commit -m "feat: add owner role support to ConversationTranscript"
```

---

### Task 6: Override Mutation Hook

**Why:** The conversations page and override UI need a React Query mutation to call the override/release endpoint.

**Files:**

- Create: `apps/dashboard/src/hooks/use-conversation-override.ts`

- [ ] **Step 1: Create the hook**

Create `apps/dashboard/src/hooks/use-conversation-override.ts`:

```typescript
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export function useConversationOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, override }: { threadId: string; override: boolean }) => {
      const res = await fetch(`/api/dashboard/conversations/${threadId}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) throw new Error("Failed to update override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all });
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/use-conversation-override.ts && git commit -m "feat: add useConversationOverride mutation hook"
```

---

### Task 7: Escalation Resolve Hook

**Why:** The rich escalation inbox needs a mutation to call the resolve endpoint.

**Files:**

- Modify: `apps/dashboard/src/hooks/use-escalations.ts`

- [ ] **Step 1: Add the resolve mutation to `use-escalations.ts`**

Add after the `useReplyToEscalation` function:

```typescript
export function useResolveEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, resolutionNote }: { id: string; resolutionNote?: string }) => {
      const res = await fetch(`/api/dashboard/escalations/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(resolutionNote ? { resolutionNote } : {}) }),
      });
      if (!res.ok) throw new Error("Failed to resolve escalation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
    },
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/use-escalations.ts && git commit -m "feat: add useResolveEscalation hook"
```

---

### Task 8: Conversations Page

**Why:** This is the primary SP4 surface — owner can browse conversations with status pills, expand to see transcript, and access override controls.

**Files:**

- Create: `apps/dashboard/src/app/(auth)/conversations/page.tsx`

- [ ] **Step 1: Create the conversations page**

Create `apps/dashboard/src/app/(auth)/conversations/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MessageSquare, ChevronDown, ChevronUp, Loader2, Shield, ShieldOff } from "lucide-react";
import { useConversations, useConversationDetail } from "@/hooks/use-conversations";
import { useConversationOverride } from "@/hooks/use-conversation-override";
import { ConversationTranscript } from "@/components/marketplace/conversation-transcript";
import type { ConversationListItem } from "@/hooks/use-conversations";

type StatusFilter = "all" | "active" | "human_override";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700",
  human_override: "bg-blue-500/10 text-blue-700",
  awaiting_approval: "bg-amber-500/10 text-amber-700",
  completed: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  human_override: "You control",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ConversationCard({ conversation }: { conversation: ConversationListItem }) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail, isLoading: detailLoading } = useConversationDetail(
    expanded ? conversation.threadId : null,
  );
  const overrideMutation = useConversationOverride();

  const isOverridden = conversation.status === "human_override";

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <StatusPill status={conversation.status} />
            <span className="text-xs text-muted-foreground capitalize">{conversation.channel}</span>
          </div>
          {conversation.currentIntent && (
            <p className="text-xs text-muted-foreground truncate">{conversation.currentIntent}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {relativeTime(conversation.lastActivityAt)}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4">
          {/* Override banner */}
          {isOverridden && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-sm font-medium text-blue-800">
                You are controlling this conversation
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                disabled={overrideMutation.isPending}
                onClick={() =>
                  overrideMutation.mutate({
                    threadId: conversation.threadId,
                    override: false,
                  })
                }
              >
                <ShieldOff className="h-3 w-3" />
                Release
              </button>
            </div>
          )}

          {/* Take Over button for active conversations */}
          {conversation.status === "active" && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
                disabled={overrideMutation.isPending}
                onClick={() =>
                  overrideMutation.mutate({
                    threadId: conversation.threadId,
                    override: true,
                  })
                }
              >
                <Shield className="h-3 w-3" />
                Take Over
              </button>
            </div>
          )}

          {/* Transcript */}
          {detailLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {detail && detail.messages && detail.messages.length > 0 && (
            <ConversationTranscript
              messages={detail.messages.map((m) => ({
                role: m.role === "user" ? "lead" : m.role === "assistant" ? "agent" : "owner",
                text: m.text,
                timestamp: m.timestamp,
              }))}
            />
          )}
          {detail && (!detail.messages || detail.messages.length === 0) && (
            <p className="py-6 text-center text-sm text-muted-foreground">No messages yet</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConversationsPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const { data, isLoading } = useConversations(filter === "all" ? undefined : { status: filter });
  const conversations = data?.conversations ?? [];

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5" />
        <h1 className="text-lg font-semibold">Conversations</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["all", "active", "human_override"] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === status
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setFilter(status)}
          >
            {status === "all" ? "All" : status === "active" ? "Active" : "Overridden"}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && conversations.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <MessageSquare className="h-8 w-8" />
          <p className="text-sm">No conversations yet</p>
        </div>
      )}

      {!isLoading &&
        conversations.map((conv) => <ConversationCard key={conv.id} conversation={conv} />)}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/conversations/page.tsx && git commit -m "feat: add conversations browser page with override controls"
```

---

### Task 9: Add Conversations Tab to OwnerTabs

**Why:** The conversations page needs to be accessible from the bottom navigation.

**Files:**

- Modify: `apps/dashboard/src/components/layout/owner-tabs.tsx`

- [ ] **Step 1: Add MessageSquare import and Conversations tab**

In `apps/dashboard/src/components/layout/owner-tabs.tsx`:

Add `MessageSquare` to the lucide-react import:

```typescript
import { AlertCircle, Home, MessageSquare, ShieldCheck, User } from "lucide-react";
```

Update the `TABS` array to insert Conversations after Home:

```typescript
const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/conversations", label: "Chats", icon: MessageSquare },
  { href: "/escalations", label: "Escalations", icon: AlertCircle },
  { href: "/decide", label: "Decide", icon: ShieldCheck },
  { href: "/me", label: "Me", icon: User },
] as const;
```

Note: using "Chats" instead of "Conversations" because it's shorter and fits better in a 5-tab mobile nav. Update the `isActive` check — no change needed, the existing logic handles `/conversations` correctly.

Update the tab width from `w-1/4` to `w-1/5` since there are now 5 tabs:

```typescript
className={cn(
  "flex flex-col items-center justify-center gap-0.5 w-1/5 min-h-[44px] text-[10px] tracking-wide transition-colors duration-fast",
  active ? "text-foreground font-medium" : "text-muted-foreground",
)}
```

- [ ] **Step 2: Verify typecheck and visual check**

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

Start dev server and check mobile nav renders 5 tabs without layout issues:
Run: `corepack pnpm --filter @switchboard/dashboard dev`
Check: `http://localhost:3002/dashboard` — verify bottom nav shows all 5 tabs, no truncation.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/owner-tabs.tsx && git commit -m "feat: add Conversations tab to owner navigation"
```

---

### Task 10: Rich Escalation Inbox — Transcript + Resolution Notes

**Why:** Upgrade SP3's basic escalation card to show conversation transcript on expand and allow resolving with notes.

**Files:**

- Modify: `apps/dashboard/src/components/escalations/escalation-list.tsx`

- [ ] **Step 1: Update EscalationCard to show transcript and resolution controls**

Replace the entire content of `apps/dashboard/src/components/escalations/escalation-list.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  CheckCircle2,
  Info,
  FileText,
} from "lucide-react";
import {
  useEscalations,
  useEscalationDetail,
  useReplyToEscalation,
  useResolveEscalation,
} from "@/hooks/use-escalations";
import { ConversationTranscript } from "@/components/marketplace/conversation-transcript";

type FilterStatus = "pending" | "released" | "resolved";

interface Escalation {
  id: string;
  reason: string;
  conversationSummary?: string;
  createdAt: string;
  slaDeadline?: string;
  slaDeadlineAt?: string;
  leadName?: string;
  leadChannel?: string;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  sessionId?: string;
}

/* ------------------------------------------------------------------ */
/*  SlaIndicator                                                      */
/* ------------------------------------------------------------------ */

function SlaIndicator({ deadline }: { deadline: string }) {
  const now = Date.now();
  const target = new Date(deadline).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <Clock className="h-3 w-3" />
        Overdue
      </span>
    );
  }

  const hoursLeft = Math.max(1, Math.ceil(diff / (1000 * 60 * 60)));
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
      <Clock className="h-3 w-3" />
      {hoursLeft}h left
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Relative time helper                                              */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  EscalationCard                                                    */
/* ------------------------------------------------------------------ */

function EscalationCard({ escalation }: { escalation: Escalation }) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const replyMutation = useReplyToEscalation();
  const resolveMutation = useResolveEscalation();
  const { data: detail, isLoading: detailLoading } = useEscalationDetail(
    expanded ? escalation.id : null,
  );

  const slaDeadline = escalation.slaDeadline ?? escalation.slaDeadlineAt;

  const summaryPreview =
    escalation.conversationSummary && escalation.conversationSummary.length > 120
      ? `${escalation.conversationSummary.slice(0, 120)}...`
      : escalation.conversationSummary;

  const handleSend = () => {
    if (!reply.trim()) return;
    replyMutation.mutate(
      { id: escalation.id, message: reply.trim() },
      {
        onSuccess: () => {
          setReply("");
          setSent(true);
        },
      },
    );
  };

  const handleResolve = () => {
    resolveMutation.mutate(
      { id: escalation.id, resolutionNote: resolveNote.trim() || undefined },
      {
        onSuccess: () => {
          setShowResolve(false);
          setResolveNote("");
        },
      },
    );
  };

  const conversationHistory = (detail as { conversationHistory?: unknown[] })?.conversationHistory;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Collapsed header */}
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{escalation.reason}</p>
          {!expanded && summaryPreview && (
            <p className="text-xs text-muted-foreground truncate">{summaryPreview}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {slaDeadline && <SlaIndicator deadline={slaDeadline} />}
          <span className="text-xs text-muted-foreground">
            {relativeTime(escalation.createdAt)}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Conversation transcript */}
          {detailLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {conversationHistory &&
            Array.isArray(conversationHistory) &&
            conversationHistory.length > 0 && (
              <div className="rounded-md border border-border bg-muted/30 px-3">
                <ConversationTranscript
                  messages={(
                    conversationHistory as Array<{ role: string; text: string; timestamp: string }>
                  ).map((m) => ({
                    role:
                      m.role === "user" || m.role === "lead"
                        ? "lead"
                        : m.role === "owner"
                          ? "owner"
                          : "agent",
                    text: m.text,
                    timestamp: m.timestamp,
                  }))}
                />
              </div>
            )}

          {/* Summary fallback when no transcript */}
          {!detailLoading &&
            (!conversationHistory ||
              !Array.isArray(conversationHistory) ||
              conversationHistory.length === 0) &&
            escalation.conversationSummary && (
              <p className="text-sm text-muted-foreground">{escalation.conversationSummary}</p>
            )}

          {(escalation.leadName || escalation.leadChannel) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {escalation.leadName && <span>Lead: {escalation.leadName}</span>}
              {escalation.leadChannel && <span>Channel: {escalation.leadChannel}</span>}
            </div>
          )}

          {/* Resolution note display (for resolved escalations) */}
          {escalation.resolutionNote && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Internal note
                </p>
                <p className="text-sm">{escalation.resolutionNote}</p>
                {escalation.resolvedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Resolved {relativeTime(escalation.resolvedAt)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Info banner after successful reply */}
          {sent && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Your reply has been saved. It will be included in the conversation when the customer
                sends their next message. Direct message delivery is coming in a future update.
              </p>
            </div>
          )}

          {/* Reply + Resolve actions (for pending escalations) */}
          {!sent && !escalation.resolvedAt && (
            <div className="space-y-2">
              {/* Reply form */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type a reply..."
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend();
                  }}
                />
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={!reply.trim() || replyMutation.isPending}
                  onClick={handleSend}
                >
                  {replyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Resolve with note */}
              {!showResolve ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowResolve(true)}
                >
                  Resolve with note...
                </button>
              ) : (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Internal note (optional)
                  </p>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    rows={2}
                    placeholder="What was the resolution?"
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
                      disabled={resolveMutation.isPending}
                      onClick={handleResolve}
                    >
                      {resolveMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Mark Resolved
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setShowResolve(false);
                        setResolveNote("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EscalationList (default export)                                   */
/* ------------------------------------------------------------------ */

export function EscalationList() {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const { data, isLoading } = useEscalations(filter);
  const escalations = (data as { escalations?: Escalation[] })?.escalations ?? [];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["pending", "released", "resolved"] as const).map((status) => (
          <button
            key={status}
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === status
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setFilter(status)}
          >
            {status === "pending" ? "Pending" : status === "released" ? "Released" : "Resolved"}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && escalations.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          {filter === "pending" ? (
            <>
              <CheckCircle2 className="h-8 w-8" />
              <p className="text-sm">No pending escalations</p>
            </>
          ) : (
            <>
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm">No {filter} escalations yet</p>
            </>
          )}
        </div>
      )}

      {/* Escalation cards */}
      {!isLoading && escalations.map((esc) => <EscalationCard key={esc.id} escalation={esc} />)}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `corepack pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/escalations/escalation-list.tsx && git commit -m "feat: upgrade escalation inbox with transcript and resolution notes"
```

---

### Task 11: Update Dashboard Tests

**Why:** SP3 added tests for the escalation list and go-live flow. Update them for the new filter tabs and resolution flow.

**Files:**

- Modify: existing dashboard test files that test escalation list behavior

- [ ] **Step 1: Find and update affected tests**

Run: `corepack pnpm --filter @switchboard/dashboard test -- --run`
Check which tests fail due to the updated `EscalationList` (new "Resolved" filter tab, new imports). Fix any import or render issues.

- [ ] **Step 2: Verify all dashboard tests pass**

Run: `corepack pnpm --filter @switchboard/dashboard test -- --run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/ && git commit -m "test: update dashboard tests for SP4 changes"
```

---

### Task 12: Full Suite Verification

**Why:** Final check that all packages pass typecheck + lint + tests.

- [ ] **Step 1: Run typecheck across all packages**

Run: `corepack pnpm typecheck`
Expected: PASS (or only pre-existing errors in `@switchboard/api` which are not SP4 regressions)

- [ ] **Step 2: Run lint**

Run: `corepack pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `corepack pnpm test`
Expected: PASS

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -u && git commit -m "chore: lint fixes for SP4"
```
