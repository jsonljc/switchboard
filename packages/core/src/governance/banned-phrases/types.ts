import type { GovernanceVerdictReason } from "@switchboard/schemas";

export type BannedPhraseCategory =
  | "superlative"
  | "guarantee"
  | "medical_claim"
  | "urgency"
  | "testimonial";

export type BannedPhraseSeverity = "block" | "rewrite_in_1b2";

export interface BannedPhraseEntry {
  id: string;
  category: BannedPhraseCategory;
  patterns: ReadonlyArray<string | RegExp>;
  severity: BannedPhraseSeverity;
  notes?: string;
}

export const REASON_CODE_BY_CATEGORY: Record<BannedPhraseCategory, GovernanceVerdictReason> = {
  superlative: "unsupported_claim",
  guarantee: "unsupported_claim",
  medical_claim: "unsupported_claim",
  urgency: "banned_phrase",
  testimonial: "banned_phrase",
};
