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
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
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
