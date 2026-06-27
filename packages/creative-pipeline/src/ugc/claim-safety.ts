// packages/creative-pipeline/src/ugc/claim-safety.ts
//
// Deterministic, no-key claim-safety detector over generated UGC scripts/hooks
// (EV-13 / MONEY-7 / BUG-8). This is the SAFETY-CRITICAL leg of the creative
// claim gate: a medspa UGC script that promises a guaranteed result, asserts
// personal safety, claims FDA approval, diagnoses a lead, makes an unevidenced
// superiority claim, manufactures urgency, relays a testimonial, or fabricates
// an offer must be flagged so it never reaches PAID video production unreviewed.
//
// GROUNDING: the ruleset is a faithful lexical projection of the non-negotiable
// rules in `skills/alex/references/medspa/claim-boundaries.md` (the same doctrine
// the conversational claim classifier enforces). It is NOT a divergent ruleset -
// it reuses the @switchboard/schemas `ClaimType` taxonomy so the creative surface
// and the conversational surface share one vocabulary. creative-pipeline is a
// Layer-2 package (schemas-only), so it cannot import the Layer-3 core classifier;
// this is the deterministic, dependency-free equivalent for generated creative.
//
// It is intentionally conservative: when a script is ambiguous the safe direction
// is to over-flag (route to human review), never to under-flag and spend.

import { z } from "zod";
import type { ClaimType } from "@switchboard/schemas";

// ── Categories ──

/**
 * A claim-safety violation category. The medical-claim categories REUSE the
 * @switchboard/schemas `ClaimType` taxonomy (minus "none"); `forbidden-phrase`
 * and `hallucinated-offer` are creative-surface-specific categories with no
 * conversational-classifier analogue.
 */
export type ClaimViolationCategory =
  | Exclude<ClaimType, "none">
  | "forbidden-phrase"
  | "hallucinated-offer";

export interface ClaimViolation {
  category: ClaimViolationCategory;
  /** The exact substring that tripped the rule (operator visibility). */
  matchedText: string;
  /** The claim-boundaries.md rule (or source list) this enforces. */
  rule: string;
}

export interface ClaimSafetyInput {
  /** The generated script/hook text to inspect. */
  text: string;
  /** Creator/brand forbidden phrases (e.g. creator.personality.forbiddenPhrases). */
  forbiddenPhrases?: readonly string[];
}

export interface ClaimSafetyResult {
  verdict: "clean" | "flagged";
  violations: ClaimViolation[];
}

// ── Persisted policy tag ──

/**
 * The validated `claimsPolicyTag` carried on a CreativeSpec's script. Before
 * EV-13 this was an unvalidated free `z.string().optional()` the model was
 * nominally meant to emit but nothing ever parsed or enforced. It is now a
 * closed enum DERIVED from the deterministic detector at scripting time and
 * PARSED + enforced at the production gate.
 */
export const ClaimsPolicyTagSchema = z.enum(["clean", "review_required"]);
export type ClaimsPolicyTag = z.infer<typeof ClaimsPolicyTagSchema>;

interface ClaimRule {
  category: ClaimViolationCategory;
  /** The claim-boundaries.md rule (or source list) this pattern enforces. */
  rule: string;
  pattern: RegExp;
}

// ── Ruleset (grounded in claim-boundaries.md) ──
//
// Each rule cites the boundary it enforces. Patterns are case-insensitive and
// word-boundary anchored so an ordinary word that merely CONTAINS a banned
// token as a substring (bestseller / secure / performance) does not trip.

const GUARANTEE_RULE =
  "claim-boundaries: Never guarantee results, outcomes, or timelines (no 'guaranteed', 'permanent', '100%', 'you will see', 'it will fix').";
const SAFETY_RULE =
  "claim-boundaries: Never assert 'safe for you' or promise no side effects / no downtime.";
const SUPERIORITY_RULE = "claim-boundaries: No superiority claims without evidence.";
const URGENCY_RULE =
  "claim-boundaries: No urgency tactics (scarcity / time pressure) without operator-provided, time-bounded offer copy.";
const TESTIMONIAL_RULE = "claim-boundaries: No testimonials or personal outcome anecdotes.";
const DIAGNOSIS_RULE = "claim-boundaries: Never diagnose.";
const REGULATORY_RULE =
  "claim-boundaries (superiority/efficacy): no unevidenced regulatory-authority claim (e.g. 'FDA-approved').";
const OFFER_RULE =
  "claim-boundaries (urgency): a concrete discount/offer is unsubstantiated unless the operator provided factual offer copy in Business Facts - none is plumbed into the script writer.";

export const CLAIM_SAFETY_RULES: readonly ClaimRule[] = [
  // efficacy / guaranteed results / outcomes / timelines
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\bguarantee(?:d|s|ing)?\b/gi },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\bpermanent(?:ly)?\b/gi },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\b100\s?%\b/gi },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\bcure[sd]?\b/gi },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\brisk[-\s]?free\b/gi },
  {
    category: "efficacy",
    rule: GUARANTEE_RULE,
    pattern: /\byou(?:'?ll| will)\s+(?:see|notice|get|love|look)\b/gi,
  },
  {
    category: "efficacy",
    rule: GUARANTEE_RULE,
    pattern: /\bit\s+will\s+(?:fix|work|cure|remove|erase|eliminate|get rid of)\b/gi,
  },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\bclinically\s+proven\b/gi },
  { category: "efficacy", rule: GUARANTEE_RULE, pattern: /\bproven\s+to\b/gi },
  {
    category: "efficacy",
    rule: GUARANTEE_RULE,
    pattern: /\b(?:results?|difference)\s+in\s+\d+\s+(?:days?|weeks?|months?)\b/gi,
  },

  // safety-claim / personal safety / no side effects / no downtime
  { category: "safety-claim", rule: SAFETY_RULE, pattern: /\bsafe\s+for\s+you\b/gi },
  {
    category: "safety-claim",
    rule: SAFETY_RULE,
    pattern: /\b(?:completely|totally|100%)\s+safe\b/gi,
  },
  {
    category: "safety-claim",
    rule: SAFETY_RULE,
    pattern: /\b(?:no|zero)\s+side[-\s]?effects?\b/gi,
  },
  {
    category: "safety-claim",
    rule: SAFETY_RULE,
    pattern: /\byou\s+won'?t\s+have\s+(?:any\s+)?side[-\s]?effects?\b/gi,
  },
  { category: "safety-claim", rule: SAFETY_RULE, pattern: /\bno\s+downtime\b/gi },
  { category: "safety-claim", rule: SAFETY_RULE, pattern: /\bpain[-\s]?free\b/gi },

  // superiority
  {
    category: "superiority",
    rule: SUPERIORITY_RULE,
    pattern: /\bbest\s+(?:clinic|results?|treatment|choice|in\s+town)\b/gi,
  },
  { category: "superiority", rule: SUPERIORITY_RULE, pattern: /\bthe\s+best\b/gi },
  { category: "superiority", rule: SUPERIORITY_RULE, pattern: /\b#\s?1\b/gi },
  { category: "superiority", rule: SUPERIORITY_RULE, pattern: /\bnumber\s+one\b/gi },
  { category: "superiority", rule: SUPERIORITY_RULE, pattern: /\bmost\s+effective\b/gi },
  { category: "superiority", rule: SUPERIORITY_RULE, pattern: /\b(?:un(?:matched|beatable))\b/gi },
  {
    category: "superiority",
    rule: SUPERIORITY_RULE,
    pattern: /\bbetter\s+than\s+(?:anyone|any other|everyone|the rest|competitors?)\b/gi,
  },

  // urgency / scarcity / time pressure
  {
    category: "urgency",
    rule: URGENCY_RULE,
    pattern: /\bonly\s+(?:a\s+few|\d+)\s+(?:spots?|slots?|left)\b/gi,
  },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\blimited\s+time\b/gi },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\bact\s+now\b/gi },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\bhurry\b/gi },
  {
    category: "urgency",
    rule: URGENCY_RULE,
    pattern: /\bends?\s+(?:today|tonight|soon|this\s+week)\b/gi,
  },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\bprice\s+ends\s+soon\b/gi },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\btoday\s+only\b/gi },
  { category: "urgency", rule: URGENCY_RULE, pattern: /\bif\s+you\s+don'?t\s+book\b/gi },
  {
    category: "urgency",
    rule: URGENCY_RULE,
    pattern: /\bwhile\s+(?:stocks?|slots?|spots?)\s+last\b/gi,
  },

  // testimonial / before-after anecdotes
  { category: "testimonial", rule: TESTIMONIAL_RULE, pattern: /\bbefore\s+and\s+after\b/gi },
  { category: "testimonial", rule: TESTIMONIAL_RULE, pattern: /\bbefore[-/&]after\b/gi },
  {
    category: "testimonial",
    rule: TESTIMONIAL_RULE,
    pattern: /\b(?:my|other)\s+(?:clients?|patients?|customers?)\s+(?:saw|got|loved|raved)\b/gi,
  },
  { category: "testimonial", rule: TESTIMONIAL_RULE, pattern: /\breal\s+results?\b/gi },

  // diagnosis (narrow + explicit, to avoid false positives)
  { category: "diagnosis", rule: DIAGNOSIS_RULE, pattern: /\bdiagnos(?:e|es|ed|is|ing)\b/gi },
  {
    category: "diagnosis",
    rule: DIAGNOSIS_RULE,
    pattern:
      /\byou\s+(?:have|'ve\s+got)\s+(?:a\s+)?(?:condition|disorder|melasma|rosacea|eczema|psoriasis)\b/gi,
  },
  { category: "diagnosis", rule: DIAGNOSIS_RULE, pattern: /\byou\s+are\s+suffering\s+from\b/gi },
  { category: "diagnosis", rule: DIAGNOSIS_RULE, pattern: /\byour\s+condition\s+is\b/gi },

  // credentials / regulatory authority (FDA etc.)
  {
    category: "credentials",
    rule: REGULATORY_RULE,
    pattern: /\bfda[-\s]?(?:approved|cleared)\b/gi,
  },
  { category: "credentials", rule: REGULATORY_RULE, pattern: /\bhsa[-\s]?approved\b/gi },

  // hallucinated offers (concrete discount/price/money-back, ungrounded)
  { category: "hallucinated-offer", rule: OFFER_RULE, pattern: /\b\d{1,3}\s?%\s+off\b/gi },
  {
    category: "hallucinated-offer",
    rule: OFFER_RULE,
    pattern: /\b(?:rm|sgd|myr|usd|\$)\s?\d+\s+off\b/gi,
  },
  {
    category: "hallucinated-offer",
    rule: OFFER_RULE,
    pattern: /\bmoney[-\s]?back\s+guarantee\b/gi,
  },
  {
    category: "hallucinated-offer",
    rule: OFFER_RULE,
    pattern: /\bfree\s+(?:consultation|consult|session|treatment|trial|gift)\b/gi,
  },
  { category: "hallucinated-offer", rule: OFFER_RULE, pattern: /\bbuy\s+one\s+get\s+one\b/gi },
  { category: "hallucinated-offer", rule: OFFER_RULE, pattern: /\bbogo\b/gi },
];

// ── UGC global forbidden ad-copy phrases ──
//
// The exact phrases the UGC script-writer prompt declares FORBIDDEN. Enforced
// here post-generation so a model that ignores its own instruction is still
// caught deterministically.
const UGC_FORBIDDEN_PHRASES: readonly string[] = [
  "limited time offer",
  "act now",
  "don't miss out",
  "dont miss out",
  "click the link below",
];

const FORBIDDEN_PHRASE_RULE =
  "ugc-script-writer FORBIDDEN list + creator.personality.forbiddenPhrases.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Detector ──

/**
 * Deterministically inspect a generated UGC script for banned/unsubstantiated
 * medical claims, hallucinated offers, and forbidden phrases. No network, no
 * API key - pure lexical analysis grounded in claim-boundaries.md.
 */
export function evaluateClaimSafety(input: ClaimSafetyInput): ClaimSafetyResult {
  const text = input.text ?? "";
  const violations: ClaimViolation[] = [];
  const seen = new Set<string>();

  const record = (category: ClaimViolationCategory, matchedText: string, rule: string): void => {
    // Dedupe identical (category, matchedText) pairs so one repeated phrase does
    // not inflate the violation list; distinct matches still each report.
    const key = `${category}::${matchedText.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ category, matchedText, rule });
  };

  for (const { category, rule, pattern } of CLAIM_SAFETY_RULES) {
    // Each rule's pattern is global; reset lastIndex defensively before reuse.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      record(category, match[0], rule);
      // Guard against zero-width matches looping forever.
      if (match.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }

  // Forbidden phrases (global UGC list + caller-supplied creator/brand list).
  const forbidden = [...UGC_FORBIDDEN_PHRASES, ...(input.forbiddenPhrases ?? [])];
  for (const phrase of forbidden) {
    const trimmed = phrase.trim();
    if (trimmed.length === 0) continue;
    const re = new RegExp(escapeRegExp(trimmed), "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      record("forbidden-phrase", match[0], FORBIDDEN_PHRASE_RULE);
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  return { verdict: violations.length > 0 ? "flagged" : "clean", violations };
}

/**
 * Producer side (scripting): derive the validated `claimsPolicyTag` to stamp on
 * a spec's script from the deterministic verdict. A flagged script routes to
 * human review; a clean script is tagged clean.
 */
export function deriveClaimsPolicyTag(result: ClaimSafetyResult): ClaimsPolicyTag {
  return result.verdict === "flagged" ? "review_required" : "clean";
}

/**
 * Consumer side (production gate): parse + validate a spec's `claimsPolicyTag`.
 *
 * - absent (undefined/null): treated as "clean" - backward compatible, a spec
 *   produced before this gate existed (or by another path) is not retroactively
 *   blocked.
 * - recognized value: passed through.
 * - present but unrecognized (tampered/garbage/wrong type): FAIL CLOSED to
 *   "review_required" - a malformed safety tag is never trusted to allow spend.
 */
export function parseClaimsPolicyTag(raw: unknown): ClaimsPolicyTag {
  if (raw === undefined || raw === null) return "clean";
  const parsed = ClaimsPolicyTagSchema.safeParse(raw);
  return parsed.success ? parsed.data : "review_required";
}
