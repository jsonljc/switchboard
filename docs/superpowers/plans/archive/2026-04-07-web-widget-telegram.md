# Web Widget + Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable marketplace-deployed agents to reach customers via an embeddable web widget and Telegram bots, both routing through a shared `ChannelGateway` bridge.

**Architecture:** A `ChannelGateway` in `packages/core/` receives normalized `IncomingChannelMessage` objects, resolves the deployment via token lookup, constructs an ephemeral `AgentRuntime`, and routes replies through a `ReplySink` callback. The web widget is a self-contained JS bundle that communicates via HTTP POST (send) + SSE (receive). Telegram reuses the existing `TelegramAdapter` with a new gateway routing path in `RuntimeRegistry`.

**Tech Stack:** TypeScript, Fastify (chat app), Next.js (dashboard), Prisma, Zod, SSE (Server-Sent Events), Telegram Bot API, AES-256-GCM credential encryption.

**Spec:** `docs/superpowers/specs/2026-04-07-web-widget-telegram-design.md`

---

## File Map

### New Files

| File                                                                                 | Responsibility                                                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/channel-gateway/types.ts`                                         | All gateway interfaces (`ChannelGatewayConfig`, `DeploymentLookup`, `DeploymentInfo`, `IncomingChannelMessage`, `ReplySink`, `GatewayConversationStore`) |
| `packages/core/src/channel-gateway/channel-gateway.ts`                               | `ChannelGateway` class — the bridge between channel endpoints and `AgentRuntime`                                                                         |
| `packages/core/src/channel-gateway/index.ts`                                         | Barrel exports                                                                                                                                           |
| `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`                | Gateway unit tests                                                                                                                                       |
| `apps/chat/src/gateway/deployment-lookup.ts`                                         | `PrismaDeploymentLookup` — resolves deployment from channel token via `DeploymentConnection` + `AgentDeployment` + `AgentPersona`                        |
| `apps/chat/src/gateway/gateway-conversation-store.ts`                                | `PrismaGatewayConversationStore` — persists conversations in `ConversationThread` using `agentContext` JSON for deploymentId/sessionId/channel           |
| `apps/chat/src/gateway/gateway-bridge.ts`                                            | `createGatewayBridge()` — factory assembling a `ChannelGateway` with Prisma-backed stores                                                                |
| `apps/chat/src/gateway/__tests__/deployment-lookup.test.ts`                          | Deployment lookup unit tests                                                                                                                             |
| `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`                 | Conversation store unit tests                                                                                                                            |
| `apps/chat/src/endpoints/widget-messages.ts`                                         | `POST /widget/:token/messages` — Fastify route handler                                                                                                   |
| `apps/chat/src/endpoints/widget-events.ts`                                           | `GET /widget/:token/events` — SSE endpoint, in-memory session map                                                                                        |
| `apps/chat/src/endpoints/widget-sse-manager.ts`                                      | `SseSessionManager` — in-memory `Map<sessionId, Reply>` for SSE push                                                                                     |
| `apps/dashboard/public/widget.js`                                                    | Self-contained embed script + iframe chat UI                                                                                                             |
| `apps/dashboard/src/components/marketplace/channels-section.tsx`                     | Channel cards (web widget + telegram) on deployment page                                                                                                 |
| `apps/dashboard/src/components/marketplace/widget-setup-modal.tsx`                   | Widget setup modal — generates token, shows embed snippet                                                                                                |
| `apps/dashboard/src/components/marketplace/telegram-setup-modal.tsx`                 | Telegram setup modal — BotFather instructions + token validation                                                                                         |
| `apps/dashboard/src/app/api/dashboard/marketplace/connections/widget-token/route.ts` | Dashboard proxy: POST generates widget token, creates `DeploymentConnection`                                                                             |
| `apps/dashboard/src/app/api/dashboard/marketplace/connections/telegram/route.ts`     | Dashboard proxy: POST validates Telegram bot token, creates connection, registers webhook                                                                |
| `apps/dashboard/src/app/api/dashboard/marketplace/connections/[id]/route.ts`         | Dashboard proxy: DELETE disconnects a channel                                                                                                            |
| `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`                            | Deployment detail page (server component)                                                                                                                |
| `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`        | Deployment detail client component                                                                                                                       |

### Modified Files

| File                                         | Change                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/chat.ts:3-11`          | Add `"web_widget"` to `ChannelSchema` enum                                                                  |
| `packages/core/src/conversation-store.ts:13` | Add `"web_widget"` to `Message.channel` union                                                               |
| `packages/core/src/index.ts`                 | Add `export * from "./channel-gateway/index.js"`                                                            |
| `apps/chat/src/main.ts`                      | Register widget endpoints, load `DeploymentConnection` gateway entries in registry                          |
| `apps/chat/src/managed/runtime-registry.ts`  | Add `GatewayEntry` type + methods for gateway-based routing alongside legacy `ManagedRuntimeEntry`          |
| `apps/api/src/routes/marketplace.ts`         | Add deployment connections CRUD endpoints                                                                   |
| `apps/dashboard/src/lib/api-client.ts`       | Add `createWidgetToken()`, `connectTelegram()`, `disconnectChannel()`, `getDeploymentConnections()` methods |

---

## Tasks

### Task 1: Add `web_widget` to Channel Schema

**Files:**

- Modify: `packages/schemas/src/chat.ts:3-11`
- Modify: `packages/core/src/conversation-store.ts:13`

- [ ] **Step 1: Add `web_widget` to `ChannelSchema`**

In `packages/schemas/src/chat.ts`, add `"web_widget"` to the enum:

```ts
export const ChannelSchema = z.enum([
  "telegram",
  "slack",
  "whatsapp",
  "instagram",
  "messenger",
  "email",
  "api",
  "web_widget",
]);
```

- [ ] **Step 2: Add `web_widget` to `Message.channel` union**

In `packages/core/src/conversation-store.ts`, line 13:

```ts
channel: "whatsapp" | "telegram" | "dashboard" | "web_widget";
```

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas typecheck && npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS (no consumers break from adding a new enum variant)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(schemas): add web_widget to channel enum"
```

---

### Task 2: Channel Gateway Types

**Files:**

- Create: `packages/core/src/channel-gateway/types.ts`
- Create: `packages/core/src/channel-gateway/index.ts`

- [ ] **Step 1: Create gateway types file**

Create `packages/core/src/channel-gateway/types.ts` with all the interfaces from the spec:

```ts
import type { AgentPersona } from "@switchboard/sdk";
import type { AgentStateStoreInterface } from "../agent-runtime/state-provider.js";
import type { ActionRequestStore } from "../agent-runtime/action-request-pipeline.js";
import type { LLMAdapter } from "../llm-adapter.js";

export interface ChannelGatewayConfig {
  deploymentLookup: DeploymentLookup;
  conversationStore: GatewayConversationStore;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapterFactory: () => LLMAdapter;
}

export interface DeploymentLookup {
  findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null>;
}

export interface DeploymentInfo {
  deployment: { id: string; listingId: string };
  persona: AgentPersona;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
}

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
}

export interface IncomingChannelMessage {
  channel: string;
  token: string;
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string };
}

export interface ReplySink {
  send(text: string): Promise<void>;
  onToken?(chunk: string): void;
  onTyping?(): void;
}

export class UnknownChannelError extends Error {
  constructor(channel: string, token: string) {
    super(`No deployment found for channel=${channel} token=${token.slice(0, 6)}...`);
    this.name = "UnknownChannelError";
  }
}

export class InactiveDeploymentError extends Error {
  constructor(deploymentId: string) {
    super(`Deployment ${deploymentId} is not active`);
    this.name = "InactiveDeploymentError";
  }
}
```

- [ ] **Step 2: Create barrel export (types only for now)**

Create `packages/core/src/channel-gateway/index.ts`. Export only types for now — the `ChannelGateway` class export is added in Task 3 after the implementation exists:

```ts
export type {
  ChannelGatewayConfig,
  DeploymentLookup,
  DeploymentInfo,
  GatewayConversationStore,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
export { UnknownChannelError, InactiveDeploymentError } from "./types.js";
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): add channel gateway type definitions"
```

---

### Task 3: Channel Gateway Implementation

**Files:**

- Create: `packages/core/src/channel-gateway/channel-gateway.ts`
- Create: `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/channel-gateway/__tests__/channel-gateway.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import { UnknownChannelError } from "../types.js";
import type {
  ChannelGatewayConfig,
  DeploymentInfo,
  IncomingChannelMessage,
  ReplySink,
  GatewayConversationStore,
} from "../types.js";

function createMockConfig(overrides: Partial<ChannelGatewayConfig> = {}): ChannelGatewayConfig {
  return {
    deploymentLookup: {
      findByChannelToken: vi.fn().mockResolvedValue(null),
    },
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    stateStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    actionRequestStore: {
      create: vi.fn().mockResolvedValue({ id: "ar-1", status: "executed" }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    },
    llmAdapterFactory: vi.fn().mockReturnValue({
      generateReply: vi.fn().mockResolvedValue({
        reply: "Hello from agent",
        confidence: 0.9,
      }),
    }),
    ...overrides,
  };
}

function createDeploymentInfo(overrides: Partial<DeploymentInfo> = {}): DeploymentInfo {
  return {
    deployment: { id: "dep-1", listingId: "listing-1" },
    persona: {
      id: "persona-1",
      organizationId: "org-1",
      businessName: "Test Biz",
      businessType: "saas",
      productService: "widgets",
      valueProposition: "best widgets",
      tone: "professional" as const,
      qualificationCriteria: {},
      disqualificationCriteria: {},
      escalationRules: {},
      bookingLink: null,
      customInstructions: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    trustScore: 50,
    trustLevel: "guided",
    ...overrides,
  };
}

describe("ChannelGateway", () => {
  it("throws UnknownChannelError when deployment not found", async () => {
    const config = createMockConfig();
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_invalid",
      sessionId: "sess-1",
      text: "hi",
    };
    const replySink: ReplySink = { send: vi.fn() };

    await expect(gateway.handleIncoming(message, replySink)).rejects.toThrow(UnknownChannelError);
  });

  it("processes message and delivers reply via replySink", async () => {
    const depInfo = createDeploymentInfo();
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const addMessageSpy = vi.fn().mockResolvedValue(undefined);
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: addMessageSpy,
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid123",
      sessionId: "sess-1",
      text: "Hello",
    };
    const replySink: ReplySink = { send: sendSpy };

    await gateway.handleIncoming(message, replySink);

    // User message persisted
    expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "user", "Hello");
    // Reply delivered via sink
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
    // Reply persisted
    expect(addMessageSpy).toHaveBeenCalledWith("conv-1", "assistant", "Hello from agent");
  });

  it("calls onTyping before processing", async () => {
    const depInfo = createDeploymentInfo();
    const onTypingSpy = vi.fn();
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid123",
      sessionId: "sess-1",
      text: "Hello",
    };
    const replySink: ReplySink = {
      send: vi.fn().mockResolvedValue(undefined),
      onTyping: onTypingSpy,
    };

    await gateway.handleIncoming(message, replySink);

    expect(onTypingSpy).toHaveBeenCalled();
  });

  it("caps conversation history at 30 messages", async () => {
    const depInfo = createDeploymentInfo();
    const longHistory = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg-${i}`,
    }));
    const generateReply = vi.fn().mockResolvedValue({
      reply: "reply",
      confidence: 0.9,
    });
    const config = createMockConfig({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue(depInfo),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: longHistory,
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      llmAdapterFactory: () => ({ generateReply }),
    });
    const gateway = new ChannelGateway(config);
    const message: IncomingChannelMessage = {
      channel: "web_widget",
      token: "sw_valid",
      sessionId: "sess-1",
      text: "hi",
    };

    await gateway.handleIncoming(message, {
      send: vi.fn().mockResolvedValue(undefined),
    });

    // RuntimeLLMProvider transforms messages to ConversationPrompt.conversationHistory
    // with direction "inbound"/"outbound". Verify the LLM received capped history.
    const callArgs = generateReply.mock.calls[0][0];
    // conversationHistory should be <= 31 (30 capped + 1 new user message)
    expect(callArgs.conversationHistory.length).toBeLessThanOrEqual(31);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run channel-gateway`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the ChannelGateway implementation**

Create `packages/core/src/channel-gateway/channel-gateway.ts`:

```ts
import { AgentRuntime } from "../agent-runtime/agent-runtime.js";
import { DefaultChatHandler } from "../agent-runtime/default-chat-handler.js";
import type { ChannelGatewayConfig, IncomingChannelMessage, ReplySink } from "./types.js";
import { UnknownChannelError } from "./types.js";

const MAX_HISTORY_MESSAGES = 30;

export class ChannelGateway {
  constructor(private config: ChannelGatewayConfig) {}

  async handleIncoming(message: IncomingChannelMessage, replySink: ReplySink): Promise<void> {
    // 1. Resolve deployment
    const info = await this.config.deploymentLookup.findByChannelToken(
      message.channel,
      message.token,
    );
    if (!info) {
      throw new UnknownChannelError(message.channel, message.token);
    }

    // 2. Get or create conversation
    const { conversationId, messages: history } =
      await this.config.conversationStore.getOrCreateBySession(
        info.deployment.id,
        message.channel,
        message.sessionId,
      );

    // 3. Persist incoming message
    await this.config.conversationStore.addMessage(conversationId, "user", message.text);

    // 4. Signal typing
    replySink.onTyping?.();

    // 5. Cap history and add new message
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const allMessages = [...recentHistory, { role: "user", content: message.text }];

    // 6. Create ephemeral AgentRuntime
    const runtime = new AgentRuntime({
      handler: DefaultChatHandler,
      deploymentId: info.deployment.id,
      surface: message.channel,
      trustScore: info.trustScore,
      trustLevel: info.trustLevel,
      persona: info.persona,
      stateStore: this.config.stateStore,
      actionRequestStore: this.config.actionRequestStore,
      llmAdapter: this.config.llmAdapterFactory(),
      onChatExecute: async (reply: string) => {
        await replySink.send(reply);
        await this.config.conversationStore.addMessage(conversationId, "assistant", reply);
      },
    });

    // 7. Handle message
    await runtime.handleMessage({
      conversationId,
      messages: allMessages,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run channel-gateway`
Expected: PASS (4 tests)

- [ ] **Step 5: Update barrel export to include ChannelGateway class**

In `packages/core/src/channel-gateway/index.ts`, add the class export:

```ts
export { ChannelGateway } from "./channel-gateway.js";
export type {
  ChannelGatewayConfig,
  DeploymentLookup,
  DeploymentInfo,
  GatewayConversationStore,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
export { UnknownChannelError, InactiveDeploymentError } from "./types.js";
```

- [ ] **Step 6: Add core index export**

In `packages/core/src/index.ts`, add at the end:

```ts
// Channel Gateway (channel → AgentRuntime bridge)
export * from "./channel-gateway/index.js";
```

- [ ] **Step 7: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(core): implement ChannelGateway bridge"
```

---

### Task 4: Deployment Lookup (Prisma-backed)

**Files:**

- Create: `apps/chat/src/gateway/deployment-lookup.ts`
- Create: `apps/chat/src/gateway/__tests__/deployment-lookup.test.ts`

**Context:** `DeploymentConnection` stores encrypted credentials. The lookup must: query all active connections for the given type, decrypt each, match the token, then load the related `AgentDeployment` + `AgentPersona` + trust data. Results are cached 60s.

The existing `PrismaDeploymentConnectionStore` (at `packages/db/src/stores/prisma-deployment-connection-store.ts`) only has `listByDeployment`. We need to query by `type` across all deployments, so we'll use Prisma directly.

The `AgentDeployment` model (in Prisma schema) has a `listingId` field. The `AgentListing` model is the marketplace listing. The `AgentPersona` is stored in `AgentDeployment.inputConfig` as JSON (per Sub-project B deploy handler).

Trust score data: `TrustScoreRecord` in `packages/db/prisma/schema.prisma` stores per-listing trust. The `TrustScoreEngine` in `packages/core/src/marketplace/trust-score-engine.ts` computes the overall score.

- [ ] **Step 1: Write the failing tests**

Create `apps/chat/src/gateway/__tests__/deployment-lookup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeploymentLookup } from "../deployment-lookup.js";

// Mock the crypto module
vi.mock("@switchboard/db", () => ({
  decryptCredentials: vi.fn(),
}));

describe("PrismaDeploymentLookup", () => {
  const mockPrisma = {
    deploymentConnection: {
      findMany: vi.fn(),
    },
    agentDeployment: {
      findUnique: vi.fn(),
    },
    agentListing: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no matching connection found", async () => {
    mockPrisma.deploymentConnection.findMany.mockResolvedValue([]);
    const lookup = new PrismaDeploymentLookup(mockPrisma as never);

    const result = await lookup.findByChannelToken("web_widget", "sw_unknown");

    expect(result).toBeNull();
  });

  it("returns deployment info when token matches", async () => {
    const { decryptCredentials } = await import("@switchboard/db");
    (decryptCredentials as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "sw_match123",
    });

    mockPrisma.deploymentConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        deploymentId: "dep-1",
        type: "web_widget",
        credentials: "encrypted-data",
        status: "active",
      },
    ]);
    mockPrisma.agentDeployment.findUnique.mockResolvedValue({
      id: "dep-1",
      listingId: "listing-1",
      inputConfig: {
        businessName: "Test",
        businessType: "saas",
        productService: "widgets",
        valueProposition: "best",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
        bookingLink: null,
        customInstructions: null,
      },
      governanceSettings: { startingAutonomy: "supervised" },
      status: "active",
    });
    mockPrisma.agentListing.findUnique.mockResolvedValue({
      id: "listing-1",
      trustScore: 45,
    });

    const lookup = new PrismaDeploymentLookup(mockPrisma as never);
    const result = await lookup.findByChannelToken("web_widget", "sw_match123");

    expect(result).not.toBeNull();
    expect(result!.deployment.id).toBe("dep-1");
    expect(result!.persona.businessName).toBe("Test");
    expect(result!.trustScore).toBe(45);
  });

  it("caches results and avoids repeat DB queries", async () => {
    const { decryptCredentials } = await import("@switchboard/db");
    (decryptCredentials as ReturnType<typeof vi.fn>).mockReturnValue({
      token: "sw_cached",
    });

    mockPrisma.deploymentConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        deploymentId: "dep-1",
        type: "web_widget",
        credentials: "encrypted",
        status: "active",
      },
    ]);
    mockPrisma.agentDeployment.findUnique.mockResolvedValue({
      id: "dep-1",
      listingId: "listing-1",
      inputConfig: {
        businessName: "Test",
        businessType: "saas",
        productService: "widgets",
        valueProposition: "best",
        tone: "professional",
        qualificationCriteria: {},
        disqualificationCriteria: {},
        escalationRules: {},
        bookingLink: null,
        customInstructions: null,
      },
      governanceSettings: {},
      status: "active",
    });
    mockPrisma.agentListing.findUnique.mockResolvedValue({
      id: "listing-1",
      trustScore: 50,
    });

    const lookup = new PrismaDeploymentLookup(mockPrisma as never);

    await lookup.findByChannelToken("web_widget", "sw_cached");
    await lookup.findByChannelToken("web_widget", "sw_cached");

    // DB should only be queried once due to caching
    expect(mockPrisma.deploymentConnection.findMany).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run deployment-lookup`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement PrismaDeploymentLookup**

Create `apps/chat/src/gateway/deployment-lookup.ts`:

```ts
import type { PrismaClient } from "@switchboard/db";
import { decryptCredentials } from "@switchboard/db";
import type { DeploymentLookup, DeploymentInfo } from "@switchboard/core";
import type { AgentPersona } from "@switchboard/sdk";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  info: DeploymentInfo;
  expiresAt: number;
}

function trustLevelFromScore(score: number): "supervised" | "guided" | "autonomous" {
  if (score >= 55) return "autonomous";
  if (score >= 30) return "guided";
  return "supervised";
}

export class PrismaDeploymentLookup implements DeploymentLookup {
  private cache = new Map<string, CacheEntry>();

  constructor(private prisma: PrismaClient) {}

  async findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null> {
    const cacheKey = `${channel}:${token}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.info;
    }

    // Load all active connections for this channel type
    const connections = await this.prisma.deploymentConnection.findMany({
      where: { type: channel, status: "active" },
    });

    // Decrypt and find matching token
    let matchedDeploymentId: string | null = null;
    for (const conn of connections) {
      try {
        const creds = decryptCredentials(conn.credentials) as Record<string, unknown>;
        if (creds["token"] === token) {
          matchedDeploymentId = conn.deploymentId;
          break;
        }
      } catch {
        // Skip connections with decryption errors
        continue;
      }
    }

    if (!matchedDeploymentId) return null;

    // Load deployment + listing
    const deployment = await this.prisma.agentDeployment.findUnique({
      where: { id: matchedDeploymentId },
    });
    if (!deployment || deployment.status !== "active") return null;

    const listing = await this.prisma.agentListing.findUnique({
      where: { id: deployment.listingId },
    });

    const trustScore = (listing?.trustScore as number) ?? 0;
    const inputConfig = deployment.inputConfig as Record<string, unknown>;

    const persona: AgentPersona = {
      id: `persona-${deployment.id}`,
      organizationId: deployment.organizationId,
      businessName: (inputConfig["businessName"] as string) ?? "",
      businessType: (inputConfig["businessType"] as string) ?? "small_business",
      productService: (inputConfig["productService"] as string) ?? "",
      valueProposition: (inputConfig["valueProposition"] as string) ?? "",
      tone: (inputConfig["tone"] as "casual" | "professional" | "consultative") ?? "professional",
      qualificationCriteria:
        (inputConfig["qualificationCriteria"] as Record<string, unknown>) ?? {},
      disqualificationCriteria:
        (inputConfig["disqualificationCriteria"] as Record<string, unknown>) ?? {},
      escalationRules: (inputConfig["escalationRules"] as Record<string, unknown>) ?? {},
      bookingLink: (inputConfig["bookingLink"] as string) ?? null,
      customInstructions: (inputConfig["customInstructions"] as string) ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const info: DeploymentInfo = {
      deployment: { id: deployment.id, listingId: deployment.listingId },
      persona,
      trustScore,
      trustLevel: trustLevelFromScore(trustScore),
    };

    this.cache.set(cacheKey, {
      info,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return info;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run deployment-lookup`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(chat): add PrismaDeploymentLookup for channel token resolution"
```

---

### Task 5: Gateway Conversation Store (Prisma-backed)

**Files:**

- Create: `apps/chat/src/gateway/gateway-conversation-store.ts`
- Create: `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`

**Context:** The `ConversationThread` model has an `agentContext Json @default("{}")` field. We store `{ deploymentId, sessionId, channel }` there. Messages are stored in `ConversationMessage` model (check schema). The `contactId` field is required — for widget visitors, use `visitor-{sessionId}` as a synthetic contact ID.

- [ ] **Step 1: Write the failing tests**

The `ConversationMessage` model uses `contactId` + `orgId` as keys (NOT a foreign key to `ConversationThread`). Messages are stored with `direction` ("inbound"/"outbound"), not `role` ("user"/"assistant"). The `PrismaGatewayConversationStore` must map between these representations.

Create `apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaGatewayConversationStore } from "../gateway-conversation-store.js";

describe("PrismaGatewayConversationStore", () => {
  const mockPrisma = {
    conversationThread: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversationMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates new conversation when none exists", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue(null);
    mockPrisma.conversationThread.create.mockResolvedValue({
      id: "new-conv",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([]);

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    const result = await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");

    expect(result.conversationId).toBe("new-conv");
    expect(result.messages).toEqual([]);
    expect(mockPrisma.conversationThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "visitor-sess-1",
          organizationId: "gateway",
          agentContext: { deploymentId: "dep-1", sessionId: "sess-1", channel: "web_widget" },
        }),
      }),
    );
  });

  it("returns existing conversation with message history", async () => {
    mockPrisma.conversationThread.findFirst.mockResolvedValue({
      id: "existing-conv",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    // ConversationMessage uses direction, not role
    mockPrisma.conversationMessage.findMany.mockResolvedValue([
      { id: "m1", direction: "inbound", content: "hello", contactId: "visitor-sess-1" },
      { id: "m2", direction: "outbound", content: "hi there", contactId: "visitor-sess-1" },
    ]);

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    const result = await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");

    expect(result.conversationId).toBe("existing-conv");
    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("adds message to conversation", async () => {
    // Store needs to know the contactId for the thread
    mockPrisma.conversationThread.findFirst.mockResolvedValue({
      id: "conv-1",
      contactId: "visitor-sess-1",
      organizationId: "gateway",
    });
    mockPrisma.conversationMessage.findMany.mockResolvedValue([]);
    mockPrisma.conversationMessage.create.mockResolvedValue({ id: "m3" });
    mockPrisma.conversationThread.update.mockResolvedValue({});

    const store = new PrismaGatewayConversationStore(mockPrisma as never);
    // First call getOrCreateBySession to populate internal contactId mapping
    await store.getOrCreateBySession("dep-1", "web_widget", "sess-1");
    await store.addMessage("conv-1", "user", "test message");

    expect(mockPrisma.conversationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactId: "visitor-sess-1",
          orgId: "gateway",
          direction: "inbound",
          content: "test message",
          channel: "web_widget",
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Implement PrismaGatewayConversationStore**

Create `apps/chat/src/gateway/gateway-conversation-store.ts`:

```ts
import type { PrismaClient } from "@switchboard/db";
import type { GatewayConversationStore } from "@switchboard/core";

interface ThreadInfo {
  contactId: string;
  organizationId: string;
  channel: string;
}

export class PrismaGatewayConversationStore implements GatewayConversationStore {
  // Cache thread info for addMessage calls
  private threadCache = new Map<string, ThreadInfo>();

  constructor(private prisma: PrismaClient) {}

  async getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> {
    const contactId = `visitor-${sessionId}`;
    const orgId = "gateway";

    // Query by agentContext JSON fields
    let thread = await this.prisma.conversationThread.findFirst({
      where: {
        agentContext: {
          path: ["deploymentId"],
          equals: deploymentId,
        },
        AND: [
          { agentContext: { path: ["sessionId"], equals: sessionId } },
          { agentContext: { path: ["channel"], equals: channel } },
        ],
      },
    });

    if (!thread) {
      thread = await this.prisma.conversationThread.create({
        data: {
          contactId,
          organizationId: orgId,
          agentContext: { deploymentId, sessionId, channel },
          followUpSchedule: {},
        },
      });
    }

    this.threadCache.set(thread.id, { contactId, organizationId: orgId, channel });

    // Load messages — ConversationMessage uses contactId+orgId, direction (not role)
    const rawMessages = await this.prisma.conversationMessage.findMany({
      where: { contactId, orgId },
      orderBy: { createdAt: "asc" },
    });

    const messages = rawMessages.map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content,
    }));

    return { conversationId: thread.id, messages };
  }

  async addMessage(conversationId: string, role: string, content: string): Promise<void> {
    const info = this.threadCache.get(conversationId);
    if (!info) {
      throw new Error(
        `Thread ${conversationId} not found in cache — call getOrCreateBySession first`,
      );
    }

    await this.prisma.conversationMessage.create({
      data: {
        contactId: info.contactId,
        orgId: info.organizationId,
        direction: role === "user" ? "inbound" : "outbound",
        content,
        channel: info.channel,
      },
    });

    await this.prisma.conversationThread.update({
      where: { id: conversationId },
      data: { messageCount: { increment: 1 } },
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run gateway-conversation`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(chat): add PrismaGatewayConversationStore for channel conversations"
```

---

### Task 6: Gateway Bridge Factory

**Files:**

- Create: `apps/chat/src/gateway/gateway-bridge.ts`

**Context:** This factory assembles a `ChannelGateway` with Prisma-backed stores. It's called once on startup by the chat app and shared across all gateway-routed requests.

- [ ] **Step 1: Create the gateway bridge factory**

Create `apps/chat/src/gateway/gateway-bridge.ts`:

```ts
import type { PrismaClient } from "@switchboard/db";
import { PrismaDeploymentStateStore, PrismaActionRequestStore } from "@switchboard/db";
import { ChannelGateway, createAnthropicAdapter } from "@switchboard/core";
import { PrismaDeploymentLookup } from "./deployment-lookup.js";
import { PrismaGatewayConversationStore } from "./gateway-conversation-store.js";

export function createGatewayBridge(prisma: PrismaClient): ChannelGateway {
  return new ChannelGateway({
    deploymentLookup: new PrismaDeploymentLookup(prisma),
    conversationStore: new PrismaGatewayConversationStore(prisma),
    stateStore: new PrismaDeploymentStateStore(prisma),
    actionRequestStore: new PrismaActionRequestStore(prisma),
    llmAdapterFactory: () => createAnthropicAdapter(),
  });
}
```

Note: `PrismaActionRequestStore` may need different constructor args — check `packages/db/src/stores/prisma-action-request-store.ts` and adapt. The key thing is that both stores implement the interfaces from `packages/core`.

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat typecheck`
Expected: PASS (ignoring pre-existing errors from missing CRM exports)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(chat): add gateway bridge factory"
```

---

### Task 7: SSE Session Manager

**Files:**

- Create: `apps/chat/src/endpoints/widget-sse-manager.ts`

- [ ] **Step 1: Create SseSessionManager**

Create `apps/chat/src/endpoints/widget-sse-manager.ts`:

```ts
import type { FastifyReply } from "fastify";

interface SseConnection {
  reply: FastifyReply;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export class SseSessionManager {
  private connections = new Map<string, SseConnection>();

  register(sessionId: string, reply: FastifyReply): void {
    // Close existing connection for this session
    this.remove(sessionId);

    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        this.remove(sessionId);
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.connections.set(sessionId, { reply, heartbeatTimer });

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);
  }

  sendTyping(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      conn.reply.raw.write(`event: typing\ndata: {}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  sendMessage(sessionId: string, role: string, content: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      const data = JSON.stringify({ role, content, id: crypto.randomUUID() });
      conn.reply.raw.write(`event: message\ndata: ${data}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  sendError(sessionId: string, error: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    try {
      conn.reply.raw.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
    } catch {
      this.remove(sessionId);
    }
  }

  remove(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn) {
      clearInterval(conn.heartbeatTimer);
      this.connections.delete(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  get size(): number {
    return this.connections.size;
  }
}
```

- [ ] **Step 2: Write tests**

Create `apps/chat/src/endpoints/__tests__/widget-sse-manager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SseSessionManager } from "../widget-sse-manager.js";

function createMockReply() {
  return {
    raw: {
      write: vi.fn().mockReturnValue(true),
    },
  };
}

describe("SseSessionManager", () => {
  let manager: SseSessionManager;

  beforeEach(() => {
    manager = new SseSessionManager();
    vi.useFakeTimers();
  });

  it("registers a session and sends connected event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);

    expect(manager.has("sess-1")).toBe(true);
    expect(manager.size).toBe(1);
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: connected"));
  });

  it("sends message event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    reply.raw.write.mockClear();

    manager.sendMessage("sess-1", "assistant", "Hello!");

    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: message"));
    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("Hello!"));
  });

  it("sends typing event", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    reply.raw.write.mockClear();

    manager.sendTyping("sess-1");

    expect(reply.raw.write).toHaveBeenCalledWith(expect.stringContaining("event: typing"));
  });

  it("removes session", () => {
    const reply = createMockReply();
    manager.register("sess-1", reply as never);
    manager.remove("sess-1");

    expect(manager.has("sess-1")).toBe(false);
    expect(manager.size).toBe(0);
  });

  it("replaces existing connection on re-register", () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    manager.register("sess-1", reply1 as never);
    manager.register("sess-1", reply2 as never);

    expect(manager.size).toBe(1);
    manager.sendMessage("sess-1", "assistant", "test");
    expect(reply2.raw.write).toHaveBeenCalled();
  });

  it("ignores sends to unknown sessions", () => {
    // Should not throw
    manager.sendMessage("unknown", "assistant", "test");
    manager.sendTyping("unknown");
    manager.sendError("unknown", "test");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run widget-sse-manager`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(chat): add SSE session manager for widget connections"
```

---

### Task 8: Widget HTTP Endpoints

**Files:**

- Create: `apps/chat/src/endpoints/widget-messages.ts`
- Create: `apps/chat/src/endpoints/widget-events.ts`
- Modify: `apps/chat/src/main.ts`

**Context:** These endpoints need CORS headers for cross-origin widget requests. The `POST /widget/:token/messages` receives a message and routes it through the `ChannelGateway`. The `GET /widget/:token/events` opens an SSE stream. Both use the `SseSessionManager` to connect sending and receiving.

- [ ] **Step 1: Create the messages endpoint**

Create `apps/chat/src/endpoints/widget-messages.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ChannelGateway, ReplySink } from "@switchboard/core";
import type { SseSessionManager } from "./widget-sse-manager.js";
import { checkIngressRateLimit } from "../adapters/security.js";

interface WidgetMessageBody {
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string };
}

export function registerWidgetMessagesEndpoint(
  app: FastifyInstance,
  gateway: ChannelGateway,
  sseManager: SseSessionManager,
): void {
  app.post<{ Params: { token: string }; Body: WidgetMessageBody }>(
    "/widget/:token/messages",
    async (request, reply) => {
      // CORS
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");

      const { token } = request.params;
      const { sessionId, text, visitor } = request.body ?? {};

      if (!sessionId || !text?.trim()) {
        return reply.code(400).send({ error: "sessionId and text are required" });
      }

      // Rate limit: 20 messages/minute per IP+session
      const rateLimitKey = `widget:${request.ip}:${sessionId}`;
      if (!(await checkIngressRateLimit(rateLimitKey, { windowMs: 60_000, maxRequests: 20 }))) {
        return reply.code(429).send({ error: "Rate limit exceeded" });
      }

      const messageId = crypto.randomUUID();

      // Build replySink wired to SSE
      const replySink: ReplySink = {
        send: async (replyText: string) => {
          sseManager.sendMessage(sessionId, "assistant", replyText);
        },
        onTyping: () => {
          sseManager.sendTyping(sessionId);
        },
      };

      // Fire-and-forget — reply is delivered via SSE, not in the HTTP response
      gateway
        .handleIncoming(
          { channel: "web_widget", token, sessionId, text: text.trim(), visitor },
          replySink,
        )
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : "Failed to process message";
          if (errMsg.includes("No deployment found")) {
            sseManager.sendError(sessionId, "Invalid widget token");
          } else {
            app.log.error(err, "Widget message error");
            sseManager.sendError(sessionId, "Failed to get response");
          }
        });

      return reply.code(200).send({ messageId });
    },
  );

  // CORS preflight
  app.options("/widget/:token/messages", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    return reply.code(204).send();
  });
}
```

- [ ] **Step 2: Create the SSE events endpoint**

Create `apps/chat/src/endpoints/widget-events.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { SseSessionManager } from "./widget-sse-manager.js";

export function registerWidgetEventsEndpoint(
  app: FastifyInstance,
  sseManager: SseSessionManager,
): void {
  app.get<{ Params: { token: string }; Querystring: { sessionId?: string } }>(
    "/widget/:token/events",
    async (request, reply) => {
      // CORS
      reply.header("Access-Control-Allow-Origin", "*");

      const { sessionId } = request.query;
      if (!sessionId) {
        return reply.code(400).send({ error: "sessionId query param is required" });
      }

      // Take over the response from Fastify — we're managing the stream manually
      reply.hijack();

      // SSE headers
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      sseManager.register(sessionId, reply);

      // Clean up on client disconnect
      request.raw.on("close", () => {
        sseManager.remove(sessionId);
      });
    },
  );
}
```

- [ ] **Step 3: Register endpoints in main.ts**

In `apps/chat/src/main.ts`, after the registry initialization block (around line 88), add:

```ts
import { SseSessionManager } from "./endpoints/widget-sse-manager.js";
import { registerWidgetMessagesEndpoint } from "./endpoints/widget-messages.js";
import { registerWidgetEventsEndpoint } from "./endpoints/widget-events.js";
import { createGatewayBridge } from "./gateway/gateway-bridge.js";
```

Add these imports at the top, then after the registry block add:

```ts
// --- Widget endpoints (gateway-based) ---
let sseManager: SseSessionManager | null = null;
if (process.env["DATABASE_URL"]) {
  try {
    const { getDb } = await import("@switchboard/db");
    const prisma = getDb();
    const gateway = createGatewayBridge(prisma);
    sseManager = new SseSessionManager();
    registerWidgetMessagesEndpoint(app, gateway, sseManager);
    registerWidgetEventsEndpoint(app, sseManager);
    app.log.info("Widget endpoints registered");
  } catch (err) {
    app.log.error(err, "Failed to initialize widget endpoints");
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat typecheck`
Expected: PASS (ignoring pre-existing errors)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(chat): add widget HTTP + SSE endpoints"
```

---

### Task 9: RuntimeRegistry Gateway Extension (Telegram)

**Files:**

- Modify: `apps/chat/src/managed/runtime-registry.ts`
- Modify: `apps/chat/src/main.ts`

**Context:** The `RuntimeRegistry` currently only loads `ManagedChannel` records and creates legacy `ChatRuntime` entries. We need to extend it to also load `DeploymentConnection` records (type `"telegram"`) and route them through the `ChannelGateway`. The routing is by data source: `ManagedChannel` → legacy, `DeploymentConnection` → gateway. Each webhook path is unique, so no ambiguity.

- [ ] **Step 1: Add gateway entry type and loading to RuntimeRegistry**

In `apps/chat/src/managed/runtime-registry.ts`, add a new entry type and loading method:

```ts
// Add import at top
import type { ChannelGateway, ReplySink } from "@switchboard/core";
import type { ChannelAdapter } from "../adapters/adapter.js";

// Add after ManagedRuntimeEntry interface (line 15)
interface GatewayEntry {
  gateway: ChannelGateway;
  adapter: ChannelAdapter;
  deploymentConnectionId: string;
  channel: string;
}
```

Add a second map `private gatewayEntries = new Map<string, GatewayEntry>()` to the class.

Add method `loadGatewayConnections(prisma, gateway)` that:

1. Queries `DeploymentConnection` where `type = "telegram"` and `status = "active"`
2. For each, decrypts credentials, creates a `TelegramAdapter`
3. Generates a webhook path: `/webhook/managed/${connectionId}` (shares the managed webhook namespace — distinguished by data source)
4. Also stores the decrypted `widgetToken` from credentials (if it's a widget connection) for the `IncomingChannelMessage.token` field
5. Stores a `GatewayEntry` in the `gatewayEntries` map
6. Logs count of loaded gateway entries

Add method `getGatewayByWebhookPath(path)` that returns from `gatewayEntries`.

Add method `provisionGatewayConnection(connection, prisma, gateway)` for hot-reload when a new Telegram connection is created.

- [ ] **Step 2: Update main.ts to load gateway connections and handle gateway webhooks**

In `apps/chat/src/main.ts`, after `registry.loadAll(prisma)`, add:

```ts
if (registry && gateway) {
  await registry.loadGatewayConnections(prisma, gateway);
}
```

Add a new webhook handler for gateway entries. In the managed webhook handler (`POST /webhook/managed/:webhookId`), add a check for gateway entries before the legacy path:

```ts
// Check gateway entries first
const gatewayEntry = registry.getGatewayByWebhookPath(webhookPath);
if (gatewayEntry) {
  // Verify webhook signature
  if (gatewayEntry.adapter.verifyRequest) {
    const rawBody = JSON.stringify(request.body);
    const headers = request.headers as Record<string, string | undefined>;
    if (!gatewayEntry.adapter.verifyRequest(rawBody, headers)) {
      return reply.code(401).send({ error: "Invalid signature" });
    }
  }

  // Parse incoming message via adapter
  const incoming = gatewayEntry.adapter.parseIncomingMessage(request.body);
  if (!incoming) {
    return reply.code(200).send({ ok: true });
  }

  // Route through gateway
  // Note: TelegramAdapter.sendTextReply already sends typing indicator internally
  const threadId = incoming.threadId ?? incoming.principalId;
  const replySink: ReplySink = {
    send: async (text) => gatewayEntry.adapter.sendTextReply(threadId, text),
    // onTyping omitted — TelegramAdapter handles typing within sendTextReply
  };

  // The gateway needs a token to look up the deployment. We use the
  // deploymentConnectionId which the DeploymentLookup must support as
  // an alternative lookup key for Telegram (the connection is already
  // resolved by the registry, but the gateway still needs DeploymentInfo).
  const channelMessage = {
    channel: "telegram",
    token: gatewayEntry.deploymentConnectionId,
    sessionId: threadId,
    text: incoming.text,
  };

  await gatewayEntry.gateway.handleIncoming(channelMessage, replySink);
  return reply.code(200).send({ ok: true });
}
```

**Important:** The `PrismaDeploymentLookup` (Task 4) currently only supports matching by decrypted `credentials.token`. For Telegram, the "token" passed is the `deploymentConnectionId`. Add an overload to `PrismaDeploymentLookup.findByChannelToken()` that, for `channel === "telegram"`, queries by `DeploymentConnection.id` directly instead of scanning all connections:

```ts
// In PrismaDeploymentLookup.findByChannelToken():
if (channel === "telegram") {
  // For Telegram, the token IS the connection ID (registry already resolved it)
  const conn = await this.prisma.deploymentConnection.findUnique({
    where: { id: token, status: "active" },
  });
  if (!conn) return null;
  matchedDeploymentId = conn.deploymentId;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(chat): extend RuntimeRegistry to route DeploymentConnections through gateway"
```

---

### Task 10: Marketplace API — Deployment Connection Endpoints

**Files:**

- Modify: `apps/api/src/routes/marketplace.ts`

**Context:** The dashboard needs API endpoints to:

1. Create a widget token (`POST /api/marketplace/deployments/:id/connections/widget`)
2. Connect Telegram (`POST /api/marketplace/deployments/:id/connections/telegram`)
3. List connections (`GET /api/marketplace/deployments/:id/connections`)
4. Disconnect (`DELETE /api/marketplace/deployments/:id/connections/:connectionId`)

These go in the existing marketplace routes file. Use the existing `PrismaDeploymentConnectionStore` + `encryptCredentials` from `@switchboard/db`.

- [ ] **Step 1: Add connection endpoints**

In `apps/api/src/routes/marketplace.ts`, add the following routes inside the existing plugin:

**Widget token generation:**

```ts
const WidgetTokenInput = z.object({
  deploymentId: z.string().min(1),
});

// POST /api/marketplace/deployments/:id/connections/widget
```

The handler should:

1. Validate the deployment exists and belongs to the user's org
2. Check no existing active `web_widget` connection exists
3. Generate token: `"sw_" + randomBytes(15).toString("base64url").slice(0, 20)`
4. Encrypt credentials: `encryptCredentials({ token })`
5. Create `DeploymentConnection` with `type: "web_widget"`, encrypted credentials
6. Return `{ connection: { id, type, token } }` — return the plaintext token only in this response

**Telegram connection:**

```ts
const TelegramConnectInput = z.object({
  deploymentId: z.string().min(1),
  botToken: z.string().min(1),
  webhookBaseUrl: z.string().url(),
});
```

The handler should:

1. Validate bot token by calling `https://api.telegram.org/bot${botToken}/getMe`
2. Generate webhook secret: `randomBytes(32).toString("hex")`
3. Generate webhook path: `/webhook/managed/${connectionId}`
4. Encrypt credentials: `encryptCredentials({ botToken, webhookSecret })`
5. Create `DeploymentConnection` with `type: "telegram"`
6. Register webhook via `https://api.telegram.org/bot${botToken}/setWebhook`
7. If webhook registration fails, delete the connection and return error
8. Hot-reload: POST to chat app's `/internal/provision-notify` if configured
9. Return `{ connection: { id, type, botUsername }, webhookPath }`

**List connections:**

```ts
// GET /api/marketplace/deployments/:id/connections
```

Return connections with type and status (NOT credentials).

**Disconnect:**

```ts
// DELETE /api/marketplace/deployments/:id/connections/:connectionId
```

Set status to "revoked". For Telegram, also call `deleteWebhook` API.

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(api): add deployment connection endpoints for widget and telegram"
```

---

### Task 11: Dashboard API Client Extensions

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`

- [ ] **Step 1: Add client methods**

In `apps/dashboard/src/lib/api-client.ts`, add after the existing marketplace methods:

```ts
  async createWidgetToken(deploymentId: string) {
    return this.request<{ connection: { id: string; type: string; token: string } }>(
      `/api/marketplace/deployments/${deploymentId}/connections/widget`,
      { method: "POST", body: JSON.stringify({ deploymentId }) },
    );
  }

  async connectTelegram(deploymentId: string, botToken: string, webhookBaseUrl: string) {
    return this.request<{ connection: { id: string; type: string; botUsername: string }; webhookPath: string }>(
      `/api/marketplace/deployments/${deploymentId}/connections/telegram`,
      { method: "POST", body: JSON.stringify({ deploymentId, botToken, webhookBaseUrl }) },
    );
  }

  async getDeploymentConnections(deploymentId: string) {
    return this.request<{ connections: Array<{ id: string; type: string; status: string; metadata?: Record<string, unknown> }> }>(
      `/api/marketplace/deployments/${deploymentId}/connections`,
    );
  }

  async disconnectChannel(deploymentId: string, connectionId: string) {
    return this.request<{ ok: boolean }>(
      `/api/marketplace/deployments/${deploymentId}/connections/${connectionId}`,
      { method: "DELETE" },
    );
  }
```

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add API client methods for deployment connections"
```

---

### Task 12: Dashboard Proxy Routes for Connections

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/connections/widget-token/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/connections/telegram/route.ts`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/connections/[id]/route.ts`

**Context:** Follow the existing dashboard proxy pattern — `getApiClient()` + typed method + `NextResponse.json()`. All require `requireSession()` for auth.

- [ ] **Step 1: Create widget token proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/connections/widget-token/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.createWidgetToken(body.deploymentId);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 2: Create Telegram connect proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/connections/telegram/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.connectTelegram(
      body.deploymentId,
      body.botToken,
      body.webhookBaseUrl,
    );
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 3: Create disconnect proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/connections/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const { id } = await params;
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId query param required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.disconnectChannel(deploymentId, id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Note: The disconnect route may need the `deploymentId` — either from a query param or by looking up the connection's deployment. Adapt based on how the API endpoint is structured.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(dashboard): add proxy routes for deployment connections"
```

---

### Task 13: Deployment Detail Page

**Files:**

- Create: `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`

**Context:** This page shows deployment details and a "Channels" section. The channels section has cards for web widget and Telegram, each with connect/disconnect actions. This page is linked from the dashboard after deploying an agent.

- [ ] **Step 1: Create server component**

Create `apps/dashboard/src/app/(auth)/deployments/[id]/page.tsx`:

```tsx
import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { DeploymentDetailClient } from "./deployment-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeploymentDetailPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);
    if (!deployment) notFound();

    const { connections } = await client.getDeploymentConnections(id);

    return (
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <h1 className="font-display text-2xl text-foreground">{deployment.listingId}</h1>
        <DeploymentDetailClient deploymentId={id} connections={connections} />
      </div>
    );
  } catch {
    notFound();
  }
}
```

- [ ] **Step 2: Create client component with channels section**

Create `apps/dashboard/src/app/(auth)/deployments/[id]/deployment-detail-client.tsx`. This component renders the channels section with two cards (web widget + telegram). Each card shows:

- Connected state: status badge + relevant info (embed snippet for widget, @bot_username for telegram) + disconnect button
- Disconnected state: "Add to your website" / "Connect Telegram" button

Wire the buttons to open the setup modals (Task 14-15).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add deployment detail page with channels section"
```

---

### Task 14: Widget Setup Modal

**Files:**

- Create: `apps/dashboard/src/components/marketplace/widget-setup-modal.tsx`

**Context:** When the user clicks "Add to your website", this modal:

1. Calls the widget-token proxy route to generate a token
2. Shows the embed snippet (copyable)
3. "Done" closes the modal

Use existing UI components: `Button`, `Input` from `@/components/ui/`. If a `Dialog` component exists in `@/components/ui/dialog`, use it. Otherwise, create a simple modal overlay.

- [ ] **Step 1: Check for existing Dialog component**

Run: `ls apps/dashboard/src/components/ui/dialog*` to check if a Dialog component exists. If not, use a simple modal with backdrop.

- [ ] **Step 2: Create the widget setup modal**

Create `apps/dashboard/src/components/marketplace/widget-setup-modal.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check } from "lucide-react";

interface WidgetSetupModalProps {
  deploymentId: string;
  onClose: () => void;
  onConnected: () => void;
}

export function WidgetSetupModal({ deploymentId, onClose, onConnected }: WidgetSetupModalProps) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateToken() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/marketplace/connections/widget-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId }),
      });
      if (!res.ok) throw new Error("Failed to generate widget token");
      const data = await res.json();
      setToken(data.connection.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setIsLoading(false);
    }
  }

  const embedSnippet = token
    ? `<script src="${window.location.origin}/widget.js" data-token="${token}"></script>`
    : "";

  function handleCopy() {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Generate token on mount
  useEffect(() => {
    generateToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg p-6 max-w-lg w-full mx-4 space-y-4">
        <h3 className="font-display text-lg text-foreground">Add Widget to Your Website</h3>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating widget token...
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {token && (
          <>
            <p className="text-sm text-muted-foreground">
              Paste this snippet into your website&apos;s HTML, just before the closing{" "}
              <code className="text-xs bg-muted px-1 rounded">&lt;/body&gt;</code> tag:
            </p>
            <div className="relative">
              <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto">{embedSnippet}</pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {token && (
            <Button
              onClick={() => {
                onConnected();
                onClose();
              }}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add widget setup modal"
```

---

### Task 15: Telegram Setup Modal

**Files:**

- Create: `apps/dashboard/src/components/marketplace/telegram-setup-modal.tsx`

**Context:** Three-step modal:

1. Instructions for creating a bot via BotFather
2. Paste bot token
3. Success with @bot_username

- [ ] **Step 1: Create the Telegram setup modal**

Create `apps/dashboard/src/components/marketplace/telegram-setup-modal.tsx`:

A three-step modal component:

- **Step 1:** BotFather instructions (static text)
- **Step 2:** Token input + "Connect" button. On submit, calls `/api/dashboard/marketplace/connections/telegram` with the bot token. Needs `webhookBaseUrl` — read from `process.env.NEXT_PUBLIC_CHAT_URL` or prompt the user.
- **Step 3:** Success — shows "Your agent is live! @bot_username"

Error handling: if `getMe` or `setWebhook` fails, show error on Step 2 and let the user retry.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(dashboard): add Telegram setup modal"
```

---

### Task 16: Channels Section Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/channels-section.tsx`

**Context:** Renders on the deployment detail page. Two channel cards: web widget and Telegram. Each shows connected/disconnected state with appropriate actions.

- [ ] **Step 1: Create channels section**

Create `apps/dashboard/src/components/marketplace/channels-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Globe, MessageCircle } from "lucide-react";
import { WidgetSetupModal } from "./widget-setup-modal";
import { TelegramSetupModal } from "./telegram-setup-modal";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface ChannelsSectionProps {
  deploymentId: string;
  connections: Connection[];
  onRefresh: () => void;
}

export function ChannelsSection({ deploymentId, connections, onRefresh }: ChannelsSectionProps) {
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [showTelegramModal, setShowTelegramModal] = useState(false);

  const widgetConn = connections.find((c) => c.type === "web_widget" && c.status === "active");
  const telegramConn = connections.find((c) => c.type === "telegram" && c.status === "active");

  async function handleDisconnect(connectionId: string) {
    try {
      await fetch(`/api/dashboard/marketplace/connections/${connectionId}`, {
        method: "DELETE",
      });
      onRefresh();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg text-foreground">Channels</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Web Widget Card */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Web Widget</span>
            {widgetConn && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                Connected
              </span>
            )}
          </div>
          {widgetConn ? (
            <Button variant="outline" size="sm" onClick={() => handleDisconnect(widgetConn.id)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => setShowWidgetModal(true)}>
              Add to your website
            </Button>
          )}
        </div>

        {/* Telegram Card */}
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Telegram</span>
            {telegramConn && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                Connected
              </span>
            )}
          </div>
          {telegramConn ? (
            <Button variant="outline" size="sm" onClick={() => handleDisconnect(telegramConn.id)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => setShowTelegramModal(true)}>
              Connect Telegram
            </Button>
          )}
        </div>
      </div>

      {showWidgetModal && (
        <WidgetSetupModal
          deploymentId={deploymentId}
          onClose={() => setShowWidgetModal(false)}
          onConnected={onRefresh}
        />
      )}
      {showTelegramModal && (
        <TelegramSetupModal
          deploymentId={deploymentId}
          onClose={() => setShowTelegramModal(false)}
          onConnected={onRefresh}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(dashboard): add channels section component"
```

---

### Task 17: Widget JS Bundle

**Files:**

- Create: `apps/dashboard/public/widget.js`

**Context:** Self-contained vanilla JS (no build step, no framework). Creates an iframe with `srcdoc` containing the chat UI. Reads `data-token` from the script tag. Communicates with the chat app via POST (send) and SSE (receive).

The chat app URL should be configurable — read from `data-api` attribute or default to the same origin as the script's `src`.

- [ ] **Step 1: Create widget.js**

Create `apps/dashboard/public/widget.js`. This file must be entirely self-contained (~200-300 lines of vanilla JS). Key behaviors:

1. **Initialization:** Find the script tag, read `data-token`, `data-visitor-name`, `data-visitor-email`, `data-api` (chat app URL). Generate/restore `sessionId` from `localStorage`.

2. **UI:** Create an iframe with `srcdoc` containing:
   - Chat bubble button (bottom-right fixed, 56px circle, primary color)
   - Chat panel (400x500px, border, shadow, rounded)
   - Header with "Chat with us" text
   - Message list with visitor (right, blue) and agent (left, gray) bubbles
   - Input box + send button
   - "Powered by Switchboard" footer
   - Typing indicator (three dots animation CSS)

3. **SSE connection:** On panel open, connect to `GET /widget/:token/events?sessionId=xxx`. Handle events: `connected`, `typing` (show indicator), `message` (append bubble), `error`. Reconnect with exponential backoff on disconnect.

4. **Sending:** POST to `POST /widget/:token/messages` with `{ sessionId, text, visitor }`.

5. **Session:** Store `sessionId` in `localStorage` under key `sw_session_{token}`.

Keep bundle size minimal — no dependencies, inline all CSS in the `srcdoc`.

- [ ] **Step 2: Test manually**

Create a test HTML page that includes the widget script and verify:

- Bubble appears bottom-right
- Click opens chat panel
- Can type and send (will 404 without backend, that's OK)
- SSE connection attempt visible in network tab

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(dashboard): add self-contained widget.js embed script"
```

---

### Task 18: Redirect Deploy Flow to Deployment Detail

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx:67`

**Context:** After successful deployment, the wizard currently redirects to `/dashboard`. Change it to redirect to the new deployment detail page so the user can immediately set up channels.

- [ ] **Step 1: Update redirect target**

In `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`, line 67, the deploy success handler does `router.push("/dashboard")`. Change it to redirect to the deployment detail page:

```ts
const { deployment } = await res.json();
router.push(`/deployments/${deployment.id}`);
```

Note: This requires the deploy API to return the deployment ID in the response. Check the existing deploy endpoint response — if it doesn't return the ID, the redirect can stay as `/dashboard` for now and be updated when the API response is confirmed.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(dashboard): redirect to deployment detail after deploy"
```

---

### Task 19: Integration Test — End-to-End Widget Flow

**Files:**

- Create: `apps/chat/src/gateway/__tests__/widget-integration.test.ts`

**Context:** Test the full flow: POST message → gateway processes → SSE delivers reply. Use the gateway with mock stores and a real `SseSessionManager`.

- [ ] **Step 1: Write integration test**

```ts
import { describe, it, expect, vi } from "vitest";
import { ChannelGateway } from "@switchboard/core";
import { SseSessionManager } from "../../endpoints/widget-sse-manager.js";

describe("Widget integration", () => {
  it("delivers reply via SSE after POST message", async () => {
    // Create gateway with mock stores
    const gateway = new ChannelGateway({
      deploymentLookup: {
        findByChannelToken: vi.fn().mockResolvedValue({
          deployment: { id: "dep-1", listingId: "listing-1" },
          persona: {
            id: "p-1",
            organizationId: "org-1",
            businessName: "Test",
            businessType: "saas",
            productService: "widgets",
            valueProposition: "best",
            tone: "professional",
            qualificationCriteria: {},
            disqualificationCriteria: {},
            escalationRules: {},
            bookingLink: null,
            customInstructions: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          trustScore: 50,
          trustLevel: "guided",
        }),
      },
      conversationStore: {
        getOrCreateBySession: vi.fn().mockResolvedValue({
          conversationId: "conv-1",
          messages: [],
        }),
        addMessage: vi.fn().mockResolvedValue(undefined),
      },
      stateStore: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      actionRequestStore: {
        create: vi.fn().mockResolvedValue({ id: "ar-1", status: "executed" }),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      },
      llmAdapterFactory: () => ({
        generateReply: vi.fn().mockResolvedValue({
          reply: "Hello! How can I help?",
          confidence: 0.9,
        }),
      }),
    });

    // Track SSE messages
    const sseMessages: string[] = [];
    const sseManager = new SseSessionManager();

    // Mock a reply object for SSE
    const mockReply = {
      raw: {
        write: vi.fn((data: string) => {
          sseMessages.push(data);
          return true;
        }),
      },
    };
    sseManager.register("sess-1", mockReply as never);

    // Route message through gateway with SSE replySink
    await gateway.handleIncoming(
      { channel: "web_widget", token: "sw_test", sessionId: "sess-1", text: "Hi" },
      {
        send: async (text) => sseManager.sendMessage("sess-1", "assistant", text),
        onTyping: () => sseManager.sendTyping("sess-1"),
      },
    );

    // Verify SSE received typing + message events
    const typingEvent = sseMessages.find((m) => m.includes("event: typing"));
    const messageEvent = sseMessages.find((m) => m.includes("Hello! How can I help?"));
    expect(typingEvent).toBeDefined();
    expect(messageEvent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat test -- --run widget-integration`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "test(chat): add widget integration test"
```

---

## Task Dependency Order

```
Task 1 (schema)
  └─ Task 2 (types) ─── Task 3 (gateway impl)
                            └─ Task 4 (deployment lookup)
                            └─ Task 5 (conversation store)
                            └─ Task 6 (bridge factory)
                            └─ Task 7 (SSE manager)
                                └─ Task 8 (widget endpoints)
                            └─ Task 9 (registry extension)
  Task 10 (API endpoints) ─── Task 11 (API client)
                                  └─ Task 12 (proxy routes)
                                  └─ Task 13 (detail page)
                                      └─ Task 14 (widget modal)
                                      └─ Task 15 (telegram modal)
                                      └─ Task 16 (channels section)
  Task 17 (widget.js) — independent
  Task 18 (redirect) — after Task 13
  Task 19 (integration test) — after Tasks 3, 7, 8
```

Tasks 1-9 (backend/core) should be done first. Tasks 10-16 (API + dashboard) can largely be done in parallel with each other but depend on the core gateway. Task 17 (widget.js) is independent. Task 18-19 are finishing touches.
