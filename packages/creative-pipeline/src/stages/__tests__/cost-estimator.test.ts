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
    // More scripts means more storyboards (one per script), so a two-script
    // batch carries both storyboards' scenes.
    const twoScripts = {
      storyboards: [...storyboard.storyboards, ...storyboard.storyboards],
    };
    const costOne = estimateCost(storyboard, 1);
    const costTwo = estimateCost(twoScripts, 2);
    expect(costTwo.basic.cost).toBeGreaterThan(costOne.basic.cost);
  });

  it("handles empty storyboard", () => {
    const empty = { storyboards: [] };
    const result = estimateCost(empty, 1);
    expect(result.basic.cost).toBe(0);
    expect(result.pro.cost).toBe(0);
  });

  // The storyboard stage builds ONE storyboard per script (see
  // storyboard-builder: "Create one storyboard per script"), so the
  // storyboards array already spans EVERY script. A two-script brief must cost
  // exactly twice a one-script brief, never four times. The earlier code
  // multiplied the already-all-scripts scene sums by scriptCount a second time,
  // overstating spend by scriptCount and parking jobs that should auto-execute.
  it("costs N scripts as N times a single script, not N-squared", () => {
    // One storyboard = one script: 3 scenes (5s, 10s, 5s).
    const oneScriptScenes = [{ duration: 5 }, { duration: 10 }, { duration: 5 }];
    const oneScript = { storyboards: [{ scenes: oneScriptScenes }] };
    // Two scripts = two storyboards with the same per-script scenes.
    const twoScripts = {
      storyboards: [{ scenes: oneScriptScenes }, { scenes: oneScriptScenes }],
    };

    const costOne = estimateCost(oneScript, 1);
    const costTwo = estimateCost(twoScripts, 2);

    // Linear, not quadratic: 2x, and explicitly NOT 4x.
    expect(costTwo.basic.cost).toBeCloseTo(2 * costOne.basic.cost, 2);
    expect(costTwo.pro.cost).toBeCloseTo(2 * costOne.pro.cost, 2);
    expect(costTwo.basic.cost).not.toBeCloseTo(4 * costOne.basic.cost, 2);

    // Pin the exact per-script basic math: 0.35 (5s) + 0.70 (10s) + 0.35 (5s) = 1.40.
    expect(costOne.basic.cost).toBeCloseTo(1.4, 2);
    expect(costTwo.basic.cost).toBeCloseTo(2.8, 2);
  });
});
