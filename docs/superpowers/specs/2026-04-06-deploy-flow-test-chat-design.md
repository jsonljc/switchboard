# Deploy Flow + Test Chat — Design Spec (Sub-project B)

**Date:** 2026-04-06
**Status:** Draft
**Author:** Jason Li + Claude
**Depends on:** Sub-project A (Agent SDK + Cloud Runtime)

---

## 1. What We're Building

A multi-step deploy wizard that lets non-tech founders go from "browse marketplace" to "talking to their agent" in under 5 minutes. The wizard scans their website, builds a persona, optionally configures connections, then drops them into a live test chat powered by the real `AgentRuntime` from Sub-project A. When the agent feels right, one click deploys it.

### Success Metrics

```
Time from "Deploy" click to test chat       < 2 minutes
Time from first test message to response     < 5 seconds
Deploy completion rate (start → finish)      > 60%
```

### What This Is NOT

- Not a full chat product — the test chat is a sandbox preview, not a production channel
- Not a connection management system — connection steps are simple API key inputs for now
- Not a custom handler pipeline — all agents use `DefaultChatHandler` until Sub-project E

---

## 2. Architecture

```
User flow:
  Marketplace Browse → Agent Detail → Deploy →
    Step 1: Scan Website (AI extracts business profile)
    Step 2: Review Persona (edit extracted fields)
    Step 3: [Connection steps from manifest — if any]
    Step 4: Test Chat (sandbox, real AgentRuntime)
    → Click "Deploy" from test chat step

Backend (test chat):
  Dashboard (Next.js) ──POST──▶ /api/dashboard/marketplace/test-chat
                                   │
                                   ▼
                          AgentRuntime.handleMessage()
                            ├─ SystemPromptAssembler(persona)
                            ├─ DefaultChatHandler (llm.chat → chat.send)
                            └─ ActionRequestPipeline (test_chat = sandbox, auto-execute)
```

### Key Design Decisions

1. **Real AgentRuntime for test chat** — not a simplified LLM call. Validates Sub-project A end-to-end and gives founders an accurate preview.
2. **Stateless test chat** — each request sends full conversation history. No server-side sessions. Works with serverless, no cleanup needed. Conversations are short (5-20 messages).
3. **Dynamic wizard steps** — step list built from agent manifest's `connections.required`. Most agents have zero connections, so typical flow is 3 steps.
4. **DefaultChatHandler** — generic persona-driven chat handler. All marketplace agents use it until developer publishing pipeline exists (Sub-project E).
5. **SystemPromptAssembler in core** — reusable across all surfaces (test chat, Telegram, web widget in Sub-project C).

---

## 3. SystemPromptAssembler

**File:** `packages/core/src/agent-runtime/system-prompt-assembler.ts`

Pure function. Takes `AgentPersona`, returns a system prompt string.

```ts
export function assembleSystemPrompt(persona: AgentPersona): string;
```

### Prompt Structure

```
You are an AI assistant for {businessName}.

## Your Role
You help customers with {productService}.
{valueProposition}

## Communication Style
Tone: {tone}
{customInstructions}

## Lead Qualification
{qualificationCriteria — serialized defensively, handles object or string}

## Escalation Rules
Hand off to a human when:
{- each enabled escalation rule}

## Booking
{bookingLink — only if present}
```

### Rules

- Omit sections with no data (no empty "Booking" heading if no bookingLink)
- Keep total prompt under ~800 tokens
- Defensive handling of `qualificationCriteria` and `escalationRules` — these are typed as generic objects, so serialize gracefully regardless of shape
- No hardcoded agent-specific behavior — purely persona-driven

---

## 4. DefaultChatHandler

**File:** `packages/core/src/agent-runtime/default-chat-handler.ts`

```ts
import type { AgentHandler } from "@switchboard/sdk";
import { assembleSystemPrompt } from "./system-prompt-assembler.js";

export const DefaultChatHandler: AgentHandler = {
  async onMessage(ctx) {
    const systemPrompt = assembleSystemPrompt(ctx.persona);
    const messages = (ctx.conversation?.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await ctx.llm.chat({
      system: systemPrompt,
      messages,
    });

    await ctx.chat.send(response.text);
  },
};
```

~15 lines. The persona config is what differentiates agents, not the handler code. Custom handlers come in Sub-project E.

---

## 5. Anthropic LLM Adapter Factory

**File:** `packages/core/src/agent-runtime/anthropic-adapter.ts`

The test chat API route needs an `LLMAdapter` instance. Rather than forcing the dashboard to know `LLMAdapter` internals, provide a factory:

```ts
export function createAnthropicAdapter(apiKey?: string): LLMAdapter;
```

- Wraps `@anthropic-ai/sdk` with the `LLMAdapter.generateReply()` interface
- Uses `ANTHROPIC_API_KEY` env var if no key provided
- Default model: `claude-sonnet-4-5-20250514`
- Reusable by any app that needs a concrete LLM adapter (dashboard, API, CLI in Sub-project E)

This follows the existing pattern — `scanWebsite` in the dashboard already uses `new Anthropic()` directly, but now it's wrapped in the standard adapter interface.

---

## 6. Deploy Wizard Shell

**File:** `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`

### Interface

```ts
interface WizardStep {
  id: string;
  label: string;
  component: React.ComponentType<WizardStepProps>;
  props?: Record<string, unknown>; // extra props (e.g., connection type for ConnectionStep)
}

interface WizardStepProps {
  data: WizardData;
  onUpdate: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}

interface WizardData {
  listingId: string;
  listingSlug: string;
  url?: string;
  persona?: PersonaInput;
  connections?: Record<string, ConnectionConfig>;
  testChatVerified?: boolean;
}
```

### Shell Behavior

- Renders progress bar (step X of N, derived from step array)
- Shell owns the **Back button** — always rendered except on step 1, always goes to previous step
- Steps control **forward progression** only — each step calls `onNext()` when ready
- No built-in Next button — steps have their own CTA ("Learn my business", "Continue", "Deploy")
- `WizardData` accumulates across steps via `onUpdate`

### Step List Construction

```ts
const steps: WizardStep[] = [
  { id: "scan", label: "Learn your business", component: ScanStep },
  { id: "review", label: "Review & customize", component: ReviewPersonaStep },
  ...manifest.connections.required.map((conn) => ({
    id: `connect-${conn.type}`,
    label: `Connect ${conn.type}`,
    component: ConnectionStep,
    props: { connectionType: conn.type, reason: conn.reason },
  })),
  { id: "test-chat", label: "Test your agent", component: TestChatStep },
];
```

Most agents have zero required connections → typical flow is 3 steps: Scan → Review → Test Chat.

### Step Components

1. **`ScanStep`** — refactored from existing `deploy-wizard.tsx` scan logic. URL input, calls `scanWebsite` server action, stores result in `WizardData.persona`, calls `onNext()`.

2. **`ReviewPersonaStep`** — refactored from existing review section. Editable fields: businessName, productService, valueProposition, tone, qualificationCriteria, escalationRules, bookingLink, customInstructions. Calls `onNext()` via "Continue" button.

3. **`ConnectionStep`** — renders for each `manifest.connections.required` entry. Shows connection type, reason, and a simple API key/config input. Stores in `WizardData.connections`. For now, just a text input — richer OAuth/config forms come later.

4. **`TestChatStep`** — chat interface + "Deploy" button. See Section 7.

---

## 7. Test Chat

### API Route

**File:** `apps/dashboard/src/app/api/dashboard/marketplace/test-chat/route.ts`

Stateless POST endpoint:

```ts
// Request
{
  persona: PersonaInput,     // subset of AgentPersona fields from wizard
  messages: Array<{ role: string; content: string }>
}

// Response
{
  reply: string
}
```

`PersonaInput` is the subset of fields the wizard collects (businessName, tone, productService, etc.) — **not** the full `AgentPersona` which has DB fields like `id`, `createdAt`, `updatedAt`, `organizationId`. The endpoint constructs a temporary `AgentPersona` with placeholder values for the DB fields.

Under the hood:

1. Constructs a temporary `AgentPersona` from `PersonaInput` + placeholder id/dates
2. Creates `LLMAdapter` via `createAnthropicAdapter()`
3. Creates `AgentRuntime` with `DefaultChatHandler`, surface `"test_chat"`, trustLevel `"autonomous"`
4. `onChatExecute` callback captures the agent's reply
5. Calls `runtime.handleMessage()` with conversation
6. Returns captured reply

No database writes. No deployment created. The agent is ephemeral.

### Test Chat UI

**File:** `apps/dashboard/src/components/marketplace/test-chat-step.tsx`

- Message list + input box
- Messages stored in React state (client-side only)
- Each send POSTs full conversation history to test-chat API
- Shows agent persona name at top
- Loading indicator while agent responds
- "Deploy — I'm happy with this agent" button at bottom
- Clicking Deploy triggers the deploy action (Section 8)

---

## 8. Deploy Action

When the user clicks "Deploy" from the test chat step:

1. **POST to `/api/dashboard/marketplace/listings/[id]/deploy`** with:
   - Persona fields from `WizardData.persona`
   - `governanceSettings: { startingAutonomy: "supervised" }`
   - `connectionIds` from connection steps (if any)

2. **Server-side** (existing deploy route, may need extension):
   - Creates `AgentPersona` record from persona fields
   - Creates `AgentDeployment` linked to listing + persona
   - Creates `DeploymentConnection` records for configured connections
   - Initializes `TrustScoreRecord` at 0

3. **Redirect to `/dashboard`** with success toast: "Your agent is live! It starts in supervised mode — you'll approve its first actions."

The existing `DeployInput` schema accepts `inputConfig`, `governanceSettings`, and `connectionIds`. The persona fields may need to be added to the deploy payload — this is a small API extension.

---

## 9. File Map

### New Files

```
packages/core/src/agent-runtime/system-prompt-assembler.ts
packages/core/src/agent-runtime/default-chat-handler.ts
packages/core/src/agent-runtime/anthropic-adapter.ts
packages/core/src/agent-runtime/__tests__/system-prompt-assembler.test.ts
packages/core/src/agent-runtime/__tests__/default-chat-handler.test.ts
packages/core/src/agent-runtime/__tests__/anthropic-adapter.test.ts

apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx
apps/dashboard/src/components/marketplace/scan-step.tsx
apps/dashboard/src/components/marketplace/review-persona-step.tsx
apps/dashboard/src/components/marketplace/connection-step.tsx
apps/dashboard/src/components/marketplace/test-chat-step.tsx
apps/dashboard/src/app/api/dashboard/marketplace/test-chat/route.ts
```

### Modified Files

```
packages/core/src/agent-runtime/index.ts           — export new modules
apps/dashboard/src/components/marketplace/deploy-wizard.tsx  — delete (replaced by new shell + steps)
apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx         — use new DeployWizardShell
apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts — extend to accept persona
```

### Dependency Flow

```
Layer 1 (schemas):  AgentPersona type
Layer 3 (core):     SystemPromptAssembler ← AgentPersona
                    DefaultChatHandler    ← SystemPromptAssembler + SDK types
                    AnthropicAdapter      ← LLMAdapter interface + @anthropic-ai/sdk
Layer 6 (dashboard): Test Chat API route  ← AgentRuntime + DefaultChatHandler + AnthropicAdapter
                     Deploy Wizard Shell  ← Step components (UI only)
```

No new Prisma models. No cross-layer violations.

---

## 10. Out of Scope

- **Real channel deployment** (Telegram, web widget) — Sub-project C
- **Custom agent handlers** — Sub-project E (developer publishing)
- **Rich connection configuration** (OAuth flows, webhook setup) — future enhancement
- **Chat history persistence** — test chat is ephemeral, no DB storage
- **Streaming responses** — simple request/response for now; streaming is a future optimization
- **Agent-to-agent handoff in test chat** — test chat tests a single agent

---

## 11. Open Questions

1. **Deploy API persona handling** — does the existing deploy route create `AgentPersona` records, or does this need to be added? (Implementation detail, not a design blocker.)
2. **Connection step UX** — for the first release, all connections are simple API key inputs. When do we need OAuth or richer config forms?
3. **Test chat rate limiting** — should we limit test chat messages per session to control LLM costs? (Suggest: not initially, monitor usage.)
