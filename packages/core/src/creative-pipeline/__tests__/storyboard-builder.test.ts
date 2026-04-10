// packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStoryboardBuilder, buildStoryboardPrompt } from "../stages/storyboard-builder.js";
import type { ScriptWriterOutput, StoryboardOutput } from "@switchboard/schemas";
import type { ImageGenerator } from "../stages/image-generator.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockScripts: ScriptWriterOutput = {
  scripts: [
    {
      hookRef: "0",
      fullScript: "Hook text. Problem text. Solution text. Proof text. CTA text.",
      timing: [
        { section: "hook", startSec: 0, endSec: 3, content: "Stop scrolling!" },
        { section: "problem", startSec: 3, endSec: 8, content: "You waste hours scheduling." },
        { section: "solution", startSec: 8, endSec: 18, content: "Our AI handles it all." },
        { section: "proof", startSec: 18, endSec: 25, content: "10k businesses trust us." },
        { section: "cta", startSec: 25, endSec: 30, content: "Try free for 14 days." },
      ],
      format: "feed_video",
      platform: "meta",
      productionNotes: "Use bright colors",
    },
  ],
};

const mockStoryboardOutput: StoryboardOutput = {
  storyboards: [
    {
      scriptRef: "0",
      scenes: [
        {
          sceneNumber: 1,
          description: "Close-up of frustrated business owner",
          visualDirection: "Tight face shot, warm lighting, shallow DOF",
          duration: 3,
          textOverlay: "Sound familiar?",
          referenceImageUrl: null,
        },
        {
          sceneNumber: 2,
          description: "Screen showing the AI scheduling interface",
          visualDirection: "Over-the-shoulder shot, cool blue tones, screen recording",
          duration: 5,
          textOverlay: null,
          referenceImageUrl: null,
        },
        {
          sceneNumber: 3,
          description: "Happy business owner checking phone",
          visualDirection: "Medium shot, natural lighting, candid feel",
          duration: 7,
          textOverlay: "10k+ businesses",
          referenceImageUrl: null,
        },
        {
          sceneNumber: 4,
          description: "Logo and CTA card",
          visualDirection: "Clean white background, brand colors, centered text",
          duration: 5,
          textOverlay: "Try free for 14 days",
          referenceImageUrl: null,
        },
      ],
    },
  ],
};

describe("buildStoryboardPrompt", () => {
  it("includes product description and scripts in user message", () => {
    const { systemPrompt, userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
    );

    expect(systemPrompt).toContain("storyboard");
    expect(systemPrompt).toContain("scene");
    expect(systemPrompt).toContain("visualDirection");
    expect(userMessage).toContain("AI scheduling tool");
    expect(userMessage).toContain("Stop scrolling!");
    expect(userMessage).toContain("hook");
  });

  it("includes product images when provided", () => {
    const { userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        productImages: ["https://example.com/product1.jpg", "https://example.com/product2.jpg"],
      },
      mockScripts,
    );

    expect(userMessage).toContain("https://example.com/product1.jpg");
    expect(userMessage).toContain("https://example.com/product2.jpg");
  });

  it("omits product images section when none provided", () => {
    const { userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
    );

    expect(userMessage).not.toContain("Product Images");
  });
});

describe("runStoryboardBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude and returns storyboard output without images", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
    );

    expect(result.storyboards).toHaveLength(1);
    expect(result.storyboards[0]?.scenes).toHaveLength(4);
    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBeNull();
    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        schema: expect.anything(),
        maxTokens: 8192,
      }),
    );
  });

  it("generates images per scene when imageGenerator is provided", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const mockImageGenerator: ImageGenerator = {
      generate: vi
        .fn()
        .mockResolvedValueOnce("https://dalle.example.com/scene1.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene2.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene3.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene4.png"),
    };

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      mockImageGenerator,
    );

    expect(mockImageGenerator.generate).toHaveBeenCalledTimes(4);
    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene1.png",
    );
    expect(result.storyboards[0]?.scenes[3]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene4.png",
    );
  });

  it("sets referenceImageUrl to null when image gen fails for a scene", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const mockImageGenerator: ImageGenerator = {
      generate: vi
        .fn()
        .mockResolvedValueOnce("https://dalle.example.com/scene1.png")
        .mockRejectedValueOnce(new Error("429 Too Many Requests"))
        .mockResolvedValueOnce("https://dalle.example.com/scene3.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene4.png"),
    };

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      mockImageGenerator,
    );

    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene1.png",
    );
    // Scene 2 failed — URL should be null, not throw
    expect(result.storyboards[0]?.scenes[1]?.referenceImageUrl).toBeNull();
    expect(result.storyboards[0]?.scenes[2]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene3.png",
    );
  });

  it("does not call image generator when none provided", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      // no imageGenerator
    );

    // All scenes should have null referenceImageUrl
    for (const scene of result.storyboards[0]?.scenes ?? []) {
      expect(scene.referenceImageUrl).toBeNull();
    }
  });
});
