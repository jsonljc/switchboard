import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhisperClient } from "../whisper-client.js";
import { DEFAULT_MAX_RESPONSE_BYTES, type SafeUrlPolicy } from "../../util/safe-url.js";

const PERMISSIVE_POLICY: SafeUrlPolicy = {
  allowedSchemes: ["https:"],
  allowedHostsRegex: [/example\.com$/i],
  rejectPrivateIPs: true,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
};

describe("WhisperClient", () => {
  let client: WhisperClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new WhisperClient({ apiKey: "test-key", safeUrlPolicy: PERMISSIVE_POLICY });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transcribes audio and returns SRT content", async () => {
    // Mock fetching the audio file — return a real Response so the
    // streaming size-guard can read its body.
    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
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
