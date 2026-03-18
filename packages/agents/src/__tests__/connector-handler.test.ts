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
