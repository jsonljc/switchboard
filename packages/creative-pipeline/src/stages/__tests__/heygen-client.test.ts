// Real HeyGen submit-and-poll client (slice-3 spec 3.5). Structurally mirrors
// KlingClient with a DELIBERATELY TIGHTER posture: 5-minute poll timeout
// (vs Kling's 10), because HeyGen ranks FIRST for avatar talking-head specs
// and a slow outage would otherwise stall the whole production step.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeyGenClient, HEYGEN_TIMEOUT_MS, DEFAULT_HEYGEN_VOICE_ID } from "../heygen-client.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HeyGenClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits avatar + voice + dimension, polls to completion, returns the video", async () => {
    const fetchMock = vi
      .fn()
      // submit
      .mockResolvedValueOnce(jsonResponse({ data: { video_id: "vid_1" } }))
      // poll: processing then completed
      .mockResolvedValueOnce(jsonResponse({ data: { status: "processing" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            status: "completed",
            video_url: "https://cdn.heygen.example/v.mp4",
            duration: 14,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HeyGenClient({ apiKey: "hg-key", pollIntervalMs: 1 });
    const result = await client.generateAvatar({
      script: "Hey, quick story.",
      avatarId: "avatar_42",
      aspectRatio: "9:16",
    });

    expect(result).toEqual({ videoUrl: "https://cdn.heygen.example/v.mp4", duration: 14 });

    const [submitUrl, submitInit] = fetchMock.mock.calls[0]!;
    expect(String(submitUrl)).toContain("/v2/video/generate");
    const body = JSON.parse((submitInit as RequestInit).body as string);
    expect(body.video_inputs[0].character).toMatchObject({
      type: "avatar",
      avatar_id: "avatar_42",
    });
    expect(body.video_inputs[0].voice).toMatchObject({
      type: "text",
      input_text: "Hey, quick story.",
      voice_id: DEFAULT_HEYGEN_VOICE_ID,
    });
    // 9:16 portrait dimension
    expect(body.dimension.height).toBeGreaterThan(body.dimension.width);

    const [pollUrl] = fetchMock.mock.calls[1]!;
    expect(String(pollUrl)).toContain("video_status.get");
    expect(String(pollUrl)).toContain("vid_1");
  });

  it("uses the creator's voice id when given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { video_id: "vid_2" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { status: "completed", video_url: "https://x/v.mp4", duration: 8 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HeyGenClient({ apiKey: "hg-key", pollIntervalMs: 1 });
    await client.generateAvatar({
      script: "s",
      avatarId: "a",
      voiceId: "voice_custom",
      aspectRatio: "16:9",
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.video_inputs[0].voice.voice_id).toBe("voice_custom");
  });

  it("throws on a failed generation status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { video_id: "vid_3" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "failed", error: "render error" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HeyGenClient({ apiKey: "hg-key", pollIntervalMs: 1 });
    await expect(
      client.generateAvatar({ script: "s", avatarId: "a", aspectRatio: "9:16" }),
    ).rejects.toThrow(/failed/i);
  });

  it("retries transient submit errors then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { video_id: "vid_4" } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { status: "completed", video_url: "https://x/v.mp4", duration: 5 } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HeyGenClient({ apiKey: "hg-key", pollIntervalMs: 1, retryDelayMs: 1 });
    const result = await client.generateAvatar({ script: "s", avatarId: "a", aspectRatio: "9:16" });
    expect(result.videoUrl).toBe("https://x/v.mp4");
  });

  it("throws a non-retryable error on a clean 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 401));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HeyGenClient({ apiKey: "bad", pollIntervalMs: 1 });
    await expect(
      client.generateAvatar({ script: "s", avatarId: "a", aspectRatio: "9:16" }),
    ).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pins the tighter 5-minute poll timeout (half of kling's posture)", () => {
    expect(HEYGEN_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});
