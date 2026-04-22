# Web Widget + Telegram — Design Spec (Sub-project C)

**Date:** 2026-04-07
**Status:** Draft
**Author:** Jason Li + Claude
**Depends on:** Sub-project A (Agent SDK + Cloud Runtime), Sub-project B (Deploy Flow + Test Chat)

---

## 1. What We're Building

Real channel deployment for marketplace agents. Founders who've deployed an agent through the wizard (Sub-project B) can connect it to customers via an embeddable web widget or a Telegram bot. Both channels use the same `ChannelGateway` bridge in `packages/core/`, which routes incoming messages through `AgentRuntime` with full governance (trust-based supervised/guided/autonomous).

Web widget is implemented first (no third-party dependencies), Telegram second (adapter already exists).

### Success Metrics

```
Time from "Add web widget" to live on site    < 2 minutes
Time from "Connect Telegram" to live bot      < 5 minutes
First reply latency (widget)                  < 8 seconds
Message delivery reliability                  > 99.5%
```

### What This Is NOT

- Not a replacement for the legacy `ChatRuntime` — non-marketplace orgs continue using the existing pipeline
- Not a streaming implementation — `replySink` is streaming-ready but `DefaultChatHandler` returns full text for now
- Not a customizable widget — no theme/color/position options in v1
- Not WhatsApp/Instagram — those channels come later

---

## 2. Architecture

```
Visitor ──► Widget (iframe + JS bundle)
              │ POST /widget/:token/messages
              │ GET  /widget/:token/events (SSE)
              ▼
         apps/chat/ (Fastify)
              │
              ▼  IncomingChannelMessage
         ChannelGateway (packages/core)
           ├─ DeploymentLookup.findByChannelToken()
           ├─ ConversationStore.getOrCreate()
           ├─ Load persona + trust config
           ├─ Create AgentRuntime (DefaultChatHandler)
           └─ onChatExecute → ReplySink
                                ├─ widget: SSE push
                                └─ telegram: sendTextReply()

Telegram ──► POST /webhook/managed/:webhookId
              │
              ▼  (same gateway path)
         TelegramAdapter.parseIncomingMessage()
              → ChannelGateway.handleIncoming()
```

### Three Layers

1. **Channel endpoints** (`apps/chat/`) — thin webhook/HTTP receivers. Normalize raw payloads into `IncomingChannelMessage`, call the gateway, deliver replies via channel-specific mechanisms.

2. **Channel Gateway** (`packages/core/src/channel-gateway/`) — the bridge. Receives normalized messages, resolves the deployment, manages conversation persistence, constructs an `AgentRuntime`, and routes replies back through a `ReplySink`. Doesn't know about HTTP, SSE, or Telegram.

3. **Agent Runtime** (Sub-project A) — handles the message using `DefaultChatHandler`, governed by trust score via `ActionRequestPipeline`.

### Key Design Decisions

1. **Channel Gateway in core** — reusable bridge that any app can call. Both web widget and Telegram use the same gateway. Future channels just need a thin adapter.
2. **SSE for widget delivery** — real-time typing indicators and message push. Sending is still a simple POST. `replySink` is designed streaming-ready (`onToken`, `onTyping` callbacks) even though v1 sends full messages.
3. **Backend in `apps/chat/`** — the chat app is already the multi-channel hub. Widget endpoints live alongside Telegram/Slack/WhatsApp webhooks.
4. **Self-contained widget JS** — a static JS bundle served from the dashboard (or CDN) that creates an iframe with the chat UI. No server-rendered widget page needed.
5. **Deployment token auth** — widget endpoints authenticate via a `sw_` prefixed token that maps to a `DeploymentConnection`. No user sessions for visitors.
6. **Conversations persisted** — real customer conversations are stored in the DB. Founders can review them. Visitors resume conversations via `sessionId` in localStorage.

---

## 3. Channel Gateway

**File:** `packages/core/src/channel-gateway/channel-gateway.ts`

### Interfaces

```ts
interface ChannelGatewayConfig {
  deploymentLookup: DeploymentLookup;
  conversationStore: GatewayConversationStore;
  stateStore: AgentStateStoreInterface;
  actionRequestStore: ActionRequestStore;
  llmAdapterFactory: () => LLMAdapter;
}

interface DeploymentLookup {
  findByChannelToken(channel: string, token: string): Promise<DeploymentInfo | null>;
}

interface DeploymentInfo {
  deployment: { id: string; listingId: string };
  persona: AgentPersona;
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  // handler is NOT included — the gateway always uses DefaultChatHandler.
  // Custom handlers come in Sub-project E (developer publishing).
}

interface GatewayConversationStore {
  getOrCreateBySession(
    deploymentId: string,
    channel: string,
    sessionId: string,
  ): Promise<{ conversationId: string; messages: Array<{ role: string; content: string }> }>;
  addMessage(conversationId: string, role: string, content: string): Promise<void>;
}

interface IncomingChannelMessage {
  channel: string;
  token: string;
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string };
}

interface ReplySink {
  send(text: string): Promise<void>;
  onToken?(chunk: string): void;
  onTyping?(): void;
}
```

### `gateway.handleIncoming(message, replySink)`

1. Call `deploymentLookup.findByChannelToken(message.channel, message.token)`
2. If not found, throw `UnknownChannelError`
3. `conversationStore.getOrCreateBySession(deployment.id, message.channel, message.sessionId)` — returns conversation with history
4. `conversationStore.addMessage(conversationId, "user", message.text)` — persist incoming
5. Call `replySink.onTyping?.()` — signal typing indicator
6. Create `AgentRuntime` with:
   - `handler`: `DefaultChatHandler` (from Sub-project B)
   - `persona`, `trustScore`, `trustLevel`: from `DeploymentInfo`
   - `llmAdapter`: from `config.llmAdapterFactory()`
   - `stateStore`, `actionRequestStore`: from `ChannelGatewayConfig` (injected by caller — the chat app provides Prisma-backed implementations)
   - `onChatExecute` — single callback that delivers and persists:
     ```ts
     onChatExecute: async (reply) => {
       await replySink.send(reply);
       await conversationStore.addMessage(conversationId, "assistant", reply);
     };
     ```
   - `surface`: `message.channel` (e.g., `"web_widget"`, `"telegram"`)
   - `deploymentId`: from `DeploymentInfo`
7. Call `runtime.handleMessage({ conversationId, messages: history })` with full conversation history (capped at last 30 messages)

### Rules

- Gateway creates a fresh `AgentRuntime` per message — stateless, no in-memory sessions
- Conversation history capped at 30 messages sent to the LLM (older messages are in DB but not in the prompt)
- `DeploymentLookup` results should be cached in-memory (60s TTL) by callers to avoid per-message DB queries
- Gateway throws typed errors (`UnknownChannelError`, `InactiveDeploymentError`) — callers map these to HTTP responses

---

## 4. Web Widget

### Embed Script

Site owners paste:

```html
<script src="https://your-domain.com/widget.js" data-token="sw_abc123..."></script>
```

Optional visitor identity:

```html
<script
  src="https://your-domain.com/widget.js"
  data-token="sw_abc123..."
  data-visitor-name="Jane"
  data-visitor-email="jane@example.com"
></script>
```

### Widget JS Bundle

**File:** `apps/dashboard/public/widget.js`

Self-contained JS (no React, no framework — vanilla JS for minimal bundle size):

1. Reads `data-token` and optional `data-visitor-*` from the script tag
2. Generates a `sessionId` (UUID), stores in `localStorage` keyed by token
3. Creates an iframe with `srcdoc` containing the chat UI HTML/CSS
4. Renders a chat bubble (bottom-right, fixed position)
5. On expand, connects SSE to `GET /widget/:token/events?sessionId=xxx`
6. On send, POSTs to `POST /widget/:token/messages`
7. Handles SSE events: `typing` (show indicator), `message` (append reply), `error`
8. SSE reconnection on disconnect with exponential backoff

### Chat UI (inside iframe)

- Chat bubble button (collapsed state)
- Chat panel: header with agent name, message list, input box
- Message bubbles: visitor (right, primary color), agent (left, muted)
- Typing indicator (three dots animation)
- "Powered by Switchboard" footer

### Session Management

- `sessionId` stored in `localStorage` under key `sw_session_{token}`
- On page load, if `sessionId` exists, widget loads conversation history via SSE reconnection (server replays missed messages)
- New visitor = new `sessionId` = new conversation

---

## 5. Widget Backend Endpoints

**Location:** `apps/chat/src/endpoints/`

### POST `/widget/:token/messages`

```ts
// Request
{
  sessionId: string,
  text: string,
  visitor?: { name?: string; email?: string }
}

// Response
{ messageId: string }
```

1. Validate token → find `DeploymentConnection` with `type: "web_widget"`
2. Rate limit by IP + sessionId (20 messages/minute)
3. Create `IncomingChannelMessage` from request
4. Call `gateway.handleIncoming(message, replySink)` where `replySink.send()` pushes to the SSE connection for this sessionId
5. Return `{ messageId }` immediately — reply delivered via SSE

### GET `/widget/:token/events?sessionId=xxx`

SSE endpoint:

1. Validate token
2. Register this connection in an in-memory `Map<sessionId, Response>`
3. Send initial `connected` event
4. On incoming events (from gateway's `replySink`):
   - `event: typing` — typing indicator started
   - `event: message` + `data: { role, content, id }` — complete message
   - `event: token` + `data: { chunk }` — streaming token (future)
5. Heartbeat every 30s to keep connection alive
6. On client disconnect, remove from map

### SSE Connection Management

In-memory `Map<string, Response>` mapping `sessionId` to the active SSE response. When the gateway's `replySink.send()` is called, look up the SSE connection and push the event.

If no SSE connection is active (visitor closed the tab), the reply is still persisted in the conversation — the visitor sees it when they return and the SSE reconnects.

**Single-instance assumption for v1:** The SSE map is in-memory, so the message POST and the SSE connection must land on the same chat app instance. For v1 this is fine — single-instance deployment. At scale, add a Redis pub/sub layer: the POST handler publishes to a channel, the SSE handler subscribes and pushes to the client. This is documented as a future optimization, not a v1 requirement.

### CORS

Widget endpoints need CORS headers since the iframe's JS calls the chat app on a different origin. Allow `*` origin for `/widget/` routes (the token is the auth, not origin restrictions).

---

## 6. Telegram Integration

### Setup Flow

Founder clicks "Connect Telegram" on the deployment page:

1. **Modal step 1:** Instructions — "Open Telegram, search @BotFather, send `/newbot`, follow the prompts, copy the token"
2. **Modal step 2:** Paste token input
3. **On submit:**
   - Backend validates token by calling Telegram `getMe` API
   - Creates `DeploymentConnection` with `type: "telegram"`, encrypted bot token + generated webhook secret
   - Registers webhook via Telegram `setWebhook` API (reusing logic from `apps/chat/src/cli/register-webhook.ts`)
   - Returns bot username
4. **Modal step 3:** Success — "Your agent is live! @bot_username"

### Message Flow

```
Telegram → POST /webhook/managed/:webhookId
  → RuntimeRegistry resolves webhookId to DeploymentConnection
  → TelegramAdapter.parseIncomingMessage(rawPayload) → IncomingChannelMessage
  → gateway.handleIncoming(message, replySink)
  → replySink.send(reply) → TelegramAdapter.sendTextReply(threadId, text)
```

### RuntimeRegistry Changes

The existing `RuntimeRegistry` loads `ManagedChannel` records on startup and creates a `ChatRuntime` (legacy pipeline) per channel. Extend it to **also** load `DeploymentConnection` records:

- On startup, query `DeploymentConnection` where `type = "telegram"` and `status = "active"`
- For each, create a `TelegramAdapter` from the stored credentials
- Register a webhook handler that routes through `ChannelGateway` **instead of** `ChatRuntime`
- The routing decision is made by data source: `ManagedChannel` records → legacy `ChatRuntime`, `DeploymentConnection` records → new `ChannelGateway`. They coexist in the same registry, differentiated by which table they came from.
- Support hot-reloading: when a new Telegram connection is created via the setup modal, add it to the registry without restart
- Each webhook path is unique, so there's no ambiguity — a given webhook always routes to either legacy or gateway, never both

### ReplySink for Telegram

```ts
const replySink: ReplySink = {
  send: (text) => telegramAdapter.sendTextReply(threadId, text),
  onTyping: () => telegramAdapter.sendChatAction(threadId, "typing"),
  // onToken not implemented — Telegram doesn't support streaming
};
```

---

## 7. Widget Setup UI

### Deployment Page Addition

On the existing deployment detail page, add a "Channels" section with two cards:

- **Web Widget** — if not connected: "Add to your website" button. If connected: shows embed snippet (copyable), status badge, disconnect button.
- **Telegram** — if not connected: "Connect Telegram" button. If connected: shows @bot_username, status badge, disconnect button.

### Widget Setup Modal

**File:** `apps/dashboard/src/components/marketplace/widget-setup-modal.tsx`

1. Click "Add to your website"
2. Backend generates token, creates `DeploymentConnection`
3. Modal shows copyable embed snippet
4. "Done" closes modal, channel card updates to show connected status

### Telegram Setup Modal

**File:** `apps/dashboard/src/components/marketplace/telegram-setup-modal.tsx`

Three-step modal as described in Section 6.

---

## 8. Deployment Token

### Format

`sw_` + 20 random alphanumeric characters. Example: `sw_a8Kj3mP9xQ2nR5vL7wYt`

### Generation

```ts
import { randomBytes } from "crypto";

function generateDeploymentToken(): string {
  return "sw_" + randomBytes(15).toString("base64url").slice(0, 20);
}
```

### Storage

Stored in `DeploymentConnection.credentials` (encrypted field):

```json
{ "token": "sw_a8Kj3mP9xQ2nR5vL7wYt" }
```

### Lookup

`DeploymentLookup.findByChannelToken("web_widget", token)` queries all `DeploymentConnection` rows where `type = "web_widget"` and `status = "active"`, decrypts `credentials` for each, and matches the token in-memory (since `credentials` is an encrypted `String` column, SQL filtering on the token value is not possible). The resulting token-to-deployment mapping is cached in-memory with 60s TTL so this scan only runs once per cache cycle.

---

## 9. Data Model Changes

### No New Prisma Models

All data fits existing models:

| Data               | Model                  | How                                                             |
| ------------------ | ---------------------- | --------------------------------------------------------------- |
| Widget token       | `DeploymentConnection` | `type: "web_widget"`, token in `credentials`                    |
| Telegram bot token | `DeploymentConnection` | `type: "telegram"`, bot token + webhook secret in `credentials` |
| Conversations      | `ConversationThread`   | See note below on `deploymentId`                                |
| Action requests    | `ActionRequest`        | `surface: "web_widget"` or `"telegram"`                         |
| Widget sessions    | Conversation metadata  | `sessionId` stored in `agentContext` JSON                       |

### ConversationThread — `deploymentId` field

The existing `ConversationThread` model does NOT have a `deploymentId` field — it has `contactId` + `organizationId`. We need to link conversations to deployments. Two options:

**Chosen approach: store `deploymentId` in `agentContext` JSON.** The `agentContext` field is a `Json` column (default `{}`) already used for arbitrary agent context data. Store `{ deploymentId, sessionId, channel }` there. Query by deployment via a Prisma JSON filter.

This avoids a schema migration for v1. If query performance becomes an issue, we add a proper `deploymentId` column later.

The `GatewayConversationStore` implementation queries `ConversationThread` by matching `agentContext.deploymentId` + `agentContext.sessionId` + `agentContext.channel`.

### Schema Changes

**`packages/schemas/src/chat.ts`** — add `"web_widget"` to Channel enum:

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

No Prisma migrations needed.

---

## 10. File Map

### New Files

```
packages/core/src/channel-gateway/
  channel-gateway.ts                — ChannelGateway class
  types.ts                          — interfaces (DeploymentLookup, ReplySink, etc.)
  index.ts                          — barrel exports
  __tests__/channel-gateway.test.ts

apps/chat/src/endpoints/
  widget-messages.ts                — POST /widget/:token/messages
  widget-events.ts                  — GET /widget/:token/events (SSE)

apps/chat/src/adapters/
  widget-adapter.ts                 — normalize widget HTTP → IncomingChannelMessage

apps/chat/src/gateway/
  gateway-bridge.ts                 — creates ChannelGateway with Prisma-backed stores
  deployment-lookup.ts              — DeploymentLookup implementation
  __tests__/deployment-lookup.test.ts

apps/dashboard/public/
  widget.js                         — self-contained embed script + chat UI

apps/dashboard/src/components/marketplace/
  widget-setup-modal.tsx            — token generation + embed snippet
  telegram-setup-modal.tsx          — BotFather guide + token validation
  channels-section.tsx              — channel cards on deployment page

apps/dashboard/src/app/api/dashboard/marketplace/
  widget-token/route.ts             — POST: generate widget token
  telegram-connect/route.ts         — POST: validate + store Telegram bot token
  telegram-connect/webhook/route.ts — POST: register Telegram webhook
```

### Modified Files

```
packages/schemas/src/chat.ts                         — add "web_widget" to Channel enum
packages/core/src/index.ts                           — export channel-gateway module
apps/chat/src/main.ts                                — register widget endpoints
apps/chat/src/managed/runtime-registry.ts            — load DeploymentConnections, route to gateway
```

### Dependency Flow

```
Layer 1 (schemas):  Channel enum, IncomingMessage types
Layer 3 (core):     ChannelGateway ← AgentRuntime + store interfaces
Layer 4 (db):       (stores already exist, no changes)
Layer 6 (chat):     Widget endpoints + gateway bridge + adapters
Layer 6 (dashboard): Setup modals + widget.js + API routes
```

No cross-layer violations. No new Prisma models.

---

## 11. Out of Scope

- **Streaming LLM tokens** — `ReplySink.onToken` is defined but not called by `DefaultChatHandler`. Future optimization.
- **Widget customization** — no colors, position, or theme options. Bottom-right, default styling.
- **WhatsApp / Instagram / Slack** — future channels. They'd follow the same gateway pattern.
- **Replacing legacy `ChatRuntime`** — non-marketplace orgs continue using the existing pipeline.
- **Rich Telegram messages** — text replies only, no inline keyboards or cards.
- **Conversation history API** — founders see conversations in the existing dashboard. No new conversation viewer for v1.
- **Proactive agent messages** — agent can only respond, not initiate. SSE supports it, but no trigger mechanism exists yet.
- **Widget analytics** — no tracking of visitor engagement, conversion, etc.

---

## 12. Open Questions

1. ~~**Conversation table linking**~~ — Resolved: store `deploymentId`, `sessionId`, `channel` in `agentContext` JSON (see Section 9).
2. **Widget bundle size** — vanilla JS chat UI needs to be small (<30KB gzipped). If it grows, consider a separate build step with minification.
3. **SSE connection limits** — the chat app will hold open SSE connections. For early traffic this is fine. At scale, consider a Redis pub/sub layer for multi-instance deployment.
4. **Telegram webhook URL** — what base URL do we register? Needs to be publicly accessible. This is a deployment/infrastructure concern, not a code concern.
