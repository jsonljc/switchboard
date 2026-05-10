import type { BannedPhraseEntry } from "./types.js";

export const SG_BANNED_PHRASES: ReadonlyArray<BannedPhraseEntry> = [
  {
    id: "sg_hsa_unapproved_skin_lightening",
    category: "medical_claim",
    patterns: [/\b(skin lightening|whitening) (treatment|procedure|injection)\b/i],
    severity: "block",
    notes: "HSA does not approve injectable skin-lightening; mention here is regulated.",
  },
  {
    id: "sg_hcsa_doctor_endorsement",
    category: "testimonial",
    patterns: ["our doctor recommends", "our specialist recommends"],
    severity: "block",
    notes: "HCSA — doctor recommendation in marketing context is restricted.",
  },
  {
    id: "sg_aesthetic_minimum_invasive_overclaim",
    category: "guarantee",
    patterns: ["non-invasive surgery", "surgery without surgery"],
    severity: "block",
  },
];
