import { describe, it, expect } from "vitest";
import creative from "../index.js";

describe("Creative employee", () => {
  it("compiles with correct port", () => {
    expect(creative.port.agentId).toBe("creative");
    expect(creative.port.version).toBe("1.0.0");
    expect(creative.port.inboundEvents).toContain("content.requested");
    expect(creative.port.inboundEvents).toContain("content.approved");
    expect(creative.port.inboundEvents).toContain("content.rejected");
    expect(creative.port.outboundEvents).toContain("content.draft_ready");
  });

  it("has 7 actions defined", () => {
    expect(creative.cartridge.manifest.actions).toHaveLength(7);
  });

  it("has publish action with medium risk", () => {
    const publish = creative.cartridge.manifest.actions.find(
      (a) => a.actionType === "creative.content.publish",
    );
    expect(publish).toBeDefined();
    expect(publish!.baseRiskCategory).toBe("medium");
    expect(publish!.reversible).toBe(false);
  });

  it("has policies with publish requiring approval", () => {
    const publishPolicy = creative.defaults.policies.find(
      (p) => p.action === "creative.content.publish",
    );
    expect(publishPolicy).toBeDefined();
    expect(publishPolicy!.effect).toBe("require_approval");
  });

  it("has rate limits configured", () => {
    expect(creative.defaults.guardrails.rateLimits).toHaveLength(2);
    expect(creative.defaults.guardrails.cooldowns).toHaveLength(1);
  });
});
