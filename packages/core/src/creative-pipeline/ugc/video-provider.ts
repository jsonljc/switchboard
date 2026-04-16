// packages/core/src/creative-pipeline/ugc/video-provider.ts

// ── Types ──

export interface VideoGenerationRequest {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  referenceImageUrl?: string;
  negativePrompt?: string;
  cameraMotion?: string;
}

export interface VideoGenerationResult {
  videoUrl: string;
  duration: number;
  provider: string;
}

export interface VideoProvider {
  name: string;
  generate(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

// ── Kling adapter ──

interface KlingLike {
  generateVideo(req: {
    prompt: string;
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    imageUrl?: string;
    negativePrompt?: string;
    cameraMotion?: string;
  }): Promise<{ videoUrl: string; duration: number }>;
}

function mapDuration(sec: number): 5 | 10 {
  return sec <= 7 ? 5 : 10;
}

function mapAspect(aspect: string): "16:9" | "9:16" | "1:1" {
  if (aspect === "16:9") return "16:9";
  if (aspect === "1:1") return "1:1";
  return "9:16";
}

function createKlingAdapter(klingClient: KlingLike): VideoProvider {
  return {
    name: "kling",
    async generate(req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      const result = await klingClient.generateVideo({
        prompt: req.prompt,
        duration: mapDuration(req.durationSec),
        aspectRatio: mapAspect(req.aspectRatio),
        imageUrl: req.referenceImageUrl,
        negativePrompt: req.negativePrompt,
        cameraMotion: req.cameraMotion,
      });
      return { videoUrl: result.videoUrl, duration: result.duration, provider: "kling" };
    },
  };
}

// ── Seedance adapter (stub — activates when API is available) ──

function createSeedanceAdapter(): VideoProvider {
  return {
    name: "seedance",
    async generate(_req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      throw new Error("Seedance provider not yet implemented — awaiting API access");
    },
  };
}

// ── Runway adapter (stub — activates when API is available) ──

function createRunwayAdapter(): VideoProvider {
  return {
    name: "runway",
    async generate(_req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      throw new Error("Runway provider not yet implemented — awaiting API access");
    },
  };
}

// ── Factory ──

interface ProviderClients {
  klingClient?: KlingLike;
}

export function createVideoProvider(provider: string, clients: ProviderClients): VideoProvider {
  switch (provider) {
    case "kling": {
      if (!clients.klingClient) {
        throw new Error("Kling client not configured");
      }
      return createKlingAdapter(clients.klingClient);
    }
    case "seedance":
      return createSeedanceAdapter();
    case "runway":
      return createRunwayAdapter();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
