// buildUgcVideoRequest (slice-3 spec 3.2): compose the SceneStyle/UgcDirection
// that scripting computes (and production discards today) into the provider
// request. Pure and deterministic; unparseable style/direction falls back to
// the raw script text, byte-equal to the legacy prompt.
import { describe, it, expect } from "vitest";
import { buildUgcVideoRequest } from "../ugc/video-prompt.js";

const style = {
  lighting: "golden_hour",
  cameraAngle: "selfie",
  cameraMovement: "handheld",
  environment: "bright clinic interior",
  wardrobeSelection: ["soft neutrals", "clinical white"],
  hairState: "natural",
  props: [],
};

const direction = {
  hookType: "direct_camera",
  eyeContact: "camera",
  energyLevel: "medium",
  pacingNotes: "Match conversational delivery style",
  imperfections: {
    hesitationDensity: 0.15,
    sentenceRestartRate: 0.1,
    microPauseDensity: 0.2,
    fillerDensityTarget: 0.2,
    fragmentationTarget: 0.3,
  },
  adLibPermissions: ["natural reactions"],
  forbiddenFraming: ["no studio lighting", "no centered framing"],
};

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    specId: "s1",
    mode: "ugc" as const,
    creatorId: "cr1",
    structureId: "confession",
    motivator: "general",
    platform: "meta_feed",
    script: { text: "Hey, so I have to tell you about this.", language: "en" },
    style,
    direction,
    format: "talking_head",
    identityConstraints: { strategy: "reference_conditioning", maxIdentityDrift: 0.5 },
    renderTargets: { aspect: "9:16", durationSec: 8 },
    qaThresholds: { faceSimilarityMin: 0.7, realismMin: 0.5 },
    providersAllowed: ["kling"],
    campaignTags: {},
    ...overrides,
  };
}

describe("buildUgcVideoRequest", () => {
  it("composes script, scene style, and direction into the prompt", () => {
    const req = buildUgcVideoRequest(makeSpec());
    expect(req.prompt).toContain("Hey, so I have to tell you about this.");
    expect(req.prompt).toContain("golden hour");
    expect(req.prompt).toContain("selfie");
    expect(req.prompt).toContain("bright clinic interior");
    expect(req.prompt).toContain("soft neutrals");
    expect(req.prompt).toContain("natural"); // hair state
    expect(req.prompt).toContain("medium energy");
    expect(req.prompt).toContain("looking at the camera");
    expect(req.prompt).toContain("Match conversational delivery style");
    // terse authenticity cue from the imperfection profile
    expect(req.prompt).toMatch(/natural pauses|unpolished/i);
    expect(req.durationSec).toBe(8);
    expect(req.aspectRatio).toBe("9:16");
  });

  it("builds the negative prompt from forbiddenFraming plus the standard artifact suffix", () => {
    const req = buildUgcVideoRequest(makeSpec());
    expect(req.negativePrompt).toContain("no studio lighting");
    expect(req.negativePrompt).toContain("no centered framing");
    expect(req.negativePrompt).toContain("blurry, low quality, distorted, watermark");
  });

  it("maps camera movement only where the provider vocabulary supports it", () => {
    // handheld has no kling camera_control equivalent: the prompt TEXT carries it
    const handheld = buildUgcVideoRequest(makeSpec());
    expect(handheld.cameraMotion).toBeUndefined();
    expect(handheld.prompt).toContain("handheld");

    const pan = buildUgcVideoRequest(makeSpec({ style: { ...style, cameraMovement: "slow_pan" } }));
    expect(pan.cameraMotion).toBe("pan_right");

    const still = buildUgcVideoRequest(
      makeSpec({ style: { ...style, cameraMovement: "static_tripod" } }),
    );
    expect(still.cameraMotion).toBeUndefined();
  });

  it("falls back to the raw script text when style/direction are absent or unparseable", () => {
    const bare = buildUgcVideoRequest(makeSpec({ style: undefined, direction: undefined }));
    expect(bare.prompt).toBe("Hey, so I have to tell you about this.");
    expect(bare.negativePrompt).toBeUndefined();
    expect(bare.cameraMotion).toBeUndefined();

    const garbage = buildUgcVideoRequest(
      makeSpec({ style: { lighting: 42 }, direction: { hookType: [] } }),
    );
    expect(garbage.prompt).toBe("Hey, so I have to tell you about this.");
  });

  it("round-trips REAL generateDirection output (guards the interface-vs-schema contract)", async () => {
    // The wire shape comes from ugc-director's hand-maintained TS interface,
    // not the zod schema the builder parses with. If the two ever drift, the
    // builder silently falls back to raw script: this test pins the contract
    // against the REAL producer.
    const { generateDirection } = await import("../ugc/ugc-director.js");
    const { sceneStyle, ugcDirection } = generateDirection({
      creator: {
        personality: { energy: "conversational", deliveryStyle: "natural" },
        appearanceRules: { hairStates: ["natural"], wardrobePalette: ["soft neutrals"] },
        environmentSet: ["bright clinic interior"],
      },
      structure: {
        id: "confession",
        name: "Confession",
        sections: [{ name: "hook", purposeGuide: "Open", durationRange: [2, 4] }],
      },
      platform: "meta_feed",
      ugcFormat: "talking_head",
    });
    const req = buildUgcVideoRequest(makeSpec({ style: sceneStyle, direction: ugcDirection }));
    // The composed branch fired (not the raw-script fallback)
    expect(req.prompt).not.toBe("Hey, so I have to tell you about this.");
    expect(req.prompt).toContain("Scene:");
    expect(req.prompt).toContain("Delivery:");
    expect(req.negativePrompt).toContain("no studio lighting");
  });

  it("composes the parsed half when only style parses (graceful gradation)", () => {
    const req = buildUgcVideoRequest(makeSpec({ direction: { hookType: [] } }));
    expect(req.prompt).toContain("Scene:");
    expect(req.prompt).not.toContain("Delivery:");
    // standard negative only: forbiddenFraming lives on the unparsed half
    expect(req.negativePrompt).toBe("blurry, low quality, distorted, watermark, text artifacts");
  });

  it("composes the parsed half when only direction parses", () => {
    const req = buildUgcVideoRequest(makeSpec({ style: { lighting: 42 } }));
    expect(req.prompt).not.toContain("Scene:");
    expect(req.prompt).toContain("Delivery:");
    expect(req.negativePrompt).toContain("no studio lighting");
    expect(req.cameraMotion).toBeUndefined();
  });

  it("threads referenceImageUrl through only when the spec carries one", () => {
    const withRef = buildUgcVideoRequest(
      makeSpec({ referenceImageUrl: "https://cdn.example.com/product.jpg" }),
    );
    expect(withRef.referenceImageUrl).toBe("https://cdn.example.com/product.jpg");

    const without = buildUgcVideoRequest(makeSpec());
    expect(without.referenceImageUrl).toBeUndefined();
  });
});
