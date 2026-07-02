import type { BannedPhraseEntry, BannedPhraseCategory } from "./types.js";
import type { Vertical } from "../../vertical.js";

export const COMMON_BANNED_PHRASES: ReadonlyArray<BannedPhraseEntry> = [
  // Superlative — pair root with marketing-claim noun class
  {
    id: "superlative_best_results",
    category: "superlative",
    patterns: [
      /\b(best|leading|top|#?1|no\.?\s?1)\s+(results?|clinic|treatment|doctor|aesthetic|laser|skin|slimming|facial)/i,
    ],
    severity: "block",
    notes: "Contextualized superlative — avoids false positive on 'best practice'.",
  },
  {
    id: "superlative_unmatched",
    category: "superlative",
    patterns: ["unmatched results", "unrivalled", "unparalleled"],
    severity: "block",
  },
  {
    id: "superlative_only",
    category: "superlative",
    patterns: [/\bthe only (treatment|clinic|technology|method) that\b/i],
    severity: "block",
  },
  {
    id: "superlative_world_class",
    category: "superlative",
    patterns: ["world-class", "world class", "industry-leading"],
    severity: "block",
  },
  {
    id: "superlative_revolutionary",
    category: "superlative",
    patterns: ["revolutionary", "groundbreaking", "breakthrough"],
    severity: "block",
  },

  // Guarantee
  {
    id: "guarantee_basic",
    category: "guarantee",
    patterns: ["guaranteed", "guarantee", "100%", "fully ensured"],
    severity: "block",
  },
  {
    id: "guarantee_permanent",
    category: "guarantee",
    patterns: ["permanent", "permanently", "lifetime"],
    severity: "block",
  },
  {
    id: "guarantee_no_side_effects",
    category: "guarantee",
    patterns: ["no side effects", "zero side effects", "no downtime"],
    severity: "block",
  },
  {
    id: "guarantee_painless",
    category: "guarantee",
    patterns: ["painless", "completely painless", "absolutely painless"],
    severity: "block",
  },
  {
    id: "guarantee_risk_free",
    category: "guarantee",
    patterns: ["risk-free", "risk free", "totally safe", "completely safe"],
    severity: "block",
  },

  // Medical claims
  {
    id: "medical_cure",
    category: "medical_claim",
    patterns: ["cure", "cures", "cured"],
    severity: "block",
  },
  {
    id: "medical_treats",
    category: "medical_claim",
    patterns: [/\btreats? (acne|eczema|melasma|psoriasis|rosacea)\b/i],
    severity: "block",
  },
  {
    id: "medical_fixes",
    category: "medical_claim",
    patterns: [/\bfixes? (your |the )?(skin|acne|wrinkles|pigmentation)\b/i],
    severity: "block",
  },
  {
    id: "medical_eliminates",
    category: "medical_claim",
    patterns: [/\beliminates? (acne|wrinkles|fat|cellulite|scars)\b/i],
    severity: "block",
  },
  {
    id: "medical_reverse_aging",
    category: "medical_claim",
    patterns: ["reverse aging", "reverses aging", "anti-aging cure", "stop aging"],
    severity: "block",
  },

  // Urgency
  {
    id: "urgency_today_only",
    category: "urgency",
    patterns: ["today only", "tonight only", "limited slots today"],
    severity: "block",
  },
  {
    id: "urgency_last_chance",
    category: "urgency",
    patterns: ["last chance", "final chance"],
    severity: "block",
  },
  {
    id: "urgency_expires",
    category: "urgency",
    patterns: [/expires (today|tonight|in \d+\s*hours?)/i],
    severity: "block",
  },

  // Testimonial-shape
  {
    id: "testimonial_many_say",
    category: "testimonial",
    patterns: ["many clients say", "many of our clients", "we've heard from"],
    severity: "block",
  },
  {
    id: "testimonial_every_client",
    category: "testimonial",
    patterns: ["every client", "all our clients", "our clients all"],
    severity: "block",
  },
  {
    id: "testimonial_real_stories",
    category: "testimonial",
    patterns: ["real stories from clients", "our clients tell us"],
    severity: "block",
  },

  // Additional superlative entries — anchored pattern, avoids false-positives
  {
    id: "superlative_no_other",
    category: "superlative",
    patterns: [/\bno other (clinic|treatment|technology|provider) (in|near|across)\b/i],
    severity: "block",
    notes: "Anchored — avoids matching 'no other option' or 'no other way'.",
  },

  // Additional guarantee entries
  {
    id: "guarantee_money_back",
    category: "guarantee",
    patterns: ["money-back guarantee", "money back guarantee", "100% refund"],
    severity: "block",
  },

  // Additional medical-claim entries — anchored verb+condition patterns
  {
    id: "medical_removes",
    category: "medical_claim",
    patterns: [
      /\bremoves? (scars?|stretch marks?|dark spots?|age spots?|pigmentation) permanently\b/i,
    ],
    severity: "block",
  },

  // Additional urgency entries
  {
    id: "urgency_act_now",
    category: "urgency",
    patterns: [/\bact now (to|and) (secure|claim|book|get)\b/i, "don't wait, book now"],
    severity: "block",
  },
];

/**
 * The universal safe-harbor floor (SH-2): the vertical-agnostic subset of the
 * medspa common table. Every self-serve / unpacked agent resolves this instead
 * of the medspa seed. A STRICT SUBSET of medspa by construction (a filter over
 * COMMON_BANNED_PHRASES), so medspa keeps passing the floor manifest with zero
 * edits and the loader floor stays a subset of medspa.
 *
 * Included: the universal claim boundaries (guarantee, superlative, urgency,
 * testimonial) plus the generic health-cure ban. Excluded: the medspa-specific
 * medical-claim entries (treats/fixes/eliminates/reverse-aging/removes), which
 * are aesthetic-condition specific and belong to the medspa pack, not the floor.
 */
const GENERIC_BANNED_CATEGORIES = new Set<BannedPhraseCategory>([
  "guarantee",
  "superlative",
  "urgency",
  "testimonial",
]);
const GENERIC_BANNED_EXTRA_IDS = new Set<string>(["medical_cure"]);
export const GENERIC_COMMON_BANNED_PHRASES: ReadonlyArray<BannedPhraseEntry> =
  COMMON_BANNED_PHRASES.filter(
    (entry) =>
      GENERIC_BANNED_CATEGORIES.has(entry.category) || GENERIC_BANNED_EXTRA_IDS.has(entry.id),
  );

/**
 * Vertical-keyed view of the common banned-phrase table. `medspa` is the seed
 * vertical (its table is the medspa pack); `generic` is the universal floor. A
 * vertical absent here falls back to the generic floor in the loader (SH-2),
 * over-restricting only on the jurisdiction regulatory overlay until its pack
 * lands. Keyed so the loader re-keys on (vertical, jurisdiction) with no
 * call-site change.
 */
export const COMMON_BANNED_PHRASES_BY_VERTICAL: Partial<
  Record<Vertical, ReadonlyArray<BannedPhraseEntry>>
> = {
  medspa: COMMON_BANNED_PHRASES,
  generic: GENERIC_COMMON_BANNED_PHRASES,
};
