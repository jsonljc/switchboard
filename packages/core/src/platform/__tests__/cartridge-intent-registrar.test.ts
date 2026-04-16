import { describe, it, expect } from "vitest";
import { IntentRegistry } from "../intent-registry.js";
import { registerCartridgeIntents } from "../cartridge-intent-registrar.js";
import type { CartridgeManifestForRegistration } from "../cartridge-intent-registrar.js";

function makeManifest(
  overrides: Partial<CartridgeManifestForRegistration> = {},
): CartridgeManifestForRegistration {
  return {
    id: "digital-ads",
    actions: [
      { name: "campaign.pause", description: "Pause a campaign", riskCategory: "medium" },
      { name: "campaign.read", description: "Read campaign data", riskCategory: "low" },
    ],
    ...overrides,
  };
}

describe("registerCartridgeIntents", () => {
  it("registers intents from manifest actions", () => {
    const registry = new IntentRegistry();
    registerCartridgeIntents(registry, [makeManifest()]);

    expect(registry.size).toBe(2);
    expect(registry.lookup("digital-ads.campaign.pause")).toBeDefined();
    expect(registry.lookup("digital-ads.campaign.read")).toBeDefined();
  });

  it("uses cartridgeId.actionName as intent", () => {
    const registry = new IntentRegistry();
    registerCartridgeIntents(registry, [
      makeManifest({ id: "crm", actions: [{ name: "contact.create" }] }),
    ]);

    const reg = registry.lookup("crm.contact.create");
    expect(reg).toBeDefined();
    expect(reg?.intent).toBe("crm.contact.create");
  });

  it("sets executor binding correctly", () => {
    const registry = new IntentRegistry();
    registerCartridgeIntents(registry, [makeManifest()]);

    const reg = registry.lookup("digital-ads.campaign.pause");
    expect(reg?.executor).toEqual({
      mode: "cartridge",
      actionId: "digital-ads.campaign.pause",
    });
    expect(reg?.defaultMode).toBe("cartridge");
    expect(reg?.budgetClass).toBe("cheap");
  });

  it("derives mutationClass from risk category", () => {
    const registry = new IntentRegistry();
    registerCartridgeIntents(registry, [
      makeManifest({
        actions: [
          { name: "safe.read", riskCategory: "none" },
          { name: "safe.list", riskCategory: "low" },
          { name: "risky.update", riskCategory: "medium" },
          { name: "danger.delete", riskCategory: "high" },
          { name: "nuke.destroy", riskCategory: "critical" },
        ],
      }),
    ]);

    expect(registry.lookup("digital-ads.safe.read")?.mutationClass).toBe("read");
    expect(registry.lookup("digital-ads.safe.list")?.mutationClass).toBe("read");
    expect(registry.lookup("digital-ads.risky.update")?.mutationClass).toBe("write");
    expect(registry.lookup("digital-ads.danger.delete")?.mutationClass).toBe("destructive");
    expect(registry.lookup("digital-ads.nuke.destroy")?.mutationClass).toBe("destructive");

    // read → retryable, write/destructive → not retryable
    expect(registry.lookup("digital-ads.safe.read")?.retryable).toBe(true);
    expect(registry.lookup("digital-ads.risky.update")?.retryable).toBe(false);
    expect(registry.lookup("digital-ads.danger.delete")?.retryable).toBe(false);

    // approval policy
    expect(registry.lookup("digital-ads.safe.read")?.approvalPolicy).toBe("none");
    expect(registry.lookup("digital-ads.risky.update")?.approvalPolicy).toBe("threshold");
    expect(registry.lookup("digital-ads.danger.delete")?.approvalPolicy).toBe("threshold");
  });

  it("skips actions without names", () => {
    const registry = new IntentRegistry();
    registerCartridgeIntents(registry, [
      makeManifest({
        actions: [
          { name: "", riskCategory: "low" },
          { name: "valid.action", riskCategory: "low" },
        ],
      }),
    ]);

    expect(registry.size).toBe(1);
    expect(registry.lookup("digital-ads.valid.action")).toBeDefined();
  });
});
