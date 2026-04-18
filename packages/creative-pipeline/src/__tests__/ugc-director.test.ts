import { describe, it, expect } from "vitest";
import { generateDirection } from "../ugc/ugc-director.js";

const baseCreator = {
  personality: { energy: "conversational" as const, deliveryStyle: "friendly" },
  appearanceRules: {
    hairStates: ["down", "ponytail"],
    wardrobePalette: ["earth_tones", "denim"],
  },
  environmentSet: ["kitchen", "living_room", "outdoor_patio"],
};

const baseStructure = {
  id: "confession",
  name: "Confession / Authentic Story",
  sections: [
    {
      name: "hook",
      purposeGuide: "Vulnerable admission",
      durationRange: [3, 5] as [number, number],
    },
    {
      name: "story",
      purposeGuide: "Personal narrative",
      durationRange: [8, 15] as [number, number],
    },
  ],
};

describe("generateDirection", () => {
  it("returns sceneStyle and ugcDirection", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "instagram_reels",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle).toBeDefined();
    expect(result.ugcDirection).toBeDefined();
  });

  it("selects environment from creator's environmentSet", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(baseCreator.environmentSet).toContain(result.sceneStyle.environment);
  });

  it("selects wardrobe from creator's wardrobePalette", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle.wardrobeSelection.length).toBeGreaterThan(0);
    for (const item of result.sceneStyle.wardrobeSelection) {
      expect(baseCreator.appearanceRules.wardrobePalette).toContain(item);
    }
  });

  it("selects hairState from creator's hairStates", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(baseCreator.appearanceRules.hairStates).toContain(result.sceneStyle.hairState);
  });

  it("uses natural lighting for UGC", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(["natural", "ambient", "golden_hour", "overcast"]).toContain(result.sceneStyle.lighting);
  });

  it("maps energy level from creator personality", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.ugcDirection.energyLevel).toBe("medium"); // "conversational" maps to medium
  });

  it("uses selfie camera for talking_head format", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "instagram_reels",
      ugcFormat: "talking_head",
    });
    expect(result.sceneStyle.cameraAngle).toBe("selfie");
  });

  it("uses handheld camera movement for UGC", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "lifestyle",
    });
    expect(["handheld", "slow_pan"]).toContain(result.sceneStyle.cameraMovement);
  });

  it("sets forbidden framing for UGC authenticity", () => {
    const result = generateDirection({
      creator: baseCreator,
      structure: baseStructure,
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    expect(result.ugcDirection.forbiddenFraming.length).toBeGreaterThan(0);
  });
});
