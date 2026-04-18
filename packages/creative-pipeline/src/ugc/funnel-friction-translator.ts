// packages/core/src/creative-pipeline/ugc/funnel-friction-translator.ts
import type { FunnelFriction, CreativeWeights } from "@switchboard/schemas";

// ── Translation rules (from spec Section 4.6) ──

interface TranslationRule {
  structurePriorities: Record<string, number>;
  motivatorPriorities: Record<string, number>;
  scriptConstraints: string[];
  hookDirectives: string[];
}

const FRICTION_RULES: Record<string, TranslationRule> = {
  low_trust: {
    structurePriorities: { social_proof: 1, confession: 0.8, before_after: 0.6 },
    motivatorPriorities: {},
    scriptConstraints: [],
    hookDirectives: [],
  },
  price_shock: {
    structurePriorities: {},
    motivatorPriorities: { value: 1, cost_of_inaction: 0.8, comparison: 0.6 },
    scriptConstraints: [],
    hookDirectives: [],
  },
  expectation_mismatch: {
    structurePriorities: { demo_first: 1, myth_buster: 0.8 },
    motivatorPriorities: {},
    scriptConstraints: ["set clear expectations early"],
    hookDirectives: [],
  },
  weak_hook: {
    structurePriorities: {},
    motivatorPriorities: {},
    scriptConstraints: [],
    hookDirectives: ["increase hook novelty"],
  },
  offer_confusion: {
    structurePriorities: { demo_first: 1 },
    motivatorPriorities: { clarity: 1 },
    scriptConstraints: ["explicit offer breakdown"],
    hookDirectives: [],
  },
  low_urgency: {
    structurePriorities: {},
    motivatorPriorities: { scarcity: 1, fomo: 0.8 },
    scriptConstraints: ["time-bound framing"],
    hookDirectives: [],
  },
  weak_demo: {
    structurePriorities: { demo_first: 1, before_after: 0.8 },
    motivatorPriorities: {},
    scriptConstraints: ["show product in use within first 5s"],
    hookDirectives: [],
  },
  poor_social_proof: {
    structurePriorities: { social_proof: 1 },
    motivatorPriorities: {},
    scriptConstraints: ["lead with testimonial or number"],
    hookDirectives: [],
  },
};

// ── Confidence weights ──

const CONFIDENCE_WEIGHT: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

/**
 * Translates active funnel frictions into creative decision weights.
 * Merges multiple frictions, weighting by confidence level.
 * Does NOT own ingestion — consumes FunnelFriction[] from external sources.
 */
export function translateFrictions(frictions: FunnelFriction[]): CreativeWeights {
  const structurePriorities: Record<string, number> = {};
  const motivatorPriorities: Record<string, number> = {};
  const scriptConstraints: string[] = [];
  const hookDirectives: string[] = [];

  for (const friction of frictions) {
    const rule = FRICTION_RULES[friction.frictionType];
    if (!rule) continue;

    const weight = CONFIDENCE_WEIGHT[friction.confidence] ?? 0.3;

    // Merge structure priorities
    for (const [structureId, score] of Object.entries(rule.structurePriorities)) {
      structurePriorities[structureId] = (structurePriorities[structureId] ?? 0) + score * weight;
    }

    // Merge motivator priorities
    for (const [motivator, score] of Object.entries(rule.motivatorPriorities)) {
      motivatorPriorities[motivator] = (motivatorPriorities[motivator] ?? 0) + score * weight;
    }

    // Collect unique constraints and directives
    for (const constraint of rule.scriptConstraints) {
      if (!scriptConstraints.includes(constraint)) {
        scriptConstraints.push(constraint);
      }
    }
    for (const directive of rule.hookDirectives) {
      if (!hookDirectives.includes(directive)) {
        hookDirectives.push(directive);
      }
    }
  }

  return { structurePriorities, motivatorPriorities, scriptConstraints, hookDirectives };
}
