// packages/core/src/creative-pipeline/stages/__tests__/cost-estimator.test.ts
import { describe, it, expect } from "vitest";
import { estimateCost } from "../cost-estimator.js";

describe("estimateCost", () => {
  const storyboard = {
    storyboards: [
      {
        scriptRef: "script-1",
        scenes: [
          {
            sceneNumber: 1,
            description: "Product intro",
            visualDirection: "zoom",
            duration: 5,
            textOverlay: null,
            referenceImageUrl: null,
          },
          {
            sceneNumber: 2,
            description: "Features",
            visualDirection: "pan",
            duration: 10,
            textOverlay: "30% off",
            referenceImageUrl: null,
          },
          {
            sceneNumber: 3,
            description: "CTA",
            visualDirection: "static",
            duration: 5,
            textOverlay: "Buy now",
            referenceImageUrl: null,
          },
        ],
      },
    ],
  };

  it("estimates basic tier cost from scene count and duration", () => {
    const result = estimateCost(storyboard, 1);
    expect(result.basic).toBeDefined();
    expect(result.basic.cost).toBeGreaterThan(0);
    expect(result.basic.description).toBeDefined();
  });

  it("estimates pro tier cost higher than basic", () => {
    const result = estimateCost(storyboard, 1);
    expect(result.pro.cost).toBeGreaterThan(result.basic.cost);
  });

  it("scales cost with number of scripts", () => {
    const costOne = estimateCost(storyboard, 1);
    const costTwo = estimateCost(storyboard, 2);
    expect(costTwo.basic.cost).toBeGreaterThan(costOne.basic.cost);
  });

  it("handles empty storyboard", () => {
    const empty = { storyboards: [] };
    const result = estimateCost(empty, 1);
    expect(result.basic.cost).toBe(0);
    expect(result.pro.cost).toBe(0);
  });
});
