# Performance Creative Director — Design Spec

**Date:** 2026-04-08
**Status:** Draft
**Family:** Family 2 — Creative & Revenue
**Worker ID:** SW-F2-001

---

## 1. Overview

The Performance Creative Director (PCD) is a single marketplace agent that replaces a performance creative agency retainer. It takes a product brief and delivers creative strategy, hooks, scripts, storyboards, and optionally produced video ads — with the buyer able to stop at any stage.

### What It Replaces

| Current Solution            | Monthly Cost      | Problem                      |
| --------------------------- | ----------------- | ---------------------------- |
| Boutique performance agency | $5,000–$15,000/mo | No accountability on results |
| Freelance creative          | $2,000–$5,000/mo  | Inconsistent, slow           |
| In-house team               | $8,000–$20,000/mo | Overhead, management cost    |
| Generic AI tool             | $99–$299/mo       | No strategy, no production   |

### Key Design Decisions

- **Single marketplace listing** with internal sub-agent modules (not 5 separate listings)
- **Progressive pipeline with off-ramps** — buyers stop at any stage, pay only for what they use
- **Hybrid architecture** — native Switchboard (marketplace, trust, governance) + Inngest for async job orchestration
- **Stages 1-3 are Claude-only** (cheap/fast); stages 4-5 use external APIs (expensive/slow)

---

## 2. Pipeline Architecture

### 2.1 Progressive Stages

```
Brief → [1] Trend Analysis → [2] Hooks → [3] Scripts → [4] Storyboard → [5] Production
              ↓ stop?           ↓ stop?      ↓ stop?       ↓ stop?          ↓ done
```

| Stage | Name               | What It Does                                          | External APIs                | Cost   |
| ----- | ------------------ | ----------------------------------------------------- | ---------------------------- | ------ |
| 1     | Trend Analyzer     | Platform trends, audience motivators, creative angles | Claude + web search          | Low    |
| 2     | Hook Generator     | Platform-specific hooks scored against format rules   | Claude only                  | Low    |
| 3     | Script Writer      | Full ad scripts with timing, format variants          | Claude only                  | Low    |
| 4     | Storyboard Builder | Scene-by-scene breakdowns, visual direction           | Claude + optional image gen  | Medium |
| 5     | Video Producer     | Video generation, voice, captions, assembly           | Seedance, ElevenLabs, FFmpeg | High   |

### 2.2 Orchestration (Inngest)

The pipeline is an Inngest step function (`creative-job-runner`):

1. Buyer submits brief → `AgentTask` created → `CreativeJob` created → Inngest event fired
2. Each stage runs as an Inngest `step.run()` — retryable, observable, with timeouts
3. After each stage: output saved to `stageOutputs`, buyer notified
4. Pipeline pauses via `step.waitForEvent()` — waits for buyer approval before next stage
5. Buyer clicks "Continue" → next stage runs. Buyer clicks "Stop" → `stoppedAt` set, task completes with partial output.

**Why Inngest:**

- `step.waitForEvent()` handles human-in-the-loop approval without polling or cron
- Video generation (Seedance) takes 2-10 minutes — Inngest handles long-running steps natively
- Built-in retries with exponential backoff for flaky external APIs
- Each step independently retryable without rerunning the whole pipeline

---

## 3. Data Model

### 3.1 Marketplace Integration

One `AgentListing` record:

- `slug: "performance-creative-director"`
- `type: "switchboard_native"`
- `status: "coming_soon"` → `"listed"` as stages ship
- `taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"]`

Standard `AgentDeployment` when buyer deploys. Standard `AgentTask` per job for governance/trust.

### 3.2 CreativeJob Model (New)

```prisma
model CreativeJob {
  id              String   @id @default(cuid())
  taskId          String   @unique
  task            AgentTask @relation(fields: [taskId], references: [id])
  organizationId  String
  deploymentId    String

  // Brief (input)
  productDescription  String
  targetAudience      String
  platforms           String[]    // ["meta", "youtube", "tiktok"]
  brandVoice          String?
  productImages       String[]    // URLs to uploaded assets
  references          String[]    // user-provided trend links, competitor ads
  pastPerformance     Json?       // optional historical ad performance data

  // Pipeline state
  currentStage    String          // "trends" | "hooks" | "scripts" | "storyboard" | "production" | "complete"
  stageOutputs    Json    @default("{}")  // { trends: {...}, hooks: {...}, ... }
  stoppedAt       String?         // null = still running, or stage name where user stopped

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Notes:**

- `stageOutputs` stores structured output per stage. Actual media files (images, videos) live in object storage; this field stores URLs and metadata only.
- `stoppedAt` enables the off-ramp pattern. `null` means pipeline is active or completed normally.
- Links to `AgentTask` for governance and trust scoring.

---

## 4. Sub-Agent Stage Details

### 4.1 Stage 1 — Trend Analyzer

- **Input:** Product description, target audience, platforms, user-provided references
- **Processing:** Claude analyzes brief, researches platform trends (TikTok Creative Center, Meta Ad Library via web search), identifies audience motivators, emotional drivers, awareness level
- **Output:**
  ```typescript
  {
    angles: Array<{ theme: string; motivator: string; platformFit: string; rationale: string }>;
    audienceInsights: {
      awarenessLevel: "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware";
      topDrivers: string[];
      objections: string[];
    };
    trendSignals: Array<{ platform: string; trend: string; relevance: string }>;
  }
  ```

### 4.2 Stage 2 — Hook Generator

- **Input:** Stage 1 output + platform selection
- **Processing:** Claude generates 3 hook variants per angle, scored against platform-specific rules
- **Platform rules encoded:**
  - Meta cold: pattern interrupt (stop the scroll)
  - Meta retargeting: social proof
  - YouTube skippable: problem/question (no logo first 2s)
  - YouTube Shorts: native UGC feel
  - TikTok: curiosity + native feel
- **Output:**
  ```typescript
  {
    hooks: Array<{
      angleRef: string;
      text: string;
      type: "pattern_interrupt" | "question" | "bold_statement";
      platformScore: number;
      rationale: string;
    }>;
    topCombos: Array<{ angleRef: string; hookRef: string; score: number }>;
  }
  ```

### 4.3 Stage 3 — Script Writer

- **Input:** Top hook combos + brand voice + platform formats
- **Processing:** Claude writes full scripts with timing structure (hook 0-3s → problem 3-8s → solution 8-18s → proof 18-25s → CTA 25-30s)
- **Output:**
  ```typescript
  {
    scripts: Array<{
      hookRef: string;
      fullScript: string;
      timing: Array<{ section: string; startSec: number; endSec: number; content: string }>;
      format: string; // "feed_video" | "stories" | "skippable" | "shorts" | etc.
      platform: string;
      productionNotes: string;
    }>;
  }
  ```

### 4.4 Stage 4 — Storyboard Builder

- **Input:** Scripts + product images
- **Processing:** Claude generates scene-by-scene breakdowns with visual direction. Optionally generates reference images.
- **Output:**
  ```typescript
  {
    storyboards: Array<{
      scriptRef: string;
      scenes: Array<{
        sceneNumber: number;
        description: string;
        visualDirection: string; // camera angle, mood, lighting
        duration: number; // seconds
        textOverlay: string | null;
        referenceImageUrl: string | null;
      }>;
    }>;
  }
  ```

### 4.5 Stage 5 — Video Producer

- **Input:** Storyboards + product images + brand assets
- **Processing:** Seedance video generation per scene → ElevenLabs voice synthesis → FFmpeg assembly (captions via Whisper, text overlays, format sizing 1:1/9:16/16:9)
- **Output:**
  ```typescript
  {
    videos: Array<{
      storyboardRef: string;
      videoUrl: string;
      thumbnailUrl: string;
      format: string; // "1:1" | "9:16" | "16:9"
      duration: number;
      platform: string;
    }>;
    staticFallbacks: Array<{ imageUrl: string; platform: string }>;
  }
  ```
- **Quality gates (automated, run before human review):**
  - Motion artifact detection (Claude Vision)
  - Audio sync accuracy (FFmpeg probe)
  - Text legibility (Claude Vision OCR)
  - Platform spec compliance (custom validator)
  - Brand safety (Claude Vision)
  - Failed check → auto-regenerate (max 3 retries)

---

## 5. Governance & Trust Scoring

### 5.1 Governance

- PCD starts at trust score 0 (supervised), like all agents
- **Supervised/Guided (0-54):** Buyer must approve each stage before it proceeds (natural — `waitForEvent` enforces this)
- **Autonomous (55+):** Stages 1-3 auto-proceed without buyer approval. Stages 4-5 always require approval (expensive, harder to undo)
- Standard governance constraints apply (no false claims, brand safety)

### 5.2 Trust Scoring

- Single trust score for the listing (not per-stage)
- Score updates when buyer reviews the final output (wherever they stopped):
  - Approval: +3 (with streak bonus up to +5)
  - Rejection: -10
- Internal per-stage quality metrics tracked in `stageOutputs` metadata — useful for debugging which stage is weak, but not exposed in marketplace trust

### 5.3 Pricing (Progressive Tiers)

| Tier            | Stages                         | Cost Driver                  |
| --------------- | ------------------------------ | ---------------------------- |
| Strategy        | 1-3 (Trends → Scripts)         | Claude API only              |
| Storyboard      | 1-4 (+ visual planning)        | Claude + optional image gen  |
| Full Production | 1-5 (+ video, voice, assembly) | Seedance, ElevenLabs, FFmpeg |

Exact pricing TBD based on actual API costs. Marketplace `priceTier` follows standard trust-based progression (free → basic → pro → elite).

---

## 6. Code Structure

```
packages/core/src/creative-pipeline/
  index.ts                    — barrel exports
  creative-job-runner.ts      — Inngest step function: orchestrates full pipeline
  types.ts                    — shared stage input/output types
  quality-gates.ts            — validation between stages
  stages/
    trend-analyzer.ts         — Stage 1
    hook-generator.ts         — Stage 2
    script-writer.ts          — Stage 3
    storyboard-builder.ts     — Stage 4
    video-producer.ts         — Stage 5

packages/schemas/src/
  creative-job.ts             — Zod schemas for CreativeJob + stage outputs

packages/db/src/stores/
  prisma-creative-job-store.ts — CRUD for CreativeJob

apps/api/src/routes/
  creative-pipeline.ts        — API routes for job submission, stage approval, status
```

Layer compliance:

- `packages/schemas` (Layer 1) — no internal deps
- `packages/core` (Layer 3) — imports schemas + cartridge-sdk
- `packages/db` (Layer 4) — imports schemas + core
- `apps/api` (Layer 6) — imports everything

---

## 7. Sub-project Decomposition

This system is too large for a single implementation cycle. Each sub-project gets its own plan.

| Sub-project                    | Scope                                                                                        | Depends On                | Ships                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| **SP1: Data models + listing** | `CreativeJob` Prisma model, Zod schemas, store, seed AgentListing, API routes for job CRUD   | Nothing                   | Listing on marketplace, jobs can be created/read            |
| **SP2: Inngest integration**   | Add Inngest to monorepo, wire into Fastify, `creative-job-runner` skeleton with no-op stages | SP1                       | Jobs trigger pipeline, stages run as placeholders           |
| **SP3: Stages 1-3 (Strategy)** | Trend analyzer, hook generator, script writer — Claude-only                                  | SP2                       | **First shippable product.** Brief → angles, hooks, scripts |
| **SP4: Stage 4 (Storyboard)**  | Storyboard builder with scene breakdowns                                                     | SP3                       | Visual planning added                                       |
| **SP5: Stage 5 (Production)**  | Seedance video gen, ElevenLabs voice, FFmpeg assembly                                        | SP4                       | Full video output                                           |
| **SP6: Dashboard UI**          | Job submission form, stage-by-stage review, approve/stop controls                            | SP1 (parallel with SP2-5) | Buyer manages jobs from dashboard                           |

**Build order:** SP1 → SP2 → SP3 (milestone: first shippable) → SP6 (parallel with SP4) → SP4 → SP5

---

## 8. Risks & Mitigations

| Risk                                     | Impact                       | Mitigation                                                                                  |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| No file upload infra exists              | Can't accept product images  | Use presigned S3/Cloudinary URLs. DB stores URLs only.                                      |
| Inngest is new to codebase               | Integration unknowns         | SP2 is dedicated to proving the integration before building stages                          |
| Single trust score for mixed-cost stages | Noisy signal                 | Acceptable for MVP. `taskCategories` array supports per-category splitting later            |
| Seedance/ElevenLabs API reliability      | Flaky output, slow responses | Inngest retries with backoff. 10min timeout per scene. Quality gate + max 3 regenerations   |
| `stageOutputs` JSON blob growth          | DB bloat at production stage | Media in object storage, JSON stores URLs only. Split to `CreativeJobAsset` table if needed |
| Buyer notifications                      | No real-time push system     | Dashboard polling for MVP. Real-time notifications deferred.                                |

---

## 9. Out of Scope (Deferred)

- Performance ingestion from Meta/Google Ads APIs (future: pull CTR/CVR to inform trust scoring)
- Custom trust formula weighted by creative metrics (CVR, hook rate, revision rate, reorder rate)
- Multi-language support
- A/B testing playbook generation
- Real-time notifications (webhook/push)
- Buyer-facing analytics dashboard for ad performance
