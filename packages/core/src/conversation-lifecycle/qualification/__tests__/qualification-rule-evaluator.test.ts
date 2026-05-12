import { describe, expect, it } from "vitest";
import type { QualificationSignals } from "@switchboard/schemas";
import { evaluateQualification } from "../qualification-rule-evaluator.js";
import type { TreatmentResolution } from "../treatment-resolver.js";

const base: QualificationSignals = {
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "soft",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
};

const resolved: TreatmentResolution = { resolved: true, serviceId: "svc_0", serviceName: "HIFU" };
const unresolved: TreatmentResolution = { resolved: false, candidate: "HIFU" };

describe("evaluateQualification", () => {
  it("marks qualified when all clauses pass", () => {
    expect(evaluateQualification(base, resolved)).toEqual({
      verdict: "qualified",
      serviceId: "svc_0",
    });
  });

  it("returns unqualified when treatment is unresolved (even if other clauses pass)", () => {
    expect(evaluateQualification(base, unresolved).verdict).toBe("unqualified");
  });

  it("returns unqualified when serviceableMarket is out_of_area", () => {
    expect(
      evaluateQualification({ ...base, serviceableMarket: "out_of_area" }, resolved).verdict,
    ).toBe("unqualified");
  });

  it("returns unqualified when serviceableMarket is unknown", () => {
    expect(evaluateQualification({ ...base, serviceableMarket: "unknown" }, resolved).verdict).toBe(
      "unqualified",
    );
  });

  it("returns unqualified when buyingIntent is none", () => {
    expect(evaluateQualification({ ...base, buyingIntent: "none" }, resolved).verdict).toBe(
      "unqualified",
    );
  });

  it("returns unqualified when explicitDecline is true", () => {
    expect(evaluateQualification({ ...base, explicitDecline: true }, resolved).verdict).toBe(
      "unqualified",
    );
  });

  it("returns disqualifier_candidates_present when candidates list is non-empty", () => {
    const out = evaluateQualification(
      { ...base, disqualifierCandidates: [{ type: "out_of_area", evidence: "lives in NY" }] },
      resolved,
    );
    expect(out.verdict).toBe("disqualifier_candidates_present");
    if (out.verdict === "disqualifier_candidates_present") {
      expect(out.candidates).toHaveLength(1);
    }
  });

  it("treatmentInterest takes precedence over disqualifier candidates when both fail", () => {
    const out = evaluateQualification(
      {
        ...base,
        treatmentInterest: "vague",
        disqualifierCandidates: [{ type: "out_of_area", evidence: "x" }],
      },
      unresolved,
    );
    expect(out.verdict).toBe("disqualifier_candidates_present");
  });
});
