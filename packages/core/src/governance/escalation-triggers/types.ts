import type { GovernanceVerdictReason } from "@switchboard/schemas";

export type EscalationTriggerCategory =
  | "pregnancy_breastfeeding"
  | "prior_adverse_reaction"
  | "prior_complaint"
  | "competitor_negative"
  | "multi_treatment_combo"
  | "sensitive_keyword";

export interface EscalationTriggerEntry {
  id: string;
  category: EscalationTriggerCategory;
  patterns: ReadonlyArray<string | RegExp>;
  /** If any negation matches in the same sentence as a pattern, the entry is suppressed. */
  negations?: ReadonlyArray<string | RegExp>;
}

export const REASON_CODE_BY_TRIGGER: Record<EscalationTriggerCategory, GovernanceVerdictReason> = {
  pregnancy_breastfeeding: "medical_safety_trigger",
  prior_adverse_reaction: "medical_safety_trigger",
  prior_complaint: "compliance_concern",
  competitor_negative: "compliance_concern",
  multi_treatment_combo: "sensitive_inbound",
  sensitive_keyword: "sensitive_inbound",
};
