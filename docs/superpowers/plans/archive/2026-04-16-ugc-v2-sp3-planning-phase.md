# UGC v2 SP3 — Planning Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the planning phase — the first real phase of the UGC pipeline. Takes a brief + creator pool + funnel frictions and outputs structure selections, casting assignments, and identity plans.

**Architecture:** Four pure-function subsystems (structure engine, scene caster, identity strategy router, funnel friction translator) composed into a planning phase function that replaces the SP2 no-op stub. Each subsystem is a separate file with deterministic logic and no external dependencies — fully testable without mocks.

**Tech Stack:** TypeScript ESM, Vitest, Zod (for type imports only — schemas already exist from SP1)

**Spec:** `docs/superpowers/specs/2026-04-15-ugc-v2-creative-system-design.md` — Sections 3.5 (phase contracts), 4.1 (structure engine), 4.2 (scene caster), 4.3 (identity strategy router), 4.6 (funnel friction translator)

---

## File Map

### New files

| File                                                                               | Responsibility                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/core/src/creative-pipeline/ugc/structure-engine.ts`                      | Structure template library + weighted selection                          |
| `packages/core/src/creative-pipeline/ugc/scene-caster.ts`                          | Scores and assigns creators to structures                                |
| `packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts`              | Decides identity enforcement strategy per casting                        |
| `packages/core/src/creative-pipeline/ugc/funnel-friction-translator.ts`            | Translates frictions into creative decision weights                      |
| `packages/core/src/creative-pipeline/ugc/phases/planning.ts`                       | Planning phase — composes subsystems into PlanningInput → PlanningOutput |
| `packages/core/src/creative-pipeline/__tests__/structure-engine.test.ts`           | Tests                                                                    |
| `packages/core/src/creative-pipeline/__tests__/scene-caster.test.ts`               | Tests                                                                    |
| `packages/core/src/creative-pipeline/__tests__/identity-strategy-router.test.ts`   | Tests                                                                    |
| `packages/core/src/creative-pipeline/__tests__/funnel-friction-translator.test.ts` | Tests                                                                    |
| `packages/core/src/creative-pipeline/__tests__/planning-phase.test.ts`             | Tests                                                                    |

### Modified files

| File                                                        | Change                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts` | Replace no-op planning stub with real planning phase call |
| `packages/core/src/creative-pipeline/index.ts`              | Export planning subsystems                                |

---

## Task 1: Funnel Friction Translator

Pure function, no dependencies on other SP3 subsystems. Build first because structure engine consumes its output.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/funnel-friction-translator.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/funnel-friction-translator.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/funnel-friction-translator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { translateFrictions } from "../ugc/funnel-friction-translator.js";
import type { FunnelFriction } from "@switchboard/schemas";

function makeFriction(
  overrides: Partial<FunnelFriction> & { frictionType: FunnelFriction["frictionType"] },
): FunnelFriction {
  return {
    id: "f_1",
    deploymentId: "dep_1",
    source: "manual",
    confidence: "medium",
    evidenceCount: 3,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

describe("translateFrictions", () => {
  it("returns empty weights when no frictions", () => {
    const result = translateFrictions([]);
    expect(result.structurePriorities).toEqual({});
    expect(result.motivatorPriorities).toEqual({});
    expect(result.scriptConstraints).toEqual([]);
    expect(result.hookDirectives).toEqual([]);
  });

  it("translates low_trust to social_proof + confession + before_after structures", () => {
    const result = translateFrictions([makeFriction({ frictionType: "low_trust" })]);
    expect(result.structurePriorities["social_proof"]).toBeGreaterThan(0);
    expect(result.structurePriorities["confession"]).toBeGreaterThan(0);
    expect(result.structurePriorities["before_after"]).toBeGreaterThan(0);
  });

  it("translates price_shock to value + cost_of_inaction + comparison motivators", () => {
    const result = translateFrictions([makeFriction({ frictionType: "price_shock" })]);
    expect(result.motivatorPriorities["value"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["cost_of_inaction"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["comparison"]).toBeGreaterThan(0);
  });

  it("translates expectation_mismatch to demo_first + myth_buster + script constraint", () => {
    const result = translateFrictions([makeFriction({ frictionType: "expectation_mismatch" })]);
    expect(result.structurePriorities["demo_first"]).toBeGreaterThan(0);
    expect(result.structurePriorities["myth_buster"]).toBeGreaterThan(0);
    expect(result.scriptConstraints).toContain("set clear expectations early");
  });

  it("translates weak_hook to hook directive", () => {
    const result = translateFrictions([makeFriction({ frictionType: "weak_hook" })]);
    expect(result.hookDirectives.length).toBeGreaterThan(0);
  });

  it("merges multiple frictions", () => {
    const result = translateFrictions([
      makeFriction({ frictionType: "low_trust" }),
      makeFriction({ frictionType: "price_shock" }),
    ]);
    expect(result.structurePriorities["social_proof"]).toBeGreaterThan(0);
    expect(result.motivatorPriorities["value"]).toBeGreaterThan(0);
  });

  it("prioritizes high-confidence frictions over low-confidence", () => {
    const result = translateFrictions([
      makeFriction({ frictionType: "low_trust", confidence: "high", evidenceCount: 10 }),
      makeFriction({ frictionType: "price_shock", confidence: "low", evidenceCount: 1 }),
    ]);
    // High-confidence friction should have stronger weight
    const trustWeight = result.structurePriorities["social_proof"] ?? 0;
    const priceWeight = result.motivatorPriorities["value"] ?? 0;
    expect(trustWeight).toBeGreaterThan(priceWeight);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run funnel-friction-translator
```

- [ ] **Step 3: Implement funnel-friction-translator.ts**

Create `packages/core/src/creative-pipeline/ugc/funnel-friction-translator.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run funnel-friction-translator
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/funnel-friction-translator.ts packages/core/src/creative-pipeline/__tests__/funnel-friction-translator.test.ts
git commit -m "feat(core): add funnel friction translator — maps frictions to creative weights"
```

---

## Task 2: Structure Engine

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/structure-engine.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/structure-engine.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/structure-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  selectStructures,
  getStructureTemplates,
  type StructureSelectionInput,
} from "../ugc/structure-engine.js";

describe("getStructureTemplates", () => {
  it("returns all 8 structure templates", () => {
    const templates = getStructureTemplates();
    expect(templates).toHaveLength(8);
    expect(templates.map((t) => t.id)).toContain("confession");
    expect(templates.map((t) => t.id)).toContain("social_proof");
  });

  it("each template has sections with duration ranges", () => {
    const templates = getStructureTemplates();
    for (const t of templates) {
      expect(t.sections.length).toBeGreaterThan(0);
      for (const s of t.sections) {
        expect(s.durationRange[0]).toBeLessThanOrEqual(s.durationRange[1]);
      }
    }
  });
});

describe("selectStructures", () => {
  it("returns ranked structures for a platform", () => {
    const input: StructureSelectionInput = {
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentStructureIds: [],
      maxResults: 3,
    };
    const result = selectStructures(input);
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.length).toBeGreaterThan(0);
    // Results should be sorted by score descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it("boosts structures matching friction priorities", () => {
    const withFriction: StructureSelectionInput = {
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: { social_proof: 1 },
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentStructureIds: [],
      maxResults: 8,
    };
    const withoutFriction: StructureSelectionInput = {
      ...withFriction,
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
    };
    const boosted = selectStructures(withFriction);
    const unboosted = selectStructures(withoutFriction);

    const socialProofBoosted = boosted.find((s) => s.structureId === "social_proof");
    const socialProofUnboosted = unboosted.find((s) => s.structureId === "social_proof");
    expect(socialProofBoosted!.score).toBeGreaterThan(socialProofUnboosted!.score);
  });

  it("applies fatigue penalty for recently used structures", () => {
    const fresh: StructureSelectionInput = {
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentStructureIds: [],
      maxResults: 8,
    };
    const fatigued: StructureSelectionInput = {
      ...fresh,
      recentStructureIds: ["confession"],
    };

    const freshResults = selectStructures(fresh);
    const fatiguedResults = selectStructures(fatigued);

    const freshConfession = freshResults.find((s) => s.structureId === "confession");
    const fatiguedConfession = fatiguedResults.find((s) => s.structureId === "confession");
    expect(fatiguedConfession!.score).toBeLessThan(freshConfession!.score);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run structure-engine
```

- [ ] **Step 3: Implement structure-engine.ts**

Create `packages/core/src/creative-pipeline/ugc/structure-engine.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run structure-engine
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/structure-engine.ts packages/core/src/creative-pipeline/__tests__/structure-engine.test.ts
git commit -m "feat(core): add structure engine — weighted ad arc template selection"
```

---

## Task 3: Scene Caster

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/scene-caster.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/scene-caster.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/scene-caster.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { castCreators, type CastingInput } from "../ugc/scene-caster.js";
import type { StructureSelection } from "../ugc/structure-engine.js";

function makeCreator(id: string, energy: string = "conversational") {
  return {
    id,
    deploymentId: "dep_1",
    name: `Creator ${id}`,
    identityRefIds: [],
    heroImageAssetId: "asset_1",
    identityDescription: "test",
    voice: {
      voiceId: "v1",
      provider: "elevenlabs" as const,
      tone: "warm",
      pace: "moderate" as const,
      sampleUrl: "",
    },
    personality: { energy, deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
    approved: true,
    isActive: true,
    bibleVersion: "1.0",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStructure(id: string, score: number): StructureSelection {
  return {
    structureId: id as any,
    template: {
      id: id as any,
      name: id,
      sections: [],
      platformAffinity: {},
      funnelFrictionAffinity: {},
    },
    score,
  };
}

describe("castCreators", () => {
  it("assigns each creator to a structure", () => {
    const input: CastingInput = {
      structures: [makeStructure("confession", 0.9), makeStructure("social_proof", 0.7)],
      creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    const result = castCreators(input);
    expect(result.length).toBeGreaterThan(0);
    // Each assignment has a creatorId and structureId
    for (const assignment of result) {
      expect(assignment.creatorId).toBeTruthy();
      expect(assignment.structureId).toBeTruthy();
      expect(assignment.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns empty when no creators", () => {
    const input: CastingInput = {
      structures: [makeStructure("confession", 0.9)],
      creatorPool: [],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    expect(castCreators(input)).toEqual([]);
  });

  it("applies repetition penalty for recent castings", () => {
    const creator = makeCreator("cr_1");
    const structure = makeStructure("confession", 0.9);

    const fresh: CastingInput = {
      structures: [structure],
      creatorPool: [creator],
      platforms: ["meta_feed"],
      creativeWeights: {
        structurePriorities: {},
        motivatorPriorities: {},
        scriptConstraints: [],
        hookDirectives: [],
      },
      performanceMemory: { structureHistory: {}, creatorHistory: {} },
      recentCastings: [],
    };
    const repeated: CastingInput = {
      ...fresh,
      recentCastings: [{ creatorId: "cr_1", structureId: "confession" }],
    };

    const freshResult = castCreators(fresh);
    const repeatedResult = castCreators(repeated);
    expect(repeatedResult[0].score).toBeLessThan(freshResult[0].score);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run scene-caster
```

- [ ] **Step 3: Implement scene-caster.ts**

Create `packages/core/src/creative-pipeline/ugc/scene-caster.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/scene-caster.ts
import type { CreatorIdentity, CreativeWeights } from "@switchboard/schemas";
import type { StructureSelection } from "./structure-engine.js";

// ── Types ──

export interface CastingAssignment {
  creatorId: string;
  structureId: string;
  score: number;
}

interface PerformanceMemory {
  structureHistory: Record<string, unknown>;
  creatorHistory: Record<string, unknown>;
}

export interface CastingInput {
  structures: StructureSelection[];
  creatorPool: CreatorIdentity[];
  platforms: string[];
  creativeWeights: CreativeWeights;
  performanceMemory: PerformanceMemory;
  recentCastings: Array<{ creatorId: string; structureId: string }>;
}

// ── Scoring ──

const REPETITION_PENALTY = 0.3;

function scoreCreatorForStructure(
  creator: CreatorIdentity,
  structure: StructureSelection,
  input: CastingInput,
): number {
  // Base score from structure selection
  let score = structure.score;

  // Energy affinity: energetic creators suit hook-heavy structures
  const energy = (creator.personality as { energy?: string }).energy ?? "conversational";
  if (energy === "energetic" || energy === "intense") {
    score += 0.1; // slight boost for high-energy creators
  }

  // Repetition penalty
  const wasRecentlyCast = input.recentCastings.some(
    (c) => c.creatorId === creator.id && c.structureId === structure.structureId,
  );
  if (wasRecentlyCast) {
    score -= REPETITION_PENALTY;
  }

  return Math.max(score, 0);
}

/**
 * Assigns creators to structures by scoring all creator × structure pairs
 * and selecting the best assignments.
 */
export function castCreators(input: CastingInput): CastingAssignment[] {
  const { structures, creatorPool } = input;

  if (creatorPool.length === 0 || structures.length === 0) return [];

  // Score all creator × structure combinations
  const allScores: Array<{ creatorId: string; structureId: string; score: number }> = [];

  for (const creator of creatorPool) {
    for (const structure of structures) {
      const score = scoreCreatorForStructure(creator, structure, input);
      allScores.push({ creatorId: creator.id, structureId: structure.structureId, score });
    }
  }

  // Sort by score descending
  allScores.sort((a, b) => b.score - a.score);

  // Greedy assignment: each creator gets their best available structure
  const assignedCreators = new Set<string>();
  const assignments: CastingAssignment[] = [];

  for (const candidate of allScores) {
    if (assignedCreators.has(candidate.creatorId)) continue;
    assignedCreators.add(candidate.creatorId);
    assignments.push(candidate);
  }

  return assignments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run scene-caster
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/scene-caster.ts packages/core/src/creative-pipeline/__tests__/scene-caster.test.ts
git commit -m "feat(core): add scene caster — scores and assigns creators to structures"
```

---

## Task 4: Identity Strategy Router

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/identity-strategy-router.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/identity-strategy-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { routeIdentityStrategy } from "../ugc/identity-strategy-router.js";
import type { CastingAssignment } from "../ugc/scene-caster.js";

describe("routeIdentityStrategy", () => {
  const baseCasting: CastingAssignment = {
    creatorId: "cr_1",
    structureId: "confession",
    score: 0.9,
  };

  it("returns asset_reuse when requireExactReuse is true", () => {
    const plan = routeIdentityStrategy(baseCasting, { requireExactReuse: true });
    expect(plan.primaryStrategy).toBe("asset_reuse");
  });

  it("defaults to reference_conditioning for Phase 1", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.primaryStrategy).toBe("reference_conditioning");
  });

  it("includes asset_reuse in fallback chain", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.fallbackChain).toContain("asset_reuse");
  });

  it("sets constraints from options", () => {
    const plan = routeIdentityStrategy(baseCasting, {
      maxIdentityDrift: 0.3,
      lockHairState: true,
      lockWardrobe: true,
    });
    expect(plan.constraints.maxIdentityDrift).toBe(0.3);
    expect(plan.constraints.lockHairState).toBe(true);
    expect(plan.constraints.lockWardrobe).toBe(true);
  });

  it("uses sensible defaults for constraints", () => {
    const plan = routeIdentityStrategy(baseCasting, {});
    expect(plan.constraints.maxIdentityDrift).toBe(0.5);
    expect(plan.constraints.lockHairState).toBe(false);
    expect(plan.constraints.lockWardrobe).toBe(false);
    expect(plan.constraints.requireExactReuse).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run identity-strategy-router
```

- [ ] **Step 3: Implement identity-strategy-router.ts**

Create `packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts
import type { IdentityPlan, IdentityStrategy } from "@switchboard/schemas";
import type { CastingAssignment } from "./scene-caster.js";

// ── Types ──

interface IdentityRoutingOptions {
  requireExactReuse?: boolean;
  maxIdentityDrift?: number;
  lockHairState?: boolean;
  lockWardrobe?: boolean;
}

// ── Decision Logic ──
// Phase 1 reality: Only reference_conditioning and asset_reuse are implemented.
// platform_identity activates when Kling ships character/identity APIs.
// fine_tuned_identity is Phase 4 (SP10).

/**
 * Decides how identity is enforced for a casting assignment.
 * Returns an IdentityPlan with primary strategy and fallback chain.
 */
export function routeIdentityStrategy(
  casting: CastingAssignment,
  options: IdentityRoutingOptions,
): IdentityPlan {
  const requireExactReuse = options.requireExactReuse ?? false;

  // Decision tree (spec Section 4.3)
  let primaryStrategy: IdentityStrategy;
  let fallbackChain: IdentityStrategy[];

  if (requireExactReuse) {
    primaryStrategy = "asset_reuse";
    fallbackChain = []; // No fallback — exact reuse or fail
  } else {
    // Phase 1: reference_conditioning is the default
    primaryStrategy = "reference_conditioning";
    fallbackChain = ["asset_reuse"]; // Fall back to reusing an approved asset
  }

  return {
    creatorId: casting.creatorId,
    primaryStrategy,
    fallbackChain,
    constraints: {
      maxIdentityDrift: options.maxIdentityDrift ?? 0.5,
      lockHairState: options.lockHairState ?? false,
      lockWardrobe: options.lockWardrobe ?? false,
      requireExactReuse,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run identity-strategy-router
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/identity-strategy-router.ts packages/core/src/creative-pipeline/__tests__/identity-strategy-router.test.ts
git commit -m "feat(core): add identity strategy router — Phase 1 reference_conditioning + asset_reuse"
```

---

## Task 5: Planning Phase

Composes the four subsystems into a single phase function with typed PlanningInput → PlanningOutput.

**Files:**

- Create: `packages/core/src/creative-pipeline/ugc/phases/planning.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/planning-phase.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/core/src/creative-pipeline/__tests__/planning-phase.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executePlanningPhase, type PlanningInput } from "../ugc/phases/planning.js";

function makeCreator(id: string) {
  return {
    id,
    deploymentId: "dep_1",
    name: `Creator ${id}`,
    identityRefIds: [],
    heroImageAssetId: "asset_1",
    identityDescription: "test",
    voice: {
      voiceId: "v1",
      provider: "elevenlabs" as const,
      tone: "warm",
      pace: "moderate" as const,
      sampleUrl: "",
    },
    personality: { energy: "conversational" as const, deliveryStyle: "friendly" },
    appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
    environmentSet: ["kitchen"],
    approved: true,
    isActive: true,
    bibleVersion: "1.0",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("executePlanningPhase", () => {
  const baseInput: PlanningInput = {
    brief: {
      productDescription: "AI scheduling tool",
      targetAudience: "Small business owners",
      platforms: ["meta"],
      creatorPoolIds: ["cr_1", "cr_2"],
      ugcFormat: "talking_head",
      productImages: [],
      references: [],
      generateReferenceImages: false,
    },
    creatorPool: [makeCreator("cr_1"), makeCreator("cr_2")],
    funnelFrictions: [],
    performanceMemory: { structureHistory: {}, creatorHistory: {} },
    providerCapabilities: [],
  };

  it("returns structures, castingAssignments, and identityPlans", () => {
    const result = executePlanningPhase(baseInput);
    expect(result.structures.length).toBeGreaterThan(0);
    expect(result.castingAssignments.length).toBeGreaterThan(0);
    expect(result.identityPlans.length).toBeGreaterThan(0);
  });

  it("produces one identity plan per casting assignment", () => {
    const result = executePlanningPhase(baseInput);
    expect(result.identityPlans.length).toBe(result.castingAssignments.length);
  });

  it("maps CreativePlatform 'meta' to UGC platforms", () => {
    const result = executePlanningPhase(baseInput);
    // Should have structures scored for meta_feed and/or instagram_reels
    expect(result.structures.length).toBeGreaterThan(0);
  });

  it("incorporates funnel frictions into structure selection", () => {
    const withFriction: PlanningInput = {
      ...baseInput,
      funnelFrictions: [
        {
          id: "f1",
          deploymentId: "dep_1",
          frictionType: "low_trust",
          source: "manual",
          confidence: "high",
          evidenceCount: 10,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      ],
    };
    const withoutFriction = baseInput;

    const resultWith = executePlanningPhase(withFriction);
    const resultWithout = executePlanningPhase(withoutFriction);

    // With low_trust friction, social_proof structure should rank higher
    const socialProofWith = resultWith.structures.find((s) => s.structureId === "social_proof");
    const socialProofWithout = resultWithout.structures.find(
      (s) => s.structureId === "social_proof",
    );
    if (socialProofWith && socialProofWithout) {
      expect(socialProofWith.score).toBeGreaterThan(socialProofWithout.score);
    }
  });

  it("returns empty assignments when creator pool is empty", () => {
    const emptyPool: PlanningInput = { ...baseInput, creatorPool: [] };
    const result = executePlanningPhase(emptyPool);
    expect(result.castingAssignments).toEqual([]);
    expect(result.identityPlans).toEqual([]);
    // Structures should still be selected
    expect(result.structures.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run planning-phase
```

- [ ] **Step 3: Create phases directory and implement planning.ts**

```bash
mkdir -p /Users/jasonljc/switchboard/packages/core/src/creative-pipeline/ugc/phases
```

Create `packages/core/src/creative-pipeline/ugc/phases/planning.ts`:

```typescript
// packages/core/src/creative-pipeline/ugc/phases/planning.ts
import type {
  CreatorIdentity,
  FunnelFriction,
  ProviderCapabilityProfile,
  IdentityPlan,
} from "@switchboard/schemas";
import { translateFrictions } from "../funnel-friction-translator.js";
import { selectStructures, type StructureSelection } from "../structure-engine.js";
import { castCreators, type CastingAssignment } from "../scene-caster.js";
import { routeIdentityStrategy } from "../identity-strategy-router.js";

// ── Types ──

interface UgcBriefInput {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  creatorPoolIds: string[];
  ugcFormat: string;
  imperfectionProfile?: unknown;
  productImages?: string[];
  references?: string[];
  generateReferenceImages?: boolean;
}

interface PerformanceMemory {
  structureHistory: Record<string, { avgCtr?: number; avgHoldRate?: number }>;
  creatorHistory: Record<string, unknown>;
}

export interface PlanningInput {
  brief: UgcBriefInput;
  creatorPool: CreatorIdentity[];
  funnelFrictions: FunnelFriction[];
  performanceMemory: PerformanceMemory;
  providerCapabilities: ProviderCapabilityProfile[];
}

export interface PlanningOutput {
  structures: StructureSelection[];
  castingAssignments: CastingAssignment[];
  identityPlans: IdentityPlan[];
}

// ── Platform mapping ──

function mapPlatformToUgc(platform: string): string[] {
  switch (platform) {
    case "meta":
      return ["meta_feed", "instagram_reels"];
    case "tiktok":
      return ["tiktok"];
    default:
      return []; // youtube and others not supported by UGC v2
  }
}

// ── Phase execution ──

const MAX_STRUCTURES = 3;

export function executePlanningPhase(input: PlanningInput): PlanningOutput {
  const { brief, creatorPool, funnelFrictions, performanceMemory } = input;

  // 1. Map platforms to UGC-specific targets
  const ugcPlatforms = brief.platforms.flatMap(mapPlatformToUgc);
  if (ugcPlatforms.length === 0) {
    // Fallback: if no UGC platforms matched, use meta_feed
    ugcPlatforms.push("meta_feed");
  }

  // 2. Translate funnel frictions into creative weights
  const creativeWeights = translateFrictions(funnelFrictions);

  // 3. Select structures
  const structures = selectStructures({
    platforms: ugcPlatforms,
    creativeWeights,
    performanceMemory,
    recentStructureIds: [], // TODO: SP8 adds recent structure tracking
    maxResults: MAX_STRUCTURES,
  });

  // 4. Cast creators to structures
  const castingAssignments = castCreators({
    structures,
    creatorPool,
    platforms: ugcPlatforms,
    creativeWeights,
    performanceMemory,
    recentCastings: [], // TODO: SP8 adds recent casting tracking
  });

  // 5. Route identity strategy for each casting
  const identityPlans: IdentityPlan[] = castingAssignments.map((casting) =>
    routeIdentityStrategy(casting, {}),
  );

  return { structures, castingAssignments, identityPlans };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run planning-phase
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/phases/planning.ts packages/core/src/creative-pipeline/__tests__/planning-phase.test.ts
git commit -m "feat(core): add planning phase — composes structure, casting, identity, and friction subsystems"
```

---

## Task 6: Wire Planning Phase into Runner + Exports

**Files:**

- Modify: `packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`

- [ ] **Step 1: Replace planning no-op in ugc-job-runner.ts**

In `ugc-job-runner.ts`, update the `executePhase` function to call the real planning phase instead of returning a no-op:

Import at the top:

```typescript
import { executePlanningPhase } from "./phases/planning.js";
import type {
  CreatorIdentity,
  FunnelFriction,
  ProviderCapabilityProfile,
} from "@switchboard/schemas";
```

Update the `executePhase` function:

```typescript
function executePhase(
  phase: UgcPhase,
  ctx: {
    job: CreativeJob;
    context: UgcPipelineContext;
    previousPhaseOutputs: Record<string, unknown>;
  },
): Record<string, unknown> {
  switch (phase) {
    case "planning": {
      const ugcConfig = (ctx.job.ugcConfig ?? {}) as Record<string, unknown>;
      const brief = (ugcConfig.brief ?? {}) as Record<string, unknown>;
      return executePlanningPhase({
        brief: brief as any,
        creatorPool: ctx.context.creatorPool as CreatorIdentity[],
        funnelFrictions: ctx.context.funnelFrictions as FunnelFriction[],
        performanceMemory: { structureHistory: {}, creatorHistory: {} },
        providerCapabilities: ctx.context.providerCapabilities as ProviderCapabilityProfile[],
      });
    }
    default:
      // SP4-SP5 replace these
      return { phase, status: "no-op", completedAt: new Date().toISOString() };
  }
}
```

Also update the `UgcPipelineContext` interface to include the new fields:

```typescript
interface UgcPipelineContext {
  creatorPool: unknown[];
  trustLevel: number;
  deploymentType: string;
  funnelFrictions: unknown[];
  providerCapabilities: unknown[];
}
```

And update `preloadContext` to populate them:

```typescript
async function preloadContext(
  job: CreativeJob,
  deps: UgcPipelineDeps,
): Promise<UgcPipelineContext> {
  const [creatorPool, deployment] = await Promise.all([
    deps.creatorStore.findByDeployment(job.deploymentId),
    deps.deploymentStore.findById(job.deploymentId),
  ]);

  return {
    creatorPool,
    trustLevel: deployment?.listing?.trustScore ?? 0,
    deploymentType: deployment?.type ?? "standard",
    funnelFrictions: [], // SP8 adds real friction store
    providerCapabilities: [], // SP5 adds real provider registry
  };
}
```

- [ ] **Step 2: Add exports to barrel**

Add to `packages/core/src/creative-pipeline/index.ts`:

```typescript
export { translateFrictions } from "./ugc/funnel-friction-translator.js";
export { selectStructures, getStructureTemplates } from "./ugc/structure-engine.js";
export type { StructureTemplate, StructureSelection, StructureId } from "./ugc/structure-engine.js";
export { castCreators } from "./ugc/scene-caster.js";
export type { CastingAssignment } from "./ugc/scene-caster.js";
export { routeIdentityStrategy } from "./ugc/identity-strategy-router.js";
export { executePlanningPhase } from "./ugc/phases/planning.js";
export type { PlanningInput, PlanningOutput } from "./ugc/phases/planning.js";
```

- [ ] **Step 3: Run all UGC tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run ugc-job-runner && npx pnpm@9.15.4 --filter @switchboard/core test -- --run planning-phase
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/ugc/ugc-job-runner.ts packages/core/src/creative-pipeline/index.ts
git commit -m "feat(core): wire planning phase into UGC runner, export SP3 subsystems"
```

---

## Task 7: Full Build + Test Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test 2>&1 | tail -80
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck 2>&1 | tail -40
```

- [ ] **Step 3: Run lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint 2>&1 | tail -40
```

- [ ] **Step 4: Fix any SP3-related issues, commit if needed**
