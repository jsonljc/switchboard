import { describe, it, expect } from "vitest";
import { mergeRoleConfig } from "../role-config-merger.js";
import type { SafetyEnvelope, AgentRoleOverride } from "@switchboard/schemas";

describe("mergeRoleConfig", () => {
  const defaultEnvelope: SafetyEnvelope = {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000,
  };

  const defaultToolPack = ["digital-ads", "crm", "knowledge"];

  it("returns manifest defaults when no override exists", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope).toEqual(defaultEnvelope);
    expect(result.toolPack).toEqual(defaultToolPack);
    expect(result.governanceProfile).toBe("guarded");
  });

  it("org override can tighten safety envelope (lower limits)", () => {
    const override = {
      safetyEnvelopeOverride: {
        maxToolCalls: 100,
        maxDollarsAtRisk: 5_000,
      },
    } as unknown as AgentRoleOverride;

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(100);
    expect(result.safetyEnvelope.maxDollarsAtRisk).toBe(5_000);
    expect(result.safetyEnvelope.maxMutations).toBe(50);
    expect(result.safetyEnvelope.sessionTimeoutMs).toBe(30 * 60 * 1000);
  });

  it("org override CANNOT loosen safety envelope (higher limits ignored)", () => {
    const override = {
      safetyEnvelopeOverride: {
        maxToolCalls: 500,
        maxDollarsAtRisk: 5_000,
      },
    } as unknown as AgentRoleOverride;

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(200);
    expect(result.safetyEnvelope.maxDollarsAtRisk).toBe(5_000);
  });

  it("org override can narrow tool pack (subset only)", () => {
    const override = {
      allowedTools: ["digital-ads"],
    } as unknown as AgentRoleOverride;

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override,
      requestOverride: undefined,
    });

    expect(result.toolPack).toEqual(["digital-ads"]);
  });

  it("org override cannot add tools not in manifest", () => {
    const override = {
      allowedTools: ["digital-ads", "payments"],
    } as unknown as AgentRoleOverride;

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override,
      requestOverride: undefined,
    });

    expect(result.toolPack).toEqual(["digital-ads"]);
  });

  it("request-level override can further tighten safety envelope", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: {
        maxToolCalls: 50,
      },
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(50);
    expect(result.safetyEnvelope.maxMutations).toBe(50);
  });

  it("request-level override cannot loosen beyond manifest", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: {
        maxToolCalls: 999,
      },
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(200);
  });
});
