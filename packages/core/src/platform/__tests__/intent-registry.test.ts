import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import type { IntentRegistration } from "../intent-registration.js";

const campaignPause: IntentRegistration = {
  intent: "campaign.pause",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.pause" },
  parameterSchema: { type: "object", properties: { campaignId: { type: "string" } } },
  mutationClass: "write",
  budgetClass: "cheap",
  approvalPolicy: "threshold",
  idempotent: true,
  allowedTriggers: ["chat", "api"],
  timeoutMs: 10_000,
  retryable: true,
};

const adOptimizer: IntentRegistration = {
  intent: "ad-optimizer.run",
  defaultMode: "skill",
  allowedModes: ["skill"],
  executor: { mode: "skill", skillSlug: "ad-optimizer" },
  parameterSchema: { type: "object" },
  mutationClass: "write",
  budgetClass: "expensive",
  approvalPolicy: "always",
  idempotent: false,
  allowedTriggers: ["api", "schedule"],
  timeoutMs: 30_000,
  retryable: false,
};

describe("IntentRegistry", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("registers and looks up an intent", () => {
    registry.register(campaignPause);
    const result = registry.lookup("campaign.pause");
    expect(result).toEqual(campaignPause);
  });

  it("returns undefined for unknown intent", () => {
    const result = registry.lookup("unknown.intent");
    expect(result).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    registry.register(campaignPause);
    expect(() => registry.register(campaignPause)).toThrow(
      "Intent already registered: campaign.pause",
    );
  });

  it("resolves mode from suggestedMode when allowed", () => {
    const multiMode: IntentRegistration = {
      ...campaignPause,
      intent: "multi.mode",
      allowedModes: ["cartridge", "skill"],
    };
    registry.register(multiMode);
    const result = registry.resolveMode("multi.mode", "skill");
    expect(result).toBe("skill");
  });

  it("falls back to defaultMode when suggestedMode is not allowed", () => {
    registry.register(campaignPause);
    const result = registry.resolveMode("campaign.pause", "pipeline");
    expect(result).toBe("cartridge");
  });

  it("returns defaultMode when no suggestedMode provided", () => {
    registry.register(campaignPause);
    const result = registry.resolveMode("campaign.pause");
    expect(result).toBe("cartridge");
  });

  it("validates trigger against allowedTriggers", () => {
    registry.register(campaignPause);
    expect(registry.validateTrigger("campaign.pause", "api")).toBe(true);
    expect(registry.validateTrigger("campaign.pause", "chat")).toBe(true);
    expect(registry.validateTrigger("campaign.pause", "schedule")).toBe(false);
  });

  it("lists all registered intents", () => {
    registry.register(campaignPause);
    registry.register(adOptimizer);
    const result = registry.listIntents();
    expect(result).toEqual(["ad-optimizer.run", "campaign.pause"]);
  });

  it("returns count of registered intents", () => {
    registry.register(campaignPause);
    registry.register(adOptimizer);
    expect(registry.size).toBe(2);
  });
});
