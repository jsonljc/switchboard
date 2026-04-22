# SP5: Video Producer — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Parent Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md`
**Depends On:** SP4 (storyboard builder), SP6/Dashboard-1 (job detail page, action bar)

---

## 1. Overview

Stage 5 of the PCD pipeline — takes storyboard output and produces video ads using AI generation tools. Supports three production tiers (Basic, Pro, Premium) selected by the buyer when approving Stage 4. Each tier adds more polish: raw clips → assembled video with voiceover → full production with AI avatars.

### Key Design Decisions

- **Tiered production** — buyers choose Basic/Pro/Premium at Stage 4 approval, not at brief submission. They've seen the creative direction before committing to production cost.
- **Kling AI for scene generation** — best-in-class image-to-video for product shots
- **HeyGen for talking heads** — UGC-style avatar scenes (Premium only)
- **ElevenLabs for voiceover** — best voice synthesis quality
- **FFmpeg for assembly** — stitching, text overlays, captions, format resizing
- **Claude as prompt optimizer** — translates storyboard scenes into tool-specific prompts
- **Parallel API calls** — audio generation doesn't depend on video, run simultaneously
- **Graceful degradation** — if Pro/Premium assembly fails, fall back to Basic (raw clips)
- **Premium tier hidden for V1** — launch with Basic + Pro only, add Premium when HeyGen + Suno are wired up
- **Provider-hosted URLs for V1** — Kling/HeyGen/ElevenLabs return hosted URLs. Only FFmpeg assembled videos need storage (Cloudflare R2).

---

## 2. Production Tiers

### 2.1 Tier Selection

Tier is chosen at Stage 4 (storyboard) approval. The approval event changes from:

```typescript
{
  action: "continue" | "stop";
}
```

To (after Stage 4 only):

```typescript
{ action: "continue", productionTier: "basic" | "pro" }
{ action: "stop" }
```

Stages 1-3 approval events remain unchanged.

### 2.2 Tier Definitions

| Tier             | Tools Used                            | Output                                    | Cost Driver             |
| ---------------- | ------------------------------------- | ----------------------------------------- | ----------------------- |
| **Basic**        | Kling AI                              | Raw scene clips                           | Kling API only          |
| **Pro**          | Kling + ElevenLabs + Whisper + FFmpeg | Assembled video with voiceover + captions | Multiple APIs + compute |
| **Premium** (V2) | + HeyGen + Suno                       | Full production with avatars + music      | All APIs                |

### 2.3 Cost Estimation

Before starting production, the dashboard shows approximate cost per tier. A cost estimator function calculates from:

- Number of scenes (from storyboard)
- Scene durations (from storyboard)
- Number of scripts
- Tier selected

Estimates shown with `~` prefix (approximate — retries may add cost).

---

## 3. Pipeline Flow Per Tier

### 3.1 Basic

```
Storyboard scenes
  → Claude prompt optimization (per scene)
  → Kling API (per scene, sequential)
  → Return clip URLs
```

### 3.2 Pro

```
Storyboard scenes + Script text
  ├─ Claude prompt optimization → Kling API (per scene)     ─┐
  └─ ElevenLabs voiceover (from script text)                  ─┤
                                                               ↓
  Claude Vision QA (per clip, regenerate failures max 3x)
                                                               ↓
  Whisper → captions from voiceover audio
                                                               ↓
  FFmpeg assembly:
    - Stitch clips in scene order
    - Mix voiceover audio
    - Burn in captions
    - Add text overlays from storyboard
    - Resize per platform format (1:1, 9:16, 16:9)
                                                               ↓
  Upload assembled videos to R2 → final URLs
  Claude Vision final QA
```

### 3.3 Premium (V2 — stubbed)

Same as Pro, plus:

- Claude tags scenes as `"avatar"` or `"generated"` — avatar scenes go to HeyGen, rest to Kling
- Suno generates background music matched to ad mood/pacing
- FFmpeg mixes in background music

Premium is architecturally supported but not exposed in the UI for V1.

---

## 4. Prompt Optimization Layer

Raw storyboard scene data produces mediocre AI video. The prompt optimizer (Claude) translates creative intent into tool-specific prompts:

**Input:** Storyboard scene (`description`, `visualDirection`, `duration`, `textOverlay`) + product context + platform

**Output per scene:**

```typescript
{
  tool: "kling" | "heygen";        // scene routing (Premium only, always "kling" for Basic/Pro)
  prompt: string;                   // optimized for the target tool
  negativePrompt?: string;          // what to avoid
  imageUrl?: string;                // product image for image-to-video
  duration: 5 | 10;                 // Kling supports 5s or 10s
  aspectRatio: "16:9" | "9:16" | "1:1";
  cameraMotion?: string;            // pan, zoom, orbit
}
```

The optimizer considers:

- **Visual consistency** across scenes (same style, lighting)
- **Camera motion** appropriate for the scene type
- **Product prominence** — ensures product is hero of relevant scenes
- **Platform-native feel** — TikTok vs YouTube vs Meta visual language

---

## 5. External API Clients

### 5.1 Kling AI Client

Async task-based API:

1. Submit generation task (text-to-video or image-to-video)
2. Receive task ID
3. Poll for completion (exponential backoff: 5s → 10s → 20s, cap 30s)
4. Timeout after 10 minutes
5. Retry transient errors (429, 500, 503) up to 3 times

**Interface:**

```typescript
interface KlingClient {
  generateVideo(request: {
    prompt: string;
    negativePrompt?: string;
    imageUrl?: string;
    duration: 5 | 10;
    aspectRatio: "16:9" | "9:16" | "1:1";
    cameraMotion?: string;
  }): Promise<{ videoUrl: string; duration: number }>;
}
```

### 5.2 ElevenLabs Client

Synchronous-ish API — submit text, receive audio file:

```typescript
interface ElevenLabsClient {
  synthesize(request: {
    text: string;
    voiceId?: string; // default voice if not specified
  }): Promise<{ audioUrl: string; duration: number }>;
}
```

### 5.3 Whisper Client (Caption Generation)

Uses OpenAI Whisper API to generate captions from voiceover audio:

```typescript
interface WhisperClient {
  transcribe(request: {
    audioUrl: string;
    language?: string; // default "en"
  }): Promise<{
    srtContent: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }>;
}
```

### 5.5 HeyGen Client (V2)

Async task-based (similar to Kling):

```typescript
interface HeyGenClient {
  generateAvatar(request: {
    script: string; // what the avatar says
    avatarId?: string; // default avatar if not specified
    aspectRatio: "16:9" | "9:16" | "1:1";
  }): Promise<{ videoUrl: string; duration: number }>;
}
```

### 5.6 Video Assembler (FFmpeg)

```typescript
interface VideoAssembler {
  assemble(request: {
    clips: Array<{ videoUrl: string; duration: number }>;
    voiceover?: { audioUrl: string };
    backgroundMusic?: { audioUrl: string; volume: number };
    captions?: { srtContent: string };
    textOverlays?: Array<{ text: string; startSec: number; endSec: number }>;
    outputFormat: { aspectRatio: "16:9" | "9:16" | "1:1"; platform: string };
  }): Promise<{ videoUrl: string; thumbnailUrl: string; duration: number }>;
}
```

Requires FFmpeg binary on the server. Assembled videos uploaded to Cloudflare R2.

---

## 6. Quality Gates (Claude Vision)

Run after clip generation, before assembly:

| Check              | What It Detects                          | Action on Failure                           |
| ------------------ | ---------------------------------------- | ------------------------------------------- |
| Motion artifacts   | Distorted faces, melting objects, jitter | Regenerate with modified prompt (max 3x)    |
| Product visibility | Product not visible or too small         | Regenerate with stronger product emphasis   |
| Brand safety       | Inappropriate content, competitor logos  | Regenerate with negative prompt additions   |
| Text legibility    | Overlaid text unreadable                 | Flag for FFmpeg text positioning adjustment |

Final QA runs on assembled video (Pro/Premium):

- Overall coherence between scenes
- Audio-video sync
- Caption accuracy

Failed final QA → return assembled video with warning flag, don't block delivery.

---

## 7. Data Model Changes

### 7.1 CreativeJob — Add Field

```prisma
productionTier  String?   // null until Stage 4 approved, then "basic" | "pro"
```

Add to `CreativeJobSchema` in `packages/schemas/src/creative-job.ts`:

```typescript
productionTier: z.enum(["basic", "pro", "premium"]).nullable().optional(),
```

### 7.2 VideoProducerOutput Schema — Update (Breaking Change)

This replaces the existing `VideoProducerOutput` schema. The old schema had `videos[]` and `staticFallbacks[]` — the new schema has `clips[]`, `assembledVideos?`, `voiceover?`, and `errors?`. Since Stage 5 was a stub (never produced real output), this is safe to replace without migration.

```typescript
export const VideoProducerOutput = z.object({
  tier: z.enum(["basic", "pro", "premium"]),
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
        scene: z.string().nullable(), // null for non-scene errors (FFmpeg, Whisper, ElevenLabs)
        tool: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
```

---

## 8. API Changes

### 8.1 Approve Endpoint — Update

`POST /api/marketplace/creative-jobs/:id/approve`

Body accepts optional `productionTier`:

```typescript
{ action: "continue", productionTier?: "basic" | "pro" }
```

**Validation rules:**

- `productionTier` is only accepted when the job's `currentStage === "storyboard"` (Stage 4). If provided at any other stage, it is ignored.
- If `currentStage === "storyboard"` and no `productionTier` is provided, defaults to `"basic"`.
- The tier is persisted to `CreativeJob.productionTier` before sending the approval event.

The `creative-job-runner.ts` reads `productionTier` from the job record (set by the approve handler) and passes it to the video producer.

### 8.2 Cost Estimate Endpoint — New

`GET /api/marketplace/creative-jobs/:id/estimate`

Returns cost estimates for all available tiers based on the job's storyboard output:

```typescript
{
  estimates: {
    basic: {
      cost: number;
      description: string;
    }
    pro: {
      cost: number;
      description: string;
    }
  }
}
```

### 8.3 Dashboard Proxy Routes

- `GET /api/dashboard/marketplace/creative-jobs/:id/estimate` — proxies to backend

---

## 9. Dashboard Changes

### 9.1 Tier Selection Component

**File:** `apps/dashboard/src/components/creative-pipeline/tier-selection.tsx`

Shown when approving Stage 4 (storyboard). Radio cards for Basic and Pro with cost estimates. "Start Production" button submits approval with selected tier.

### 9.2 Action Bar — Modify

When `currentStage === "storyboard"`, render tier selection instead of normal Continue/Stop buttons.

### 9.3 Production Output — Replace Placeholder

**Basic:** Grid of video clip players with download links.
**Pro:** Primary assembled video player + expandable section showing individual clips + voiceover audio player.
Show error banner for any partial failures.

---

## 10. Error Handling

| Scenario                                     | Behavior                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| Kling generation fails (3 retries exhausted) | Skip scene, include in `errors[]`                        |
| HeyGen fails (Premium)                       | Fall back to Kling for that scene                        |
| ElevenLabs fails                             | Retry 3x, produce video without voiceover                |
| Claude Vision QA fails a clip                | Regenerate with adjusted prompt, max 3 attempts          |
| FFmpeg assembly fails                        | Retry once, fall back to Basic output (raw clips)        |
| Kling timeout (>10 min)                      | Treat as failure, trigger retry                          |
| All scenes fail                              | Return empty clips + full error list                     |
| Cost estimate unavailable                    | Hide cost in tier selection, show "Estimate unavailable" |

---

## 11. File Structure

| Action | File                                                                                    | Responsibility                                                                      |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Create | `packages/core/src/creative-pipeline/stages/kling-client.ts`                            | Kling AI API client                                                                 |
| Create | `packages/core/src/creative-pipeline/stages/elevenlabs-client.ts`                       | ElevenLabs voice synthesis client                                                   |
| Create | `packages/core/src/creative-pipeline/stages/whisper-client.ts`                          | Whisper caption generation client                                                   |
| Create | `packages/core/src/creative-pipeline/stages/heygen-client.ts`                           | HeyGen avatar client (stubbed for V1)                                               |
| Create | `packages/core/src/creative-pipeline/stages/video-assembler.ts`                         | FFmpeg wrapper                                                                      |
| Create | `packages/core/src/creative-pipeline/stages/cost-estimator.ts`                          | Cost estimation per tier                                                            |
| Create | `packages/core/src/creative-pipeline/stages/video-producer.ts`                          | Stage 5 orchestrator + prompt optimization                                          |
| Modify | `packages/core/src/creative-pipeline/stages/run-stage.ts`                               | Replace production stub                                                             |
| Modify | `packages/core/src/creative-pipeline/creative-job-runner.ts`                            | Pass video config + production tier                                                 |
| Modify | `packages/schemas/src/creative-job.ts`                                                  | Update VideoProducerOutput, add ProductionTier                                      |
| Modify | `packages/db/prisma/schema.prisma`                                                      | Add productionTier field                                                            |
| Modify | `packages/db/src/stores/prisma-creative-job-store.ts`                                   | Support productionTier field                                                        |
| Modify | `apps/api/src/routes/creative-pipeline.ts`                                              | Add estimate endpoint, update approve                                               |
| Create | `apps/dashboard/src/components/creative-pipeline/tier-selection.tsx`                    | Tier picker with cost estimates                                                     |
| Modify | `apps/dashboard/src/components/creative-pipeline/action-bar.tsx`                        | Show tier selection at Stage 4                                                      |
| Modify | `apps/dashboard/src/components/creative-pipeline/production-output.tsx`                 | Replace placeholder with video player                                               |
| Create | `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts` | Proxy for cost estimate                                                             |
| Modify | `apps/dashboard/src/hooks/use-creative-pipeline.ts`                                     | Add `useCostEstimate()` hook, update `useApproveStage()` to accept `productionTier` |

---

## 12. Out of Scope

- Premium tier UI (hidden for V1, architecture supports it)
- Suno music generation (Premium-only feature)
- Custom voice cloning (ElevenLabs supports it but not exposed)
- Custom HeyGen avatar selection (uses default)
- Real-time generation progress in dashboard (polling is sufficient)
- Video download as ZIP
- A/B variant generation (multiple videos from same storyboard)
