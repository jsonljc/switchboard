// SSRF-gated ffmpeg frame extraction for real frame-QA (slice-3 spec 3.1).
//
// Given a provider video URL (or an already-local path), download the bytes
// through the same SafeUrlPolicy the assembler uses, extract evenly spaced
// JPEG keyframes via ffmpeg, and return them base64-encoded PLUS the local
// video path so later steps (durable upload) reuse the downloaded bytes
// instead of re-fetching. Shelling ffmpeg from L2 follows the VideoAssembler
// precedent; the exec and fetch seams are injectable for hermetic tests.
import { execFile } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import {
  defaultSafeUrlPolicy,
  isSafeUrl,
  readBodyWithLimit,
  SsrfRejectedError,
  type SafeUrlPolicy,
} from "../util/safe-url.js";

/** Frames per clip. Evenly spaced; first/last covered by the fps spacing. */
export const FRAME_COUNT = 8;

const DEFAULT_CLIP_SECONDS = 10;
const FFMPEG_TIMEOUT_MS = 120_000;

export interface ExtractedFrames {
  /** Base64 JPEG frames, chronological. */
  frames: string[];
  /** Local path of the video bytes (downloaded or the input path). */
  localVideoPath: string;
  /** Temp working directory holding frames (and the download, if any). */
  workDir: string;
}

export interface FrameExtractor {
  extract(videoUrlOrPath: string, durationSec: number): Promise<ExtractedFrames>;
}

type ExecFileImpl = (cmd: string, args: string[]) => Promise<string>;

interface FfmpegFrameExtractorOptions {
  safeUrlPolicy?: SafeUrlPolicy;
  execFileImpl?: ExecFileImpl;
  fetchImpl?: typeof fetch;
}

/**
 * Build the ffmpeg args for evenly spaced frame extraction. Pure; exported
 * for direct testing. `fps=N/duration` spaces N frames across the clip;
 * `-frames:v N` caps the output regardless of container duration drift.
 */
export function buildFrameArgs(
  videoPath: string,
  outPattern: string,
  frameCount: number,
  durationSec: number,
): string[] {
  const duration = durationSec > 0 ? durationSec : DEFAULT_CLIP_SECONDS;
  return [
    "-i",
    videoPath,
    "-vf",
    `fps=${frameCount}/${duration}`,
    "-frames:v",
    String(frameCount),
    "-q:v",
    "3",
    "-y",
    outPattern,
  ];
}

function defaultExec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: FFMPEG_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) reject(new Error(`ffmpeg failed: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

export class FfmpegFrameExtractor implements FrameExtractor {
  private readonly safeUrlPolicy: SafeUrlPolicy;
  private readonly exec: ExecFileImpl;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FfmpegFrameExtractorOptions = {}) {
    this.safeUrlPolicy = options.safeUrlPolicy ?? defaultSafeUrlPolicy();
    this.exec = options.execFileImpl ?? defaultExec;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extract(videoUrlOrPath: string, durationSec: number): Promise<ExtractedFrames> {
    const workDir = join(tmpdir(), `switchboard-frames-${randomUUID()}`);
    mkdirSync(workDir, { recursive: true });

    // URL-shaped (has a scheme) goes through the SSRF guard + download; a bare
    // path is treated as already-local bytes. Same split as VideoAssembler.
    let localVideoPath = videoUrlOrPath;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(videoUrlOrPath)) {
      const verdict = isSafeUrl(videoUrlOrPath, this.safeUrlPolicy);
      if (!verdict.ok) {
        throw new SsrfRejectedError(videoUrlOrPath, verdict.reason);
      }
      const res = await this.fetchImpl(verdict.url);
      if (!res.ok) throw new Error(`Failed to download video for frame QA: ${res.status}`);
      const buffer = await readBodyWithLimit(res, this.safeUrlPolicy.maxResponseBytes);
      localVideoPath = join(workDir, "source.mp4");
      writeFileSync(localVideoPath, buffer);
    }

    const outPattern = join(workDir, "frame-%02d.jpg");
    await this.exec("ffmpeg", buildFrameArgs(localVideoPath, outPattern, FRAME_COUNT, durationSec));

    const frames: string[] = [];
    for (let i = 1; i <= FRAME_COUNT; i++) {
      const framePath = join(workDir, `frame-${String(i).padStart(2, "0")}.jpg`);
      try {
        frames.push(readFileSync(framePath).toString("base64"));
      } catch {
        break; // shorter clips can yield fewer frames; take what exists
      }
    }
    if (frames.length === 0) {
      throw new Error("frame extraction produced no frames");
    }

    return { frames, localVideoPath, workDir };
  }
}
