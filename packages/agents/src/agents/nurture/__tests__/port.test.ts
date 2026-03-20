import { describe, it, expect } from "vitest";
import { NURTURE_AGENT_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Nurture Agent Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(NURTURE_AGENT_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts stage.advanced events", () => {
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("stage.advanced");
  });

  it("accepts lead.disqualified events", () => {
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("lead.disqualified");
  });

  it("accepts revenue.recorded events", () => {
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("revenue.recorded");
  });

  it("emits conversation.escalated events", () => {
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("emits lead.qualified events for re-qualification", () => {
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("lead.qualified");
  });

  it("emits stage.advanced events", () => {
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("stage.advanced");
  });

  it("declares start_cadence, send_reminder, and request_review tools", () => {
    const toolNames = NURTURE_AGENT_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("start_cadence");
    expect(toolNames).toContain("send_reminder");
    expect(toolNames).toContain("request_review");
  });
});
