import { describe, it, expect } from "vitest";
import { LEAD_RESPONDER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Lead Responder Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(LEAD_RESPONDER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lead.received events", () => {
    expect(LEAD_RESPONDER_PORT.inboundEvents).toContain("lead.received");
  });

  it("emits qualification and escalation events", () => {
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("lead.qualified");
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("lead.disqualified");
    expect(LEAD_RESPONDER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares qualify_lead and handle_objection tools", () => {
    const toolNames = LEAD_RESPONDER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("qualify_lead");
    expect(toolNames).toContain("handle_objection");
  });
});
