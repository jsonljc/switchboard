import { describe, it, expect, vi } from "vitest";
import { createVideoProvider, type VideoGenerationRequest } from "../ugc/video-provider.js";

describe("createVideoProvider", () => {
  it("creates a kling provider adapter", () => {
    const mockKling = {
      generateVideo: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.example.com/kling.mp4", duration: 10 }),
    };
    const provider = createVideoProvider("kling", { klingClient: mockKling as never });
    expect(provider).toBeDefined();
    expect(provider.name).toBe("kling");
  });

  it("kling adapter calls klingClient.generateVideo", async () => {
    const mockKling = {
      generateVideo: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.example.com/kling.mp4", duration: 10 }),
    };
    const provider = createVideoProvider("kling", { klingClient: mockKling as never });

    const req: VideoGenerationRequest = {
      prompt: "Test prompt",
      durationSec: 15,
      aspectRatio: "9:16",
      referenceImageUrl: undefined,
    };
    const result = await provider.generate(req);

    expect(mockKling.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Test prompt", aspectRatio: "9:16" }),
    );
    expect(result.videoUrl).toBe("https://cdn.example.com/kling.mp4");
  });

  it("creates a seedance provider adapter (stub)", () => {
    const provider = createVideoProvider("seedance", {});
    expect(provider).toBeDefined();
    expect(provider.name).toBe("seedance");
  });

  it("seedance adapter throws not-implemented", async () => {
    const provider = createVideoProvider("seedance", {});
    await expect(
      provider.generate({
        prompt: "test",
        durationSec: 10,
        aspectRatio: "9:16",
      }),
    ).rejects.toThrow("not yet implemented");
  });

  it("creates a runway provider adapter (stub)", () => {
    const provider = createVideoProvider("runway", {});
    expect(provider).toBeDefined();
    expect(provider.name).toBe("runway");
  });

  it("runway adapter throws not-implemented", async () => {
    const provider = createVideoProvider("runway", {});
    await expect(
      provider.generate({
        prompt: "test",
        durationSec: 10,
        aspectRatio: "9:16",
      }),
    ).rejects.toThrow("not yet implemented");
  });

  it("throws for unknown provider", () => {
    expect(() => createVideoProvider("unknown", {})).toThrow("Unknown provider: unknown");
  });
});
