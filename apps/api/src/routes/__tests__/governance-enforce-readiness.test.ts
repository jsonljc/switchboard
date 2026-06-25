import { describe, it, expect, vi } from "vitest";
import {
  buildEnforceReadiness,
  type EnforceReadinessDeps,
  type EnforceReadinessUnit,
} from "../governance-enforce-readiness.js";
import { buildObserveGovernanceConfig, type GovernanceGateUnit } from "@switchboard/schemas";

const observe = buildObserveGovernanceConfig({ jurisdiction: "SG", clinicType: "medical" });

function makeDeps(over: Partial<EnforceReadinessDeps> = {}): EnforceReadinessDeps {
  return {
    findAlexDeployment: vi.fn().mockResolvedValue({ id: "dep-1", governanceConfig: observe }),
    probeProducers: vi.fn().mockResolvedValue({
      approvedPriceCount: 0,
      approvedClaimCount: 0,
      approvedTemplateCount: 0,
    }),
    ...over,
  };
}

function byUnit(units: EnforceReadinessUnit[]): Record<GovernanceGateUnit, EnforceReadinessUnit> {
  return Object.fromEntries(units.map((u) => [u.unit, u])) as Record<
    GovernanceGateUnit,
    EnforceReadinessUnit
  >;
}

describe("buildEnforceReadiness", () => {
  it("refuses producer-dependent gates when empty; consent is always ready (fail-safe)", async () => {
    const out = await buildEnforceReadiness(makeDeps(), "org-1");
    if (!("units" in out)) throw new Error("unexpected non-success");
    const u = byUnit(out.units);

    expect(u.deterministic.currentMode).toBe("observe");
    expect(u.deterministic.ready).toBe(false);
    expect(u.deterministic.producer).toEqual({ kind: "price", count: 0 });
    expect(u.claims.ready).toBe(false);
    expect(u.claims.producer).toEqual({ kind: "claim", count: 0 });
    expect(u.whatsapp.ready).toBe(false);
    expect(u.whatsapp.producer).toEqual({ kind: "template", count: 0 });
    expect(u.consent.ready).toBe(true);
    expect(u.consent.blockingReason).toBeNull();
    expect(u.consent.producer).toEqual({ kind: "none", count: 0 });
  });

  it("marks a unit ready once its producer is populated, with the producer count", async () => {
    const deps = makeDeps({
      probeProducers: vi.fn().mockResolvedValue({
        approvedPriceCount: 2,
        approvedClaimCount: 1,
        approvedTemplateCount: 3,
      }),
    });
    const out = await buildEnforceReadiness(deps, "org-1");
    if (!("units" in out)) throw new Error("unexpected non-success");
    const u = byUnit(out.units);
    expect(u.deterministic.ready).toBe(true);
    expect(u.deterministic.producer.count).toBe(2);
    expect(u.claims.ready).toBe(true);
    expect(u.whatsapp.ready).toBe(true);
    expect(u.whatsapp.producer.count).toBe(3);
    expect(deps.probeProducers).toHaveBeenCalledWith("org-1", "dep-1");
  });

  it("reflects a per-unit enforce flip in currentMode", async () => {
    const flipped = { ...observe, deterministicGate: { mode: "enforce" as const } };
    const deps = makeDeps({
      findAlexDeployment: vi.fn().mockResolvedValue({ id: "dep-1", governanceConfig: flipped }),
    });
    const out = await buildEnforceReadiness(deps, "org-1");
    if (!("units" in out)) throw new Error("unexpected non-success");
    expect(byUnit(out.units).deterministic.currentMode).toBe("enforce");
  });

  it("treats a corrupt governanceConfig as all-off but still reports producer readiness", async () => {
    const deps = makeDeps({
      findAlexDeployment: vi
        .fn()
        .mockResolvedValue({ id: "dep-1", governanceConfig: { bogus: 1 } }),
    });
    const out = await buildEnforceReadiness(deps, "org-1");
    if (!("units" in out)) throw new Error("unexpected non-success");
    expect(out.units.every((g) => g.currentMode === "off")).toBe(true);
  });

  it("returns notFound when the org has no Alex deployment (org scope)", async () => {
    const out = await buildEnforceReadiness(
      makeDeps({ findAlexDeployment: vi.fn().mockResolvedValue(null) }),
      "org-x",
    );
    expect(out).toEqual({ notFound: true });
  });
});
