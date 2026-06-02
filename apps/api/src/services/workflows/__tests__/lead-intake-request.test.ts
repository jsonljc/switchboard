import { describe, it, expect } from "vitest";
import { buildLeadIntakeIngressSubmitRequest } from "../lead-intake-request.js";

const req = {
  intent: "meta.lead.intake",
  payload: { organizationId: "org_1", deploymentId: "dep_1", contactPhone: "+6500000000" },
  idempotencyKey: "leadgen:abc",
};

describe("buildLeadIntakeIngressSubmitRequest", () => {
  it("uses the seeded 'system' principal so governance can resolve identity (not a bespoke system:* id)", () => {
    // Regression guard for the silent lead-drop: a bespoke system:<x> actor has no
    // seeded IdentitySpec → GovernanceGate.loadIdentitySpec throws → GOVERNANCE_ERROR deny.
    expect(buildLeadIntakeIngressSubmitRequest(req).actor).toEqual({
      id: "system",
      type: "system",
    });
  });

  it("maps the adapter req onto the canonical submit envelope", () => {
    const out = buildLeadIntakeIngressSubmitRequest(req);
    expect(out.organizationId).toBe("org_1");
    expect(out.intent).toBe("meta.lead.intake");
    expect(out.parameters).toBe(req.payload);
    expect(out.idempotencyKey).toBe("leadgen:abc");
    expect(out.trigger).toBe("internal");
    expect(out.surface).toEqual({ surface: "api" });
    expect(out.targetHint).toEqual({ deploymentId: "dep_1" });
    expect(out.parentWorkUnitId).toBeUndefined();
  });

  it("threads parentWorkUnitId only when present", () => {
    const out = buildLeadIntakeIngressSubmitRequest({ ...req, parentWorkUnitId: "wu_1" });
    expect(out.parentWorkUnitId).toBe("wu_1");
  });
});
