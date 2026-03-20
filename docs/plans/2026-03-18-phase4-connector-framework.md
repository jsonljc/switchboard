# Phase 4: Native Connector Framework + HubSpot Connector — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the native connector framework so the agent pipeline can dispatch events to external platforms (HubSpot, Calendly, Stripe, etc.), then implement the HubSpot connector as the first real integration — syncing leads, deals, and revenue back to HubSpot CRM.

**Architecture:** A `ConnectorPort` interface defines what connectors provide. A `ConnectorAdapter` maps agent events to connector-specific API calls. The `createConnectorHandler` factory plugs into the existing `Dispatcher` (same pattern as `createWebhookHandler`). The HubSpot connector wraps the existing `HubSpotCrmProvider` from `cartridges/crm`. A `ConnectorConfigProvider` bridges the connection store to the agent router's `ConnectorDestinationConfig[]`.

**Tech Stack:** TypeScript, Vitest, existing `HubSpotCrmProvider`, `PrismaConnectionStore`

**Design doc:** `docs/plans/2026-03-18-agent-architecture-design.md`

---

## Task 1: Connector Port Interface and Adapter Base

Define the standard contract for native connectors — what events they handle and how they translate agent events into platform-specific API calls.

**Files:**

- Create: `packages/agents/src/connectors/connector-port.ts`
- Create: `packages/agents/src/__tests__/connector-port.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/connector-port.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { ConnectorAdapter, ConnectorPort } from "../connectors/connector-port.js";
import { createEventEnvelope } from "../events.js";

describe("ConnectorPort and ConnectorAdapter", () => {
  it("adapter handles events it supports", async () => {
    const adapter: ConnectorAdapter = {
      connectorType: "hubspot",
      supportedEvents: ["lead.received", "lead.qualified", "revenue.recorded"],
      handleEvent: vi.fn().mockResolvedValue({ success: true }),
    };

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1", email: "test@example.com" },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(adapter.handleEvent).toHaveBeenCalledWith(event);
  });

  it("port declares connector identity and capabilities", () => {
    const port: ConnectorPort = {
      connectorType: "hubspot",
      version: "1.0.0",
      displayName: "HubSpot CRM",
      supportedEvents: ["lead.received", "lead.qualified", "revenue.recorded"],
      requiredConfig: ["accessToken"],
      optionalConfig: ["pipelineId"],
    };

    expect(port.connectorType).toBe("hubspot");
    expect(port.supportedEvents).toContain("lead.received");
    expect(port.requiredConfig).toContain("accessToken");
  });

  it("validateConfig checks required config keys", () => {
    const { validateConnectorConfig } = require("../connectors/connector-port.js");

    const port: ConnectorPort = {
      connectorType: "hubspot",
      version: "1.0.0",
      displayName: "HubSpot CRM",
      supportedEvents: ["lead.received"],
      requiredConfig: ["accessToken"],
      optionalConfig: [],
    };

    expect(validateConnectorConfig(port, { accessToken: "tok-123" }).valid).toBe(true);
    expect(validateConnectorConfig(port, {}).valid).toBe(false);
    expect(validateConnectorConfig(port, {}).errors).toContain(
      "Missing required config: accessToken",
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/connectors/connector-port.ts`:

```typescript
// ---------------------------------------------------------------------------
// Connector Port — standard contract for native connectors
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "../events.js";

/**
 * Declares what a connector provides — identity, capabilities, config shape.
 * Used for registration and validation.
 */
export interface ConnectorPort {
  connectorType: string;
  version: string;
  displayName: string;
  supportedEvents: string[];
  requiredConfig: string[];
  optionalConfig: string[];
}

/**
 * Handles events by translating them to platform-specific API calls.
 * Each connector type has one adapter implementation.
 */
export interface ConnectorAdapter {
  connectorType: string;
  supportedEvents: string[];
  handleEvent(event: RoutedEventEnvelope): Promise<{ success: boolean; error?: string }>;
}

export interface ConnectorConfigValidation {
  valid: boolean;
  errors: string[];
}

export function validateConnectorConfig(
  port: ConnectorPort,
  config: Record<string, unknown>,
): ConnectorConfigValidation {
  const errors: string[] = [];

  for (const key of port.requiredConfig) {
    if (!(key in config) || config[key] === undefined || config[key] === null) {
      errors.push(`Missing required config: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/connectors/connector-port.ts packages/agents/src/__tests__/connector-port.test.ts
git commit -m "feat(agents): add connector port interface and adapter contract"
```

---

## Task 2: Connector Dispatch Handler

Create a `createConnectorHandler` factory analogous to `createWebhookHandler`. It looks up the correct `ConnectorAdapter` by connector type and delegates event handling.

**Files:**

- Create: `packages/agents/src/dispatch/connector-handler.ts`
- Create: `packages/agents/src/__tests__/connector-handler.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/connector-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createConnectorHandler } from "../dispatch/connector-handler.js";
import type { ConnectorAdapter } from "../connectors/connector-port.js";
import { createEventEnvelope } from "../events.js";

describe("createConnectorHandler", () => {
  it("dispatches event to the correct connector adapter", async () => {
    const hubspotAdapter: ConnectorAdapter = {
      connectorType: "hubspot",
      supportedEvents: ["lead.received"],
      handleEvent: vi.fn().mockResolvedValue({ success: true }),
    };

    const handler = createConnectorHandler({
      adapters: new Map([["hubspot", hubspotAdapter]]),
      configLookup: (destinationId) => ({
        id: destinationId,
        connectorType: "hubspot",
        subscribedEvents: ["lead.received"],
        criticality: "required" as const,
        enabled: true,
        config: { accessToken: "tok-123" },
      }),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: { contactId: "c1" },
    });

    const result = await handler(event, "hubspot-connector-1");
    expect(result.success).toBe(true);
    expect(hubspotAdapter.handleEvent).toHaveBeenCalledWith(event);
  });

  it("returns failure when connector config not found", async () => {
    const handler = createConnectorHandler({
      adapters: new Map(),
      configLookup: () => undefined,
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "nonexistent");
    expect(result.success).toBe(false);
  });

  it("returns failure when no adapter registered for connector type", async () => {
    const handler = createConnectorHandler({
      adapters: new Map(),
      configLookup: () => ({
        id: "conn-1",
        connectorType: "salesforce",
        subscribedEvents: ["lead.received"],
        criticality: "required" as const,
        enabled: true,
        config: {},
      }),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "conn-1");
    expect(result.success).toBe(false);
  });

  it("returns failure when adapter throws", async () => {
    const failingAdapter: ConnectorAdapter = {
      connectorType: "hubspot",
      supportedEvents: ["lead.received"],
      handleEvent: vi.fn().mockRejectedValue(new Error("API rate limited")),
    };

    const handler = createConnectorHandler({
      adapters: new Map([["hubspot", failingAdapter]]),
      configLookup: () => ({
        id: "conn-1",
        connectorType: "hubspot",
        subscribedEvents: ["lead.received"],
        criticality: "required" as const,
        enabled: true,
        config: { accessToken: "tok" },
      }),
    });

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "system", id: "test" },
      payload: {},
    });

    const result = await handler(event, "conn-1");
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/dispatch/connector-handler.ts`:

```typescript
// ---------------------------------------------------------------------------
// Connector Dispatch Handler — routes events to native connector adapters
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "../events.js";
import type { ConnectorAdapter } from "../connectors/connector-port.js";
import type { ConnectorDestinationConfig } from "../route-plan.js";

export interface ConnectorHandlerConfig {
  adapters: Map<string, ConnectorAdapter>;
  configLookup: (destinationId: string) => ConnectorDestinationConfig | undefined;
}

export function createConnectorHandler(config: ConnectorHandlerConfig) {
  return async (
    event: RoutedEventEnvelope,
    destinationId: string,
  ): Promise<{ success: boolean }> => {
    const connectorConfig = config.configLookup(destinationId);
    if (!connectorConfig) {
      return { success: false };
    }

    const adapter = config.adapters.get(connectorConfig.connectorType);
    if (!adapter) {
      return { success: false };
    }

    try {
      const result = await adapter.handleEvent(event);
      return { success: result.success };
    } catch {
      return { success: false };
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/dispatch/connector-handler.ts packages/agents/src/__tests__/connector-handler.test.ts
git commit -m "feat(agents): add connector dispatch handler with adapter routing"
```

---

## Task 3: Connector Config Provider

Similar to `InMemoryWebhookConfigProvider` — stores connector configs per org and provides them to the router and dispatch handler.

**Files:**

- Create: `packages/agents/src/providers/connector-config-provider.ts`
- Create: `packages/agents/src/__tests__/connector-config-provider.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/connector-config-provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryConnectorConfigProvider } from "../providers/connector-config-provider.js";

describe("InMemoryConnectorConfigProvider", () => {
  it("registers and retrieves connector configs for an org", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received", "lead.qualified"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const configs = provider.listForOrg("org-1");
    expect(configs).toHaveLength(1);
    expect(configs[0]!.connectorType).toBe("hubspot");
  });

  it("converts to router-compatible format", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const routerConfigs = provider.toRouterConfigs("org-1");
    expect(routerConfigs).toHaveLength(1);
    expect(routerConfigs[0]!.connectorType).toBe("hubspot");
  });

  it("provides lookup function for dispatch handler", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: { accessToken: "tok-123" },
    });

    const lookup = provider.toLookup("org-1");
    expect(lookup("hubspot-1")).toBeDefined();
    expect(lookup("hubspot-1")!.connectorType).toBe("hubspot");
    expect(lookup("nonexistent")).toBeUndefined();
  });

  it("removes a connector", () => {
    const provider = new InMemoryConnectorConfigProvider();
    provider.register("org-1", {
      id: "hubspot-1",
      connectorType: "hubspot",
      subscribedEvents: ["lead.received"],
      criticality: "required",
      enabled: true,
      config: {},
    });

    provider.remove("org-1", "hubspot-1");
    expect(provider.listForOrg("org-1")).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/providers/connector-config-provider.ts`:

```typescript
// ---------------------------------------------------------------------------
// Connector Config Provider — bridges connection store to agent router/handler
// ---------------------------------------------------------------------------

import type { ConnectorDestinationConfig } from "../route-plan.js";

export class InMemoryConnectorConfigProvider {
  private store = new Map<string, Map<string, ConnectorDestinationConfig>>();

  register(organizationId: string, entry: ConnectorDestinationConfig): void {
    let orgMap = this.store.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.store.set(organizationId, orgMap);
    }
    orgMap.set(entry.id, entry);
  }

  remove(organizationId: string, connectorId: string): boolean {
    return this.store.get(organizationId)?.delete(connectorId) ?? false;
  }

  listForOrg(organizationId: string): ConnectorDestinationConfig[] {
    const orgMap = this.store.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  toRouterConfigs(organizationId: string): ConnectorDestinationConfig[] {
    return this.listForOrg(organizationId);
  }

  toLookup(organizationId: string): (id: string) => ConnectorDestinationConfig | undefined {
    const orgMap = this.store.get(organizationId);
    return (id: string) => orgMap?.get(id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/providers/connector-config-provider.ts packages/agents/src/__tests__/connector-config-provider.test.ts
git commit -m "feat(agents): add connector config provider"
```

---

## Task 4: HubSpot Connector Adapter

The first real connector. Maps agent events to HubSpot CRM API calls using the existing `CrmProvider` interface (which `HubSpotCrmProvider` implements). This adapter lives in `packages/agents` and only depends on the `CrmProvider` interface from `@switchboard/schemas` — not on the HubSpot implementation directly.

**Files:**

- Create: `packages/agents/src/connectors/hubspot-adapter.ts`
- Create: `packages/agents/src/__tests__/hubspot-adapter.test.ts`

**Step 1: Write the failing test**

Create `packages/agents/src/__tests__/hubspot-adapter.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HubSpotConnectorAdapter } from "../connectors/hubspot-adapter.js";
import { createEventEnvelope } from "../events.js";

function mockCrmProvider() {
  return {
    searchContacts: vi.fn().mockResolvedValue([]),
    getContact: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    listDeals: vi.fn().mockResolvedValue([]),
    listActivities: vi.fn().mockResolvedValue([]),
    getPipelineStatus: vi.fn().mockResolvedValue([]),
    createContact: vi.fn().mockResolvedValue({ id: "hs-c1", firstName: "Test" }),
    updateContact: vi.fn().mockResolvedValue({ id: "hs-c1" }),
    archiveContact: vi.fn(),
    createDeal: vi.fn().mockResolvedValue({ id: "hs-d1" }),
    archiveDeal: vi.fn(),
    logActivity: vi.fn().mockResolvedValue({ id: "hs-a1" }),
    healthCheck: vi.fn().mockResolvedValue({ connected: true }),
  };
}

describe("HubSpotConnectorAdapter", () => {
  it("creates a contact on lead.received", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId: "c1",
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        phone: "+60123456789",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
      }),
    );
  });

  it("creates a deal on lead.qualified", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.qualified",
      source: { type: "agent", id: "lead-responder" },
      payload: {
        contactId: "c1",
        score: 85,
        tier: "hot",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.createDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringContaining("c1"),
        stage: "qualified",
      }),
    );
  });

  it("logs activity on revenue.recorded", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "revenue.recorded",
      source: { type: "system", id: "conversion-bus-bridge" },
      payload: {
        contactId: "c1",
        amount: 350,
        type: "purchased",
      },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(true);
    expect(crm.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "revenue",
        contactId: "c1",
      }),
    );
  });

  it("returns failure for unsupported events", async () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "ad.optimized",
      source: { type: "agent", id: "ad-optimizer" },
      payload: {},
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(false);
    expect(result.error).toContain("unsupported");
  });

  it("returns failure when CRM call throws", async () => {
    const crm = mockCrmProvider();
    crm.createContact.mockRejectedValue(new Error("HubSpot 429"));
    const adapter = new HubSpotConnectorAdapter(crm);

    const event = createEventEnvelope({
      organizationId: "org-1",
      eventType: "lead.received",
      source: { type: "agent", id: "lead-responder" },
      payload: { contactId: "c1", email: "test@example.com" },
    });

    const result = await adapter.handleEvent(event);
    expect(result.success).toBe(false);
    expect(result.error).toBe("HubSpot 429");
  });

  it("declares correct connector type and supported events", () => {
    const crm = mockCrmProvider();
    const adapter = new HubSpotConnectorAdapter(crm);

    expect(adapter.connectorType).toBe("hubspot");
    expect(adapter.supportedEvents).toContain("lead.received");
    expect(adapter.supportedEvents).toContain("lead.qualified");
    expect(adapter.supportedEvents).toContain("revenue.recorded");
    expect(adapter.supportedEvents).toContain("stage.advanced");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: FAIL

**Step 3: Write implementation**

Create `packages/agents/src/connectors/hubspot-adapter.ts`:

```typescript
// ---------------------------------------------------------------------------
// HubSpot Connector Adapter — maps agent events to HubSpot CRM API calls
// ---------------------------------------------------------------------------

import type { CrmProvider } from "@switchboard/schemas";
import type { RoutedEventEnvelope } from "../events.js";
import type { ConnectorAdapter } from "./connector-port.js";

type EventPayload = Record<string, unknown>;

export class HubSpotConnectorAdapter implements ConnectorAdapter {
  readonly connectorType = "hubspot";
  readonly supportedEvents = [
    "lead.received",
    "lead.qualified",
    "stage.advanced",
    "revenue.recorded",
  ];

  constructor(private crm: CrmProvider) {}

  async handleEvent(event: RoutedEventEnvelope): Promise<{ success: boolean; error?: string }> {
    if (!this.supportedEvents.includes(event.eventType)) {
      return { success: false, error: `Event type unsupported: ${event.eventType}` };
    }

    try {
      const payload = event.payload as EventPayload;

      switch (event.eventType) {
        case "lead.received":
          await this.handleLeadReceived(payload);
          break;
        case "lead.qualified":
          await this.handleLeadQualified(payload);
          break;
        case "stage.advanced":
          await this.handleStageAdvanced(payload);
          break;
        case "revenue.recorded":
          await this.handleRevenueRecorded(payload);
          break;
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async handleLeadReceived(payload: EventPayload): Promise<void> {
    await this.crm.createContact({
      externalId: payload.contactId as string | undefined,
      email: payload.email as string | undefined,
      firstName: payload.firstName as string | undefined,
      lastName: payload.lastName as string | undefined,
      phone: payload.phone as string | undefined,
      sourceAdId: payload.sourceAdId as string | undefined,
      sourceCampaignId: payload.sourceCampaignId as string | undefined,
    });
  }

  private async handleLeadQualified(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    await this.crm.createDeal({
      name: `Lead ${contactId}`,
      stage: "qualified",
      contactId,
      properties: {
        score: payload.score,
        tier: payload.tier,
      },
    });
  }

  private async handleStageAdvanced(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    const stage = payload.stage as string | undefined;
    await this.crm.logActivity({
      type: "stage_change",
      contactId,
      description: `Stage advanced to ${stage ?? "next"}`,
      properties: { stage },
    });
  }

  private async handleRevenueRecorded(payload: EventPayload): Promise<void> {
    const contactId = payload.contactId as string;
    await this.crm.logActivity({
      type: "revenue",
      contactId,
      description: `Revenue recorded: ${payload.amount}`,
      properties: {
        amount: payload.amount,
        originalType: payload.type,
      },
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agents/src/connectors/hubspot-adapter.ts packages/agents/src/__tests__/hubspot-adapter.test.ts
git commit -m "feat(agents): add HubSpot connector adapter"
```

---

## Task 5: Update Barrel Exports and Final Build Verification

**Files:**

- Modify: `packages/agents/src/index.ts`

**Step 1: Update index.ts to export new modules**

Add to `packages/agents/src/index.ts`:

```typescript
export {
  validateConnectorConfig,
  type ConnectorAdapter,
  type ConnectorConfigValidation,
  type ConnectorPort,
} from "./connectors/connector-port.js";

export {
  createConnectorHandler,
  type ConnectorHandlerConfig,
} from "./dispatch/connector-handler.js";

export { InMemoryConnectorConfigProvider } from "./providers/connector-config-provider.js";

export { HubSpotConnectorAdapter } from "./connectors/hubspot-adapter.js";
```

**Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents typecheck`
Expected: clean

**Step 3: Run full agents tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm --filter @switchboard/agents test`
Expected: ALL PASS

**Step 4: Run workspace build**

Run: `cd /Users/jasonljc/switchboard && npx pnpm build`
Expected: all packages build

**Step 5: Run full workspace tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm test`
Expected: no regressions

**Step 6: Commit**

```bash
git add packages/agents/src/index.ts
git commit -m "feat(agents): complete Phase 4 connector framework with HubSpot adapter"
```

---

## Implementation Order

```
Task 1:  Connector port interface              (standalone)
Task 2:  Connector dispatch handler            (depends on Task 1)
Task 3:  Connector config provider             (standalone)
Task 4:  HubSpot connector adapter             (depends on Task 1)
Task 5:  Barrel exports + final build          (depends on all above)
```

Tasks 1, 3 are independent.
Tasks 2, 4 depend on Task 1.
Task 5 is the final gate.

## Files Summary

| Action | File                                                              | Task |
| ------ | ----------------------------------------------------------------- | ---- |
| CREATE | `packages/agents/src/connectors/connector-port.ts`                | T1   |
| CREATE | `packages/agents/src/__tests__/connector-port.test.ts`            | T1   |
| CREATE | `packages/agents/src/dispatch/connector-handler.ts`               | T2   |
| CREATE | `packages/agents/src/__tests__/connector-handler.test.ts`         | T2   |
| CREATE | `packages/agents/src/providers/connector-config-provider.ts`      | T3   |
| CREATE | `packages/agents/src/__tests__/connector-config-provider.test.ts` | T3   |
| CREATE | `packages/agents/src/connectors/hubspot-adapter.ts`               | T4   |
| CREATE | `packages/agents/src/__tests__/hubspot-adapter.test.ts`           | T4   |
| MODIFY | `packages/agents/src/index.ts`                                    | T5   |
