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
  // §2.5 conservative seed additions — MY-specific regulatory patterns
  {
    id: "my_mmc_guaranteed_outcome",
    category: "guarantee",
    patterns: [/\b(guaranteed|promise(d)?|assure(d)?) (result|outcome|effect|improvement)\b/i],
    severity: "block",
    notes:
      "MMC — guaranteeing clinical outcomes is prohibited under MY medical advertising guidelines.",
  },
  {
    id: "my_kkm_urgency_slots",
    category: "urgency",
    patterns: [
      /\b(last|only|remaining) \d+ (slot|spot|appointment|seat)s? (available|left|today)\b/i,
    ],
    severity: "block",
    notes:
      "KKM — artificial urgency around appointment scarcity is prohibited in MY health advertising.",
  },
];
