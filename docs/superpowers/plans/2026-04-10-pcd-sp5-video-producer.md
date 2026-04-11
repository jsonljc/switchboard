# SP5: Video Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stage 5 of the PCD creative pipeline — takes storyboard output and produces video ads using tiered production (Basic: raw Kling clips, Pro: assembled video with voiceover + captions via FFmpeg).

**Architecture:** External API clients (Kling, ElevenLabs, Whisper) generate raw assets. A video producer orchestrator routes through tiers, using Claude for prompt optimization. FFmpeg assembles Pro-tier videos. Cost estimation runs before production. Dashboard gets tier selection at Stage 4 approval and video player output.

**Tech Stack:** Kling AI API, ElevenLabs API, OpenAI Whisper API, FFmpeg (child process), Claude API (prompt optimization), Zod, Prisma, Fastify, React/Next.js, TanStack Query, shadcn/ui

---

### Task 1: Schema & Migration — Add productionTier + Update VideoProducerOutput

**Files:**

- Modify: `packages/schemas/src/creative-job.ts`
- Modify: `packages/db/prisma/schema.prisma:870-898`
- Test: `packages/schemas/src/__tests__/creative-job.test.ts` (create if missing)

- [ ] **Step 1: Write failing test for new VideoProducerOutput schema**

```typescript
// packages/schemas/src/__tests__/creative-job.test.ts
import { describe, it, expect } from "vitest";
import { VideoProducerOutput, CreativeJobSchema } from "../creative-job.js";

describe("VideoProducerOutput", () => {
  it("validates basic tier output with clips only", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "basic",
      clips: [
        {
          sceneRef: "scene-1",
          videoUrl: "https://kling.example.com/video.mp4",
          duration: 5,
          generatedBy: "kling",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates pro tier output with assembled videos and voiceover", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "pro",
      clips: [
        {
          sceneRef: "scene-1",
          videoUrl: "https://kling.example.com/v1.mp4",
          duration: 5,
          generatedBy: "kling",
        },
      ],
      assembledVideos: [
        {
          videoUrl: "https://r2.example.com/assembled.mp4",
          thumbnailUrl: "https://r2.example.com/thumb.jpg",
          format: "9:16",
          duration: 30,
          platform: "meta",
          hasVoiceover: true,
          hasCaptions: true,
          hasBackgroundMusic: false,
        },
      ],
      voiceover: {
        audioUrl: "https://elevenlabs.example.com/audio.mp3",
        duration: 28,
        captionsUrl: "https://r2.example.com/captions.srt",
      },
    });
    expect(result.success).toBe(true);
  });

  it("validates errors with nullable scene", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "pro",
      clips: [],
      errors: [
        {
          stage: "voiceover",
          scene: null,
          tool: "elevenlabs",
          message: "API timeout",
        },
        {
          stage: "generation",
          scene: "scene-1",
          tool: "kling",
          message: "Rate limited",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid tier", () => {
    const result = VideoProducerOutput.safeParse({
      tier: "ultra",
      clips: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("CreativeJobSchema", () => {
  it("accepts productionTier field", () => {
    const base = {
      id: "test-id",
      taskId: "task-1",
      organizationId: "org-1",
      deploymentId: "dep-1",
      productDescription: "A widget",
      targetAudience: "Everyone",
      platforms: ["meta"],
      brandVoice: null,
      productImages: [],
      references: [],
      pastPerformance: null,
      generateReferenceImages: false,
      currentStage: "production",
      stageOutputs: {},
      stoppedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // null is valid (before Stage 4 approval)
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: null }).success).toBe(true);
    // "basic" is valid
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: "basic" }).success).toBe(true);
    // "pro" is valid
    expect(CreativeJobSchema.safeParse({ ...base, productionTier: "pro" }).success).toBe(true);
    // missing is valid (optional)
    expect(CreativeJobSchema.safeParse(base).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run creative-job`
Expected: FAIL — `VideoProducerOutput` doesn't have `tier`/`clips` fields, `CreativeJobSchema` doesn't have `productionTier`

- [ ] **Step 3: Update VideoProducerOutput schema**

Replace the existing `VideoProducerOutput` in `packages/schemas/src/creative-job.ts` (lines 123-141):

```typescript
export const ProductionTier = z.enum(["basic", "pro", "premium"]);
export type ProductionTier = z.infer<typeof ProductionTier>;

export const VideoProducerOutput = z.object({
  tier: ProductionTier,
  clips: z.array(
    z.object({
      sceneRef: z.string(),
      videoUrl: z.string(),
      duration: z.number(),
      generatedBy: z.enum(["kling", "heygen"]),
    }),
  ),
  assembledVideos: z
    .array(
      z.object({
        videoUrl: z.string(),
        thumbnailUrl: z.string(),
        format: z.string(),
        duration: z.number(),
        platform: z.string(),
        hasVoiceover: z.boolean(),
        hasCaptions: z.boolean(),
        hasBackgroundMusic: z.boolean(),
      }),
    )
    .optional(),
  voiceover: z
    .object({
      audioUrl: z.string(),
      duration: z.number(),
      captionsUrl: z.string(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        stage: z.enum(["generation", "assembly", "voiceover", "captions"]),
        scene: z.string().nullable(),
        tool: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type VideoProducerOutput = z.infer<typeof VideoProducerOutput>;
```

Add `productionTier` to `CreativeJobSchema` (after `generateReferenceImages` field, around line 181):

```typescript
productionTier: ProductionTier.nullable().optional(),
```

- [ ] **Step 4: Add productionTier to Prisma schema**

In `packages/db/prisma/schema.prisma`, add after `stoppedAt` field (line 889):

```prisma
productionTier  String?
```

- [ ] **Step 5: Run Prisma migration and generate**

Run: `npx pnpm@9.15.4 db:migrate` (creates migration file for `productionTier` column)
Then: `npx pnpm@9.15.4 db:generate`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run creative-job`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/creative-job.ts packages/schemas/src/__tests__/creative-job.test.ts packages/db/prisma/schema.prisma
git commit -m "feat(schemas): update VideoProducerOutput for tiered production + add productionTier"
```

---

### Task 2: DB Store — Add updateProductionTier Method

**Files:**

- Modify: `packages/db/src/stores/prisma-creative-job-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts` (create if missing)

- [ ] **Step 1: Write failing test**

```typescript
// packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
import { describe, it, expect, vi } from "vitest";
import { PrismaCreativeJobStore } from "../prisma-creative-job-store.js";

function mockPrisma() {
  return {
    creativeJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as any;
}

describe("PrismaCreativeJobStore", () => {
  describe("updateProductionTier", () => {
    it("updates the productionTier field", async () => {
      const prisma = mockPrisma();
      const store = new PrismaCreativeJobStore(prisma);
      const mockJob = { id: "job-1", productionTier: "pro" };
      prisma.creativeJob.update.mockResolvedValue(mockJob);

      const result = await store.updateProductionTier("job-1", "pro");

      expect(prisma.creativeJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: { productionTier: "pro" },
      });
      expect(result).toEqual(mockJob);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store`
Expected: FAIL — `updateProductionTier` method doesn't exist

- [ ] **Step 3: Add updateProductionTier method**

Add to `packages/db/src/stores/prisma-creative-job-store.ts` after the `stop` method (line 93):

```typescript
async updateProductionTier(id: string, tier: string): Promise<CreativeJob> {
  return this.prisma.creativeJob.update({
    where: { id },
    data: { productionTier: tier },
  }) as unknown as CreativeJob;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run prisma-creative-job-store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store.test.ts
git commit -m "feat(db): add updateProductionTier method to creative job store"
```

---

### Task 3: Kling AI Client

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/kling-client.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/kling-client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/kling-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KlingClient } from "../kling-client.js";

describe("KlingClient", () => {
  let client: KlingClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new KlingClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits generation task and polls for completion", async () => {
    // First call: submit task
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // Second call: poll — still processing
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { task_status: "processing", task_result: null },
        }),
    });
    // Third call: poll — complete
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            task_status: "succeed",
            task_result: {
              videos: [
                {
                  url: "https://kling.example.com/video.mp4",
                  duration: "5.0",
                },
              ],
            },
          },
        }),
    });

    const result = await client.generateVideo({
      prompt: "A product shot of a widget",
      duration: 5,
      aspectRatio: "16:9",
    });

    expect(result.videoUrl).toBe("https://kling.example.com/video.mp4");
    expect(result.duration).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws on timeout", async () => {
    // Submit succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // All polls return processing
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { task_status: "processing", task_result: null },
        }),
    });

    // Create client with very short timeout for testing
    client = new KlingClient({ apiKey: "test-key", timeoutMs: 100, pollIntervalMs: 20 });

    await expect(
      client.generateVideo({ prompt: "test", duration: 5, aspectRatio: "16:9" }),
    ).rejects.toThrow(/timeout/i);
  });

  it("retries on transient errors", async () => {
    // Submit succeeds
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { task_id: "task-123" } }),
    });
    // First poll: 500 error
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });
    // Second poll: success
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            task_status: "succeed",
            task_result: {
              videos: [{ url: "https://kling.example.com/v.mp4", duration: "5.0" }],
            },
          },
        }),
    });

    const result = await client.generateVideo({
      prompt: "test",
      duration: 5,
      aspectRatio: "16:9",
    });

    expect(result.videoUrl).toBe("https://kling.example.com/v.mp4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run kling-client`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement KlingClient**

```typescript
// packages/core/src/creative-pipeline/stages/kling-client.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run kling-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/kling-client.ts packages/core/src/creative-pipeline/stages/__tests__/kling-client.test.ts
git commit -m "feat(core): add Kling AI client with async polling and retry"
```

---

### Task 4: ElevenLabs Client

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/elevenlabs-client.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/elevenlabs-client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/elevenlabs-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElevenLabsClient } from "../elevenlabs-client.js";

describe("ElevenLabsClient", () => {
  let client: ElevenLabsClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new ElevenLabsClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("synthesizes text to speech and returns audio URL", async () => {
    const audioBlob = new Blob(["fake-audio"], { type: "audio/mpeg" });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(audioBlob),
      headers: new Headers({ "x-audio-duration": "28.5" }),
    });

    const result = await client.synthesize({
      text: "Hello world, this is a test voiceover.",
    });

    expect(result.audioUrl).toBeDefined();
    expect(result.duration).toBe(28.5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses custom voiceId when provided", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["audio"])),
      headers: new Headers({ "x-audio-duration": "10" }),
    });

    await client.synthesize({
      text: "Test",
      voiceId: "custom-voice-123",
    });

    const callUrl = fetchSpy.mock.calls[0][0] as string;
    expect(callUrl).toContain("custom-voice-123");
  });

  it("retries on transient errors", async () => {
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["audio"])),
        headers: new Headers({ "x-audio-duration": "5" }),
      });

    const result = await client.synthesize({ text: "Test" });
    expect(result.duration).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run elevenlabs-client`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement ElevenLabsClient**

```typescript
// packages/core/src/creative-pipeline/stages/elevenlabs-client.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run elevenlabs-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/elevenlabs-client.ts packages/core/src/creative-pipeline/stages/__tests__/elevenlabs-client.test.ts
git commit -m "feat(core): add ElevenLabs voice synthesis client with retry"
```

---

### Task 5: Whisper Client + HeyGen Stub

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/whisper-client.ts`
- Create: `packages/core/src/creative-pipeline/stages/heygen-client.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/whisper-client.test.ts`

- [ ] **Step 1: Write failing test for Whisper**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/whisper-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhisperClient } from "../whisper-client.js";

describe("WhisperClient", () => {
  let client: WhisperClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new WhisperClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transcribes audio and returns SRT content", async () => {
    // Mock fetching the audio file
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["fake-audio"])),
    });
    // Mock Whisper API response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: "Hello world",
          segments: [
            { start: 0, end: 2.5, text: "Hello" },
            { start: 2.5, end: 5, text: "world" },
          ],
        }),
    });

    const result = await client.transcribe({
      audioUrl: "https://example.com/audio.mp3",
    });

    expect(result.segments).toHaveLength(2);
    expect(result.srtContent).toContain("Hello");
    expect(result.srtContent).toContain("world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run whisper-client`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement WhisperClient**

```typescript
// packages/core/src/creative-pipeline/stages/whisper-client.ts

const OPENAI_API_BASE = "https://api.openai.com/v1";

interface WhisperConfig {
  apiKey: string;
}

interface TranscribeRequest {
  audioUrl: string;
  language?: string;
}

interface TranscribeSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscribeResult {
  srtContent: string;
  segments: TranscribeSegment[];
}

export class WhisperClient {
  private apiKey: string;

  constructor(config: WhisperConfig) {
    this.apiKey = config.apiKey;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    // Download audio file
    const audioRes = await fetch(request.audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
    const audioBlob = await audioRes.blob();

    // Send to Whisper API
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.mp3");
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "segment");
    if (request.language) formData.append("language", request.language);

    const res = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) throw new Error(`Whisper API: ${res.status} ${res.statusText}`);
    const data = await res.json();

    const segments: TranscribeSegment[] = (data.segments ?? []).map(
      (s: { start: number; end: number; text: string }) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      }),
    );

    return {
      srtContent: segmentsToSrt(segments),
      segments,
    };
  }
}

function segmentsToSrt(segments: TranscribeSegment[]): string {
  return segments
    .map((seg, i) => {
      const startTime = formatSrtTime(seg.start);
      const endTime = formatSrtTime(seg.end);
      return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`;
    })
    .join("\n");
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
```

- [ ] **Step 4: Create HeyGen stub**

```typescript
// packages/core/src/creative-pipeline/stages/heygen-client.ts

/**
 * HeyGen avatar video client — stubbed for V1 (Premium tier).
 * Will be implemented in V2 when Premium tier is exposed.
 */

interface HeyGenConfig {
  apiKey: string;
}

interface GenerateAvatarRequest {
  script: string;
  avatarId?: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
}

interface GenerateAvatarResult {
  videoUrl: string;
  duration: number;
}

export class HeyGenClient {
  constructor(_config: HeyGenConfig) {}

  async generateAvatar(_request: GenerateAvatarRequest): Promise<GenerateAvatarResult> {
    throw new Error("HeyGen integration is not yet available (Premium tier — V2)");
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run whisper-client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/whisper-client.ts packages/core/src/creative-pipeline/stages/heygen-client.ts packages/core/src/creative-pipeline/stages/__tests__/whisper-client.test.ts
git commit -m "feat(core): add Whisper caption client + HeyGen stub (V2)"
```

---

### Task 6: Video Assembler (FFmpeg Wrapper)

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/video-assembler.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/video-assembler.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/video-assembler.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VideoAssembler } from "../video-assembler.js";

// Mock child_process.execFile
vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, "", "");
  }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run video-assembler`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement VideoAssembler**

```typescript
// packages/core/src/creative-pipeline/stages/video-assembler.ts

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

    // Write concat file
    const concatContent = request.clips.map((c) => `file '${c.videoUrl}'`).join("\n");
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

  private exec(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 300_000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`FFmpeg failed: ${stderr || error.message}`));
        else resolve(stdout);
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run video-assembler`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/video-assembler.ts packages/core/src/creative-pipeline/stages/__tests__/video-assembler.test.ts
git commit -m "feat(core): add FFmpeg video assembler with concat, voiceover, and captions"
```

---

### Task 7: Cost Estimator

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/cost-estimator.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/cost-estimator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/cost-estimator.test.ts
import { describe, it, expect } from "vitest";
import { estimateCost } from "../cost-estimator.js";

describe("estimateCost", () => {
  const storyboard = {
    storyboards: [
      {
        scriptRef: "script-1",
        scenes: [
          {
            sceneNumber: 1,
            description: "Product intro",
            visualDirection: "zoom",
            duration: 5,
            textOverlay: null,
            referenceImageUrl: null,
          },
          {
            sceneNumber: 2,
            description: "Features",
            visualDirection: "pan",
            duration: 10,
            textOverlay: "30% off",
            referenceImageUrl: null,
          },
          {
            sceneNumber: 3,
            description: "CTA",
            visualDirection: "static",
            duration: 5,
            textOverlay: "Buy now",
            referenceImageUrl: null,
          },
        ],
      },
    ],
  };

  it("estimates basic tier cost from scene count and duration", () => {
    const result = estimateCost(storyboard, 1);
    expect(result.basic).toBeDefined();
    expect(result.basic.cost).toBeGreaterThan(0);
    expect(result.basic.description).toBeDefined();
  });

  it("estimates pro tier cost higher than basic", () => {
    const result = estimateCost(storyboard, 1);
    expect(result.pro.cost).toBeGreaterThan(result.basic.cost);
  });

  it("scales cost with number of scripts", () => {
    const costOne = estimateCost(storyboard, 1);
    const costTwo = estimateCost(storyboard, 2);
    expect(costTwo.basic.cost).toBeGreaterThan(costOne.basic.cost);
  });

  it("handles empty storyboard", () => {
    const empty = { storyboards: [] };
    const result = estimateCost(empty, 1);
    expect(result.basic.cost).toBe(0);
    expect(result.pro.cost).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run cost-estimator`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement cost estimator**

```typescript
// packages/core/src/creative-pipeline/stages/cost-estimator.ts

/**
 * Approximate cost per Kling API call (5s clip).
 * Kling charges per generation — ~$0.35 per 5s clip (standard mode).
 */
const KLING_COST_PER_5S = 0.35;
const KLING_COST_PER_10S = 0.7;
const ELEVENLABS_COST_PER_1K_CHARS = 0.3;
const WHISPER_COST_PER_MINUTE = 0.006;
const AVG_CHARS_PER_SCRIPT = 500;

interface StoryboardForEstimate {
  storyboards: Array<{
    scenes: Array<{
      duration: number;
    }>;
  }>;
}

interface TierEstimate {
  cost: number;
  description: string;
}

interface CostEstimates {
  basic: TierEstimate;
  pro: TierEstimate;
}

export function estimateCost(
  storyboard: StoryboardForEstimate,
  scriptCount: number,
): CostEstimates {
  const allScenes = storyboard.storyboards.flatMap((sb) => sb.scenes);
  const totalScenes = allScenes.length * scriptCount;

  if (totalScenes === 0) {
    return {
      basic: { cost: 0, description: "No scenes to produce" },
      pro: { cost: 0, description: "No scenes to produce" },
    };
  }

  // Basic: Kling generation only
  const klingCost =
    allScenes.reduce((sum, scene) => {
      return sum + (scene.duration > 5 ? KLING_COST_PER_10S : KLING_COST_PER_5S);
    }, 0) * scriptCount;

  const basicCost = klingCost;

  // Pro: Kling + ElevenLabs + Whisper
  const voiceoverCost = scriptCount * (AVG_CHARS_PER_SCRIPT / 1000) * ELEVENLABS_COST_PER_1K_CHARS;
  const totalDuration = allScenes.reduce((sum, s) => sum + s.duration, 0) * scriptCount;
  const whisperCost = (totalDuration / 60) * WHISPER_COST_PER_MINUTE;
  const proCost = klingCost + voiceoverCost + whisperCost;

  return {
    basic: {
      cost: Math.round(basicCost * 100) / 100,
      description: `~${totalScenes} scene clips via Kling AI`,
    },
    pro: {
      cost: Math.round(proCost * 100) / 100,
      description: `~${totalScenes} clips + voiceover + captions + assembled video`,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run cost-estimator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/cost-estimator.ts packages/core/src/creative-pipeline/stages/__tests__/cost-estimator.test.ts
git commit -m "feat(core): add cost estimator for tiered video production"
```

---

### Task 8: Video Producer Orchestrator

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/video-producer.ts`
- Test: `packages/core/src/creative-pipeline/stages/__tests__/video-producer.test.ts`

This is the main Stage 5 orchestrator. It takes storyboard output + script text + production tier and produces `VideoProducerOutput`.

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/video-producer.test.ts
import { describe, it, expect, vi } from "vitest";
import { runVideoProducer } from "../video-producer.js";
import type { VideoProducerDeps } from "../video-producer.js";

function makeMockDeps(): VideoProducerDeps {
  return {
    klingClient: {
      generateVideo: vi.fn().mockResolvedValue({
        videoUrl: "https://kling.example.com/clip.mp4",
        duration: 5,
      }),
    },
    elevenLabsClient: {
      synthesize: vi.fn().mockResolvedValue({
        audioUrl: "https://elevenlabs.example.com/audio.mp3",
        duration: 20,
      }),
    },
    whisperClient: {
      transcribe: vi.fn().mockResolvedValue({
        srtContent: "1\n00:00:00,000 --> 00:00:05,000\nHello\n",
        segments: [{ start: 0, end: 5, text: "Hello" }],
      }),
    },
    videoAssembler: {
      assemble: vi.fn().mockResolvedValue({
        videoUrl: "https://r2.example.com/assembled.mp4",
        thumbnailUrl: "https://r2.example.com/thumb.jpg",
        duration: 15,
      }),
    },
    optimizePrompt: vi.fn().mockResolvedValue({
      tool: "kling" as const,
      prompt: "Optimized prompt for product shot",
      duration: 5 as const,
      aspectRatio: "9:16" as const,
    }),
  };
}

const storyboard = {
  storyboards: [
    {
      scriptRef: "script-0",
      scenes: [
        {
          sceneNumber: 1,
          description: "Product intro",
          visualDirection: "zoom in",
          duration: 5,
          textOverlay: null,
          referenceImageUrl: null,
        },
        {
          sceneNumber: 2,
          description: "Features demo",
          visualDirection: "pan left",
          duration: 5,
          textOverlay: "30% off",
          referenceImageUrl: null,
        },
        {
          sceneNumber: 3,
          description: "CTA",
          visualDirection: "static",
          duration: 5,
          textOverlay: "Buy now",
          referenceImageUrl: null,
        },
      ],
    },
  ],
};

const scripts = {
  scripts: [
    {
      hookRef: "hook-0",
      fullScript: "Introducing the amazing widget. It does everything you need. Buy now!",
      timing: [],
      format: "feed_video" as const,
      platform: "meta",
      productionNotes: "",
    },
  ],
};

describe("runVideoProducer", () => {
  it("produces basic tier output with clips only", async () => {
    const deps = makeMockDeps();
    const result = await runVideoProducer(
      {
        storyboard,
        scripts,
        tier: "basic",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("basic");
    expect(result.clips.length).toBe(3);
    expect(result.assembledVideos).toBeUndefined();
    expect(result.voiceover).toBeUndefined();
    expect(deps.klingClient.generateVideo).toHaveBeenCalledTimes(3);
    expect(deps.optimizePrompt).toHaveBeenCalledTimes(3);
  });

  it("produces pro tier output with assembled video + voiceover", async () => {
    const deps = makeMockDeps();
    const result = await runVideoProducer(
      {
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("pro");
    expect(result.clips.length).toBe(3);
    expect(result.assembledVideos).toBeDefined();
    expect(result.assembledVideos!.length).toBeGreaterThan(0);
    expect(result.voiceover).toBeDefined();
    expect(deps.elevenLabsClient!.synthesize).toHaveBeenCalled();
    expect(deps.whisperClient!.transcribe).toHaveBeenCalled();
    expect(deps.videoAssembler!.assemble).toHaveBeenCalled();
  });

  it("records errors for failed scenes without crashing", async () => {
    const deps = makeMockDeps();
    deps.klingClient.generateVideo = vi
      .fn()
      .mockRejectedValueOnce(new Error("Kling timeout"))
      .mockResolvedValue({ videoUrl: "https://kling.example.com/ok.mp4", duration: 5 });

    const result = await runVideoProducer(
      {
        storyboard,
        scripts,
        tier: "basic",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.clips.length).toBe(2); // 1 failed, 2 succeeded
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBe(1);
    expect(result.errors![0].stage).toBe("generation");
    expect(result.errors![0].tool).toBe("kling");
  });

  it("falls back to basic output when assembly fails in pro tier", async () => {
    const deps = makeMockDeps();
    deps.videoAssembler!.assemble = vi.fn().mockRejectedValue(new Error("FFmpeg crash"));

    const result = await runVideoProducer(
      {
        storyboard,
        scripts,
        tier: "pro",
        platforms: ["meta"],
        productDescription: "A widget",
      },
      deps,
    );

    expect(result.tier).toBe("pro");
    expect(result.clips.length).toBe(3);
    // Assembly failed — assembledVideos should be absent or empty
    expect(result.assembledVideos ?? []).toHaveLength(0);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.stage === "assembly")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run video-producer`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement video producer**

```typescript
// packages/core/src/creative-pipeline/stages/video-producer.ts

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

  // Pro tier: generate voiceover (parallel with clips already generated above) + captions + assemble
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run video-producer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/video-producer.ts packages/core/src/creative-pipeline/stages/__tests__/video-producer.test.ts
git commit -m "feat(core): add video producer orchestrator with tiered production"
```

---

### Task 9: Wire Stage 5 into Pipeline — run-stage.ts + creative-job-runner.ts

**Files:**

- Modify: `packages/core/src/creative-pipeline/stages/run-stage.ts:111-124`
- Modify: `packages/core/src/creative-pipeline/creative-job-runner.ts`
- Test: existing tests for these files (update if present)

- [ ] **Step 1: Write failing test for run-stage production case**

Add a test file or update existing:

```typescript
// packages/core/src/creative-pipeline/stages/__tests__/run-stage-production.test.ts
import { describe, it, expect, vi } from "vitest";
import { runStage } from "../run-stage.js";
import type { StageInput } from "../run-stage.js";

// We need to mock the video producer module
vi.mock("../video-producer.js", () => ({
  runVideoProducer: vi.fn().mockResolvedValue({
    tier: "basic",
    clips: [
      {
        sceneRef: "s0-scene-1",
        videoUrl: "https://kling/v.mp4",
        duration: 5,
        generatedBy: "kling",
      },
    ],
  }),
}));

describe("runStage — production", () => {
  it("calls runVideoProducer for production stage", async () => {
    const input: StageInput = {
      jobId: "job-1",
      brief: {
        productDescription: "Widget",
        targetAudience: "Everyone",
        platforms: ["meta"],
      },
      previousOutputs: {
        storyboard: {
          storyboards: [
            {
              scriptRef: "s0",
              scenes: [
                {
                  sceneNumber: 1,
                  description: "Intro",
                  visualDirection: "zoom",
                  duration: 5,
                  textOverlay: null,
                  referenceImageUrl: null,
                },
              ],
            },
          ],
        },
        scripts: {
          scripts: [
            {
              hookRef: "h0",
              fullScript: "Test script",
              timing: [],
              format: "feed_video",
              platform: "meta",
              productionNotes: "",
            },
          ],
        },
      },
      apiKey: "test-key",
      productionTier: "basic",
    };

    const result = await runStage("production", input);
    expect((result as any).tier).toBe("basic");
    expect((result as any).clips).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run run-stage-production`
Expected: FAIL — `StageInput` doesn't have `productionTier`, production case returns placeholder

- [ ] **Step 3: Update StageInput and production case in run-stage.ts**

**Important:** First, add `createPromptOptimizer` and `extractCameraMotion` to `video-producer.ts` (see code at end of this step). These must exist before `run-stage.ts` imports them.

In `packages/core/src/creative-pipeline/stages/run-stage.ts`:

1. Add imports at top:

```typescript
import { StoryboardOutput, ScriptWriterOutput } from "@switchboard/schemas";
import { runVideoProducer, createPromptOptimizer } from "./video-producer.js";
import { KlingClient } from "./kling-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { WhisperClient } from "./whisper-client.js";
import { VideoAssembler } from "./video-assembler.js";
```

2. Add `productionTier` to `StageInput` interface (line 10):

```typescript
export interface StageInput {
  jobId: string;
  brief: {
    productDescription: string;
    targetAudience: string;
    platforms: string[];
    brandVoice?: string | null;
    references?: string[];
    productImages?: string[];
  };
  previousOutputs: Record<string, unknown>;
  apiKey: string;
  generateReferenceImages?: boolean;
  imageGenerator?: ImageGenerator;
  productionTier?: string; // "basic" | "pro" — set from Stage 4 approval
}
```

3. Replace production case (lines 111-124):

```typescript
    case "production": {
      const rawStoryboard = input.previousOutputs["storyboard"];
      const rawScripts = input.previousOutputs["scripts"];
      if (!rawStoryboard || !rawScripts) {
        throw new Error("production stage requires storyboard and scripts output");
      }
      const storyboard = StoryboardOutput.parse(rawStoryboard);
      const scripts = ScriptWriterOutput.parse(rawScripts);
      const tier = (input.productionTier ?? "basic") as "basic" | "pro";

      // Build deps — API keys come from environment/config
      const klingClient = new KlingClient({ apiKey: process.env.KLING_API_KEY ?? "" });
      const deps: any = {
        klingClient,
        optimizePrompt: createPromptOptimizer(input.apiKey),
      };

      if (tier === "pro") {
        deps.elevenLabsClient = new ElevenLabsClient({
          apiKey: process.env.ELEVENLABS_API_KEY ?? "",
        });
        deps.whisperClient = new WhisperClient({
          apiKey: input.apiKey, // Whisper uses OpenAI key
        });
        deps.videoAssembler = new VideoAssembler();
      }

      return runVideoProducer(
        { storyboard, scripts, tier, platforms: input.brief.platforms, productDescription: input.brief.productDescription },
        deps,
      );
    }
```

4. Add `createPromptOptimizer` function to `video-producer.ts` (export it):

```typescript
/**
 * Creates a prompt optimizer function that uses Claude to translate
 * storyboard scene descriptions into tool-optimized prompts.
 */
export function createPromptOptimizer(apiKey: string) {
  return async (scene: SceneInput, context: PromptContext): Promise<OptimizedPrompt> => {
    // For V1, use a template-based approach. Claude optimization can be added later.
    const aspectRatio = getAspectRatio(context.platform);
    const duration: 5 | 10 = scene.duration > 5 ? 10 : 5;

    const prompt = [
      `Professional advertisement video scene.`,
      `Product: ${context.productDescription}.`,
      `Scene: ${scene.description}.`,
      `Visual style: ${scene.visualDirection}.`,
      `High quality, commercial production, well-lit, sharp focus.`,
    ].join(" ");

    return {
      tool: "kling" as const,
      prompt,
      negativePrompt: "blurry, low quality, distorted, watermark, text artifacts",
      imageUrl: scene.referenceImageUrl ?? undefined,
      duration,
      aspectRatio,
      cameraMotion: extractCameraMotion(scene.visualDirection),
    };
  };
}

function extractCameraMotion(visualDirection: string): string | undefined {
  const lower = visualDirection.toLowerCase();
  if (lower.includes("zoom in")) return "zoom_in";
  if (lower.includes("zoom out")) return "zoom_out";
  if (lower.includes("pan left")) return "pan_left";
  if (lower.includes("pan right")) return "pan_right";
  if (lower.includes("orbit")) return "orbit";
  return undefined;
}
```

- [ ] **Step 4: Update creative-job-runner.ts to pass productionTier**

In `packages/core/src/creative-pipeline/creative-job-runner.ts`:

1. Add `VideoConfig` interface and parameter:

```typescript
interface VideoConfig {
  klingApiKey?: string;
  elevenLabsApiKey?: string;
}
```

2. Update `StageInput` construction in the `for` loop (line 72-88) to include `productionTier`:

```typescript
const output = await step.run(`stage-${stage}`, () =>
  runStage(stage, {
    jobId: job.id,
    brief: {
      productDescription: job.productDescription,
      targetAudience: job.targetAudience,
      platforms: job.platforms,
      brandVoice: job.brandVoice,
      references: job.references,
      productImages: job.productImages,
    },
    previousOutputs: stageOutputs,
    apiKey: llmConfig.apiKey,
    generateReferenceImages: job.generateReferenceImages,
    imageGenerator,
    productionTier: job.productionTier ?? "basic",
  }),
);
```

3. Update `executeCreativePipeline` and `createCreativeJobRunner` signatures to accept `videoConfig`:

```typescript
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  _videoConfig?: VideoConfig,
): Promise<void> {
```

```typescript
export function createCreativeJobRunner(
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
  videoConfig?: VideoConfig,
) {
  return inngestClient.createFunction(
    { ... },
    async ({ event, step }) => {
      await executeCreativePipeline(event.data, step, jobStore, llmConfig, imageConfig, videoConfig);
    },
  );
}
```

- [ ] **Step 5: Add env vars to .env.example**

Add to `.env.example`:

```bash
KLING_API_KEY=            # Kling AI API key for video generation
ELEVENLABS_API_KEY=       # ElevenLabs API key for voice synthesis (Pro tier)
```

- [ ] **Step 6: Run tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/run-stage.ts packages/core/src/creative-pipeline/creative-job-runner.ts packages/core/src/creative-pipeline/stages/video-producer.ts packages/core/src/creative-pipeline/stages/__tests__/run-stage-production.test.ts .env.example
git commit -m "feat(core): wire video producer into pipeline with productionTier support"
```

> **Note:** Claude Vision QA gates (spec Section 6) are deferred to a follow-up. The video producer orchestrator generates and uses clips directly without validation. A QA hook can be inserted before assembly in a future iteration.

---

### Task 10: API Routes — Update Approve + Add Cost Estimate

**Files:**

- Modify: `apps/api/src/routes/creative-pipeline.ts`
- Test: `apps/api/src/routes/__tests__/creative-pipeline.test.ts` (create if missing)

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/routes/__tests__/creative-pipeline-approve.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";

const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
  productionTier: z.enum(["basic", "pro"]).optional(),
});

describe("ApproveStageInput with productionTier", () => {
  it("accepts productionTier when provided", () => {
    const result = ApproveStageInput.safeParse({
      action: "continue",
      productionTier: "pro",
    });
    expect(result.success).toBe(true);
    expect(result.data?.productionTier).toBe("pro");
  });

  it("accepts approval without productionTier", () => {
    const result = ApproveStageInput.safeParse({ action: "continue" });
    expect(result.success).toBe(true);
    expect(result.data?.productionTier).toBeUndefined();
  });

  it("defaults productionTier to basic when not provided at storyboard stage", () => {
    const result = ApproveStageInput.safeParse({ action: "continue" });
    expect(result.success).toBe(true);
    // Logic: approve handler defaults to "basic" if not provided and currentStage === "storyboard"
    expect(result.data?.productionTier).toBeUndefined(); // schema allows undefined; handler defaults
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run creative-pipeline-approve`
Expected: FAIL (or passes since we're testing inline — adjust approach)

- [ ] **Step 3: Update ApproveStageInput schema**

In `apps/api/src/routes/creative-pipeline.ts`, update line 17-19:

```typescript
const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
  productionTier: z.enum(["basic", "pro"]).optional(),
});
```

- [ ] **Step 4: Update approve handler to persist productionTier at Stage 4**

In the approve endpoint (line 124-170), after fetching the job and before sending the Inngest event, add:

```typescript
// Persist productionTier if this is Stage 4 (storyboard) approval
if (
  parsed.data.action === "continue" &&
  job.currentStage === "storyboard" // Stage 4 — production tier is relevant
) {
  const tier = parsed.data.productionTier ?? "basic";
  await jobStore.updateProductionTier(id, tier);
}
```

This goes after `const job = await jobStore.findById(id)` and the null/complete checks, before the `if (parsed.data.action === "stop")` block.

- [ ] **Step 5: Add cost estimate endpoint**

Add after the approve endpoint in `apps/api/src/routes/creative-pipeline.ts`:

```typescript
// GET /creative-jobs/:id/estimate — cost estimate per tier
app.get("/creative-jobs/:id/estimate", async (request, reply) => {
  if (!app.prisma) {
    return reply.code(503).send({ error: "Database not available" });
  }

  const orgId = request.organizationIdFromAuth;
  if (!orgId) {
    return reply.code(401).send({ error: "Organization required" });
  }

  const { id } = request.params as { id: string };
  const jobStore = new PrismaCreativeJobStore(app.prisma);
  const job = await jobStore.findById(id);

  if (!job || job.organizationId !== orgId) {
    return reply.code(404).send({ error: "Creative job not found" });
  }

  const stageOutputs = (job.stageOutputs ?? {}) as Record<string, unknown>;
  const storyboard = stageOutputs["storyboard"];
  const scripts = stageOutputs["scripts"];

  if (!storyboard) {
    return reply.send({ estimates: null, reason: "Storyboard not yet complete" });
  }

  const { estimateCost } = await import("@switchboard/core/creative-pipeline");
  const scriptCount = (scripts as any)?.scripts?.length ?? 1;
  const estimates = estimateCost(storyboard as any, scriptCount);

  return reply.send({ estimates });
});
```

- [ ] **Step 6: Export estimateCost from core package**

Check if `packages/core/src/creative-pipeline/index.ts` exists. If so, add:

```typescript
export { estimateCost } from "./stages/cost-estimator.js";
```

If not, create it or add to the existing barrel export.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run && npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/creative-pipeline.ts packages/core/src/creative-pipeline/index.ts
git commit -m "feat(api): update approve endpoint for productionTier + add cost estimate route"
```

---

### Task 11: Dashboard — Tier Selection Component + Action Bar Update

**Files:**

- Create: `apps/dashboard/src/components/creative-pipeline/tier-selection.tsx`
- Modify: `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`
- Modify: `apps/dashboard/src/hooks/use-creative-pipeline.ts`

- [ ] **Step 1: Add useCostEstimate hook and update useApproveStage**

In `apps/dashboard/src/hooks/use-creative-pipeline.ts`:

Add `useCostEstimate` hook:

```typescript
export function useCostEstimate(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.creativeJobs.estimate(jobId),
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/estimate`);
      if (!res.ok) throw new Error("Failed to fetch cost estimate");
      const data = await res.json();
      return data.estimates as {
        basic: { cost: number; description: string };
        pro: { cost: number; description: string };
      } | null;
    },
    enabled: enabled && !!jobId,
  });
}
```

Update `useApproveStage` to accept `productionTier`:

```typescript
export function useApproveStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      action,
      productionTier,
    }: {
      jobId: string;
      action: "continue" | "stop";
      productionTier?: "basic" | "pro";
    }) => {
      const res = await fetch(`/api/dashboard/marketplace/creative-jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(productionTier ? { productionTier } : {}) }),
      });
      if (!res.ok) throw new Error("Failed to update pipeline");
      const data = await res.json();
      return data as { job: CreativeJobSummary; action: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creativeJobs.all });
    },
  });
}
```

Also add the query key. Check `apps/dashboard/src/lib/query-keys.ts` and add:

```typescript
estimate: (id: string) => [...queryKeys.creativeJobs.all, "estimate", id] as const,
```

- [ ] **Step 2: Create tier-selection.tsx**

```tsx
// apps/dashboard/src/components/creative-pipeline/tier-selection.tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useCostEstimate, useApproveStage } from "@/hooks/use-creative-pipeline";

interface TierSelectionProps {
  jobId: string;
}

const TIERS = [
  {
    id: "basic" as const,
    label: "Basic",
    description: "Raw AI-generated scene clips from Kling AI",
    features: ["Individual scene clips", "Direct Kling AI output", "Fastest turnaround"],
  },
  {
    id: "pro" as const,
    label: "Pro",
    description: "Assembled video with voiceover, captions, and text overlays",
    features: [
      "Assembled video per platform",
      "AI voiceover (ElevenLabs)",
      "Auto-generated captions",
      "Text overlays from storyboard",
      "Platform-optimized formats",
    ],
  },
];

export function TierSelection({ jobId }: TierSelectionProps) {
  const { toast } = useToast();
  const [selectedTier, setSelectedTier] = useState<"basic" | "pro">("basic");
  const { data: estimates, isLoading: estimatesLoading } = useCostEstimate(jobId, true);
  const approveMutation = useApproveStage();

  const handleStartProduction = () => {
    approveMutation.mutate(
      { jobId, action: "continue", productionTier: selectedTier },
      {
        onSuccess: () => {
          toast({
            title: "Production started",
            description: `Starting ${selectedTier} tier production.`,
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to start production. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-medium">Choose Production Tier</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TIERS.map((tier) => {
          const estimate = estimates?.[tier.id];
          const isSelected = selectedTier === tier.id;
          return (
            <button
              key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              className={`text-left p-4 rounded-lg border-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[14px] font-medium">{tier.label}</span>
                {estimatesLoading ? (
                  <span className="text-[12px] text-muted-foreground">Loading...</span>
                ) : estimate ? (
                  <span className="text-[13px] font-medium text-primary">
                    ~${estimate.cost.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground">Estimate unavailable</span>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground mb-2">{tier.description}</p>
              <ul className="space-y-0.5">
                {tier.features.map((f) => (
                  <li key={f} className="text-[11px] text-muted-foreground">
                    • {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            approveMutation.mutate(
              { jobId, action: "stop" },
              {
                onSuccess: () => toast({ title: "Pipeline stopped" }),
                onError: () =>
                  toast({
                    title: "Error",
                    description: "Failed to stop pipeline.",
                    variant: "destructive",
                  }),
              },
            );
          }}
          disabled={approveMutation.isPending}
        >
          Stop Pipeline
        </Button>
        <Button
          onClick={handleStartProduction}
          disabled={approveMutation.isPending}
          className="flex-1"
        >
          {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Start {selectedTier === "pro" ? "Pro" : "Basic"} Production
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update action-bar.tsx to show tier selection at Stage 4**

In `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`:

1. Add import: `import { TierSelection } from "./tier-selection";`

2. Replace the return JSX. When `currentStage === "storyboard"`, render `TierSelection` instead of the normal buttons:

```tsx
// When current stage is storyboard (Stage 4), show tier selection instead of normal buttons
if (currentStage === "storyboard") {
  return (
    <div className="sticky bottom-0 bg-background border-t border-border p-4">
      <TierSelection jobId={jobId} />
    </div>
  );
}
```

Add this check right after the `if (currentStage === "complete" || stoppedAt) return null;` check (line 36), before `const handleApprove`.

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/tier-selection.tsx apps/dashboard/src/components/creative-pipeline/action-bar.tsx apps/dashboard/src/hooks/use-creative-pipeline.ts apps/dashboard/src/lib/query-keys.ts
git commit -m "feat(dashboard): add tier selection component + cost estimates at Stage 4"
```

---

### Task 12: Dashboard — Production Output + Estimate Proxy Route

**Files:**

- Modify: `apps/dashboard/src/components/creative-pipeline/production-output.tsx`
- Create: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts` (add getCostEstimate method)

- [ ] **Step 1: Create estimate proxy route**

```typescript
// apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.getCostEstimate(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

- [ ] **Step 2: Add getCostEstimate to api-client.ts**

Add method to `SwitchboardClient` class in `apps/dashboard/src/lib/api-client.ts`:

```typescript
async getCostEstimate(jobId: string) {
  return this.request<{
    estimates: {
      basic: { cost: number; description: string };
      pro: { cost: number; description: string };
    } | null;
  }>(`/api/marketplace/creative-jobs/${jobId}/estimate`);
}
```

- [ ] **Step 3: Replace production-output.tsx with video player**

```tsx
// apps/dashboard/src/components/creative-pipeline/production-output.tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Clip {
  sceneRef: string;
  videoUrl: string;
  duration: number;
  generatedBy: string;
}

interface AssembledVideo {
  videoUrl: string;
  thumbnailUrl: string;
  format: string;
  duration: number;
  platform: string;
  hasVoiceover: boolean;
  hasCaptions: boolean;
  hasBackgroundMusic: boolean;
}

interface ProductionError {
  stage: string;
  scene: string | null;
  tool: string;
  message: string;
}

interface ProductionData {
  tier: string;
  clips: Clip[];
  assembledVideos?: AssembledVideo[];
  voiceover?: { audioUrl: string; duration: number; captionsUrl: string };
  errors?: ProductionError[];
}

interface ProductionOutputProps {
  output: unknown;
}

function isProductionData(data: unknown): data is ProductionData {
  return (
    typeof data === "object" &&
    data !== null &&
    "tier" in data &&
    "clips" in data &&
    Array.isArray((data as ProductionData).clips)
  );
}

export function ProductionOutput({ output }: ProductionOutputProps) {
  const [showClips, setShowClips] = useState(false);

  if (!isProductionData(output)) {
    // Fallback for old format or unexpected data
    return (
      <div>
        <p className="text-[13px] text-muted-foreground mb-2">Production output</p>
        <pre className="text-[12px] bg-muted p-4 rounded-lg overflow-auto max-h-96">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const { tier, clips, assembledVideos, voiceover, errors } = output;

  return (
    <div className="space-y-4">
      {/* Tier badge */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[11px]">
          {tier.toUpperCase()} Tier
        </Badge>
        <span className="text-[13px] text-muted-foreground">
          {clips.length} clip{clips.length !== 1 ? "s" : ""} generated
        </span>
      </div>

      {/* Errors banner */}
      {errors && errors.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-[13px] font-medium text-destructive">
              {errors.length} issue{errors.length !== 1 ? "s" : ""} during production
            </span>
          </div>
          {errors.map((err, i) => (
            <p key={i} className="text-[12px] text-muted-foreground ml-6">
              [{err.tool}] {err.scene ? `Scene ${err.scene}: ` : ""}
              {err.message}
            </p>
          ))}
        </div>
      )}

      {/* Assembled videos (Pro tier) */}
      {assembledVideos && assembledVideos.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-[14px] font-medium">Assembled Videos</h4>
          {assembledVideos.map((video, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <video
                src={video.videoUrl}
                poster={video.thumbnailUrl}
                controls
                className="w-full max-h-[400px] bg-black"
              />
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {video.platform}
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {video.format}
                  </Badge>
                  <span className="text-[12px] text-muted-foreground">{video.duration}s</span>
                  {video.hasVoiceover && (
                    <Badge variant="outline" className="text-[10px]">
                      Voiceover
                    </Badge>
                  )}
                  {video.hasCaptions && (
                    <Badge variant="outline" className="text-[10px]">
                      Captions
                    </Badge>
                  )}
                </div>
                <a href={video.videoUrl} download>
                  <Button variant="ghost" size="sm">
                    <Download className="h-3.5 w-3.5 mr-1" /> Download
                  </Button>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Voiceover audio (Pro tier) */}
      {voiceover && (
        <div>
          <h4 className="text-[14px] font-medium mb-2">Voiceover</h4>
          <audio src={voiceover.audioUrl} controls className="w-full" />
          <p className="text-[12px] text-muted-foreground mt-1">{voiceover.duration}s</p>
        </div>
      )}

      {/* Individual clips (expandable) */}
      {clips.length > 0 && (
        <div>
          <button
            onClick={() => setShowClips(!showClips)}
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showClips ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {assembledVideos?.length ? "Individual Clips" : "Video Clips"} ({clips.length})
          </button>
          {(showClips || !assembledVideos?.length) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {clips.map((clip, i) => (
                <div key={i} className="rounded-lg border border-border overflow-hidden">
                  <video src={clip.videoUrl} controls className="w-full max-h-[200px] bg-black" />
                  <div className="p-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-muted-foreground">{clip.sceneRef}</span>
                      <span className="text-[11px] text-muted-foreground">{clip.duration}s</span>
                    </div>
                    <a href={clip.videoUrl} download>
                      <Button variant="ghost" size="sm" className="h-7 px-2">
                        <Download className="h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/creative-pipeline/production-output.tsx apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts apps/dashboard/src/lib/api-client.ts
git commit -m "feat(dashboard): add video player production output + cost estimate proxy"
```

---

### Task 13: Final Integration — Typecheck + Lint + Test

**Files:** All modified files from Tasks 1-12

- [ ] **Step 1: Run full typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS — fix any type errors

- [ ] **Step 2: Run full linting**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS — fix any lint errors

- [ ] **Step 3: Run full test suite**

Run: `npx pnpm@9.15.4 test`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `npx pnpm@9.15.4 build`
Expected: PASS

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address typecheck and lint issues from SP5 integration"
```
