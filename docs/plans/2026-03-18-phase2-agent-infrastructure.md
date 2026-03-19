# Phase 2: Agent Infrastructure Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the `packages/agents` package — the event envelope, port interface, router, policy bridge, dispatchers, delivery store, and agent registry that form the foundation for the "hire your AI team" product model.

**Architecture:** New package at Layer 3 (same as `core`). Imports from `@switchboard/schemas` and `@switchboard/core` only. The existing `ConversionBus` stays as an internal pub/sub — the agent router sits above it and wraps events in `RoutedEventEnvelope`s with idempotency, correlation, and attribution metadata. Agents are thin wrappers around existing cartridge logic.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspace

**Design doc:** `docs/plans/2026-03-18-agent-architecture-design.md`

---

## Task 1: Scaffold `packages/agents` Package

**Files:**

- Create: `packages/agents/package.json`
- Create: `packages/agents/tsconfig.json`
- Create: `packages/agents/vitest.config.ts`
- Create: `packages/agents/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@switchboard/agents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src --ext .ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@switchboard/schemas": "workspace:*",
    "@switchboard/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 2: Create tsconfig.json**

Copy from `packages/core/tsconfig.json` and adjust `references` to point to `../schemas` and `../core`.

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

**Step 4: Create src/index.ts**

```typescript
// ---------------------------------------------------------------------------
// @switchboard/agents — Agent infrastructure for the closed-loop funnel
// ---------------------------------------------------------------------------

export * from "./events.js";
export * from "./ports.js";
export * from "./registry.js";
export * from "./router.js";
export * from "./route-plan.js";
export * from "./policy-bridge.js";
export * from "./delivery-store.js";
```

This will fail to compile until subsequent tasks create the referenced files — that's expected.

**Step 5: Install dependencies**

Run: `cd /Users/jasonljc/switchboard && pnpm install`
Expected: `@switchboard/agents` appears in the workspace.

**Step 6: Commit**

```bash
git add packages/agents/
git commit -m "chore: scaffold @switchboard/agents package"
```

---

## Task 2: Define Canonical Event Types and Event Envelope

**Files:**

- Create: `packages/agents/src/events.ts`
- Create: `packages/agents/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/events.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createEventEnvelope,
  type RoutedEventEnvelope,
  type AttributionChain,
  AGENT_EVENT_TYPES,
} from "../events.js";

describe("createEventEnvelope", () => {
  it("creates an envelope with generated eventId and idempotencyKey", () => {
    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram-adapter" },
      payload: { contactId: "c1", message: "Hi" },
    });

    expect(envelope.eventId).toBeTruthy();
    expect(envelope.idempotencyKey).toBeTruthy();
    expect(envelope.correlationId).toBeTruthy();
    expect(envelope.organizationId).toBe("org-1");
    expect(envelope.eventType).toBe("lead.received");
    expect(envelope.source.type).toBe("webhook");
    expect(envelope.occurredAt).toBeTruthy();
  });

  it("preserves explicit correlationId and causationId", () => {
    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      correlationId: "corr-abc",
      causationId: "event-xyz",
      payload: { contactId: "c1", score: 85 },
    });

    expect(envelope.correlationId).toBe("corr-abc");
    expect(envelope.causationId).toBe("event-xyz");
  });

  it("attaches attribution chain when provided", () => {
    const attribution: AttributionChain = {
      fbclid: "fb-123",
      gclid: null,
      ttclid: null,
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
      utmSource: "meta",
      utmMedium: "paid",
      utmCampaign: "spring-promo",
    };

    const envelope = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "deal-stage-handler" },
      attribution,
      payload: { amount: 350 },
    });

    expect(envelope.attribution).toEqual(attribution);
  });

  it("generates unique eventIds for each call", () => {
    const e1 = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "wa" },
      payload: {},
    });
    const e2 = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "wa" },
      payload: {},
    });

    expect(e1.eventId).not.toBe(e2.eventId);
  });
});

describe("AGENT_EVENT_TYPES", () => {
  it("contains all canonical event types", () => {
    expect(AGENT_EVENT_TYPES).toContain("lead.received");
    expect(AGENT_EVENT_TYPES).toContain("lead.qualified");
    expect(AGENT_EVENT_TYPES).toContain("lead.disqualified");
    expect(AGENT_EVENT_TYPES).toContain("stage.advanced");
    expect(AGENT_EVENT_TYPES).toContain("stage.reverted");
    expect(AGENT_EVENT_TYPES).toContain("revenue.recorded");
    expect(AGENT_EVENT_TYPES).toContain("revenue.attributed");
    expect(AGENT_EVENT_TYPES).toContain("ad.optimized");
    expect(AGENT_EVENT_TYPES).toContain("conversation.escalated");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/events.ts`:

```typescript
// ---------------------------------------------------------------------------
// Canonical Agent Events & RoutedEventEnvelope
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";

export const AGENT_EVENT_TYPES = [
  "lead.received",
  "lead.qualified",
  "lead.disqualified",
  "stage.advanced",
  "stage.reverted",
  "revenue.recorded",
  "revenue.attributed",
  "ad.optimized",
  "conversation.escalated",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface EventSource {
  type: "agent" | "connector" | "webhook" | "manual" | "system";
  id: string;
}

export interface AttributionChain {
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface RoutedEventEnvelope<TPayload = unknown> {
  eventId: string;
  organizationId: string;
  eventType: string;
  occurredAt: string;
  source: EventSource;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  attribution?: AttributionChain;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export interface CreateEnvelopeInput<TPayload = unknown> {
  organizationId: string;
  eventType: string;
  source: EventSource;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  attribution?: AttributionChain;
  metadata?: Record<string, unknown>;
}

export function createEventEnvelope<TPayload = unknown>(
  input: CreateEnvelopeInput<TPayload>,
): RoutedEventEnvelope<TPayload> {
  const eventId = randomUUID();
  return {
    eventId,
    organizationId: input.organizationId,
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId ?? randomUUID(),
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey ?? eventId,
    attribution: input.attribution,
    payload: input.payload,
    metadata: input.metadata,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/agents/src/events.ts packages/agents/src/__tests__/events.test.ts
git commit -m "feat(agents): add canonical event types and RoutedEventEnvelope"
```

---

## Task 3: Define Agent Port Interface

**Files:**

- Create: `packages/agents/src/ports.ts`
- Create: `packages/agents/src/__tests__/ports.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/ports.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateAgentPort, type AgentPort } from "../ports.js";

describe("validateAgentPort", () => {
  it("validates a well-formed agent port", () => {
    const port: AgentPort = {
      agentId: "lead-responder",
      version: "0.1.0",
      inboundEvents: ["lead.received"],
      outboundEvents: ["lead.qualified", "lead.disqualified", "conversation.escalated"],
      tools: [
        {
          name: "qualify_lead",
          description: "Run qualification flow and score the lead",
          parameters: { contactId: { type: "string" } },
        },
      ],
      configSchema: {
        type: "object",
        properties: {
          autoQualify: { type: "boolean" },
        },
      },
    };

    const result = validateAgentPort(port);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects port with empty agentId", () => {
    const port: AgentPort = {
      agentId: "",
      version: "0.1.0",
      inboundEvents: ["lead.received"],
      outboundEvents: [],
      tools: [],
      configSchema: {},
    };

    const result = validateAgentPort(port);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agentId must not be empty");
  });

  it("rejects port with no inbound events", () => {
    const port: AgentPort = {
      agentId: "broken-agent",
      version: "0.1.0",
      inboundEvents: [],
      outboundEvents: ["lead.qualified"],
      tools: [],
      configSchema: {},
    };

    const result = validateAgentPort(port);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("inboundEvents must have at least one event");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/ports.ts`:

```typescript
// ---------------------------------------------------------------------------
// Agent Port Interface — standard contract for hireable agents
// ---------------------------------------------------------------------------

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentPort {
  agentId: string;
  version: string;
  inboundEvents: string[];
  outboundEvents: string[];
  tools: ToolDeclaration[];
  configSchema: Record<string, unknown>;
  conversionActionTypes?: string[];
}

export interface AgentHandler {
  handle(
    event: import("./events.js").RoutedEventEnvelope,
    config: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResponse>;
}

export interface AgentContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
}

export interface AgentResponse {
  events: import("./events.js").RoutedEventEnvelope[];
  actions: ActionRequest[];
  state?: Record<string, unknown>;
}

export interface ActionRequest {
  actionType: string;
  parameters: Record<string, unknown>;
}

export interface PortValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAgentPort(port: AgentPort): PortValidationResult {
  const errors: string[] = [];

  if (!port.agentId || port.agentId.trim() === "") {
    errors.push("agentId must not be empty");
  }

  if (!port.version || port.version.trim() === "") {
    errors.push("version must not be empty");
  }

  if (!port.inboundEvents || port.inboundEvents.length === 0) {
    errors.push("inboundEvents must have at least one event");
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/ports.ts packages/agents/src/__tests__/ports.test.ts
git commit -m "feat(agents): add AgentPort interface and validation"
```

---

## Task 4: Build Agent Registry

**Files:**

- Create: `packages/agents/src/registry.ts`
- Create: `packages/agents/src/__tests__/registry.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentRegistry, type AgentRegistryEntry } from "../registry.js";

describe("AgentRegistry", () => {
  it("registers an agent with draft status", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead", "score_lead"],
      },
    });

    const entry = registry.get("org-1", "lead-responder");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("draft");
    expect(entry!.installed).toBe(true);
  });

  it("activates a draft agent", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: { autoQualify: true },
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified"],
        tools: ["qualify_lead"],
      },
    });

    registry.updateStatus("org-1", "lead-responder", "active");
    const entry = registry.get("org-1", "lead-responder");
    expect(entry!.status).toBe("active");
  });

  it("lists only active agents for an org", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: {},
      capabilities: { accepts: ["lead.qualified"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "nurture",
      version: "0.1.0",
      installed: true,
      status: "paused",
      config: {},
      capabilities: { accepts: ["stage.advanced"], emits: [], tools: [] },
    });

    const active = registry.listActive("org-1");
    expect(active).toHaveLength(1);
    expect(active[0]!.agentId).toBe("lead-responder");
  });

  it("finds agents that accept a given event type", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.qualified"], emits: [], tools: [] },
    });

    const responders = registry.findByInboundEvent("org-1", "lead.received");
    expect(responders).toHaveLength(1);
    expect(responders[0]!.agentId).toBe("lead-responder");
  });

  it("returns empty array for unknown org", () => {
    const registry = new AgentRegistry();
    expect(registry.listActive("unknown-org")).toEqual([]);
    expect(registry.findByInboundEvent("unknown-org", "lead.received")).toEqual([]);
  });

  it("updates runtime info", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    registry.updateRuntime("org-1", "lead-responder", {
      provider: "openclaw",
      sessionId: "sess-123",
      health: "healthy",
      lastHeartbeatAt: "2026-03-18T10:00:00Z",
    });

    const entry = registry.get("org-1", "lead-responder");
    expect(entry!.runtime?.sessionId).toBe("sess-123");
    expect(entry!.runtime?.health).toBe("healthy");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/agents/src/registry.ts`:

```typescript
// ---------------------------------------------------------------------------
// Agent Registry — tracks which agents are installed/active per organization
// ---------------------------------------------------------------------------

export type AgentStatus = "draft" | "active" | "paused" | "error" | "disabled";
export type AgentHealth = "healthy" | "degraded" | "offline";

export interface AgentRuntime {
  provider: "openclaw";
  sessionId?: string;
  health?: AgentHealth;
  lastHeartbeatAt?: string;
}

export interface AgentRegistryEntry {
  agentId: string;
  version: string;
  installed: boolean;
  status: AgentStatus;
  config: Record<string, unknown>;
  capabilities: {
    accepts: string[];
    emits: string[];
    tools: string[];
  };
  runtime?: AgentRuntime;
  lastActiveAt?: string;
}

type RegistrationInput = Omit<AgentRegistryEntry, "lastActiveAt">;

export class AgentRegistry {
  private entries = new Map<string, Map<string, AgentRegistryEntry>>();

  register(organizationId: string, entry: RegistrationInput): void {
    let orgMap = this.entries.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.entries.set(organizationId, orgMap);
    }
    orgMap.set(entry.agentId, { ...entry, lastActiveAt: undefined });
  }

  get(organizationId: string, agentId: string): AgentRegistryEntry | undefined {
    return this.entries.get(organizationId)?.get(agentId);
  }

  listAll(organizationId: string): AgentRegistryEntry[] {
    const orgMap = this.entries.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  listActive(organizationId: string): AgentRegistryEntry[] {
    return this.listAll(organizationId).filter((e) => e.status === "active");
  }

  findByInboundEvent(organizationId: string, eventType: string): AgentRegistryEntry[] {
    return this.listActive(organizationId).filter((e) =>
      e.capabilities.accepts.includes(eventType),
    );
  }

  updateStatus(organizationId: string, agentId: string, status: AgentStatus): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.status = status;
      if (status === "active") {
        entry.lastActiveAt = new Date().toISOString();
      }
    }
  }

  updateRuntime(organizationId: string, agentId: string, runtime: AgentRuntime): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.runtime = runtime;
    }
  }

  updateConfig(organizationId: string, agentId: string, config: Record<string, unknown>): void {
    const entry = this.get(organizationId, agentId);
    if (entry) {
      entry.config = config;
    }
  }

  remove(organizationId: string, agentId: string): boolean {
    const orgMap = this.entries.get(organizationId);
    return orgMap?.delete(agentId) ?? false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add packages/agents/src/registry.ts packages/agents/src/__tests__/registry.test.ts
git commit -m "feat(agents): add AgentRegistry with lifecycle state management"
```

---

## Task 5: Build Route Plan and Router

**Files:**

- Create: `packages/agents/src/route-plan.ts`
- Create: `packages/agents/src/router.ts`
- Create: `packages/agents/src/__tests__/router.test.ts`

**Step 1: Write the route-plan types**

Create `packages/agents/src/route-plan.ts`:

```typescript
// ---------------------------------------------------------------------------
// Route Plan — destination resolution output
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";

export type DestinationType = "agent" | "connector" | "webhook" | "manual_queue" | "system";
export type DestinationCriticality = "required" | "optional" | "best_effort";
export type DestinationSequencing = "parallel" | "after_success" | "blocking";

export interface ResolvedDestination {
  type: DestinationType;
  id: string;
  criticality: DestinationCriticality;
  sequencing: DestinationSequencing;
  afterDestinationId?: string;
}

export interface RoutePlan {
  event: RoutedEventEnvelope;
  destinations: ResolvedDestination[];
}

export type ManualQueueReason =
  | "manual_review"
  | "human_approval"
  | "needs_configuration"
  | "failed_after_retries"
  | "blocked_by_policy";

export interface WebhookDestinationConfig {
  id: string;
  url: string;
  secret?: string;
  subscribedEvents: string[];
  criticality: DestinationCriticality;
  enabled: boolean;
}

export interface ConnectorDestinationConfig {
  id: string;
  connectorType: string;
  subscribedEvents: string[];
  criticality: DestinationCriticality;
  enabled: boolean;
  config: Record<string, unknown>;
}
```

**Step 2: Write the failing test**

Create `packages/agents/src/__tests__/router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentRouter } from "../router.js";
import { AgentRegistry } from "../registry.js";
import { createEventEnvelope } from "../events.js";
import type { WebhookDestinationConfig, ConnectorDestinationConfig } from "../route-plan.js";

describe("AgentRouter", () => {
  function buildRegistry(): AgentRegistry {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead"],
      },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: {
        accepts: ["lead.qualified"],
        emits: ["stage.advanced"],
        tools: ["book_appointment"],
      },
    });
    return registry;
  }

  it("routes to hired agent that accepts the event", () => {
    const registry = buildRegistry();
    const router = new AgentRouter(registry);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("agent");
    expect(plan.destinations[0]!.id).toBe("lead-responder");
    expect(plan.destinations[0]!.criticality).toBe("required");
  });

  it("routes to webhook when no agent accepts the event", () => {
    const registry = new AgentRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "hubspot-hook",
        url: "https://hooks.hubspot.com/abc",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: true,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "intake" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("webhook");
    expect(plan.destinations[0]!.id).toBe("hubspot-hook");
  });

  it("fans out to both agent and webhook", () => {
    const registry = buildRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "analytics-hook",
        url: "https://analytics.example.com/events",
        subscribedEvents: ["lead.received"],
        criticality: "best_effort",
        enabled: true,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(2);

    const agentDest = plan.destinations.find((d) => d.type === "agent");
    const webhookDest = plan.destinations.find((d) => d.type === "webhook");
    expect(agentDest).toBeDefined();
    expect(webhookDest).toBeDefined();
    expect(webhookDest!.criticality).toBe("best_effort");
  });

  it("routes to manual_queue when no destination matches", () => {
    const registry = new AgentRegistry();
    const router = new AgentRouter(registry);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");
  });

  it("skips disabled webhooks", () => {
    const registry = new AgentRegistry();
    const webhooks: WebhookDestinationConfig[] = [
      {
        id: "disabled-hook",
        url: "https://example.com",
        subscribedEvents: ["lead.received"],
        criticality: "required",
        enabled: false,
      },
    ];
    const router = new AgentRouter(registry, { webhooks });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");
  });

  it("includes connector destinations", () => {
    const registry = new AgentRegistry();
    const connectors: ConnectorDestinationConfig[] = [
      {
        id: "hubspot-connector",
        connectorType: "hubspot",
        subscribedEvents: ["lead.qualified"],
        criticality: "required",
        enabled: true,
        config: { apiKey: "xxx" },
      },
    ];
    const router = new AgentRouter(registry, { connectors });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: {},
    });

    const plan = router.resolve(event);
    const connDest = plan.destinations.find((d) => d.type === "connector");
    expect(connDest).toBeDefined();
    expect(connDest!.id).toBe("hubspot-connector");
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL — module not found

**Step 4: Write implementation**

Create `packages/agents/src/router.ts`:

```typescript
// ---------------------------------------------------------------------------
// Agent Router — resolves destinations for events, produces RoutePlans
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { AgentRegistry } from "./registry.js";
import type {
  RoutePlan,
  ResolvedDestination,
  WebhookDestinationConfig,
  ConnectorDestinationConfig,
} from "./route-plan.js";

export interface AgentRouterConfig {
  webhooks?: WebhookDestinationConfig[];
  connectors?: ConnectorDestinationConfig[];
}

export class AgentRouter {
  constructor(
    private registry: AgentRegistry,
    private config: AgentRouterConfig = {},
  ) {}

  resolve(event: RoutedEventEnvelope): RoutePlan {
    const destinations: ResolvedDestination[] = [];

    // 1. Find active agents that accept this event
    const agents = this.registry.findByInboundEvent(event.organizationId, event.eventType);
    for (const agent of agents) {
      destinations.push({
        type: "agent",
        id: agent.agentId,
        criticality: "required",
        sequencing: "parallel",
      });
    }

    // 2. Find native connectors subscribed to this event
    const connectors = (this.config.connectors ?? []).filter(
      (c) => c.enabled && c.subscribedEvents.includes(event.eventType),
    );
    for (const connector of connectors) {
      destinations.push({
        type: "connector",
        id: connector.id,
        criticality: connector.criticality,
        sequencing: "parallel",
      });
    }

    // 3. Find webhooks subscribed to this event
    const webhooks = (this.config.webhooks ?? []).filter(
      (w) => w.enabled && w.subscribedEvents.includes(event.eventType),
    );
    for (const webhook of webhooks) {
      destinations.push({
        type: "webhook",
        id: webhook.id,
        criticality: webhook.criticality,
        sequencing: "parallel",
      });
    }

    // 4. If no destinations found, route to manual queue
    if (destinations.length === 0) {
      destinations.push({
        type: "manual_queue",
        id: "unrouted",
        criticality: "required",
        sequencing: "parallel",
      });
    }

    return { event, destinations };
  }
}
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (6 tests)

**Step 6: Commit**

```bash
git add packages/agents/src/route-plan.ts packages/agents/src/router.ts packages/agents/src/__tests__/router.test.ts
git commit -m "feat(agents): add AgentRouter with destination resolution and fan-out"
```

---

## Task 6: Build Policy Bridge

**Files:**

- Create: `packages/agents/src/policy-bridge.ts`
- Create: `packages/agents/src/__tests__/policy-bridge.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/policy-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PolicyBridge, type DeliveryIntent } from "../policy-bridge.js";

describe("PolicyBridge", () => {
  it("approves intent when policy engine allows", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "allow" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "lead-responder",
      action: "lead.received",
      payload: { contactId: "c1" },
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(true);
  });

  it("denies intent when policy engine denies", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "deny", reason: "consent not active" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "webhook",
      destinationId: "hubspot",
      action: "reminder.send",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("consent not active");
  });

  it("marks requires_approval when policy engine requests it", async () => {
    const policyEngine = {
      evaluate: vi.fn().mockResolvedValue({ effect: "require_approval" }),
    };
    const bridge = new PolicyBridge(policyEngine);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "sales-closer",
      action: "appointment.book",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("approves when no policy engine is configured (permissive mode)", async () => {
    const bridge = new PolicyBridge(null);

    const intent: DeliveryIntent = {
      eventId: "evt-1",
      destinationType: "agent",
      destinationId: "lead-responder",
      action: "lead.received",
      payload: {},
      criticality: "required",
    };

    const result = await bridge.evaluate(intent);
    expect(result.approved).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/policy-bridge.ts`:

```typescript
// ---------------------------------------------------------------------------
// Policy Bridge — evaluates DeliveryIntents against the governance policy engine
// ---------------------------------------------------------------------------

export interface DeliveryIntent {
  eventId: string;
  destinationType: "agent" | "connector" | "webhook" | "manual_queue" | "system";
  destinationId: string;
  action: string;
  payload: unknown;
  criticality: "required" | "optional" | "best_effort";
}

export interface PolicyEvaluation {
  approved: boolean;
  requiresApproval?: boolean;
  reason?: string;
}

export interface PolicyEngine {
  evaluate(intent: DeliveryIntent): Promise<{ effect: string; reason?: string }>;
}

export class PolicyBridge {
  constructor(private engine: PolicyEngine | null) {}

  async evaluate(intent: DeliveryIntent): Promise<PolicyEvaluation> {
    if (!this.engine) {
      return { approved: true };
    }

    const result = await this.engine.evaluate(intent);

    if (result.effect === "allow") {
      return { approved: true };
    }

    if (result.effect === "require_approval") {
      return { approved: false, requiresApproval: true, reason: result.reason };
    }

    return { approved: false, reason: result.reason };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/agents/src/policy-bridge.ts packages/agents/src/__tests__/policy-bridge.test.ts
git commit -m "feat(agents): add PolicyBridge for delivery intent governance"
```

---

## Task 7: Build Delivery Store

**Files:**

- Create: `packages/agents/src/delivery-store.ts`
- Create: `packages/agents/src/__tests__/delivery-store.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/delivery-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryDeliveryStore, type DeliveryAttempt } from "../delivery-store.js";

describe("InMemoryDeliveryStore", () => {
  it("records a delivery attempt", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "dispatched",
      attempts: 1,
      lastAttemptAt: "2026-03-18T10:00:00Z",
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe("dispatched");
  });

  it("updates an existing delivery attempt", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "dispatched",
      attempts: 1,
      lastAttemptAt: "2026-03-18T10:00:00Z",
    });

    await store.update("evt-1", "lead-responder", {
      status: "succeeded",
      attempts: 1,
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts[0]!.status).toBe("succeeded");
  });

  it("tracks multiple destinations per event independently", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "lead-responder",
      status: "succeeded",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-1",
      destinationId: "hubspot-hook",
      status: "failed",
      attempts: 2,
      error: "Connection refused",
    });

    const attempts = await store.getByEvent("evt-1");
    expect(attempts).toHaveLength(2);

    const failed = attempts.find((a) => a.destinationId === "hubspot-hook");
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toBe("Connection refused");
  });

  it("lists failed deliveries for retry", async () => {
    const store = new InMemoryDeliveryStore();
    await store.record({
      eventId: "evt-1",
      destinationId: "hook-1",
      status: "failed",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-2",
      destinationId: "hook-2",
      status: "succeeded",
      attempts: 1,
    });
    await store.record({
      eventId: "evt-3",
      destinationId: "hook-3",
      status: "retrying",
      attempts: 2,
    });

    const retryable = await store.listRetryable();
    expect(retryable).toHaveLength(2);
    expect(retryable.map((a) => a.eventId).sort()).toEqual(["evt-1", "evt-3"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/delivery-store.ts`:

```typescript
// ---------------------------------------------------------------------------
// Delivery Store — per-destination delivery attempt tracking
// ---------------------------------------------------------------------------

export type DeliveryStatus =
  | "pending"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "retrying"
  | "dead_letter";

export interface DeliveryAttempt {
  eventId: string;
  destinationId: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}

export interface DeliveryStore {
  record(attempt: DeliveryAttempt): Promise<void>;
  update(
    eventId: string,
    destinationId: string,
    updates: Partial<Pick<DeliveryAttempt, "status" | "attempts" | "error" | "lastAttemptAt">>,
  ): Promise<void>;
  getByEvent(eventId: string): Promise<DeliveryAttempt[]>;
  listRetryable(): Promise<DeliveryAttempt[]>;
}

export class InMemoryDeliveryStore implements DeliveryStore {
  private attempts = new Map<string, DeliveryAttempt>();

  private key(eventId: string, destinationId: string): string {
    return `${eventId}::${destinationId}`;
  }

  async record(attempt: DeliveryAttempt): Promise<void> {
    this.attempts.set(this.key(attempt.eventId, attempt.destinationId), { ...attempt });
  }

  async update(
    eventId: string,
    destinationId: string,
    updates: Partial<Pick<DeliveryAttempt, "status" | "attempts" | "error" | "lastAttemptAt">>,
  ): Promise<void> {
    const existing = this.attempts.get(this.key(eventId, destinationId));
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  async getByEvent(eventId: string): Promise<DeliveryAttempt[]> {
    const results: DeliveryAttempt[] = [];
    for (const [key, attempt] of this.attempts) {
      if (key.startsWith(`${eventId}::`)) {
        results.push({ ...attempt });
      }
    }
    return results;
  }

  async listRetryable(): Promise<DeliveryAttempt[]> {
    const results: DeliveryAttempt[] = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.status === "failed" || attempt.status === "retrying") {
        results.push({ ...attempt });
      }
    }
    return results;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/agents/src/delivery-store.ts packages/agents/src/__tests__/delivery-store.test.ts
git commit -m "feat(agents): add DeliveryStore for per-destination attempt tracking"
```

---

## Task 8: Build Dispatcher Pipeline

**Files:**

- Create: `packages/agents/src/dispatcher.ts`
- Create: `packages/agents/src/__tests__/dispatcher.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { Dispatcher } from "../dispatcher.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { PolicyBridge } from "../policy-bridge.js";
import { createEventEnvelope } from "../events.js";
import type { RoutePlan } from "../route-plan.js";

describe("Dispatcher", () => {
  it("dispatches to agent destination and records success", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("succeeded");
    expect(agentHandler).toHaveBeenCalledWith(event, "lead-responder");
  });

  it("records failure when handler throws", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockRejectedValue(new Error("Agent offline"));

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.error).toBe("Agent offline");
  });

  it("skips destinations blocked by policy", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge({
      evaluate: vi.fn().mockResolvedValue({ effect: "deny", reason: "no consent" }),
    });
    const agentHandler = vi.fn();

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "reminder.send",
      source: { type: "agent", id: "nurture" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "nurture", criticality: "required", sequencing: "parallel" },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("blocked_by_policy");
    expect(agentHandler).not.toHaveBeenCalled();
  });

  it("dispatches to multiple destinations in parallel", async () => {
    const store = new InMemoryDeliveryStore();
    const bridge = new PolicyBridge(null);
    const agentHandler = vi.fn().mockResolvedValue({ success: true });
    const webhookHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { agent: agentHandler, webhook: webhookHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: {},
    });

    const plan: RoutePlan = {
      event,
      destinations: [
        { type: "agent", id: "lead-responder", criticality: "required", sequencing: "parallel" },
        {
          type: "webhook",
          id: "analytics-hook",
          criticality: "best_effort",
          sequencing: "parallel",
        },
      ],
    };

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/dispatcher.ts`:

```typescript
// ---------------------------------------------------------------------------
// Dispatcher — executes approved delivery intents from a RoutePlan
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { RoutePlan, DestinationType } from "./route-plan.js";
import type { PolicyBridge } from "./policy-bridge.js";
import type { DeliveryStore, DeliveryStatus } from "./delivery-store.js";

export type DestinationHandler = (
  event: RoutedEventEnvelope,
  destinationId: string,
) => Promise<{ success: boolean }>;

export interface DispatchResult {
  destinationId: string;
  destinationType: DestinationType;
  status: DeliveryStatus | "blocked_by_policy";
  error?: string;
}

export interface DispatcherConfig {
  deliveryStore: DeliveryStore;
  policyBridge: PolicyBridge;
  handlers: Partial<Record<DestinationType, DestinationHandler>>;
}

export class Dispatcher {
  private store: DeliveryStore;
  private bridge: PolicyBridge;
  private handlers: Partial<Record<DestinationType, DestinationHandler>>;

  constructor(config: DispatcherConfig) {
    this.store = config.deliveryStore;
    this.bridge = config.policyBridge;
    this.handlers = config.handlers;
  }

  async execute(plan: RoutePlan): Promise<DispatchResult[]> {
    const results: Promise<DispatchResult>[] = [];

    for (const dest of plan.destinations) {
      if (dest.sequencing === "parallel") {
        results.push(this.dispatchOne(plan.event, dest.type, dest.id, dest.criticality));
      }
    }

    return Promise.all(results);
  }

  private async dispatchOne(
    event: RoutedEventEnvelope,
    type: DestinationType,
    destinationId: string,
    criticality: string,
  ): Promise<DispatchResult> {
    // 1. Policy check
    const evaluation = await this.bridge.evaluate({
      eventId: event.eventId,
      destinationType: type,
      destinationId,
      action: event.eventType,
      payload: event.payload,
      criticality: criticality as "required" | "optional" | "best_effort",
    });

    if (!evaluation.approved) {
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 0,
        error: evaluation.reason ?? "blocked by policy",
      });
      return {
        destinationId,
        destinationType: type,
        status: "blocked_by_policy",
        error: evaluation.reason,
      };
    }

    // 2. Find handler
    const handler = this.handlers[type];
    if (!handler) {
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 1,
        error: `No handler for destination type: ${type}`,
      });
      return {
        destinationId,
        destinationType: type,
        status: "failed",
        error: `No handler for destination type: ${type}`,
      };
    }

    // 3. Dispatch
    try {
      await handler(event, destinationId);
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "succeeded",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
      });
      return { destinationId, destinationType: type, status: "succeeded" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.store.record({
        eventId: event.eventId,
        destinationId,
        status: "failed",
        attempts: 1,
        lastAttemptAt: new Date().toISOString(),
        error,
      });
      return { destinationId, destinationType: type, status: "failed", error };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: PASS (4 tests)

**Step 5: Update index.ts to export dispatcher**

In `packages/agents/src/index.ts`, add:

```typescript
export * from "./dispatcher.js";
```

**Step 6: Commit**

```bash
git add packages/agents/src/dispatcher.ts packages/agents/src/__tests__/dispatcher.test.ts packages/agents/src/index.ts
git commit -m "feat(agents): add Dispatcher pipeline with policy check and delivery tracking"
```

---

## Task 9: Integration Test — Full Pipeline

**Files:**

- Create: `packages/agents/src/__tests__/pipeline.test.ts`

**Step 1: Write the integration test**

Create `packages/agents/src/__tests__/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { AgentRegistry } from "../registry.js";
import { AgentRouter } from "../router.js";
import { PolicyBridge } from "../policy-bridge.js";
import { InMemoryDeliveryStore } from "../delivery-store.js";
import { Dispatcher } from "../dispatcher.js";
import { createEventEnvelope } from "../events.js";

describe("Full Pipeline: event → route → policy → dispatch → delivery", () => {
  it("routes lead.received to lead-responder and tracks delivery", async () => {
    // 1. Registry: lead-responder is hired and active
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: { autoQualify: true },
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead"],
      },
    });

    // 2. Router: resolve destinations
    const router = new AgentRouter(registry, {
      webhooks: [
        {
          id: "slack-notification",
          url: "https://hooks.slack.com/xxx",
          subscribedEvents: ["lead.received"],
          criticality: "best_effort",
          enabled: true,
        },
      ],
    });

    // 3. Policy bridge: permissive
    const bridge = new PolicyBridge(null);

    // 4. Delivery store
    const store = new InMemoryDeliveryStore();

    // 5. Handlers
    const agentHandler = vi.fn().mockResolvedValue({ success: true });
    const webhookHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: {
        agent: agentHandler,
        webhook: webhookHandler,
      },
    });

    // 6. Emit event
    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1", message: "Hi, interested in teeth whitening" },
      attribution: {
        fbclid: "fb-abc123",
        gclid: null,
        ttclid: null,
        sourceCampaignId: "camp-spring-2026",
        sourceAdId: "ad-whitening-01",
        utmSource: "meta",
        utmMedium: "paid",
        utmCampaign: "spring-promo",
      },
    });

    // 7. Route
    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(2);

    // 8. Dispatch
    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);

    // 9. Verify agent handler received the event with attribution
    expect(agentHandler).toHaveBeenCalledWith(event, "lead-responder");
    expect(event.attribution?.sourceCampaignId).toBe("camp-spring-2026");

    // 10. Verify delivery store recorded both
    const deliveries = await store.getByEvent(event.eventId);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === "succeeded")).toBe(true);
  });

  it("routes to manual_queue when no agents are hired", async () => {
    const registry = new AgentRegistry();
    const router = new AgentRouter(registry);
    const bridge = new PolicyBridge(null);
    const store = new InMemoryDeliveryStore();
    const manualHandler = vi.fn().mockResolvedValue({ success: true });

    const dispatcher = new Dispatcher({
      deliveryStore: store,
      policyBridge: bridge,
      handlers: { manual_queue: manualHandler },
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "webhook", id: "telegram" },
      payload: { contactId: "c1" },
    });

    const plan = router.resolve(event);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]!.type).toBe("manual_queue");

    const results = await dispatcher.execute(plan);
    expect(results).toHaveLength(1);
    expect(manualHandler).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: ALL PASS — events, ports, registry, router, policy-bridge, delivery-store, dispatcher, pipeline

**Step 3: Commit**

```bash
git add packages/agents/src/__tests__/pipeline.test.ts
git commit -m "test(agents): add full pipeline integration test"
```

---

## Task 10: Final Wiring — Typecheck and Build

**Step 1: Verify index.ts exports all modules**

Read `packages/agents/src/index.ts` and confirm it exports:

```typescript
export * from "./events.js";
export * from "./ports.js";
export * from "./registry.js";
export * from "./router.js";
export * from "./route-plan.js";
export * from "./policy-bridge.js";
export * from "./delivery-store.js";
export * from "./dispatcher.js";
```

**Step 2: Run full package typecheck**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents typecheck`
Expected: clean, no errors

**Step 3: Run full package tests**

Run: `cd /Users/jasonljc/switchboard && pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 4: Run workspace build**

Run: `cd /Users/jasonljc/switchboard && pnpm build`
Expected: all packages build successfully including `@switchboard/agents`

**Step 5: Run full workspace tests**

Run: `cd /Users/jasonljc/switchboard && pnpm test`
Expected: no regressions — new package tests pass, existing tests unaffected

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(agents): complete Phase 2 agent infrastructure foundation"
```

---

## Implementation Order

```
Task 1:  Scaffold package                    (parallel-safe)
Task 2:  Event envelope + canonical types    (depends on Task 1)
Task 3:  Agent port interface                (depends on Task 1)
Task 4:  Agent registry                      (depends on Task 1)
Task 5:  Route plan + router                 (depends on Task 2, Task 4)
Task 6:  Policy bridge                       (depends on Task 2)
Task 7:  Delivery store                      (depends on Task 1)
Task 8:  Dispatcher pipeline                 (depends on Task 5, Task 6, Task 7)
Task 9:  Integration test                    (depends on all above)
Task 10: Final wiring + build verification   (depends on all above)
```

Tasks 2, 3, 4, 6, 7 can run in parallel after Task 1.
Tasks 5 and 8 are sequential.
Tasks 9 and 10 are final gates.

## Files Summary

| Action | File                                                   | Task   |
| ------ | ------------------------------------------------------ | ------ |
| CREATE | `packages/agents/package.json`                         | T1     |
| CREATE | `packages/agents/tsconfig.json`                        | T1     |
| CREATE | `packages/agents/vitest.config.ts`                     | T1     |
| CREATE | `packages/agents/src/index.ts`                         | T1, T8 |
| CREATE | `packages/agents/src/events.ts`                        | T2     |
| CREATE | `packages/agents/src/__tests__/events.test.ts`         | T2     |
| CREATE | `packages/agents/src/ports.ts`                         | T3     |
| CREATE | `packages/agents/src/__tests__/ports.test.ts`          | T3     |
| CREATE | `packages/agents/src/registry.ts`                      | T4     |
| CREATE | `packages/agents/src/__tests__/registry.test.ts`       | T4     |
| CREATE | `packages/agents/src/route-plan.ts`                    | T5     |
| CREATE | `packages/agents/src/router.ts`                        | T5     |
| CREATE | `packages/agents/src/__tests__/router.test.ts`         | T5     |
| CREATE | `packages/agents/src/policy-bridge.ts`                 | T6     |
| CREATE | `packages/agents/src/__tests__/policy-bridge.test.ts`  | T6     |
| CREATE | `packages/agents/src/delivery-store.ts`                | T7     |
| CREATE | `packages/agents/src/__tests__/delivery-store.test.ts` | T7     |
| CREATE | `packages/agents/src/dispatcher.ts`                    | T8     |
| CREATE | `packages/agents/src/__tests__/dispatcher.test.ts`     | T8     |
| CREATE | `packages/agents/src/__tests__/pipeline.test.ts`       | T9     |
