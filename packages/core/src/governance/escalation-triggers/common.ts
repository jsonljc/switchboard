import type { EscalationTriggerEntry } from "./types.js";

export const COMMON_ESCALATION_TRIGGERS: ReadonlyArray<EscalationTriggerEntry> = [
  {
    id: "pregnancy",
    category: "pregnancy_breastfeeding",
    patterns: [/\bpregnan(t|cy)\b/i, /\b(expect(ing)?|with child)\b/i],
    negations: [/\b(not|never|no longer|wasn'?t)\b[^.!?]*\b(pregnan(t|cy)|expecting)\b/i],
  },
  {
    id: "breastfeeding",
    category: "pregnancy_breastfeeding",
    patterns: [/\b(breast ?feeding|nursing|lactating)\b/i],
    negations: [/\b(not|never|no longer|stopped)\b[^.!?]*\b(breast ?feeding|nursing|lactating)\b/i],
  },
  {
    id: "prior_adverse_reaction",
    category: "prior_adverse_reaction",
    patterns: [
      /\b(allergic reaction|allergy|severe reaction|bad reaction|anaphylaxis)\b/i,
      /\b(burn(ed|t)?|scarred|swollen badly) after\b/i,
    ],
    negations: [/\b(no|never|no history of)\b[^.!?]*\b(reaction|allergy)\b/i],
  },
  {
    id: "prior_complaint",
    category: "prior_complaint",
    patterns: [
      /\b(complain(ed|t)|filed (a )?complaint|legal action)\b/i,
      /\b(unhappy|disappointed|refund) (with|from) (the|my last|previous) (clinic|treatment)\b/i,
    ],
    negations: [/\b(no|never had a|didn'?t)\b[^.!?]*\bcomplain/i],
  },
  {
    id: "competitor_negative",
    category: "competitor_negative",
    patterns: [
      /\b(better than|cheaper than|inferior to)\b[^.!?]*\b(other clinic|competitor)\b/i,
      /\b(scammed|cheated|misled) by\b/i,
    ],
  },
  {
    id: "multi_treatment_combo",
    category: "multi_treatment_combo",
    patterns: [
      /\b(combine|stack|together|same day)\b[^.!?]*\b(botox|filler|laser|peel|skinbooster|profhilo)\b/i,
    ],
  },
  {
    id: "sensitive_keyword_minor",
    category: "sensitive_keyword",
    patterns: [/\b(my (daughter|son)|teenage|under ?\s?(16|18))\b/i],
  },
  {
    id: "sensitive_keyword_medical_condition",
    category: "sensitive_keyword",
    patterns: [
      /\b(diabet(es|ic)|hypertension|high blood pressure|cancer|chemo(therapy)?|pacemaker|epilepsy|seizures?)\b/i,
    ],
  },
];
