import { describe, it, expect } from "vitest";
import { AD_OPTIMIZER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Ad Optimizer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(AD_OPTIMIZER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts revenue.recorded and stage.advanced events", () => {
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("revenue.recorded");
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("stage.advanced");
  });

  it("emits ad.optimized and conversation.escalated events", () => {
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("ad.optimized");
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares send_conversion and diagnose_funnel tools", () => {
    const toolNames = AD_OPTIMIZER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("send_conversion");
    expect(toolNames).toContain("diagnose_funnel");
  });
});
