import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KlingClient } from "../kling-client.js";

describe("KlingClient", () => {
  let client: KlingClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new KlingClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("submits generation task and polls for completion", async () => {
    // First call: submit task
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // Second call: poll — still processing
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { task_status: "processing", task_result: null },
        }),
    });
    // Third call: poll — complete
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            task_status: "succeed",
            task_result: {
              videos: [
                {
                  url: "https://kling.example.com/video.mp4",
                  duration: "5.0",
                },
              ],
            },
          },
        }),
    });

    const promise = client.generateVideo({
      prompt: "A product shot of a widget",
      duration: 5,
      aspectRatio: "16:9",
    });

    // Advance timers to trigger poll intervals
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.videoUrl).toBe("https://kling.example.com/video.mp4");
    expect(result.duration).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws on timeout", async () => {
    // Submit succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // All polls return processing
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { task_status: "processing", task_result: null },
        }),
    });

    // Create client with very short timeout for testing
    client = new KlingClient({ apiKey: "test-key", timeoutMs: 100, pollIntervalMs: 20 });

    const promise = client.generateVideo({ prompt: "test", duration: 5, aspectRatio: "16:9" });

    // Set up the expectation before advancing timers
    const expectation = expect(promise).rejects.toThrow(/timeout/i);

    // Advance timers past the timeout
    await vi.runAllTimersAsync();

    await expectation;
  });

  it("retries on transient errors", async () => {
    // Submit succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // First poll: 500 error
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
    // Second poll: success
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            task_status: "succeed",
            task_result: {
              videos: [{ url: "https://kling.example.com/v.mp4", duration: "5.0" }],
            },
          },
        }),
    });

    const promise = client.generateVideo({
      prompt: "test",
      duration: 5,
      aspectRatio: "16:9",
    });

    // Advance timers to trigger poll and retry
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.videoUrl).toBe("https://kling.example.com/v.mp4");
  });
});
