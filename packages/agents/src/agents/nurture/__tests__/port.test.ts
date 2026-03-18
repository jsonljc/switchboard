import { describe, it, expect } from "vitest";
import { NURTURE_AGENT_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Nurture Agent Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(NURTURE_AGENT_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lead.disqualified, stage.advanced, and revenue.recorded events", () => {
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("lead.disqualified");
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("stage.advanced");
    expect(NURTURE_AGENT_PORT.inboundEvents).toContain("revenue.recorded");
  });

  it("emits stage.advanced and lead.qualified events", () => {
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("stage.advanced");
    expect(NURTURE_AGENT_PORT.outboundEvents).toContain("lead.qualified");
  });

  it("declares start_cadence, send_reminder, and request_review tools", () => {
    const toolNames = NURTURE_AGENT_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("start_cadence");
    expect(toolNames).toContain("send_reminder");
    expect(toolNames).toContain("request_review");
  });

  it("has version 0.1.0", () => {
    expect(NURTURE_AGENT_PORT.version).toBe("0.1.0");
  });

  it("has agentId nurture", () => {
    expect(NURTURE_AGENT_PORT.agentId).toBe("nurture");
  });
});
