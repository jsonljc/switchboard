import { describe, it, expect } from "vitest";
import { validateAgentPort, type AgentPort } from "../ports.js";

describe("validateAgentPort", () => {
  it("validates a well-formed agent port", () => {
    const port: AgentPort = {
      agentId: "employee-a",
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
