import { describe, it, expect, beforeEach } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import type { IntentRegistration } from "../intent-registration.js";
import { SpendBearingAutoApproveError } from "../intent-registration.js";

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

// F4 registry guard (security audit 2026-06-10): a spend-bearing intent — one
// that commits OUTBOUND spend the spend gate must cap — must never be registered
// `approvalMode: "system_auto_approved"`, because auto-approval returns `execute`
// before the spend-approval threshold and the hard spend floor run.
const budgetRegistration = (overrides?: Partial<IntentRegistration>): IntentRegistration => ({
  intent: "digital-ads.campaign.adjust_budget",
  defaultMode: "cartridge",
  allowedModes: ["cartridge"],
  executor: { mode: "cartridge", actionId: "digital-ads.campaign.adjust_budget" },
  parameterSchema: {},
  mutationClass: "write",
  budgetClass: "standard",
  approvalPolicy: "threshold",
  spendBearing: true,
  idempotent: false,
  allowedTriggers: ["api"],
  timeoutMs: 30_000,
  retryable: false,
  ...overrides,
});

describe("IntentRegistry — F4 spend-bearing auto-approve guard", () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  it("throws when a spend-bearing intent is registered system_auto_approved", () => {
    expect(() =>
      registry.register(budgetRegistration({ approvalMode: "system_auto_approved" })),
    ).toThrow(SpendBearingAutoApproveError);
  });

  it("names the offending intent and the rule in the error message", () => {
    expect(() =>
      registry.register(budgetRegistration({ approvalMode: "system_auto_approved" })),
    ).toThrow(/digital-ads\.campaign\.adjust_budget/);
    expect(() =>
      registry.register(budgetRegistration({ approvalMode: "system_auto_approved" })),
    ).toThrow(/system_auto_approved/);
  });

  it("allows a spend-bearing intent under policy mode (approvalMode omitted)", () => {
    expect(() => registry.register(budgetRegistration())).not.toThrow();
    expect(registry.lookup("digital-ads.campaign.adjust_budget")?.spendBearing).toBe(true);
  });

  it("allows a spend-bearing intent under explicit policy mode", () => {
    expect(() => registry.register(budgetRegistration({ approvalMode: "policy" }))).not.toThrow();
  });

  it("allows a non-spend-bearing intent under system_auto_approved (operator-direct pattern)", () => {
    expect(() =>
      registry.register(
        budgetRegistration({
          intent: "operator.transition_opportunity_stage",
          spendBearing: false,
          approvalPolicy: "none",
          approvalMode: "system_auto_approved",
        }),
      ),
    ).not.toThrow();
  });
});
