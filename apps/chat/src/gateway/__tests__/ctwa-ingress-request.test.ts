import { describe, it, expect } from "vitest";
import { buildCtwaIngressSubmitRequest } from "../ctwa-ingress-request.js";

const req = {
  intent: "lead.intake",
  payload: { organizationId: "org_1", deploymentId: "dep_1", source: "ctwa" },
  idempotencyKey: "+6500000000:ARxx_clid",
};

describe("buildCtwaIngressSubmitRequest", () => {
  it("uses the seeded 'system' principal so governance can resolve identity (not a bespoke system:* id)", () => {
    // Regression guard for the silent CTWA lead-drop: a bespoke system:<x> actor has
    // no seeded IdentitySpec → GovernanceGate.loadIdentitySpec throws → GOVERNANCE_ERROR.
    expect(buildCtwaIngressSubmitRequest(req).actor).toEqual({ id: "system", type: "system" });
  });

  it("maps the adapter req onto the canonical submit envelope with the chat surface", () => {
    const out = buildCtwaIngressSubmitRequest(req);
    expect(out.organizationId).toBe("org_1");
    expect(out.intent).toBe("lead.intake");
    expect(out.parameters).toBe(req.payload);
    expect(out.idempotencyKey).toBe("+6500000000:ARxx_clid");
    expect(out.trigger).toBe("internal");
    expect(out.surface).toEqual({ surface: "chat" });
    expect(out.targetHint).toEqual({ deploymentId: "dep_1" });
    expect(out.parentWorkUnitId).toBeUndefined();
  });

  it("threads parentWorkUnitId only when present", () => {
    const out = buildCtwaIngressSubmitRequest({ ...req, parentWorkUnitId: "wu_1" });
    expect(out.parentWorkUnitId).toBe("wu_1");
  });
});
