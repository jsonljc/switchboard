import { describe, it, expect } from "vitest";
import { REVENUE_TRACKER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Revenue Tracker Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(REVENUE_TRACKER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts revenue.recorded and stage.advanced events", () => {
    expect(REVENUE_TRACKER_PORT.inboundEvents).toContain("revenue.recorded");
    expect(REVENUE_TRACKER_PORT.inboundEvents).toContain("stage.advanced");
  });

  it("emits revenue.attributed and conversation.escalated events", () => {
    expect(REVENUE_TRACKER_PORT.outboundEvents).toContain("revenue.attributed");
    expect(REVENUE_TRACKER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares attribute_revenue and log_pipeline tools", () => {
    const toolNames = REVENUE_TRACKER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("attribute_revenue");
    expect(toolNames).toContain("log_pipeline");
  });
});
