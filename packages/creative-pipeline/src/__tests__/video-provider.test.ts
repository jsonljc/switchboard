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

  it("kling adapter threads referenceImageUrl as imageUrl (image2video grounding)", async () => {
    const mockKling = {
      generateVideo: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.example.com/kling.mp4", duration: 10 }),
    };
    const provider = createVideoProvider("kling", { klingClient: mockKling as never });

    await provider.generate({
      prompt: "Hold the product",
      durationSec: 8,
      aspectRatio: "9:16",
      referenceImageUrl: "https://cdn.example.com/product.jpg",
      negativePrompt: "no studio lighting",
      cameraMotion: "pan_right",
    });

    expect(mockKling.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://cdn.example.com/product.jpg",
        negativePrompt: "no studio lighting",
        cameraMotion: "pan_right",
      }),
    );
  });

  it("heygen adapter renders the SPOKEN script via the avatar, ignoring prompt-composition fields", async () => {
    const mockHeyGen = {
      generateAvatar: vi
        .fn()
        .mockResolvedValue({ videoUrl: "https://cdn.heygen.example/a.mp4", duration: 12 }),
    };
    const provider = createVideoProvider("heygen", { heygenClient: mockHeyGen as never });

    const result = await provider.generate({
      prompt: "Scene: golden hour... (composed visual prompt)",
      script: "Hey, quick story about my first visit.",
      durationSec: 12,
      aspectRatio: "9:16",
      negativePrompt: "no studio lighting",
      cameraMotion: "pan_right",
      avatar: { refId: "avatar_42", voiceId: "voice_9" },
    });

    expect(mockHeyGen.generateAvatar).toHaveBeenCalledWith({
      script: "Hey, quick story about my first visit.",
      avatarId: "avatar_42",
      voiceId: "voice_9",
      aspectRatio: "9:16",
    });
    expect(result.provider).toBe("heygen");
    expect(result.videoUrl).toBe("https://cdn.heygen.example/a.mp4");
  });

  it("heygen adapter throws a typed not-configured error without a client", async () => {
    const provider = createVideoProvider("heygen", {});
    await expect(
      provider.generate({
        prompt: "p",
        script: "s",
        durationSec: 5,
        aspectRatio: "9:16",
        avatar: { refId: "a" },
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it("heygen adapter throws when the spec carries no avatar ref (falls back via the retry loop)", async () => {
    const mockHeyGen = { generateAvatar: vi.fn() };
    const provider = createVideoProvider("heygen", { heygenClient: mockHeyGen as never });
    await expect(
      provider.generate({ prompt: "p", script: "s", durationSec: 5, aspectRatio: "9:16" }),
    ).rejects.toThrow(/avatar/i);
    expect(mockHeyGen.generateAvatar).not.toHaveBeenCalled();
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
