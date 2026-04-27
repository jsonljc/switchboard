# Alex Wedge Live Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the converged skill runtime in the apps and wire the calendar-book tool into Alex's live WhatsApp conversation path so a real lead can be booked.

**Architecture:** The chat app is a transport edge, not an execution host. WhatsApp messages flow through ChannelGateway → HTTP → API server's PlatformIngress → SkillMode → SkillExecutorImpl with tools. A new `/api/ingress/submit` route accepts `SubmitWorkRequest` directly. Skill intents are registered with `mode: "skill"` so the `ExecutionModeRegistry` routes them to `SkillMode`.

**Tech Stack:** TypeScript ESM, Fastify, Prisma + PostgreSQL, Anthropic SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-04-18-alex-wedge-live-wiring-design.md`

**Key finding:** ChannelGateway constructs intent as `${skillSlug}.respond` (e.g., `alex.respond`). Skill intents must be registered with this pattern. The skill frontmatter's `intent` field (`alex.run`) is metadata, not the routing key.

---

## Task 1: Fix gateway connection loading for all channel types (B4 — hard blocker)

**Files:**

- Modify: `apps/chat/src/managed/runtime-registry.ts`

Without this, no WhatsApp deployment can come online through the gateway path.

- [ ] **Step 1: Read the current `loadGatewayConnections` method**

Read `apps/chat/src/managed/runtime-registry.ts` lines 142-201 to understand the current Telegram-only implementation.

- [ ] **Step 2: Update `loadGatewayConnections` to support all channel types**

Replace the method (lines 142-174) with:

```typescript
async loadGatewayConnections(prisma: PrismaClient, gateway: ChannelGateway): Promise<void> {
  const connections = await prisma.deploymentConnection.findMany({
    where: { status: "active" },
  });
  for (const conn of connections) {
    try {
      const creds = decryptCredentials(conn.credentials);
      const adapter = this.createAdapterForConnection(conn.type, creds);
      if (!adapter) {
        console.warn(
          `[RuntimeRegistry] Unsupported gateway channel type: ${conn.type}, skipping ${conn.id}`,
        );
        continue;
      }
      const webhookPath = `/webhook/managed/${conn.id}`;
      this.gatewayEntries.set(webhookPath, {
        gateway,
        adapter,
        deploymentConnectionId: conn.id,
        channel: conn.type,
      });
    } catch (err) {
      console.error(`[RuntimeRegistry] Failed to load gateway connection ${conn.id}:`, err);
    }
  }
  console.warn(`[RuntimeRegistry] Loaded ${this.gatewayEntries.size} gateway entries`);
}

private createAdapterForConnection(
  type: string,
  creds: Record<string, unknown>,
): ChannelAdapter | null {
  if (type === "telegram") {
    const botToken = creds["botToken"] as string;
    if (!botToken) return null;
    const webhookSecret = creds["webhookSecret"] as string | undefined;
    return new TelegramAdapter(
      botToken,
      async () => ({ organizationId: "gateway" }),
      webhookSecret,
    );
  }
  if (type === "whatsapp") {
    const token = creds["token"] as string;
    const phoneNumberId = creds["phoneNumberId"] as string;
    if (!token || !phoneNumberId) return null;
    const appSecret = creds["appSecret"] as string | undefined;
    const verifyToken = creds["verifyToken"] as string | undefined;
    const wa = new WhatsAppAdapter({ token, phoneNumberId, appSecret, verifyToken });
    return Object.assign(wa, {
      resolveOrganizationId: async () => ({ organizationId: "gateway" }),
    }) as ChannelAdapter;
  }
  if (type === "slack") {
    const botToken = creds["botToken"] as string;
    if (!botToken) return null;
    const signingSecret = creds["signingSecret"] as string | undefined;
    const slack = new SlackAdapter(botToken, signingSecret);
    return Object.assign(slack, {
      resolveOrganizationId: async () => "gateway",
    }) as ChannelAdapter;
  }
  return null;
}
```

Also update `provisionGatewayConnection` (lines 180-201) to use the same `createAdapterForConnection` helper instead of hardcoding Telegram:

```typescript
async provisionGatewayConnection(
  connection: { id: string; type?: string; credentials: string },
  _prisma: PrismaClient,
  gateway: ChannelGateway,
): Promise<void> {
  const creds = decryptCredentials(connection.credentials);
  const type = connection.type ?? "telegram";
  const adapter = this.createAdapterForConnection(type, creds);
  if (!adapter) throw new Error(`Unsupported or misconfigured channel: ${type}`);
  const webhookPath = `/webhook/managed/${connection.id}`;
  this.gatewayEntries.set(webhookPath, {
    gateway,
    adapter,
    deploymentConnectionId: connection.id,
    channel: type,
  });
}
```

- [ ] **Step 3: Build and verify**

Run: `npx pnpm@9.15.4 --filter @switchboard/chat build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/chat/src/managed/runtime-registry.ts && git commit -m "$(cat <<'EOF'
fix(chat): load all channel types in gateway connection discovery
EOF
)"
```

---

## Task 2: Export createCalendarBookTool from tools barrel (B5)

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/index.ts`

- [ ] **Step 1: Add export**

Add to the end of `packages/core/src/skill-runtime/tools/index.ts`:

```typescript
export { createCalendarBookTool } from "./calendar-book.js";
```

- [ ] **Step 2: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/core build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/tools/index.ts && git commit -m "$(cat <<'EOF'
feat(core): export createCalendarBookTool from tools barrel
EOF
)"
```

---

## Task 3: Create registerSkillIntents function (A2)

**Files:**

- Create: `packages/core/src/platform/register-skill-intents.ts`
- Create: `packages/core/src/platform/register-skill-intents.test.ts`

The ChannelGateway constructs intents as `${skillSlug}.respond`. This function registers those intents with `mode: "skill"` so the `ExecutionModeRegistry` routes them to `SkillMode`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/platform/register-skill-intents.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { registerSkillIntents } from "./register-skill-intents.js";
import { IntentRegistry } from "./intent-registry.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

function makeSkill(slug: string): SkillDefinition {
  return {
    name: slug,
    slug,
    version: "1.0.0",
    description: `Test skill ${slug}`,
    author: "test",
    parameters: [],
    tools: [],
    body: "test body",
    context: [],
  };
}

describe("registerSkillIntents", () => {
  it("registers {slug}.respond intent for each skill", () => {
    const registry = new IntentRegistry();
    const skills = new Map<string, SkillDefinition>();
    skills.set("alex", makeSkill("alex"));
    skills.set("nurture", makeSkill("nurture"));

    registerSkillIntents(registry, skills);

    expect(registry.lookup("alex.respond")).toBeDefined();
    expect(registry.lookup("nurture.respond")).toBeDefined();
    expect(registry.resolveMode("alex.respond")).toBe("skill");
  });

  it("sets allowed triggers to chat, api, schedule", () => {
    const registry = new IntentRegistry();
    const skills = new Map<string, SkillDefinition>();
    skills.set("alex", makeSkill("alex"));

    registerSkillIntents(registry, skills);

    expect(registry.validateTrigger("alex.respond", "chat")).toBe(true);
    expect(registry.validateTrigger("alex.respond", "api")).toBe(true);
  });

  it("does not throw when skills map is empty", () => {
    const registry = new IntentRegistry();
    registerSkillIntents(registry, new Map());
    expect(registry.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run register-skill-intents`
Expected: FAIL

- [ ] **Step 3: Implement**

Create `packages/core/src/platform/register-skill-intents.ts`:

```typescript
import type { IntentRegistry } from "./intent-registry.js";
import type { SkillDefinition } from "../skill-runtime/types.js";

export function registerSkillIntents(
  registry: IntentRegistry,
  skills: Map<string, SkillDefinition>,
): void {
  for (const [slug] of skills) {
    const intent = `${slug}.respond`;
    registry.register({
      intent,
      defaultMode: "skill",
      allowedModes: ["skill"],
      allowedTriggers: ["chat", "api", "schedule"],
      metadata: {
        skillSlug: slug,
        description: `Respond intent for skill: ${slug}`,
      },
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run register-skill-intents`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/platform/register-skill-intents.ts packages/core/src/platform/register-skill-intents.test.ts && git commit -m "$(cat <<'EOF'
feat(core): add registerSkillIntents for skill-mode routing
EOF
)"
```

---

## Task 4: Register SkillMode in the API server (A1)

**Files:**

- Modify: `apps/api/src/app.ts`

This is the most critical task. It loads skill definitions, builds the tools map, constructs SkillExecutorImpl, and registers SkillMode in the ExecutionModeRegistry.

- [ ] **Step 1: Read the current app.ts to understand available variables**

Read `apps/api/src/app.ts` fully. Note which stores, adapters, and services are already constructed and available at the point where `modeRegistry` is created (around line 349). You need:

- `prismaClient` — for store construction
- Whatever Anthropic adapter exists — for SkillExecutorImpl
- `modelRouter` if one exists — for tier-based model selection

- [ ] **Step 2: Add skill runtime imports and wiring after CartridgeMode registration**

After line 350 (`modeRegistry.register(new CartridgeMode(...))`), add:

```typescript
// --- Skill runtime activation ---
try {
  const { loadSkill } = await import("@switchboard/core/skill-runtime/skill-loader");
  const { SkillExecutorImpl } = await import("@switchboard/core/skill-runtime/skill-executor");
  const { registerSkillIntents } =
    await import("@switchboard/core/platform/register-skill-intents");
  const { SkillMode } = await import("@switchboard/core/platform/modes/skill-mode");
  const { createCrmQueryTool, createCrmWriteTool, createCalendarBookTool } =
    await import("@switchboard/core/skill-runtime/tools");
  const { createAnthropicAdapter } = await import("@switchboard/core/agent-runtime");
  const { BuilderRegistry } = await import("@switchboard/core/skill-runtime/builder-registry");
  const { buildAlexParameters } = await import("@switchboard/core/skill-runtime/builders/alex");

  // Load skill definitions
  const skillsDir = new URL("../../../../skills", import.meta.url).pathname;
  const skillsBySlug = new Map();
  for (const slug of ["alex"]) {
    const skill = loadSkill(slug, skillsDir);
    skillsBySlug.set(slug, skill);
    app.log.info(`Loaded skill: ${slug} (v${skill.version})`);
  }

  if (skillsBySlug.size === 0) {
    throw new Error("No skills loaded — SkillMode cannot operate");
  }

  // Register skill intents
  registerSkillIntents(intentRegistry, skillsBySlug);

  // Build tools map
  const skillTools = new Map();
  if (prismaClient) {
    const {
      PrismaContactStore,
      PrismaOpportunityStore,
      PrismaActivityLogStore,
      PrismaBookingStore,
      PrismaOutboxStore,
      PrismaAgentPersonaStore,
    } = await import("@switchboard/db");

    const contactStore = new PrismaContactStore(prismaClient);
    const opportunityStore = new PrismaOpportunityStore(prismaClient);
    const activityStore = new PrismaActivityLogStore(prismaClient);
    const bookingStore = new PrismaBookingStore(prismaClient);
    const personaStore = new PrismaAgentPersonaStore(prismaClient);

    skillTools.set("crm-query", createCrmQueryTool(contactStore, activityStore));
    skillTools.set("crm-write", createCrmWriteTool(opportunityStore, activityStore));

    // Calendar-book tool with stub provider for now
    // Real GoogleCalendarAdapter wired when Google Calendar connection exists
    const stubCalendarProvider = {
      listAvailableSlots: async () => [],
      createBooking: async () => {
        throw new Error("No calendar connected");
      },
      cancelBooking: async () => {},
      rescheduleBooking: async () => {
        throw new Error("No calendar connected");
      },
      getBooking: async () => null,
      healthCheck: async () => ({ status: "disconnected" as const, latencyMs: 0 }),
    };

    skillTools.set(
      "calendar-book",
      createCalendarBookTool({
        calendarProvider: stubCalendarProvider,
        bookingStore,
        opportunityStore: {
          findActiveByContact: async (orgId: string, contactId: string) => {
            const opps = await opportunityStore.listByContact(orgId, contactId);
            return opps.find((o: { stage: string }) => !["won", "lost"].includes(o.stage)) ?? null;
          },
          create: async (input: { organizationId: string; contactId: string; service: string }) => {
            return opportunityStore.create({
              organizationId: input.organizationId,
              contactId: input.contactId,
              stage: "interested",
              service: input.service,
            });
          },
        },
        runTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
          prismaClient.$transaction(fn as never),
      }),
    );

    // Anthropic adapter for LLM calls
    const anthropicAdapter = createAnthropicAdapter();

    // Builder registry for parameter resolution
    const builderRegistry = new BuilderRegistry();
    builderRegistry.register("alex", buildAlexParameters);

    const skillExecutor = new SkillExecutorImpl(anthropicAdapter as never, skillTools);

    modeRegistry.register(
      new SkillMode({
        executor: skillExecutor,
        skillsBySlug,
        builderRegistry,
        stores: { contactStore, opportunityStore, activityStore, personaStore },
      }),
    );

    app.log.info(
      `SkillMode registered with ${skillsBySlug.size} skills and ${skillTools.size} tools`,
    );
  }
} catch (err) {
  app.log.error(err, "Failed to initialize SkillMode — skill execution unavailable");
  if (process.env.NODE_ENV === "production") {
    throw err; // Fail fast in production
  }
}
```

**Important notes for the implementer:**

- Read the actual `app.ts` to find the real variable names for stores that may already be constructed earlier in the file. Reuse them if they exist instead of creating duplicates.
- The `createAnthropicAdapter` might need different args depending on how it's used elsewhere in the file. Check imports.
- The skill tools map uses narrow subset interfaces — the `opportunityStore` wrapper adapts the real store to the `OpportunityStoreSubset` interface that `createCalendarBookTool` expects.
- The stub `calendarProvider` returns empty slots and throws on booking. This will be replaced with a real `GoogleCalendarAdapter` when a Google Calendar connection is provisioned for the org.

- [ ] **Step 3: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build`
Fix any type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts && git commit -m "$(cat <<'EOF'
feat(api): register SkillMode with tools and skill definitions
EOF
)"
```

---

## Task 5: Create ingress submit API route + HttpPlatformIngressAdapter (A3)

**Files:**

- Create: `apps/api/src/routes/ingress.ts`
- Create: `apps/chat/src/gateway/http-platform-ingress-adapter.ts`
- Modify: `apps/chat/src/main.ts`
- Modify: `apps/api/src/app.ts` (register route)

The ChannelGateway calls `platformIngress.submit(request)`. The chat app needs to delegate this to the API server. Two pieces: a new API route that accepts `SubmitWorkRequest` JSON, and an HTTP adapter in the chat app.

- [ ] **Step 1: Create the ingress API route**

Create `apps/api/src/routes/ingress.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";

export const ingressRoutes: FastifyPluginAsync = async (app) => {
  app.post("/ingress/submit", async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "PlatformIngress not available" });
    }

    const body = request.body as {
      organizationId: string;
      actor: { id: string; type: string };
      intent: string;
      parameters: Record<string, unknown>;
      trigger: string;
      deployment?: Record<string, unknown>;
    };

    if (!body.organizationId || !body.intent) {
      return reply.code(400).send({ error: "Missing organizationId or intent" });
    }

    const response = await app.platformIngress.submit({
      organizationId: body.organizationId,
      actor: { id: body.actor?.id ?? "anonymous", type: (body.actor?.type ?? "user") as "user" },
      intent: body.intent,
      parameters: body.parameters ?? {},
      trigger: (body.trigger ?? "api") as "api",
      deployment: body.deployment as never,
    });

    return reply.send(response);
  });
};
```

- [ ] **Step 2: Register the route in app.ts**

In `apps/api/src/app.ts` (or wherever routes are registered, likely `apps/api/src/bootstrap/routes.ts`), add:

```typescript
import { ingressRoutes } from "./routes/ingress.js";
// In the route registration section:
app.register(ingressRoutes, { prefix: "/api" });
```

- [ ] **Step 3: Create the HTTP adapter for the chat app**

Create `apps/chat/src/gateway/http-platform-ingress-adapter.ts`:

```typescript
interface SubmitWorkRequest {
  organizationId: string;
  actor: { id: string; type: string };
  intent: string;
  parameters: Record<string, unknown>;
  trigger: string;
  deployment?: Record<string, unknown>;
}

interface SubmitWorkResponse {
  ok: boolean;
  result?: {
    outputs: Record<string, unknown>;
    summary: string;
  };
  error?: { type: string; message: string };
}

export class HttpPlatformIngressAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async submit(request: SubmitWorkRequest): Promise<SubmitWorkResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/api/ingress/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[HttpPlatformIngress] API error ${response.status}: ${text}`);
      return {
        ok: false,
        error: { type: "api_error", message: `HTTP ${response.status}` },
      };
    }

    return response.json();
  }
}
```

- [ ] **Step 4: Wire the adapter into main.ts**

In `apps/chat/src/main.ts`, after `const prisma = getDb();` (around line 86), before `createGatewayBridge`:

```typescript
const { HttpPlatformIngressAdapter } = await import("./gateway/http-platform-ingress-adapter.js");
const apiUrl = process.env["SWITCHBOARD_API_URL"] ?? "http://localhost:3000";
const apiKey = process.env["SWITCHBOARD_API_KEY"];
const platformIngressAdapter = new HttpPlatformIngressAdapter(apiUrl, apiKey);

const gateway = createGatewayBridge(prisma, {
  platformIngress: platformIngressAdapter,
});
```

Replace the existing `const gateway = createGatewayBridge(prisma);` on line 87.

- [ ] **Step 5: Build both apps**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build && npx pnpm@9.15.4 --filter @switchboard/chat build`
Expected: Clean builds.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/ingress.ts apps/chat/src/gateway/http-platform-ingress-adapter.ts apps/chat/src/main.ts apps/api/src/app.ts apps/api/src/bootstrap/routes.ts && git commit -m "$(cat <<'EOF'
feat: wire PlatformIngress from chat to API via HTTP adapter
EOF
)"
```

---

## Task 6: Update Alex skill prompt for calendar booking (B6)

**Files:**

- Modify: `skills/alex.md`

- [ ] **Step 1: Read the current skill file**

Read `skills/alex.md` fully. Find the `tools:` array in frontmatter and the Book phase in the body.

- [ ] **Step 2: Add `calendar-book` to frontmatter tools array**

In the frontmatter section, change:

```yaml
tools:
  - crm-query
  - crm-write
```

to:

```yaml
tools:
  - crm-query
  - crm-write
  - calendar-book
```

- [ ] **Step 3: Replace the Book phase**

Find the section that contains `{{PERSONA_CONFIG.bookingLink}}` and replace the entire Book phase with:

```markdown
**Phase 4: Book**
When the lead expresses readiness to book or schedule:

1. Call `calendar-book.slots.query` with:
   - dateFrom: today's date (ISO 8601)
   - dateTo: 3 business days from today
   - durationMinutes: 30 (or from business config)
   - service: the service they discussed
   - timezone: from business config or "Asia/Singapore"

2. Present 3-5 available slots as a numbered list:
   "Great! Here are some available times:
   1. Monday Apr 21, 10:00 AM
   2. Monday Apr 21, 2:30 PM
   3. Tuesday Apr 22, 9:00 AM
      Which works best for you? Just reply with the number."

3. **Slot selection rules:**
   - If reply is a single digit 1-5 matching an offered slot, select it
   - If reply names a specific offered time unambiguously, select it
   - If reply is ambiguous ("the later one", "morning", "around 2"),
     ask a clarification question — do NOT guess or call booking.create

4. Once a slot is confirmed, call `calendar-book.booking.create` with:
   - orgId: organization ID from context
   - contactId: contact ID from context
   - service: the discussed service
   - slotStart: selected slot start time
   - slotEnd: selected slot end time
   - calendarId: "primary"
   - attendeeName: from lead profile if known
   - attendeeEmail: from lead profile if known

5. Confirm naturally:
   "You're all set! I've booked [service] for [day] at [time].
   You'll receive a calendar invite shortly."

**If calendar-book.slots.query returns empty or fails:**

- "I'm having trouble checking availability right now.
  Let me have someone reach out to confirm a time with you."
- Call crm-write.activity.log to note the failed attempt

**If calendar-book.booking.create fails:**

- "I wasn't able to lock in that slot just now.
  Let me have someone confirm your booking shortly."
- Call crm-write.activity.log to note the booking failure
- Do NOT retry silently or fabricate a confirmation
```

Remove ALL references to `{{PERSONA_CONFIG.bookingLink}}` from the file.

- [ ] **Step 4: Validate the skill loads**

Run a quick check that the skill still parses:

```bash
cd /Users/jasonljc/switchboard && node -e "
  const { loadSkill } = require('./packages/core/dist/skill-runtime/skill-loader.js');
  const skill = loadSkill('alex', './skills');
  console.log('Loaded:', skill.slug, 'Tools:', skill.tools);
"
```

Expected: `Loaded: alex Tools: [ 'crm-query', 'crm-write', 'calendar-book' ]`

If this fails due to ESM issues, build core first: `npx pnpm@9.15.4 --filter @switchboard/core build`

- [ ] **Step 5: Commit**

```bash
git add skills/alex.md && git commit -m "$(cat <<'EOF'
feat: update Alex skill prompt for calendar-book tool
EOF
)"
```

---

## Task 7: Add businessHours to OrganizationConfig + seed (B7)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/prisma/seed-marketplace.ts`

- [ ] **Step 1: Add `businessHours` field to `OrganizationConfig`**

In `packages/db/prisma/schema.prisma`, find the `OrganizationConfig` model (around line 328) and add after the `purchasedAgents` field:

```prisma
businessHours      Json?
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma generate`

- [ ] **Step 3: Create migration**

Run: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --create-only --name add_business_hours_to_org_config`

- [ ] **Step 4: Seed business hours for the demo org**

In `packages/db/prisma/seed-marketplace.ts`, find where the demo `OrganizationConfig` is created/upserted (search for `glow-aesthetics` or the demo org ID). Add `businessHours` to the upsert data:

```typescript
businessHours: {
  timezone: "Asia/Singapore",
  days: [
    { day: 1, open: "09:00", close: "17:00" },
    { day: 2, open: "09:00", close: "17:00" },
    { day: 3, open: "09:00", close: "17:00" },
    { day: 4, open: "09:00", close: "17:00" },
    { day: 5, open: "09:00", close: "17:00" },
  ],
  defaultDurationMinutes: 30,
  bufferMinutes: 15,
  slotIncrementMinutes: 30,
},
```

If the seed file does not create an `OrganizationConfig` for the demo org, find where the demo deployment is seeded (around lines 601-668) and note the `organizationId`. Then add a separate upsert for the org config.

- [ ] **Step 5: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/db build`

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/ && git commit -m "$(cat <<'EOF'
feat(db): add businessHours to OrganizationConfig and seed demo org
EOF
)"
```

---

## Task 8: Add runtime observability logs

**Files:**

- Modify: `packages/core/src/platform/prisma-deployment-resolver.ts`
- Modify: `packages/core/src/platform/execution-mode-registry.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.ts`

Three required log points for debugging live conversations.

- [ ] **Step 0: Add deployment resolution logging**

In `packages/core/src/platform/prisma-deployment-resolver.ts`, in the `resolveByChannelToken` method, after the deployment is found, add:

```typescript
console.warn(
  `[DeploymentResolver] resolved deployment=${deployment.id} skillSlug=${deployment.skillSlug} org=${deployment.organizationId}`,
);
```

- [ ] **Step 1: Add dispatch logging to ExecutionModeRegistry**

In `packages/core/src/platform/execution-mode-registry.ts`, update the `dispatch` method (line 16-27):

```typescript
async dispatch(
  modeName: string,
  workUnit: WorkUnit,
  constraints: ExecutionConstraints,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const mode = this.modes.get(modeName);
  if (!mode) {
    throw new Error(`Unknown execution mode: ${modeName}`);
  }
  console.warn(
    `[ModeRegistry] dispatch mode=${modeName} intent=${workUnit.intent} org=${workUnit.organizationId}`,
  );
  return mode.execute(workUnit, constraints, context);
}
```

- [ ] **Step 2: Add tool call logging to SkillExecutorImpl**

In `packages/core/src/skill-runtime/skill-executor.ts`, find the tool execution section (where tool_use blocks are processed, around lines 181-245). Before the `op.execute(toolUse.input)` call, add:

```typescript
console.warn(
  `[SkillExecutor] tool_call: ${toolUse.name} args=${JSON.stringify(toolUse.input).slice(0, 200)}`,
);
```

- [ ] **Step 3: Build**

Run: `npx pnpm@9.15.4 --filter @switchboard/core build`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/platform/prisma-deployment-resolver.ts packages/core/src/platform/execution-mode-registry.ts packages/core/src/skill-runtime/skill-executor.ts && git commit -m "$(cat <<'EOF'
feat(core): add runtime observability logs for skill mode dispatch
EOF
)"
```

---

## Task 9: Full build + typecheck + test

- [ ] **Step 1: Full build**

Run: `npx pnpm@9.15.4 build --force`
Expected: All packages build.

- [ ] **Step 2: Typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Fix any errors from the new code.

- [ ] **Step 3: Run all tests**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass.

- [ ] **Step 4: Verify skill loading**

Manually verify Alex loads with the calendar-book tool:

```bash
cd /Users/jasonljc/switchboard
npx pnpm@9.15.4 --filter @switchboard/core build
node --input-type=module -e "
  import { loadSkill } from './packages/core/dist/skill-runtime/skill-loader.js';
  const skill = loadSkill('alex', './skills');
  console.log('Skill:', skill.slug);
  console.log('Tools:', skill.tools);
  console.log('Version:', skill.version);
"
```

Expected output includes `Tools: [ 'crm-query', 'crm-write', 'calendar-book' ]`.

- [ ] **Step 5: Commit any fixes**
