import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — default ElevenLabs voice
const MAX_RETRIES = 3;
const TRANSIENT_STATUS_CODES = [429, 500, 503];

interface ElevenLabsConfig {
  apiKey: string;
}

interface SynthesizeRequest {
  text: string;
  voiceId?: string;
}

interface SynthesizeResult {
  audioUrl: string;
  duration: number;
}

export class ElevenLabsClient {
  private apiKey: string;

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey;
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult> {
    const voiceId = request.voiceId ?? DEFAULT_VOICE_ID;
    const url = `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`;

    const res = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: request.text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    const audioBlob = await res.blob();
    const duration = parseFloat(res.headers.get("x-audio-duration") ?? "0");

    // Write audio to temp file. In production, upload to R2.
    const workDir = join(tmpdir(), "switchboard-audio");
    mkdirSync(workDir, { recursive: true });
    const audioPath = join(workDir, `voiceover-${randomUUID()}.mp3`);
    const buffer = Buffer.from(await audioBlob.arrayBuffer());
    writeFileSync(audioPath, buffer);

    return { audioUrl: audioPath, duration };
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (!TRANSIENT_STATUS_CODES.includes(res.status)) {
        throw new Error(`ElevenLabs API: ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`ElevenLabs API: ${res.status} ${res.statusText}`);
      if (attempt < MAX_RETRIES - 1) await sleep(1000 * (attempt + 1));
    }
    throw lastError ?? new Error("ElevenLabs API: max retries exceeded");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
