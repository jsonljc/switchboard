import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhisperClient } from "../whisper-client.js";

describe("WhisperClient", () => {
  let client: WhisperClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new WhisperClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transcribes audio and returns SRT content", async () => {
    // Mock fetching the audio file
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["fake-audio"])),
    });
    // Mock Whisper API response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: "Hello world",
          segments: [
            { start: 0, end: 2.5, text: "Hello" },
            { start: 2.5, end: 5, text: "world" },
          ],
        }),
    });

    const result = await client.transcribe({
      audioUrl: "https://example.com/audio.mp3",
    });

    expect(result.segments).toHaveLength(2);
    expect(result.srtContent).toContain("Hello");
    expect(result.srtContent).toContain("world");
  });
});
