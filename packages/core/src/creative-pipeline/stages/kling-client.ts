const KLING_API_BASE = "https://api.klingai.com/v1";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_RETRIES = 3;
const TRANSIENT_STATUS_CODES = [429, 500, 503];

interface KlingConfig {
  apiKey: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface GenerateVideoRequest {
  prompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  duration: 5 | 10;
  aspectRatio: "16:9" | "9:16" | "1:1";
  cameraMotion?: string;
}

interface GenerateVideoResult {
  videoUrl: string;
  duration: number;
}

export class KlingClient {
  private apiKey: string;
  private timeoutMs: number;
  private pollIntervalMs: number;

  constructor(config: KlingConfig) {
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async generateVideo(request: GenerateVideoRequest): Promise<GenerateVideoResult> {
    const endpoint = request.imageUrl
      ? `${KLING_API_BASE}/videos/image2video`
      : `${KLING_API_BASE}/videos/text2video`;

    const body: Record<string, unknown> = {
      prompt: request.prompt,
      duration: String(request.duration),
      aspect_ratio: request.aspectRatio,
    };
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.imageUrl) body.image = request.imageUrl;
    if (request.cameraMotion) {
      body.camera_control = { type: "simple", config: { movement: request.cameraMotion } };
    }

    // Submit task
    const submitRes = await this.fetchWithRetry(endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const submitData = await submitRes.json();
    const taskId = submitData?.data?.task_id;
    if (!taskId) throw new Error("Kling API: no task_id in response");

    // Poll for completion
    return this.pollForResult(taskId);
  }

  private async pollForResult(taskId: string): Promise<GenerateVideoResult> {
    const start = Date.now();
    while (Date.now() - start < this.timeoutMs) {
      await sleep(this.pollIntervalMs);

      const res = await this.fetchWithRetry(`${KLING_API_BASE}/videos/text2video/${taskId}`, {
        headers: this.headers(),
      });
      const data = await res.json();
      const status = data?.data?.task_status;

      if (status === "succeed") {
        const video = data.data.task_result?.videos?.[0];
        if (!video?.url) throw new Error("Kling API: no video URL in result");
        return {
          videoUrl: video.url,
          duration: parseFloat(video.duration) || 5,
        };
      }

      if (status === "failed") {
        throw new Error(`Kling API: generation failed — ${data.data.task_status_msg ?? "unknown"}`);
      }
      // Otherwise "processing" / "submitted" — continue polling
    }
    throw new Error(`Kling API: timeout after ${this.timeoutMs}ms`);
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (!TRANSIENT_STATUS_CODES.includes(res.status)) {
        throw new Error(`Kling API: ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`Kling API: ${res.status} ${res.statusText}`);
      if (attempt < MAX_RETRIES - 1) await sleep(1000 * (attempt + 1));
    }
    throw lastError ?? new Error("Kling API: max retries exceeded");
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
