import { describe, it, expect } from "vitest";
import { AD_OPTIMIZER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Ad Optimizer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(AD_OPTIMIZER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts revenue.attributed, ad.anomaly_detected, and ad.performance_review", () => {
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("revenue.attributed");
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("ad.anomaly_detected");
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("ad.performance_review");
  });

  it("emits ad.optimized and conversation.escalated events", () => {
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("ad.optimized");
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("conversation.escalated");
  });

  it("declares analyze_budget and adjust_budget tools", () => {
    const toolNames = AD_OPTIMIZER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("analyze_budget");
    expect(toolNames).toContain("adjust_budget");
  });
});
