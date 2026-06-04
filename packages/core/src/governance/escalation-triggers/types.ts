import type { GovernanceVerdictReason, HandoffReason } from "@switchboard/schemas";

export type EscalationTriggerCategory =
  | "pregnancy_breastfeeding"
  | "prior_adverse_reaction"
  | "anticoagulant_use"
  | "suspicious_lesion"
  | "recent_procedure"
  | "prior_complaint"
  | "competitor_negative"
  | "multi_treatment_combo"
  | "sensitive_keyword";

export interface EscalationTriggerEntry {
  id: string;
  category: EscalationTriggerCategory;
  patterns: ReadonlyArray<string | RegExp>;
  /** A pattern occurrence is suppressed when a negation match span overlaps it (same sentence). */
  negations?: ReadonlyArray<string | RegExp>;
}

export const REASON_CODE_BY_TRIGGER: Record<EscalationTriggerCategory, GovernanceVerdictReason> = {
  pregnancy_breastfeeding: "medical_safety_trigger",
  prior_adverse_reaction: "medical_safety_trigger",
  anticoagulant_use: "medical_safety_trigger",
  suspicious_lesion: "medical_safety_trigger",
  recent_procedure: "medical_safety_trigger",
  prior_complaint: "compliance_concern",
  competitor_negative: "compliance_concern",
  multi_treatment_combo: "sensitive_inbound",
  sensitive_keyword: "sensitive_inbound",
};

/**
 * Handoff reason for an enforce-mode input-gate block, derived from the
 * verdict reason so the two taxonomies stay deliberately mapped (#791
 * seam-reuse finding): a trigger category is medical iff its verdict reason
 * is medical_safety_trigger.
 */
export function handoffReasonForTriggerCategory(
  category: EscalationTriggerCategory,
): HandoffReason {
  return REASON_CODE_BY_TRIGGER[category] === "medical_safety_trigger"
    ? "medical_safety"
    : "compliance_concern";
}
