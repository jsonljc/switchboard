// packages/core/src/creative-pipeline/ugc/structure-engine.ts
import type { CreativeWeights } from "@switchboard/schemas";

// ── Types ──

export type StructureId =
  | "confession"
  | "mistake"
  | "social_proof"
  | "pas"
  | "demo_first"
  | "before_after"
  | "comparison"
  | "myth_buster";

export interface StructureTemplate {
  id: StructureId;
  name: string;
  sections: Array<{ name: string; purposeGuide: string; durationRange: [number, number] }>;
  platformAffinity: Record<string, number>;
  funnelFrictionAffinity: Record<string, number>;
}

export interface StructureSelection {
  structureId: StructureId;
  template: StructureTemplate;
  score: number;
}

interface PerformanceMemory {
  structureHistory: Record<string, { avgCtr?: number; avgHoldRate?: number }>;
  creatorHistory: Record<string, unknown>;
}

export interface StructureSelectionInput {
  platforms: string[];
  creativeWeights: CreativeWeights;
  performanceMemory: PerformanceMemory;
  recentStructureIds: string[];
  maxResults: number;
}

// ── Template Library ──

const TEMPLATES: StructureTemplate[] = [
  {
    id: "confession",
    name: "Confession / Authentic Story",
    sections: [
      {
        name: "hook",
        purposeGuide: "Vulnerable admission that draws attention",
        durationRange: [3, 5],
      },
      {
        name: "story",
        purposeGuide: "Personal narrative building credibility",
        durationRange: [8, 15],
      },
      { name: "reveal", purposeGuide: "Product as the turning point", durationRange: [5, 10] },
      { name: "cta", purposeGuide: "Invitation to try", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.8, instagram_reels: 0.9, tiktok: 0.95 },
    funnelFrictionAffinity: { low_trust: 0.9, poor_social_proof: 0.6 },
  },
  {
    id: "mistake",
    name: "Common Mistake",
    sections: [
      { name: "hook", purposeGuide: "Call out a widespread mistake", durationRange: [3, 5] },
      { name: "problem", purposeGuide: "Show consequences of the mistake", durationRange: [5, 10] },
      { name: "solution", purposeGuide: "Reveal the better approach", durationRange: [8, 12] },
      { name: "cta", purposeGuide: "Drive action", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.7, instagram_reels: 0.8, tiktok: 0.85 },
    funnelFrictionAffinity: { expectation_mismatch: 0.8, weak_hook: 0.6 },
  },
  {
    id: "social_proof",
    name: "Social Proof / Testimonial",
    sections: [
      { name: "hook", purposeGuide: "Lead with number or testimonial", durationRange: [3, 5] },
      { name: "evidence", purposeGuide: "Stack proof points", durationRange: [8, 15] },
      { name: "product", purposeGuide: "Show what delivers these results", durationRange: [5, 8] },
      { name: "cta", purposeGuide: "Join the crowd", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.9, instagram_reels: 0.8, tiktok: 0.7 },
    funnelFrictionAffinity: { low_trust: 0.95, poor_social_proof: 0.95 },
  },
  {
    id: "pas",
    name: "Problem → Agitate → Solve",
    sections: [
      { name: "problem", purposeGuide: "Name the pain point", durationRange: [3, 5] },
      { name: "agitate", purposeGuide: "Make it feel urgent", durationRange: [5, 10] },
      { name: "solve", purposeGuide: "Present the solution", durationRange: [8, 12] },
      { name: "cta", purposeGuide: "Clear next step", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.85, instagram_reels: 0.8, tiktok: 0.75 },
    funnelFrictionAffinity: { price_shock: 0.7, low_urgency: 0.8 },
  },
  {
    id: "demo_first",
    name: "Demo First",
    sections: [
      { name: "demo", purposeGuide: "Show product in action immediately", durationRange: [5, 10] },
      { name: "context", purposeGuide: "Explain what they just saw", durationRange: [5, 8] },
      { name: "benefits", purposeGuide: "Connect demo to outcomes", durationRange: [5, 8] },
      { name: "cta", purposeGuide: "Try it yourself", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.8, instagram_reels: 0.85, tiktok: 0.9 },
    funnelFrictionAffinity: { weak_demo: 0.95, expectation_mismatch: 0.8, offer_confusion: 0.7 },
  },
  {
    id: "before_after",
    name: "Before / After",
    sections: [
      { name: "before", purposeGuide: "Show the pain state", durationRange: [5, 8] },
      { name: "transition", purposeGuide: "The moment of change", durationRange: [3, 5] },
      { name: "after", purposeGuide: "Show the transformed state", durationRange: [5, 10] },
      { name: "cta", purposeGuide: "Get your own transformation", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.85, instagram_reels: 0.9, tiktok: 0.85 },
    funnelFrictionAffinity: { low_trust: 0.7, weak_demo: 0.8 },
  },
  {
    id: "comparison",
    name: "Comparison / Us vs Them",
    sections: [
      { name: "hook", purposeGuide: "Set up the comparison", durationRange: [3, 5] },
      { name: "them", purposeGuide: "Show the alternative's weakness", durationRange: [5, 8] },
      { name: "us", purposeGuide: "Show our strength", durationRange: [5, 10] },
      { name: "cta", purposeGuide: "Make the switch", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.8, instagram_reels: 0.75, tiktok: 0.8 },
    funnelFrictionAffinity: { price_shock: 0.8, offer_confusion: 0.6 },
  },
  {
    id: "myth_buster",
    name: "Myth Buster",
    sections: [
      { name: "myth", purposeGuide: "State the common belief", durationRange: [3, 5] },
      { name: "bust", purposeGuide: "Disprove with evidence", durationRange: [8, 12] },
      { name: "truth", purposeGuide: "Reveal what actually works", durationRange: [5, 8] },
      { name: "cta", purposeGuide: "Try the truth", durationRange: [3, 5] },
    ],
    platformAffinity: { meta_feed: 0.75, instagram_reels: 0.8, tiktok: 0.9 },
    funnelFrictionAffinity: { expectation_mismatch: 0.9, weak_hook: 0.7 },
  },
];

export function getStructureTemplates(): StructureTemplate[] {
  return TEMPLATES;
}

// ── Selection Logic ──

// Configurable weights (spec says "calibrated over time")
const WEIGHTS = {
  platform: 0.3,
  friction: 0.3,
  performance: 0.2,
  fatigue: 0.2,
};

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 0.001);
  return values.map((v) => v / max);
}

export function selectStructures(input: StructureSelectionInput): StructureSelection[] {
  const { platforms, creativeWeights, performanceMemory, recentStructureIds, maxResults } = input;

  const rawScores = TEMPLATES.map((template) => {
    // Platform affinity: average across target platforms
    const platformScore =
      platforms.reduce((sum, p) => sum + (template.platformAffinity[p] ?? 0), 0) /
      Math.max(platforms.length, 1);

    // Friction affinity: sum of matching friction priorities
    const frictionScore = Object.entries(creativeWeights.structurePriorities).reduce(
      (sum, [_frictionType, priority]) => {
        // Check if this structure has affinity for any boosted structure
        return template.id === _frictionType ? sum + priority : sum;
      },
      0,
    );

    // Also check funnelFrictionAffinity against the friction types that are active
    const frictionAffinityScore = Object.entries(template.funnelFrictionAffinity).reduce(
      (sum, [frictionType, affinity]) => {
        const priority = creativeWeights.structurePriorities[frictionType] ?? 0;
        return sum + affinity * priority;
      },
      0,
    );

    // Performance memory (stub: empty = 0)
    const perf = performanceMemory.structureHistory[template.id];
    const performanceScore = perf?.avgCtr ?? 0;

    // Fatigue penalty
    const fatigueScore = recentStructureIds.includes(template.id) ? 1 : 0;

    return {
      template,
      platformScore,
      frictionScore: frictionScore + frictionAffinityScore,
      performanceScore,
      fatigueScore,
    };
  });

  // Normalize each dimension
  const platformScores = normalize(rawScores.map((s) => s.platformScore));
  const frictionScores = normalize(rawScores.map((s) => s.frictionScore));
  const performanceScores = normalize(rawScores.map((s) => s.performanceScore));
  const fatigueScores = normalize(rawScores.map((s) => s.fatigueScore));

  // Combine with weights
  const scored: StructureSelection[] = rawScores.map((raw, i) => ({
    structureId: raw.template.id,
    template: raw.template,
    score:
      WEIGHTS.platform * platformScores[i] +
      WEIGHTS.friction * frictionScores[i] +
      WEIGHTS.performance * performanceScores[i] -
      WEIGHTS.fatigue * fatigueScores[i],
  }));

  // Sort descending by score, take top N
  return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
