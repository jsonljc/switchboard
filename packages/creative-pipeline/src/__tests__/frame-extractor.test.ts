// Frame extractor for real frame-QA (slice-3 spec 3.1): SSRF-gated download,
// ffmpeg keyframe extraction, base64 JPEG frames + the local video path reused
// by durable upload. Pure arg-building is tested directly; the exec and fetch
// seams are injected so no test shells ffmpeg or hits the network.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FfmpegFrameExtractor, buildFrameArgs, FRAME_COUNT } from "../ugc/frame-extractor.js";
import { SsrfRejectedError, type SafeUrlPolicy } from "../util/safe-url.js";

const allowAllPolicy: SafeUrlPolicy = {
  allowedSchemes: ["https:"],
  allowedHostsRegex: [/.*/],
  rejectPrivateIPs: true,
  maxResponseBytes: 1024 * 1024,
};

const denyAllPolicy: SafeUrlPolicy = {
  ...allowAllPolicy,
  allowedHostsRegex: [/^never-matches\.example$/],
};

describe("buildFrameArgs", () => {
  it("builds deterministic ffmpeg args for evenly spaced frames", () => {
    const args = buildFrameArgs("/tmp/in.mp4", "/work/frame-%02d.jpg", 8, 10);
    expect(args).toEqual([
      "-i",
      "/tmp/in.mp4",
      "-vf",
      "fps=8/10",
      "-frames:v",
      "8",
      "-q:v",
      "3",
      "-y",
      "/work/frame-%02d.jpg",
    ]);
  });

  it("guards non-positive durations with the default clip length", () => {
    const args = buildFrameArgs("/tmp/in.mp4", "/work/frame-%02d.jpg", 8, 0);
    expect(args).toContain("fps=8/10");
  });
});

describe("FfmpegFrameExtractor", () => {
  let workRoot: string;

  // Fake exec: parses the output pattern from the args and writes FRAME_COUNT
  // dummy jpegs there, the way ffmpeg would.
  const fakeExec = vi.fn(async (_cmd: string, args: string[]) => {
    const outPattern = args[args.length - 1]!;
    for (let i = 1; i <= FRAME_COUNT; i++) {
      writeFileSync(outPattern.replace("%02d", String(i).padStart(2, "0")), `jpeg-${i}`);
    }
    return "";
  });

  const fakeFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

  beforeEach(() => {
    vi.clearAllMocks();
    workRoot = mkdtempSync(join(tmpdir(), "frame-extractor-test-"));
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("rejects a URL outside the allowlist with SsrfRejectedError, never fetching", async () => {
    const extractor = new FfmpegFrameExtractor({
      safeUrlPolicy: denyAllPolicy,
      execFileImpl: fakeExec,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    await expect(extractor.extract("https://evil.example/clip.mp4", 10)).rejects.toThrow(
      SsrfRejectedError,
    );
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it("downloads an allowlisted URL then extracts FRAME_COUNT base64 frames", async () => {
    const extractor = new FfmpegFrameExtractor({
      safeUrlPolicy: allowAllPolicy,
      execFileImpl: fakeExec,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const result = await extractor.extract("https://cdn.example.com/clip.mp4", 10);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(result.frames).toHaveLength(FRAME_COUNT);
    expect(result.frames[0]).toBe(Buffer.from("jpeg-1").toString("base64"));
    expect(result.localVideoPath).toMatch(/\.mp4$/);
  });

  it("treats a bare path as local: no fetch, frames extracted from it directly", async () => {
    const localPath = join(workRoot, "local.mp4");
    writeFileSync(localPath, "bytes");
    const extractor = new FfmpegFrameExtractor({
      safeUrlPolicy: denyAllPolicy, // policy must not matter for local paths
      execFileImpl: fakeExec,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const result = await extractor.extract(localPath, 5);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(result.localVideoPath).toBe(localPath);
    expect(result.frames).toHaveLength(FRAME_COUNT);
  });

  it("propagates ffmpeg failures", async () => {
    const failingExec = vi.fn(async () => {
      throw new Error("ffmpeg failed: boom");
    });
    const extractor = new FfmpegFrameExtractor({
      safeUrlPolicy: allowAllPolicy,
      execFileImpl: failingExec,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    await expect(extractor.extract("https://cdn.example.com/clip.mp4", 10)).rejects.toThrow(
      "ffmpeg failed",
    );
  });
});
