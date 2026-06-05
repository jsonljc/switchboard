// Real HeyGen avatar video client (slice-3 spec 3.5): submit-and-poll,
// structurally mirroring KlingClient with a DELIBERATELY TIGHTER posture.
// HeyGen ranks FIRST for avatar talking-head specs, so an outage on it would
// stall the whole production step: the poll timeout is 5 minutes (half of
// Kling's) and production grants it ONE attempt before falling back to Kling
// (see provider-router attemptLimit). API version pinned in the base URLs;
// exact field names follow HeyGen's v2 generate + v1 status endpoints.
const HEYGEN_GENERATE_URL = "https://api.heygen.com/v2/video/generate";
const HEYGEN_STATUS_URL = "https://api.heygen.com/v1/video_status.get";

export const HEYGEN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_RETRIES = 3;
const TRANSIENT_STATUS_CODES = [429, 500, 503];

/** Pinned default voice for creators without an explicit HeyGen voice ref.
 *  VoiceSchema.provider is elevenlabs-only today; widening it rides the
 *  deferred ElevenLabs-lipsync upgrade (spec 3.5). */
export const DEFAULT_HEYGEN_VOICE_ID = "1bd001e7e50f421d891986aad5158bc8";

interface HeyGenConfig {
  apiKey: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

interface GenerateAvatarRequest {
  script: string;
  avatarId: string;
  voiceId?: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
}

interface GenerateAvatarResult {
  videoUrl: string;
  duration: number;
}

const DIMENSIONS: Record<GenerateAvatarRequest["aspectRatio"], { width: number; height: number }> =
  {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 1080, height: 1080 },
  };

export class HeyGenClient {
  private apiKey: string;
  private timeoutMs: number;
  private pollIntervalMs: number;
  private retryDelayMs: number;

  constructor(config: HeyGenConfig) {
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? HEYGEN_TIMEOUT_MS;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
  }

  async generateAvatar(request: GenerateAvatarRequest): Promise<GenerateAvatarResult> {
    const body = {
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: request.avatarId, avatar_style: "normal" },
          voice: {
            type: "text",
            input_text: request.script,
            voice_id: request.voiceId ?? DEFAULT_HEYGEN_VOICE_ID,
          },
        },
      ],
      dimension: DIMENSIONS[request.aspectRatio],
    };

    const submitRes = await this.fetchWithRetry(HEYGEN_GENERATE_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const submitData = (await submitRes.json()) as {
      data?: { video_id?: string };
      error?: unknown;
    };
    const videoId = submitData?.data?.video_id;
    if (!videoId) {
      // HeyGen can signal submit validation failures as 200 + error body.
      throw new Error(
        `HeyGen API: no video_id in response${
          submitData?.error ? `: ${JSON.stringify(submitData.error)}` : ""
        }`,
      );
    }

    return this.pollForResult(videoId);
  }

  private async pollForResult(videoId: string): Promise<GenerateAvatarResult> {
    const start = Date.now();
    while (Date.now() - start < this.timeoutMs) {
      await sleep(this.pollIntervalMs);

      const res = await this.fetchWithRetry(
        `${HEYGEN_STATUS_URL}?video_id=${encodeURIComponent(videoId)}`,
        { headers: this.headers() },
      );
      const data = (await res.json()) as {
        data?: { status?: string; video_url?: string; duration?: number; error?: unknown };
      };
      const status = data?.data?.status;

      if (status === "completed") {
        const videoUrl = data.data?.video_url;
        if (!videoUrl) throw new Error("HeyGen API: no video_url in completed result");
        return { videoUrl, duration: Number(data.data?.duration) || 0 };
      }

      if (status === "failed") {
        throw new Error(
          `HeyGen API: generation failed: ${JSON.stringify(data.data?.error ?? "unknown")}`,
        );
      }
      // "processing" / "pending" / "waiting": keep polling
    }
    throw new Error(`HeyGen API: timeout after ${this.timeoutMs}ms`);
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (!TRANSIENT_STATUS_CODES.includes(res.status)) {
        throw new Error(`HeyGen API: ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`HeyGen API: ${res.status} ${res.statusText}`);
      if (attempt < MAX_RETRIES - 1) await sleep(this.retryDelayMs * (attempt + 1));
    }
    throw lastError ?? new Error("HeyGen API: max retries exceeded");
  }

  private headers(): Record<string, string> {
    return {
      "X-Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
