import { describe, it, expect, vi, beforeEach } from "vitest";
import { VideoAssembler } from "../video-assembler.js";

// Mock child_process.execFile
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

describe("VideoAssembler", () => {
  let assembler: VideoAssembler;

  beforeEach(() => {
    assembler = new VideoAssembler();
  });

  it("builds FFmpeg command with clips and voiceover", () => {
    const args = assembler.buildArgs(
      {
        clips: [
          { videoUrl: "/tmp/clip1.mp4", duration: 5 },
          { videoUrl: "/tmp/clip2.mp4", duration: 5 },
        ],
        voiceover: { audioUrl: "/tmp/voice.mp3" },
        outputFormat: { aspectRatio: "9:16", platform: "meta" },
        outputPath: "/tmp/output.mp4",
      },
      "/tmp/workdir",
    );

    expect(args).toContain("-i");
    expect(args.some((a) => a.includes("concat"))).toBe(true);
  });

  it("builds FFmpeg command with captions", () => {
    const args = assembler.buildArgs(
      {
        clips: [{ videoUrl: "/tmp/clip1.mp4", duration: 5 }],
        captions: { srtContent: "1\n00:00:00,000 --> 00:00:05,000\nHello" },
        outputFormat: { aspectRatio: "16:9", platform: "youtube" },
        outputPath: "/tmp/output.mp4",
      },
      "/tmp/workdir",
    );

    expect(args.some((a) => a.includes("subtitles"))).toBe(true);
  });
});
