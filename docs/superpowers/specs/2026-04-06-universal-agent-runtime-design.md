# Universal Agent Runtime — Design Spec

**Date:** 2026-04-06
**Status:** Draft
**Author:** Jason Li + Claude

---

## 1. What We're Building

A universal agent runtime that lets AI agents operate across any surface — chat, browser, APIs, desktop — with trust-based governance controlling every action. Combined with a developer SDK and marketplace, this makes Switchboard the platform where developers publish agents and non-tech founders deploy them in minutes.

### The Vision

**For founders:** Browse the marketplace, click Deploy, test your agent in a sandbox, go live. The agent sets up its own integrations. You just type passwords when asked. Every action is governed — agents earn autonomy through consistent good work.

**For developers:** You write the brain. Switchboard handles trust infrastructure, multi-surface execution, state management, and distribution to non-tech buyers.

### What This Is NOT

- Not a chatbot builder — agents operate across any surface, not just chat
- Not a workflow automation tool (Zapier) — agents reason and adapt, they don't follow fixed flows
- Not an agent hosting service — the marketplace + governance is the product, not raw compute

### Success Metrics

```
Founder deploys first agent             < 5 minutes (scan website → test chat → live)
Time to "wow" moment (test chat)        < 2 minutes from starting deploy
Developer publishes first agent         < 1 day from `switchboard init` to marketplace
Agent response time (chat)              < 5 seconds in test chat, < 60 seconds supervised
```

---

## 2. Architecture — Progressive Runtime

Three runtime layers, progressively adopted. Most founders never need the heaviest one.

```
┌─────────────────────────────────────────────────────────────────┐
│                     MARKETPLACE LAYER                           │
│                                                                 │
│  Agent listings, trust scores, deploy wizard, approval queue    │
│  (Already built — marketplace browse, agent profiles, deploy)   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                    GOVERNANCE LAYER                              │
│                                                                 │
│  Action Requests → Policy evaluation → Trust-gated execution    │
│  (Existing policy engine + trust scoring, extended to all       │
│   surfaces — chat, browser, file, API actions)                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                   ORCHESTRATOR LAYER                             │
│                                                                 │
│  Agent SDK handler dispatch, state management,                  │
│  agent-to-agent handoffs, scheduling                            │
└──────────┬───────────────────┼──────────────────┬───────────────┘
           │                   │                  │
┌──────────▼─────┐ ┌──────────▼────────┐ ┌───────▼──────────────┐
│ CLOUD RUNTIME  │ │  MANUS RUNTIME    │ │ DESKTOP COMPANION    │
│                │ │  (optional)       │ │ (optional)           │
│ Chat adapters  │ │ Browser/web-app   │ │ Local files          │
│ API connectors │ │ automation        │ │ Native app control   │
│ LLM calls      │ │ Self-setup flows  │ │ Offline credential   │
│ Scheduled jobs │ │ (founder's own    │ │ vault                │
│                │ │  Manus account)   │ │                      │
│ Install: none  │ │ Install: none     │ │ Install: download    │
└────────────────┘ └───────────────────┘ └──────────────────────┘
```

### Runtime Selection Logic

The orchestrator automatically picks the right runtime for each action:

| Action                            | Runtime                           | Why                           |
| --------------------------------- | --------------------------------- | ----------------------------- |
| Send chat message                 | Cloud                             | Always available, fastest     |
| Call Google Calendar API          | Cloud                             | OAuth token stored in cloud   |
| Create Google Doc via web UI      | Manus (if available) or manual    | No API, needs browser         |
| Read local Obsidian vault         | Desktop Companion                 | Local filesystem access       |
| Log into a SaaS tool during setup | Manus (optional) or guided wizard | Founder chooses comfort level |

### What Exists and Gets Reused

| Component                  | Location                                                      | Reuse                                                |
| -------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Marketplace UI             | `apps/dashboard/src/app/(public)/`                            | Browse, agent profiles, deploy wizard                |
| Trust scoring              | `packages/core/src/marketplace/trust-score-engine.ts`         | Direct reuse for all surfaces                        |
| TrustScoreAdapter          | `packages/core/src/marketplace/trust-adapter.ts`              | Bridge marketplace trust into governance             |
| Policy engine              | `packages/core/src/orchestrator/`                             | Extend to evaluate Action Requests from all surfaces |
| Approval queue             | `apps/dashboard/src/app/(auth)/decide/`                       | Extend to show all action types                      |
| Chat adapters              | `apps/chat/src/adapters/`                                     | Telegram, WhatsApp, Slack, Instagram                 |
| LLM adapter                | `packages/core/src/llm-adapter.ts`                            | Claude via existing interface                        |
| Deploy wizard              | `apps/dashboard/src/components/marketplace/deploy-wizard.tsx` | Extend with connection + test steps                  |
| AgentPersona deploy        | `apps/dashboard/src/app/(auth)/deploy/[slug]/actions.ts`      | Website scanner already works                        |
| Credential encryption      | `packages/db/`                                                | Reuse for storing OAuth tokens                       |
| Agent listings/deployments | `packages/schemas/src/marketplace.ts`                         | Direct reuse                                         |

### What's New to Build

| Component                   | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| **Agent SDK**               | Developer interface — manifest, handler, context, test harness |
| **Orchestrator**            | Handler dispatch, state management, handoffs, scheduling       |
| **Action Request pipeline** | Unified governance for all surfaces (chat, browser, file, API) |
| **Cloud Runtime providers** | Chat, API, LLM, scheduled job execution                        |
| **Connection system**       | OAuth flows, credential storage, Manus integration             |
| **Web chat widget**         | Embeddable widget for founder's website                        |
| **Telegram bot setup**      | Guided wizard for Telegram bot token                           |
| **Deploy wizard extension** | Connection steps, test chat, go-live flow                      |

---

## 3. Agent SDK — The Developer Interface

### Manifest

Every agent declares what it is and what it needs:

```ts
import type { AgentManifest } from "@switchboard/sdk";

export const manifest: AgentManifest = {
  name: "Speed-to-Lead Rep",
  slug: "speed-to-lead",
  description: "Responds to inbound leads within 60 seconds, qualifies through conversation",
  version: "1.0.0",
  author: "switchboard",
  category: "sales",

  capabilities: {
    required: ["chat"],
    optional: ["browser"],
  },

  connections: {
    required: [{ type: "chat_channel", reason: "To receive and respond to leads" }],
    optional: [
      { type: "google_calendar", reason: "To book meetings for qualified leads" },
      { type: "google_drive", reason: "To save qualified lead summaries" },
    ],
  },

  governance: {
    startingAutonomy: "supervised",
    escalateWhen: ["customer_frustrated", "asked_for_human", "outside_knowledge"],
  },

  pricing: {
    model: "free", // "free" | "paid" | "usage_based"
  },
};
```

### Handler

The handler is the agent's logic. Supports chat, multi-step workflows, handoffs, setup, and scheduled work:

```ts
import type { AgentHandler, AgentContext } from "@switchboard/sdk";

export const handler: AgentHandler = {
  // Respond to incoming messages
  async onMessage(ctx: AgentContext) {
    const history = ctx.conversation.messages;
    const persona = ctx.persona;

    const response = await ctx.llm.chat({
      system: buildSystemPrompt(persona),
      messages: history,
    });

    await ctx.chat.send(response.text);

    // Check if lead is qualified
    if (await isQualified(ctx)) {
      await ctx.handoff("sales-closer", {
        reason: "lead_qualified",
        qualificationData: await ctx.state.get("qualification"),
      });
    }
  },

  // Multi-step task workflow
  async onTask(ctx: AgentContext) {
    const doc = await ctx.files.read(ctx.task.input.documentUrl);
    const analysis = await ctx.llm.chat({
      system: "Analyze this document and identify risky clauses.",
      messages: [{ role: "user", content: doc }],
    });
    // Each action individually governed
    await ctx.files.write("output.md", analysis.text);
    await ctx.notify(analysis.text);
  },

  // Self-configure during deploy
  async onSetup(ctx: AgentContext) {
    // Agent can configure its own integrations using granted capabilities
  },

  // Scheduled work (follow-ups, reports)
  async onSchedule(ctx: AgentContext) {
    const leads = await ctx.state.list("leads:pending_followup");
    for (const lead of leads) {
      if (daysSince(lead.lastContact) >= 3) {
        await ctx.chat.send(`Hi ${lead.name}, circling back...`);
        await ctx.state.set(`leads:${lead.id}:lastContact`, new Date());
      }
    }
  },

  // Receive handoff from another agent
  async onHandoff(ctx: AgentContext) {
    const { fromAgent, conversation, qualificationData } = ctx.handoff;
    // Full conversation history + context available
    // Lead experiences one continuous conversation
  },
};
```

### Agent Context

What the runtime provides to every agent:

```ts
interface AgentContext {
  // State — persisted per-deployment, scoped to this founder's instance
  state: StateStore; // get/set/list/delete — agent's working memory

  // Capabilities — only those declared in manifest
  chat: ChatProvider; // send/receive messages across channels
  files: FileProvider; // read/write documents (Google Drive, local)
  browser: BrowserProvider; // navigate, click, extract (via Manus or direct API)
  llm: LLMAdapter; // LLM calls — Switchboard provides, usage metered

  // Platform features — every agent gets these
  notify: (message: string | StructuredNotification) => Promise<void>;
  handoff: (agentSlug: string, context: HandoffPayload) => Promise<void>;

  // Context
  persona: AgentPersona; // business profile from deploy wizard
  conversation?: ConversationThread; // if triggered by a message
  task?: AgentTask; // if triggered by a task
  handoff?: HandoffPayload; // if triggered by another agent
  trust: { score: number; level: "supervised" | "guided" | "autonomous" };
}

interface StateStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  delete(key: string): Promise<void>;
}
```

### Test Harness

Developers test agents locally against realistic scenarios:

```ts
import { createTestHarness } from "@switchboard/sdk/testing";

const harness = createTestHarness({ persona: mockPersona({ businessName: "Bloom Flowers" }) });

// Chat test
test("qualifies a good lead", async () => {
  const session = harness.chat();
  await session.userSays("Planning a wedding in June, budget around $5k");
  expect(session.lastResponse).toMatch(/wedding/i);
  expect(await session.state.get("qualificationProgress")).toBeGreaterThan(0.5);
});

// Workflow test
test("reviews contract and flags risky clauses", async () => {
  const session = harness.task({
    type: "contract_review",
    input: { documentUrl: "mock://contract.pdf" },
  });
  await session.run();
  expect(session.filesWritten).toHaveLength(1);
  expect(session.notifications[0]).toBeDefined();
});

// Handoff test
test("hands off to sales closer when qualified", async () => {
  const session = harness.chat();
  await session.qualifyLead(); // helper: simulates full qualification flow
  expect(session.handoffs).toEqual([
    expect.objectContaining({ to: "sales-closer", reason: "lead_qualified" }),
  ]);
});

// Governance test
test("action queued when supervised", async () => {
  const session = harness.chat({ trustLevel: "supervised" });
  await session.userSays("Tell me about pricing");
  expect(session.pendingApprovals).toHaveLength(1);
  expect(session.messagesSent).toHaveLength(0); // not sent until approved
});
```

### Developer CLI

```bash
npx switchboard init my-agent          # scaffold from template (chat, workflow, or hybrid)
npx switchboard dev                    # local dev server: test chat + governance simulator
npx switchboard test                   # run test harness
npx switchboard publish                # submit to marketplace
```

### Publishing — No Review Bottleneck

1. **Automated gates (instant):** manifest valid, tests pass, security scan, no disallowed capabilities
2. **Published immediately** with "New Agent" badge, trust score 0
3. **Community flagging** — founders can report agents, flagged agents get reviewed
4. **Curated collections** — Switchboard team editorially highlights quality agents

No manual review queue. Ship fast, earn trust through usage.

### Revenue Model for Developers

| Model           | How it works                                                                    |
| --------------- | ------------------------------------------------------------------------------- |
| **Free**        | Agent free to use. Developer gets exposure and marketplace presence.            |
| **Paid**        | Developer sets monthly price from day one. Founder pays upon deploy.            |
| **Usage-based** | Developer sets per-task or per-action price. Founder pays for actual work done. |

Switchboard takes a 20–30% platform cut. Trust score gates **autonomy**, not pricing. A paid agent at trust score 0 works — it's just fully supervised.

---

## 4. Connection System

When a founder deploys an agent, the deploy wizard reads the manifest's `connections` and presents only what's relevant.

### Connection Types

**API Connections (Cloud Runtime)**

Standard OAuth or API key integrations. Agent works through APIs — fastest, most reliable.

- Google Calendar, Drive, Gmail → OAuth consent flow
- Stripe, QuickBooks → API key or OAuth
- Telegram, WhatsApp → bot token / business API

Tokens stored encrypted in Switchboard's cloud DB using existing credential encryption.

**Web App Connections (Manus — Optional)**

For SaaS tools without usable APIs, or when the founder wants hands-free setup.

- Agent declares: `{ type: "web_app", url: "docs.google.com", access: "read_write" }`
- Founder clicks "Set it up for me" → dispatches a Manus task to founder's own Manus account
- Manus opens browser, founder types password, setup completes
- Resulting credentials/session stored by Switchboard

**Local Connections (Desktop Companion — Optional)**

For truly local tools — rare edge case.

- `{ type: "local_folder", path: "~/Documents/Obsidian", access: "read" }`
- `{ type: "native_app", name: "Terminal", access: "screen_control" }`
- Founder grants via OS-level permission dialogs

### Three Paths for Every Connection

| Path                   | For who            | Experience                                                                   |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------- |
| **Self-serve**         | Technical founders | OAuth flow, paste API keys, configure webhooks                               |
| **Guided wizard**      | Semi-technical     | Step-by-step walkthrough with screenshots                                    |
| **"Set it up for me"** | Non-technical      | Manus handles it, founder just types passwords (founder pays Manus directly) |

The agent manifest is the same regardless of path. Once connected, a Google Calendar token works identically whether the founder OAuth'd themselves or Manus did it.

### Connection UI in Deploy Wizard

```
"Speed-to-Lead needs a chat channel to receive leads."

  [Add web widget to my site]    → embed snippet
  [Connect Telegram]             → guided wizard
  [Connect WhatsApp]             → Meta Business setup

  ─── or ───

  [Set it up for me]             → Manus (your account)

Optional — recommended for best results:

  Google Calendar → "So I can book meetings for you"
    [Connect myself] [Set it up for me] [Skip for now]
```

Connections skipped during deploy can be added later from the dashboard. Agents gracefully degrade — they work without optional connections but mention what they could do: _"I could book this meeting directly if you connect Google Calendar."_

---

## 5. Governance Across All Surfaces

Every agent action is an **Action Request** before it executes. The governance layer decides whether it runs, queues for approval, or gets blocked.

### Action Request Flow

```
Agent decides to act
       ↓
Action Request created
  { type: "send_message", content: "Hi Sarah...", surface: "telegram" }
  { type: "browse_url", url: "calendar.google.com", intent: "create_event" }
  { type: "write_file", path: "contract-draft.docx", surface: "google_drive" }
       ↓
Governance evaluates:
  - Trust score for this agent + action category
  - Policy rules (e.g., "never auto-approve messages mentioning pricing")
  - Risk score of the specific action
       ↓
Result:
  EXECUTE  → runtime executes immediately, action logged to audit trail
  QUEUE    → founder sees it in approval queue, approves/rejects
  BLOCK    → action denied, agent notified, logged
```

### Surface-Specific Rules

| Surface                                | Governance behavior                                  |
| -------------------------------------- | ---------------------------------------------------- |
| Test chat (sandbox)                    | Always auto-execute — no real customer, low stakes   |
| Chat (real channels)                   | Governed by trust score                              |
| API actions (create event, send email) | Governed same as chat                                |
| Browser actions via Manus              | Manus task dispatched only after governance approves |
| File reads                             | Always allowed — observation is safe                 |
| File writes                            | Governed by trust score                              |

### Unified Approval Queue

The founder's dashboard shows one queue for all pending actions, regardless of surface:

```
Approval Queue (3 pending)

Speed-to-Lead → Telegram
  "Hi Sarah, thanks for reaching out about wedding flowers..."
  [Approve] [Edit & Approve] [Reject]

Sales Closer → Google Calendar
  Create event: "Call with Sarah Chen, March 15 2pm"
  [Approve] [Reject]

Legal Agent → Google Drive
  Create file: "Service Agreement — Chen Wedding.docx"
  [Preview] [Approve] [Reject]
```

As agents earn trust, items auto-approve and the queue gets quieter. The approval queue is the founder's single pane of glass.

### Trust Score Mechanics (Changed — Per-Deployment Scoping)

The existing trust scoring operates per-listing (global). For marketplace governance, trust must be **per-deployment** — each founder's instance earns trust independently. One founder's approvals should not grant autonomy in another founder's deployment.

**Changes to existing trust system:**

- `TrustScoreRecord` gains a `deploymentId` field (nullable — null = global marketplace reputation)
- `TrustScoreEngine` evaluates deployment-local trust for governance decisions
- Global listing trust (aggregated across all deployments) remains for marketplace display
- `scoreToPriceTier()` is deprecated — pricing is now developer-set (see Section 3)

**Score thresholds (unchanged):**

- Start at 0, approval +3 (streak bonus up to +5), rejection -10
- 0–29 supervised, 30–54 guided, 55–79 autonomous
- Applied per-agent per-action-category (an agent trusted for chat may still be supervised for file writes)

### Action Request Lifecycle

**Timeouts:** Pending approvals expire after 4 hours. On expiry:

- Guided-level agents: action auto-approves with reduced trust boost
- Supervised-level agents: action expires, agent notified, founder sees "missed" count in dashboard

**User-facing messaging while waiting:** When a real customer is waiting for a supervised agent's response:

- Customer sees: "Thanks for your message — I'll get back to you shortly" (configurable auto-reply)
- Founder gets push notification: "Lead waiting — approve response?"

**Retries:** If execution fails after approval (API error, timeout):

- Retried up to 3 times with exponential backoff
- If all retries fail: action marked as "failed," founder notified, agent can attempt alternative action

**Escalation:** If founder is consistently unresponsive (>3 expired approvals in 24h):

- Agent pauses new work, surfaces "Agent paused — needs attention" in dashboard
- Optional: email/SMS escalation to founder

---

## 6. Deploy Flow — End to End

### Step 1: Browse & Choose

Founder lands on marketplace. Sees agent cards with trust scores, reviews, pricing. Clicks "Deploy."

### Step 2: Business Profile

Deploy wizard scans their website, AI extracts business profile. Founder reviews and tweaks. (Already built.)

### Step 3: Agent Brief

Agent-specific configuration — qualification criteria, escalation rules, tone, restrictions. (Already built.)

### Step 4: Connect Required Services

Wizard reads agent manifest, shows required and optional connections. Three paths: self-serve, guided, Manus. Required connections must be completed. Optional can be skipped.

### Step 5: Test Run

Agent activates in sandbox mode. Founder chats with their own agent — ungoverned, instant responses. This is the "wow" moment. For workflow agents, a simulated task runs instead.

### Step 6: Go Live

Founder clicks "Go live." Agent deploys at trust score 0 (fully supervised). Every action queued for approval. Each approval nudges trust score up. Queue gets quieter over time.

### Post-Deploy Dashboard

```
My Agents (1 active)

Speed-to-Lead Rep
  Trust: 12/100 (Supervised — 4 approvals, 0 rejections)
  Channel: Telegram + Web widget
  Today: 3 leads received, 2 responses pending approval

  [View queue] [Test chat] [Settings] [Pause]
```

---

## 7. Channel Rollout Order

The deploy flow supports three channels, unlocked in this order:

### Phase 1: Dashboard Test Chat

- Already partially built (`/settings/test-chat`)
- Ungoverned sandbox — instant responses
- No install, no channel setup

### Phase 2: Web Chat Widget

- Embeddable `<script>` tag for founder's website
- Leads arrive through the widget → agent responds via cloud runtime
- Governed by trust score once live

### Phase 3: Telegram

- Guided setup: founder creates bot via BotFather, pastes token
- Or "Set it up for me" via Manus
- Full governance applies

WhatsApp, Slack, Instagram follow later — adapters already exist in `apps/chat/src/adapters/`.

---

## 8. Data Model Changes

### New: Agent SDK Package (`packages/sdk`)

New package containing the SDK types, test harness, and CLI tool. No runtime logic — just the developer interface.

**Dependency layer:** Layer 2 (alongside `cartridge-sdk`). May import `schemas` only. Apps and core import from SDK, not the other way around.

### HandoffPayload Type

```ts
interface HandoffPayload {
  fromAgent: string; // slug of the handing-off agent
  reason: string; // why the handoff happened
  conversation: ConversationThread; // full conversation history transfers
  context: Record<string, unknown>; // arbitrary data (qualificationData, etc.)
}
```

### New: Action Request

```prisma
model ActionRequest {
  id            String   @id @default(cuid())
  deploymentId  String   // which agent deployment
  type          String   // "send_message" | "browse_url" | "write_file" | "api_call"
  surface       String   // "telegram" | "web_widget" | "google_drive" | "browser"
  payload       Json     // action-specific data
  status        String   // "pending" | "approved" | "rejected" | "executed" | "blocked"
  governanceResult Json? // policy evaluation details
  reviewedBy    String?  // founder who approved/rejected
  reviewedAt    DateTime?
  executedAt    DateTime?
  createdAt     DateTime @default(now())

  deployment    AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@index([deploymentId, status])
  @@index([status, createdAt])
}
```

### New: Agent State

```prisma
model AgentState {
  id            String   @id @default(cuid())
  deploymentId  String   // scoped per deployment
  key           String   // state key (e.g., "leads:sarah-chen:lastContact")
  value         Json     // state value
  updatedAt     DateTime @updatedAt

  deployment    AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@unique([deploymentId, key])
  @@index([deploymentId])
}
```

### New: Connection

```prisma
model Connection {
  id            String   @id @default(cuid())
  deploymentId  String
  type          String   // "google_calendar" | "telegram" | "google_drive" | etc.
  slot          String   @default("default") // discriminator for multiple connections of same type
  status        String   // "active" | "expired" | "revoked"
  credentials   String   // encrypted OAuth token or API key
  metadata      Json?    // connection-specific config
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  deployment    AgentDeployment @relation(fields: [deploymentId], references: [id])

  @@unique([deploymentId, type, slot])
  @@index([deploymentId])
}
```

### Changes to Existing Models

**AgentDeployment** — add relation fields:

```prisma
// Add to existing AgentDeployment model:
connections    Connection[]
actionRequests ActionRequest[]
agentStates    AgentState[]
```

Note: `AgentDeployment` already has `connectionIds String[]` (flat array). The new `Connection` model replaces this with proper relational data. `connectionIds` becomes deprecated.

**TrustScoreRecord** — add deployment-scoped trust:

```prisma
// Add to existing TrustScoreRecord model:
deploymentId   String?  // null = global marketplace reputation
```

**AgentListing, AgentTask, AgentPersona, ConversationThread, ConversationMessage** — no changes.

---

## 9. Sub-Project Decomposition

This design is too large for a single implementation cycle. Recommended sub-projects:

### Sub-project A: Agent SDK + Cloud Runtime (Foundation)

- SDK types package (`packages/sdk`) — manifest, handler, context interfaces
- Orchestrator — handler dispatch, state store, Action Request pipeline
- Cloud runtime providers — chat (test chat first), LLM adapter integration
- Governance extension — Action Requests evaluated by existing policy engine
- Test harness for developers

### Sub-project B: Deploy Flow + Test Chat

- Refactor deploy wizard into multi-step flow framework (current wizard has only 2 hardcoded steps: "scan" and "review" — needs step navigation, plugin architecture for connection steps)
- Add connection steps and test chat step to wizard
- Dashboard test chat as ungoverned sandbox
- AgentPersona → system prompt assembly
- First working agent: Speed-to-Lead in test chat

### Sub-project C: Web Widget + Telegram

- Embeddable web chat widget
- Telegram bot setup wizard
- Full governance flow — supervised agents in real channels
- Approval queue extended for all action types

### Sub-project D: Manus Integration

- "Set it up for me" button in deploy wizard
- Manus task dispatch for connection setup
- Manus as optional browser automation runtime

### Sub-project E: Developer CLI + Marketplace Publishing

- `switchboard init/dev/test/publish` CLI
- Automated publishing gates
- Community flagging system
- Revenue model infrastructure (paid/usage-based agents)

### Sub-project F: Desktop Companion (Future)

- Electron app for local file access and native app control
- Local credential vault
- Only built when agent demand requires it

Recommended order: **A → B → C → D → E → F**

A and B can partially overlap. D and E are independent of each other. F is deferred until needed.

---

## 10. Open Questions

1. **LLM cost model** — who pays for LLM calls? The founder (usage-based), the developer (built into pricing), or Switchboard (subsidized)?
2. **Agent versioning** — when a developer publishes v2, do existing deployments auto-update or pin to v1?
3. **Multi-tenant Manus** — can multiple agents share one Manus session, or does each get its own?
4. **Offline behavior** — what happens to scheduled tasks when cloud runtime is down?
5. **Rate limiting** — how many actions per minute can a supervised agent queue before it becomes overwhelming for the founder?
