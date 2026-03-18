import { describe, it, expect } from "vitest";
import { AD_OPTIMIZER_PORT } from "../port.js";
import { validateAgentPort } from "../../../ports.js";

describe("Ad Optimizer Port", () => {
  it("declares valid port identity", () => {
    const result = validateAgentPort(AD_OPTIMIZER_PORT);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("has correct agent id and version", () => {
    expect(AD_OPTIMIZER_PORT.agentId).toBe("ad-optimizer");
    expect(AD_OPTIMIZER_PORT.version).toBe("0.1.0");
  });

  it("listens to revenue.attributed events", () => {
    expect(AD_OPTIMIZER_PORT.inboundEvents).toContain("revenue.attributed");
  });

  it("emits ad.optimized events", () => {
    expect(AD_OPTIMIZER_PORT.outboundEvents).toContain("ad.optimized");
  });

  it("declares adjust_budget and pause_campaign tools", () => {
    const toolNames = AD_OPTIMIZER_PORT.tools.map((t) => t.name);
    expect(toolNames).toContain("adjust_budget");
    expect(toolNames).toContain("pause_campaign");
  });

  it("defines config schema with targetROAS and maxBudgetChangePercent", () => {
    expect(AD_OPTIMIZER_PORT.configSchema).toHaveProperty("targetROAS");
    expect(AD_OPTIMIZER_PORT.configSchema).toHaveProperty("maxBudgetChangePercent");
    expect(AD_OPTIMIZER_PORT.configSchema).toHaveProperty("minDataDays");
  });
});
