import { describe, it, expect } from "vitest";
import { VideoProducerOutput, CreativeJobSchema } from "../creative-job.js";

describe("VideoProducerOutput", () => {
  it("validates basic tier output with clips only", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "basic",
      clips: [
        {
          sceneRef: "scene-1",
          videoUrl: "https://kling.example.com/video.mp4",
          duration: 5,
          generatedBy: "kling",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates pro tier output with assembled videos and voiceover", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "pro",
      clips: [
        {
          sceneRef: "scene-1",
          videoUrl: "https://kling.example.com/v1.mp4",
          duration: 5,
          generatedBy: "kling",
        },
      ],
      assembledVideos: [
        {
          videoUrl: "https://r2.example.com/assembled.mp4",
          thumbnailUrl: "https://r2.example.com/thumb.jpg",
          format: "9:16",
          duration: 30,
          platform: "meta",
          hasVoiceover: true,
          hasCaptions: true,
          hasBackgroundMusic: false,
        },
      ],
      voiceover: {
        audioUrl: "https://elevenlabs.example.com/audio.mp3",
        duration: 28,
        captionsUrl: "https://r2.example.com/captions.srt",
      },
    });
    expect(result.success).toBe(true);
  });

  it("validates errors with nullable scene", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "pro",
      clips: [],
      errors: [
        {
          stage: "voiceover",
          scene: null,
          tool: "elevenlabs",
          message: "API timeout",
        },
        {
          stage: "generation",
          scene: "scene-1",
          tool: "kling",
          message: "Rate limited",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid tier", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "ultra",
      clips: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("CreativeJobSchema", () => {
  it("accepts productionTier field", () => {
    const base = {
      id: "test-id",
      taskId: "task-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      productDescription: "A widget",
      targetAudience: "Everyone",
      platforms: ["meta"],
      brandVoice: null,
      productImages: [],
      references: [],
      pastPerformance: null,
      generateReferenceImages: false,
      currentStage: "production",
      stageOutputs: {},
      stoppedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // null is valid (before Stage 4 approval)
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: null }).success).toBe(true);
    // "basic" is valid
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: "basic" }).success).toBe(true);
    // "pro" is valid
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: "pro" }).success).toBe(true);
    // missing is valid (optional)
    expect(CreativeJobSchema.safeParse(base).success).toBe(true);
  });
});
