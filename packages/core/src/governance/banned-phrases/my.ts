import type { BannedPhraseEntry } from "./types.js";

export const MY_BANNED_PHRASES: ReadonlyArray<BannedPhraseEntry> = [
  {
    id: "my_mab_overclaim_aesthetic",
    category: "superlative",
    patterns: [/\b(only|first|premier) aesthetic clinic\b/i],
    severity: "block",
    notes: "MAB — superlative clinic claims require substantiation.",
  },
  {
    id: "my_kkm_unregistered_device",
    category: "medical_claim",
    patterns: ["FDA-approved", "FDA approved"],
    severity: "block",
    notes:
      "Marketing FDA-approval to MY consumers when device may only carry MDA approval is misleading.",
  },
  {
    id: "my_overclaim_doctor_specialist",
    category: "testimonial",
    patterns: [/\bspecialist (in|of) (every|all)\b/i],
    severity: "block",
  },
];
