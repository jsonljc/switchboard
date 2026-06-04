import { describe, it, expect } from "vitest";
import type { EscalationTriggerCategory } from "../types.js";
import { REASON_CODE_BY_TRIGGER, handoffReasonForTriggerCategory } from "../types.js";

describe("handoffReasonForTriggerCategory", () => {
  it("routes every medical_safety_trigger category to handoff reason medical_safety", () => {
    const medical: EscalationTriggerCategory[] = [
      "pregnancy_breastfeeding",
      "prior_adverse_reaction",
      "anticoagulant_use",
      "suspicious_lesion",
      "recent_procedure",
    ];
    for (const c of medical) {
      expect(REASON_CODE_BY_TRIGGER[c]).toBe("medical_safety_trigger");
      expect(handoffReasonForTriggerCategory(c)).toBe("medical_safety");
    }
  });

  it("keeps every non-medical category on compliance_concern", () => {
    const all = Object.keys(REASON_CODE_BY_TRIGGER) as EscalationTriggerCategory[];
    for (const c of all) {
      if (REASON_CODE_BY_TRIGGER[c] === "medical_safety_trigger") continue;
      expect(handoffReasonForTriggerCategory(c)).toBe("compliance_concern");
    }
  });
});
