import { describe, it, expect, vi } from "vitest";
import { runVideoProducer } from "../video-producer.js";
import type { VideoProducerDeps } from "../video-producer.js";

function makeMockDeps(): VideoProducerDeps {
  return {
    klingClient: {
      generateVideo: vi.fn().mockResolvedValue({
        videoUrl: "https://kling.example.com/clip.mp4",
        duration: 5,
      }),
    },
    elevenLabsClient: {
      synthesize: vi.fn().mockResolvedValue({
        audioUrl: "https://elevenlabs.example.com/audio.mp3",
        duration: 20,
      }),
    },
    whisperClient: {
      transcribe: vi.fn().mockResolvedValue({
        srtContent: "1\n00:00:00,000 --> 00:00:05,000\nHello\n",
        segments: [{ start: 0, end: 5, text: "Hello" }],
      }),
    },
    videoAssembler: {
      assemble: vi.fn().mockResolvedValue({
        videoUrl: "https://r2.example.com/assembled.mp4",
        thumbnailUrl: "https://r2.example.com/thumb.jpg",
        duration: 15,
      }),
    },
    optimizePrompt: vi.fn().mockResolvedValue({
      tool: "kling" as const,
      prompt: "Optimized prompt for product shot",
      duration: 5 as const,
      aspectRatio: "9:16" as const,
    }),
  };
}

const storyboard = {
  storyboards: [
    {
      scriptRef: "script-0",
      scenes: [
        {
          sceneNumber: 1,
          description: "Product intro",
          visualDirection: "zoom in",
          duration: 5,
          textOverlay: null,
          referenceImageUrl: null,
        },
        {
          sceneNumber: 2,
          description: "Features demo",
          visualDirection: "pan left",
          duration: 5,
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

const scripts = {
  scripts: [
    {
      hookRef: "hook-0",
      fullScript: "Introducing the amazing widget. It does everything you need. Buy now!",
      timing: [],
      format: "feed_video" as const,
      platform: "meta",
      productionNotes: "",
    },
  ],
};

describe("runVideoProducer", () => {
  it("produces basic tier output with clips only", async () => {
    const deps = makeMockDeps();
    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "basic",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("basic");
    expect(result.clips.length).toBe(3);
    expect(result.assembledVideos).toBeUndefined();
    expect(result.voiceover).toBeUndefined();
    expect(deps.klingClient.generateVideo).toHaveBeenCalledTimes(3);
    expect(deps.optimizePrompt).toHaveBeenCalledTimes(3);
  });

  it("produces pro tier output with assembled video + voiceover", async () => {
    const deps = makeMockDeps();
    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("pro");
    expect(result.clips.length).toBe(3);
    expect(result.assembledVideos).toBeDefined();
    expect(result.assembledVideos!.length).toBeGreaterThan(0);
    expect(result.voiceover).toBeDefined();
    expect(deps.elevenLabsClient!.synthesize).toHaveBeenCalled();
    expect(deps.whisperClient!.transcribe).toHaveBeenCalled();
    expect(deps.videoAssembler!.assemble).toHaveBeenCalled();
  });

  it("records errors for failed scenes without crashing", async () => {
    const deps = makeMockDeps();
    deps.klingClient.generateVideo = vi
      .fn()
      .mockRejectedValueOnce(new Error("Kling timeout"))
      .mockResolvedValue({ videoUrl: "https://kling.example.com/ok.mp4", duration: 5 });

    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "basic",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.clips.length).toBe(2); // 1 failed, 2 succeeded
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBe(1);
    expect(result.errors?.[0]?.stage).toBe("generation");
    expect(result.errors?.[0]?.tool).toBe("kling");
  });

  it("falls back to basic output when assembly fails in pro tier", async () => {
    const deps = makeMockDeps();
    deps.videoAssembler!.assemble = vi.fn().mockRejectedValue(new Error("FFmpeg crash"));

    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("pro");
    expect(result.clips.length).toBe(3);
    // Assembly failed — assembledVideos should be absent or empty
    expect(result.assembledVideos ?? []).toHaveLength(0);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.stage === "assembly")).toBe(true);
  });

  it("uploads the assembled video + thumbnail and sets durableAssetUrl (pro tier)", async () => {
    const deps = makeMockDeps();
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ url: "https://cdn.example.com/creative-assets/job_1/u.mp4" })
      .mockResolvedValueOnce({ url: "https://cdn.example.com/creative-assets/job_1/u-thumb.jpg" });
    deps.assetStorage = { upload };

    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: "creative-assets/job_1/assembled.mp4",
        contentType: "video/mp4",
      }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: "creative-assets/job_1/assembled-thumb.jpg",
        contentType: "image/jpeg",
      }),
    );
    expect(result.assembledVideos?.[0]?.videoUrl).toBe(
      "https://cdn.example.com/creative-assets/job_1/u.mp4",
    );
    expect(result.assembledVideos?.[0]?.thumbnailUrl).toBe(
      "https://cdn.example.com/creative-assets/job_1/u-thumb.jpg",
    );
    expect(result.durableAssetUrl).toBe("https://cdn.example.com/creative-assets/job_1/u.mp4");
  });

  it("leaves assembled URLs local and durableAssetUrl undefined when no assetStorage", async () => {
    const deps = makeMockDeps();
    const result = await runVideoProducer(
      {
        jobId: "job_1",
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );
    expect(result.durableAssetUrl).toBeUndefined();
    expect(result.assembledVideos?.[0]?.videoUrl).toBe("https://r2.example.com/assembled.mp4");
  });

  it("propagates storage upload errors (fail loud, no fake success)", async () => {
    const deps = makeMockDeps();
    deps.assetStorage = { upload: vi.fn().mockRejectedValue(new Error("S3 unavailable")) };
    await expect(
      runVideoProducer(
        {
          jobId: "job_1",
          storyboard,
          scripts,
          tier: "pro",
          platforms: ["meta"],
          productDescription: "A widget",
        },
        deps,
      ),
    ).rejects.toThrow("S3 unavailable");
  });
});
