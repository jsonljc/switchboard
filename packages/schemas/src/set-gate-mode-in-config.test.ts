import { describe, it, expect } from "vitest";
import { buildObserveGovernanceConfig } from "./governance-config.js";
import { setGateModeInConfig } from "./set-gate-mode-in-config.js";
import { readGateMode } from "./governance-gate-unit.js";

const base = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

function subBlock(cfg: unknown, key: string): Record<string, unknown> {
  return (cfg as Record<string, Record<string, unknown> | undefined>)[key] ?? {};
}

describe("setGateModeInConfig", () => {
  it("flips deterministic to enforce, preserving the other units", () => {
    const next = setGateModeInConfig(base, "deterministic", "enforce");
    expect(readGateMode(next, "deterministic")).toBe("enforce");
    expect(readGateMode(next, "claims")).toBe("observe");
    expect(readGateMode(next, "consent")).toBe("observe");
    expect(readGateMode(next, "whatsapp")).toBe("observe");
    expect(next.jurisdiction).toBe("SG");
    expect(next.clinicType).toBe("medical");
  });

  it("flips whatsapp mode while preserving enabled + allowMarketingTemplateSubstitution", () => {
    const next = setGateModeInConfig(base, "whatsapp", "enforce");
    expect(subBlock(next, "whatsappWindow")).toEqual({
      enabled: true,
      mode: "enforce",
      allowMarketingTemplateSubstitution: false,
    });
  });

  it("flips claims mode while preserving classifier tuning fields", () => {
    const withTuning = {
      ...base,
      claimClassifier: {
        mode: "observe",
        latencyBudgetMs: 900,
        model: "m",
        confidenceThreshold: 0.8,
      },
    } as never;
    const next = setGateModeInConfig(withTuning, "claims", "enforce");
    expect(subBlock(next, "claimClassifier")).toEqual({
      mode: "enforce",
      latencyBudgetMs: 900,
      model: "m",
      confidenceThreshold: 0.8,
    });
  });

  it("supports rollback to observe and to off", () => {
    const enforced = setGateModeInConfig(base, "consent", "enforce");
    expect(readGateMode(enforced, "consent")).toBe("enforce");
    expect(readGateMode(setGateModeInConfig(enforced, "consent", "observe"), "consent")).toBe(
      "observe",
    );
    expect(readGateMode(setGateModeInConfig(enforced, "consent", "off"), "consent")).toBe("off");
  });

  it("is pure (does not mutate the input)", () => {
    const snapshot = JSON.stringify(base);
    setGateModeInConfig(base, "consent", "enforce");
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("creates the sub-block if absent (defensive), without disturbing siblings", () => {
    const minimal = { jurisdiction: "SG", clinicType: "medical" } as never;
    const next = setGateModeInConfig(minimal, "deterministic", "enforce");
    expect(readGateMode(next, "deterministic")).toBe("enforce");
    expect(next.jurisdiction).toBe("SG");
  });
});
