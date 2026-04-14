import { execFile } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

interface ClipInput {
  videoUrl: string;
  duration: number;
}

interface AssembleRequest {
  clips: ClipInput[];
  voiceover?: { audioUrl: string };
  captions?: { srtContent: string };
  textOverlays?: Array<{ text: string; startSec: number; endSec: number }>;
  outputFormat: { aspectRatio: "16:9" | "9:16" | "1:1"; platform: string };
  outputPath: string;
}

interface AssembleResult {
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
}

const ASPECT_SIZES: Record<string, string> = {
  "16:9": "1920:1080",
  "9:16": "1080:1920",
  "1:1": "1080:1080",
};

export class VideoAssembler {
  /**
   * Build FFmpeg arguments for assembly. Exposed for testing.
   * workDir must match where assemble() writes its temp files.
   */
  buildArgs(request: AssembleRequest, workDir: string): string[] {
    const args: string[] = [];

    // Concat filter for clips
    const concatFile = join(workDir, "concat.txt");

    args.push("-f", "concat", "-safe", "0", "-i", concatFile);

    // Voiceover audio input
    if (request.voiceover) {
      args.push("-i", request.voiceover.audioUrl);
    }

    // Build filter complex
    const filters: string[] = [];
    const size = ASPECT_SIZES[request.outputFormat.aspectRatio] ?? "1920:1080";
    filters.push(
      `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2`,
    );

    // Captions (burn-in via subtitles filter)
    if (request.captions) {
      const srtPath = join(workDir, "captions.srt");
      filters.push(`subtitles=${srtPath}:force_style='FontSize=24,PrimaryColour=&HFFFFFF&'`);
    }

    // Text overlays
    if (request.textOverlays?.length) {
      for (const overlay of request.textOverlays) {
        const escaped = overlay.text.replace(/'/g, "'\\''");
        filters.push(
          `drawtext=text='${escaped}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-100:enable='between(t,${overlay.startSec},${overlay.endSec})'`,
        );
      }
    }

    if (filters.length > 0) {
      args.push("-vf", filters.join(","));
    }

    // Audio mixing
    if (request.voiceover) {
      args.push("-map", "0:v", "-map", "1:a", "-shortest");
    }

    args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
    args.push("-c:a", "aac", "-b:a", "128k");
    args.push("-movflags", "+faststart");
    args.push("-y", request.outputPath);

    return args;
  }

  /**
   * Assemble video from clips, voiceover, and captions.
   */
  async assemble(request: AssembleRequest): Promise<AssembleResult> {
    const workDir = join(tmpdir(), `switchboard-ffmpeg-${randomUUID()}`);
    mkdirSync(workDir, { recursive: true });

    // Download remote clips to local files for FFmpeg concat
    const localClips = await this.downloadClips(request.clips, workDir);

    // Write concat file with local paths
    const concatContent = localClips.map((path) => `file '${path}'`).join("\n");
    writeFileSync(join(workDir, "concat.txt"), concatContent);

    // Write captions if provided
    if (request.captions) {
      writeFileSync(join(workDir, "captions.srt"), request.captions.srtContent);
    }

    const args = this.buildArgs({ ...request, outputPath: request.outputPath }, workDir);

    await this.exec("ffmpeg", args);

    const totalDuration = request.clips.reduce((sum, c) => sum + c.duration, 0);

    // Generate thumbnail
    const thumbPath = request.outputPath.replace(/\.mp4$/, "-thumb.jpg");
    await this.exec("ffmpeg", [
      "-i",
      request.outputPath,
      "-ss",
      "1",
      "-vframes",
      "1",
      "-y",
      thumbPath,
    ]);

    return {
      videoUrl: request.outputPath,
      thumbnailUrl: thumbPath,
      duration: totalDuration,
    };
  }

  private async downloadClips(clips: ClipInput[], workDir: string): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]!;
      if (clip.videoUrl.startsWith("http")) {
        const res = await fetch(clip.videoUrl);
        if (!res.ok) throw new Error(`Failed to download clip: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const localPath = join(workDir, `clip-${i}.mp4`);
        writeFileSync(localPath, buffer);
        paths.push(localPath);
      } else {
        paths.push(clip.videoUrl); // Already a local path
      }
    }
    return paths;
  }

  private exec(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 300_000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`FFmpeg failed: ${stderr || error.message}`));
        else resolve(stdout);
      });
    });
  }
}
