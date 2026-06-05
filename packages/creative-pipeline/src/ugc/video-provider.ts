// packages/core/src/creative-pipeline/ugc/video-provider.ts

// ── Types ──

export interface VideoGenerationRequest {
  prompt: string;
  /**
   * The SPOKEN script (slice-3 spec 3.5): what an avatar provider reads
   * aloud. Distinct from `prompt`, the composed VISUAL generation text
   * (scene/delivery sentences would be nonsense read aloud).
   */
  script?: string;
  durationSec: number;
  aspectRatio: string;
  referenceImageUrl?: string;
  negativePrompt?: string;
  cameraMotion?: string;
  /** Avatar identity for providers that require one (heygen). */
  avatar?: { refId: string; voiceId?: string };
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

// ── HeyGen adapter (slice-3 spec 3.5) ──

interface HeyGenLike {
  generateAvatar(req: {
    script: string;
    avatarId: string;
    voiceId?: string;
    aspectRatio: "16:9" | "9:16" | "1:1";
  }): Promise<{ videoUrl: string; duration: number }>;
}

/**
 * Avatar rendering consumes the SPOKEN script + avatar identity and IGNORES
 * the prompt-composition fields (negativePrompt / cameraMotion /
 * referenceImageUrl mean nothing to an avatar renderer). A missing client or
 * missing avatar ref throws a typed error the production retry loop catches,
 * falling back to the next allowed provider (kling).
 */
function createHeyGenAdapter(heygenClient?: HeyGenLike): VideoProvider {
  return {
    name: "heygen",
    async generate(req: VideoGenerationRequest): Promise<VideoGenerationResult> {
      if (!heygenClient) {
        throw new Error("HeyGen client not configured");
      }
      if (!req.avatar?.refId) {
        throw new Error("HeyGen requires an avatar ref on the spec's creator");
      }
      const result = await heygenClient.generateAvatar({
        script: req.script ?? req.prompt,
        avatarId: req.avatar.refId,
        voiceId: req.avatar.voiceId,
        aspectRatio: mapAspect(req.aspectRatio),
      });
      return { videoUrl: result.videoUrl, duration: result.duration, provider: "heygen" };
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

export interface ProviderClients {
  klingClient?: KlingLike;
  heygenClient?: HeyGenLike;
}

export function createVideoProvider(provider: string, clients: ProviderClients): VideoProvider {
  switch (provider) {
    case "kling": {
      if (!clients.klingClient) {
        throw new Error("Kling client not configured");
      }
      return createKlingAdapter(clients.klingClient);
    }
    case "heygen":
      return createHeyGenAdapter(clients.heygenClient);
    case "seedance":
      return createSeedanceAdapter();
    case "runway":
      return createRunwayAdapter();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
