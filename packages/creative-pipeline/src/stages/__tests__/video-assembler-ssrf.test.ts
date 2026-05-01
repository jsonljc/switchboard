import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VideoAssembler } from "../video-assembler.js";
import { DEFAULT_MAX_RESPONSE_BYTES, type SafeUrlPolicy } from "../../util/safe-url.js";

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, "", "");
    },
  ),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const POLICY: SafeUrlPolicy = {
  allowedSchemes: ["https:"],
  allowedHostsRegex: [/\.amazonaws\.com$/i, /\.cloudfront\.net$/i],
  rejectPrivateIPs: true,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
};

describe("VideoAssembler SSRF guard", () => {
  let assembler: VideoAssembler;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assembler = new VideoAssembler({ safeUrlPolicy: POLICY });
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects URLs targeting the AWS instance metadata service (169.254.169.254)", async () => {
    await expect(
      assembler.assemble({
        clips: [{ videoUrl: "https://169.254.169.254/latest/meta-data/", duration: 5 }],
        outputFormat: { aspectRatio: "16:9", platform: "youtube" },
        outputPath: "/tmp/output.mp4",
      }),
    ).rejects.toMatchObject({
      name: "SsrfRejectedError",
      reason: expect.stringMatching(/private-ipv4/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS URLs", async () => {
    await expect(
      assembler.assemble({
        clips: [{ videoUrl: "http://my-bucket.s3.amazonaws.com/clip.mp4", duration: 5 }],
        outputFormat: { aspectRatio: "16:9", platform: "youtube" },
        outputPath: "/tmp/output.mp4",
      }),
    ).rejects.toMatchObject({
      name: "SsrfRejectedError",
      reason: expect.stringMatching(/scheme-not-allowed/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted hosts", async () => {
    await expect(
      assembler.assemble({
        clips: [{ videoUrl: "https://evil.example.com/clip.mp4", duration: 5 }],
        outputFormat: { aspectRatio: "16:9", platform: "youtube" },
        outputPath: "/tmp/output.mp4",
      }),
    ).rejects.toMatchObject({
      name: "SsrfRejectedError",
      reason: expect.stringMatching(/host-not-allowlisted/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts allowlisted S3 URLs and downloads the clip", async () => {
    const payload = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // small dummy bytes
    fetchSpy.mockResolvedValue(
      new Response(payload, { status: 200, headers: { "Content-Type": "video/mp4" } }),
    );

    await assembler.assemble({
      clips: [
        {
          videoUrl: "https://my-bucket.s3.us-east-1.amazonaws.com/clip.mp4",
          duration: 5,
        },
      ],
      outputFormat: { aspectRatio: "16:9", platform: "youtube" },
      outputPath: "/tmp/output.mp4",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledWith = fetchSpy.mock.calls[0]![0];
    const calledHref = calledWith instanceof URL ? calledWith.href : String(calledWith);
    expect(calledHref).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/clip.mp4");
  });

  it("passes through bare local paths without invoking fetch", async () => {
    await assembler.assemble({
      clips: [{ videoUrl: "/tmp/local-clip.mp4", duration: 5 }],
      outputFormat: { aspectRatio: "16:9", platform: "youtube" },
      outputPath: "/tmp/output.mp4",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
