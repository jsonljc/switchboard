import { describe, it, expect } from "vitest";
import { routeIdentityStrategy } from "../ugc/identity-strategy-router.js";
import type { CastingAssignment } from "../ugc/scene-caster.js";

describe("routeIdentityStrategy", () => {
  const baseCasting: CastingAssignment = {
    creatorId: "cr_1",
    structureId: "confession",
    score: 0.9,
  };

  it("returns asset_reuse when requireExactReuse is true", () => {
    const plan = routeIdentityStrategy(baseCasting, { requireExactReuse: true });
    expect(plan.primaryStrategy).toBe("asset_reuse");
  });

  it("defaults to reference_conditioning for Phase 1", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.primaryStrategy).toBe("reference_conditioning");
  });

  it("includes asset_reuse in fallback chain", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.fallbackChain).toContain("asset_reuse");
  });

  it("sets constraints from options", () => {
    const plan = routeIdentityStrategy(baseCasting, {
      maxIdentityDrift: 0.3,
      lockHairState: true,
      lockWardrobe: true,
    });
    expect(plan.constraints.maxIdentityDrift).toBe(0.3);
    expect(plan.constraints.lockHairState).toBe(true);
    expect(plan.constraints.lockWardrobe).toBe(true);
  });

  it("uses sensible defaults for constraints", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.constraints.maxIdentityDrift).toBe(0.5);
    expect(plan.constraints.lockHairState).toBe(false);
    expect(plan.constraints.lockWardrobe).toBe(false);
    expect(plan.constraints.requireExactReuse).toBe(false);
  });
});
