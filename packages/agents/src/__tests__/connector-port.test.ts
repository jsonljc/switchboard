import { describe, it, expect, vi } from "vitest";
import {
  validateConnectorConfig,
  type ConnectorAdapter,
  type ConnectorPort,
} from "../connectors/connector-port.js";
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
