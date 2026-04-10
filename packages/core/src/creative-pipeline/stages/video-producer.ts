import type {
  StoryboardOutput,
  ScriptWriterOutput,
  VideoProducerOutput,
} from "@switchboard/schemas";

interface OptimizedPrompt {
  tool: "kling" | "heygen";
  prompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  duration: 5 | 10;
  aspectRatio: "16:9" | "9:16" | "1:1";
  cameraMotion?: string;
}

interface KlingLike {
  generateVideo(req: {
    prompt: string;
    negativePrompt?: string;
    imageUrl?: string;
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    cameraMotion?: string;
  }): Promise<{ videoUrl: string; duration: number }>;
}

interface ElevenLabsLike {
  synthesize(req: { text: string }): Promise<{ audioUrl: string; duration: number }>;
}

interface WhisperLike {
  transcribe(req: { audioUrl: string }): Promise<{
    srtContent: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }>;
}

interface AssemblerLike {
  assemble(req: {
    clips: Array<{ videoUrl: string; duration: number }>;
    voiceover?: { audioUrl: string };
    captions?: { srtContent: string };
    textOverlays?: Array<{ text: string; startSec: number; endSec: number }>;
    outputFormat: { aspectRatio: "16:9" | "9:16" | "1:1"; platform: string };
    outputPath: string;
  }): Promise<{ videoUrl: string; thumbnailUrl: string; duration: number }>;
}

export interface VideoProducerDeps {
  klingClient: KlingLike;
  elevenLabsClient?: ElevenLabsLike;
  whisperClient?: WhisperLike;
  videoAssembler?: AssemblerLike;
  optimizePrompt: (scene: SceneInput, context: PromptContext) => Promise<OptimizedPrompt>;
}

interface SceneInput {
  description: string;
  visualDirection: string;
  duration: number;
  textOverlay: string | null;
  referenceImageUrl: string | null;
}

interface PromptContext {
  productDescription: string;
  platform: string;
}

interface VideoProducerInput {
  storyboard: StoryboardOutput;
  scripts: ScriptWriterOutput;
  tier: "basic" | "pro" | "premium";
  platforms: string[];
  productDescription: string;
}

interface ErrorEntry {
  stage: "generation" | "assembly" | "voiceover" | "captions";
  scene: string | null;
  tool: string;
  message: string;
}

type VideoProducerResult = VideoProducerOutput;

export async function runVideoProducer(
  input: VideoProducerInput,
  deps: VideoProducerDeps,
): Promise<VideoProducerResult> {
  const errors: ErrorEntry[] = [];
  const clips: Array<{
    sceneRef: string;
    videoUrl: string;
    duration: number;
    generatedBy: "kling" | "heygen";
  }> = [];
  const platform = input.platforms[0] ?? "meta";

  // Generate clips for all scenes across all storyboards
  for (const storyboard of input.storyboard.storyboards) {
    for (const scene of storyboard.scenes) {
      const sceneRef = `${storyboard.scriptRef}-scene-${scene.sceneNumber}`;
      try {
        const optimized = await deps.optimizePrompt(scene, {
          productDescription: input.productDescription,
          platform,
        });

        const result = await deps.klingClient.generateVideo({
          prompt: optimized.prompt,
          negativePrompt: optimized.negativePrompt,
          imageUrl: optimized.imageUrl ?? scene.referenceImageUrl ?? undefined,
          duration: optimized.duration,
          aspectRatio: optimized.aspectRatio,
          cameraMotion: optimized.cameraMotion,
        });

        clips.push({
          sceneRef,
          videoUrl: result.videoUrl,
          duration: result.duration,
          generatedBy: "kling",
        });
      } catch (err) {
        errors.push({
          stage: "generation",
          scene: sceneRef,
          tool: "kling",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Basic tier: return clips only
  if (input.tier === "basic") {
    return {
      tier: "basic",
      clips,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  // Pro tier: generate voiceover + captions + assemble
  let voiceover: { audioUrl: string; duration: number; captionsUrl: string } | undefined;

  if (deps.elevenLabsClient) {
    const scriptText = input.scripts.scripts.map((s) => s.fullScript).join("\n\n");
    try {
      const voiceResult = await deps.elevenLabsClient.synthesize({ text: scriptText });

      // Generate captions from voiceover
      let captionsUrl = "";
      if (deps.whisperClient) {
        try {
          const captionResult = await deps.whisperClient.transcribe({
            audioUrl: voiceResult.audioUrl,
          });
          captionsUrl = captionResult.srtContent; // In production, upload SRT to R2
        } catch (err) {
          errors.push({
            stage: "captions",
            scene: null,
            tool: "whisper",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      voiceover = {
        audioUrl: voiceResult.audioUrl,
        duration: voiceResult.duration,
        captionsUrl,
      };
    } catch (err) {
      errors.push({
        stage: "voiceover",
        scene: null,
        tool: "elevenlabs",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Assembly
  const assembledVideos: Array<{
    videoUrl: string;
    thumbnailUrl: string;
    format: string;
    duration: number;
    platform: string;
    hasVoiceover: boolean;
    hasCaptions: boolean;
    hasBackgroundMusic: boolean;
  }> = [];

  if (clips.length > 0 && deps.videoAssembler) {
    // Collect text overlays from storyboard scenes
    const textOverlays: Array<{ text: string; startSec: number; endSec: number }> = [];
    let timeCursor = 0;
    for (const sb of input.storyboard.storyboards) {
      for (const scene of sb.scenes) {
        if (scene.textOverlay) {
          textOverlays.push({
            text: scene.textOverlay,
            startSec: timeCursor,
            endSec: timeCursor + scene.duration,
          });
        }
        timeCursor += scene.duration;
      }
    }

    const aspectRatio = getAspectRatio(platform);
    const assemblyRequest = {
      clips: clips.map((c) => ({ videoUrl: c.videoUrl, duration: c.duration })),
      voiceover: voiceover ? { audioUrl: voiceover.audioUrl } : undefined,
      captions: voiceover?.captionsUrl ? { srtContent: voiceover.captionsUrl } : undefined,
      textOverlays: textOverlays.length > 0 ? textOverlays : undefined,
      outputFormat: { aspectRatio, platform },
      outputPath: `/tmp/switchboard-${Date.now()}-assembled.mp4`,
    };

    // Retry once on failure, then fall back to Basic (raw clips)
    let assembled: { videoUrl: string; thumbnailUrl: string; duration: number } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        assembled = await deps.videoAssembler.assemble(assemblyRequest);
        break;
      } catch (err) {
        if (attempt === 1) {
          errors.push({
            stage: "assembly",
            scene: null,
            tool: "ffmpeg",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (assembled) {
      assembledVideos.push({
        videoUrl: assembled.videoUrl,
        thumbnailUrl: assembled.thumbnailUrl,
        format: aspectRatio,
        duration: assembled.duration,
        platform,
        hasVoiceover: !!voiceover,
        hasCaptions: !!voiceover?.captionsUrl,
        hasBackgroundMusic: false,
      });
    }
  }

  return {
    tier: input.tier,
    clips,
    ...(assembledVideos.length > 0 ? { assembledVideos } : {}),
    ...(voiceover ? { voiceover } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function getAspectRatio(platform: string): "16:9" | "9:16" | "1:1" {
  switch (platform) {
    case "tiktok":
      return "9:16";
    case "youtube":
      return "16:9";
    case "meta":
    default:
      return "9:16";
  }
}
