import type { BannedPhraseEntry } from "./types.js";

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
];
