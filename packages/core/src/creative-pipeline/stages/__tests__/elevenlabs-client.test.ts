import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElevenLabsClient } from "../elevenlabs-client.js";

describe("ElevenLabsClient", () => {
  let client: ElevenLabsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new ElevenLabsClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesizes text to speech and returns audio URL", async () => {
    const audioBlob = new Blob(["fake-audio"], { type: "audio/mpeg" });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(audioBlob),
      headers: new Headers({ "x-audio-duration": "28.5" }),
    });

    const result = await client.synthesize({
      text: "Hello world, this is a test voiceover.",
    });

    expect(result.audioUrl).toBeDefined();
    expect(result.duration).toBe(28.5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses custom voiceId when provided", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["audio"])),
      headers: new Headers({ "x-audio-duration": "10" }),
    });

    await client.synthesize({
      text: "Test",
      voiceId: "custom-voice-123",
    });

    const callUrl = fetchSpy.mock.calls[0][0] as string;
    expect(callUrl).toContain("custom-voice-123");
  });

  it("retries on transient errors", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["audio"])),
        headers: new Headers({ "x-audio-duration": "5" }),
      });

    const result = await client.synthesize({ text: "Test" });
    expect(result.duration).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
