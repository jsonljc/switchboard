import { describe, it, expect } from "vitest";
import {
  VideoProducerOutput,
  CreativeJobSchema,
  CREATIVE_META_PUBLISH_STATUS,
} from "../creative-job.js";

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

describe("CreativeJobSchema meta-publish fields", () => {
  const BASE = {
    id: "job_1",
    taskId: "task_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    productDescription: "Botox lunchtime refresh",
    targetAudience: "women 30-50",
    platforms: ["instagram"],
    brandVoice: null,
    productImages: [],
    references: [],
    pastPerformance: null,
    generateReferenceImages: false,
    currentStage: "complete",
    stageOutputs: {},
    stoppedAt: null,
    mode: "polished",
    createdAt: new Date("2026-06-01"),
    updatedAt: new Date("2026-06-01"),
  };

  it("defaults the new meta-publish fields to undefined when omitted", () => {
    const job = CreativeJobSchema.parse(BASE);
    expect(job.metaAdId).toBeUndefined();
    expect(job.metaPublishStatus).toBeUndefined();
    expect(job.durableAssetUrl).toBeUndefined();
  });

  it("accepts populated meta-publish fields", () => {
    const job = CreativeJobSchema.parse({
      ...BASE,
      metaVideoId: "vid_1",
      metaCampaignId: "camp_1",
      metaAdSetId: "set_1",
      metaCreativeId: "cr_1",
      metaAdId: "ad_1",
      metaPublishStatus: "parked_paused",
      durableAssetUrl: "https://cdn.example.com/a.mp4",
    });
    expect(job.metaAdId).toBe("ad_1");
    expect(job.metaPublishStatus).toBe("parked_paused");
    expect(job.durableAssetUrl).toBe("https://cdn.example.com/a.mp4");
  });

  // Cross-layer contract: the api publish producer and the core read model both
  // compare metaPublishStatus against these literals; pin them so a rename can
  // never silently desync the producer from the reader.
  it("locks the meta-publish-status literals", () => {
    expect(CREATIVE_META_PUBLISH_STATUS.parkedPaused).toBe("parked_paused");
    expect(CREATIVE_META_PUBLISH_STATUS.publishFailed).toBe("publish_failed");
  });
});

describe("VideoProducerOutput.durableAssetUrl", () => {
  it("accepts an optional durableAssetUrl", () => {
    const parsed = VideoProducerOutput.parse({
      tier: "pro",
      clips: [],
      durableAssetUrl: "https://cdn.example.com/creative-assets/job_1/u.mp4",
    });
    expect(parsed.durableAssetUrl).toBe("https://cdn.example.com/creative-assets/job_1/u.mp4");
  });

  it("treats durableAssetUrl as optional", () => {
    const parsed = VideoProducerOutput.parse({ tier: "basic", clips: [] });
    expect(parsed.durableAssetUrl).toBeUndefined();
  });
});
