import { describe, it, expect } from "vitest";
import type { SaveGovernanceVerdictInput } from "../types.js";

describe("SaveGovernanceVerdictInput.details accepts extra keys", () => {
  it("compiles with arbitrary detail keys (no cast needed)", () => {
    const input: SaveGovernanceVerdictInput = {
      action: "block",
      reasonCode: "consent_missing",
      jurisdiction: "SG",
      clinicType: "medical",
      sourceGuard: "consent_gate",
      auditLevel: "warning",
      decidedAt: new Date().toISOString(),
      conversationId: "conv_1",
      deploymentId: "dep_1",
      details: { event: "jurisdiction_stamped", arbitrary: 123 },
    };
    expect(input.details?.["event"]).toBe("jurisdiction_stamped");
  });
});
