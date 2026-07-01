import type { BannedPhraseEntry } from "./types.js";
import type { Vertical } from "../../vertical.js";

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
  // §2.5 conservative seed additions — SG-specific regulatory patterns
  {
    id: "sg_smc_unlicensed_practice",
    category: "medical_claim",
    patterns: [
      /\b(perform(s)?|offer(s)?|do(es)?) (surgery|surgical|invasive) (without|no need for) (a )?(doctor|physician|surgeon)\b/i,
    ],
    severity: "block",
    notes:
      "SMC — procedures requiring a licensed physician cannot be framed as tech-only or non-medical.",
  },
  {
    id: "sg_hsa_approved_superlative",
    category: "superlative",
    patterns: [
      /\b(hsa|moh|ministry)[ -]?(approved|certified|endorsed) (and |&amp; )?(best|top|leading)\b/i,
    ],
    severity: "block",
    notes:
      "HCSA/HSA — regulatory endorsement cannot be combined with superlative marketing claims.",
  },
];

/**
 * Vertical-keyed view of the SG jurisdiction table. `medspa` is the seed
 * vertical; a vertical absent here inherits the medspa SG floor in the loader.
 */
export const SG_BANNED_PHRASES_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<BannedPhraseEntry>>
> = {
  medspa: SG_BANNED_PHRASES,
};
