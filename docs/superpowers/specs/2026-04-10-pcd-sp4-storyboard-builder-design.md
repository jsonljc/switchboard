# SP4: Storyboard Builder — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Parent Spec:** `docs/superpowers/specs/2026-04-08-performance-creative-director-design.md` — Section 4.4
**Depends On:** SP3 (Strategy Stages 1-3)

---

## 1. Overview

Stage 4 of the Performance Creative Director pipeline takes scripts from Stage 3 and produces scene-by-scene storyboards with visual direction. Image generation is opt-in per job — controlled by a `generateReferenceImages` boolean on the brief. When enabled, each scene gets a reference image via a pluggable `ImageGenerator` interface, with DALL-E 3 as the first implementation.

### Key Design Decisions

- **Opt-in image generation** — `generateReferenceImages: boolean` on the job, set at brief submission time
- **One image per scene** — every scene gets a reference image when enabled (~$0.20 per storyboard)
- **Pluggable image generator** — `ImageGenerator` interface with DALL-E 3 as first implementation, swappable later
- **Non-fatal image failures** — if image gen fails for a scene, `referenceImageUrl` is set to `null` and the stage continues

---

## 2. Data Model Changes

### 2.1 CreativeBriefInput (Zod schema)

Add field:

```typescript
generateReferenceImages: z.boolean().default(false);
```

### 2.2 CreativeJob (Prisma model)

Add column:

```prisma
generateReferenceImages  Boolean  @default(false)
```

### 2.3 CreativeJobSchema (Zod)

Add field to `CreativeJobSchema` in `packages/schemas/src/creative-job.ts`:

```typescript
generateReferenceImages: z.boolean(),
```

This ensures jobs read back from the database retain the field through Zod parsing.

### 2.4 StoryboardOutput (no changes)

The existing schema already supports `referenceImageUrl: string | null` per scene. No modifications needed.

---

## 3. Components

### 3.1 Image Generator Interface

**File:** `packages/core/src/creative-pipeline/stages/image-generator.ts`

**Dependency:** Add `openai` package to `packages/core/package.json`.

```typescript
export interface ImageGenerator {
  generate(prompt: string): Promise<string>; // returns image URL
}
```

**DALL-E 3 Implementation:** `DalleImageGenerator` class implementing the interface. Uses the OpenAI SDK (`openai` package). Generates 1024x1024 images in "vivid" style.

```typescript
export class DalleImageGenerator implements ImageGenerator {
  constructor(private apiKey: string) {}
  async generate(prompt: string): Promise<string> { ... }
}
```

### 3.2 Storyboard Builder Stage

**File:** `packages/core/src/creative-pipeline/stages/storyboard-builder.ts`

Two exported functions following the same pattern as stages 1-3:

- `buildStoryboardPrompt(brief, scriptsOutput)` — Constructs system + user prompt for Claude
- `runStoryboardBuilder(brief, scriptsOutput, apiKey, imageGenerator?)` — Calls Claude, then optionally generates images per scene

**Prompt design:**

- System prompt instructs Claude to break each script into 4-6 scenes
- Each scene maps to a timing section from the script (hook → scene 1, problem → scene 2, etc.)
- Claude provides: scene description, visual direction (camera angle, lighting, mood, composition, talent direction), text overlay content, and duration
- Product images are referenced in the prompt so Claude can incorporate them into visual direction

**Image generation flow** (when `generateReferenceImages` is true and `imageGenerator` is provided):

1. Claude generates all scenes with visual direction text
2. For each scene, build an image prompt from: visual direction + product description + platform context
3. Call `imageGenerator.generate()` sequentially per scene
4. Set `referenceImageUrl` on each scene
5. If any individual image call fails, log the error and set that scene's `referenceImageUrl` to `null`

### 3.3 StageInput Changes

Add to `StageInput.brief` (passthrough — `productImages` already exists on `CreativeBriefInput` and the Prisma model):

```typescript
productImages?: string[];
```

Add as top-level fields on `StageInput` (not nested under `brief`):

```typescript
generateReferenceImages?: boolean;
imageGenerator?: ImageGenerator;
```

These top-level fields are only relevant for the storyboard stage. Other stages ignore them.

### 3.4 Dependency Injection

**New config type:**

```typescript
interface ImageConfig {
  openaiApiKey?: string;
}
```

**Injection chain:**

```
inngest.ts (reads OPENAI_API_KEY from env)
  → createCreativeJobRunner(jobStore, llmConfig, imageConfig)
    → executeCreativePipeline(eventData, step, jobStore, llmConfig, imageConfig)
      → runStage("storyboard", { ...input, generateReferenceImages, imageGenerator })
```

The `imageGenerator` is only instantiated when `imageConfig.openaiApiKey` is set AND the job has `generateReferenceImages: true`. Otherwise the storyboard stage runs Claude-only (all `referenceImageUrl` values are `null`).

**Runner changes (`creative-job-runner.ts`):**

- Add `imageConfig: ImageConfig` as 4th parameter to `createCreativeJobRunner` and `executeCreativePipeline`
- Add `productImages: job.productImages` to the `brief` object passed to `runStage`
- Add `generateReferenceImages: job.generateReferenceImages` and `imageGenerator` (when available) as top-level fields in the `runStage` input

---

## 4. Run-Stage Wiring

Replace the storyboard stub in `run-stage.ts`:

```typescript
case "storyboard": {
  const scripts = ScriptWriterOutput.parse(input.previousOutputs["scripts"]);
  return runStoryboardBuilder(
    {
      productDescription: input.brief.productDescription,
      targetAudience: input.brief.targetAudience,
      platforms: input.brief.platforms,
      productImages: input.brief.productImages,
    },
    scripts,
    input.apiKey,
    input.generateReferenceImages ? input.imageGenerator : undefined,
  );
}
```

---

## 5. API Changes

### 5.1 POST /creative-jobs (brief submission)

The `SubmitBriefInput` already accepts the full `CreativeBriefInput`. Adding `generateReferenceImages` to the schema makes it available automatically. The route passes it through to `jobStore.create()`.

### 5.2 No changes to approve endpoint

The approve/stop flow is unchanged. Image generation happens during the storyboard stage execution, not at approval time.

---

## 6. Environment Variables

Add to `.env.example`:

```
# OpenAI — reference image generation for storyboard stage (optional)
OPENAI_API_KEY=
```

When not set, storyboard runs Claude-only regardless of the job's `generateReferenceImages` flag. A warning is logged at startup.

---

## 7. Error Handling

| Scenario                                       | Behavior                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Image gen fails for one scene                  | Log error, set `referenceImageUrl: null` for that scene, continue |
| Image gen fails for all scenes                 | Storyboard still succeeds with all `referenceImageUrl: null`      |
| OpenAI API key not set but job requests images | Log warning, skip image gen, all URLs null                        |
| Claude fails to generate storyboard            | Inngest retries the step (3 retries configured)                   |
| Invalid scripts output from Stage 3            | Zod validation throws, Inngest retries                            |

---

## 8. Testing Strategy

- **`storyboard-builder.test.ts`** — Mock `callClaude`, mock `ImageGenerator`:
  - Prompt construction from scripts
  - Scene breakdown matches script timing
  - Image gen called per scene when enabled
  - Image gen skipped when disabled (no generator provided)
  - Image gen failure handled gracefully (URL set to null)
- **`image-generator.test.ts`** — Mock OpenAI SDK:
  - Successful image generation returns URL
  - API error throws
- **`run-stage.test.ts`** — Update existing tests:
  - Storyboard stage calls real implementation (with mocked callClaude + image gen)
  - Validates scripts output with Zod before passing to storyboard
- **`creative-job-runner.test.ts`** — Update existing tests:
  - Verify `imageConfig` threading through `executeCreativePipeline`
  - Verify `productImages` and `generateReferenceImages` passed in `runStage` input

---

## 9. File Structure

| Action | File                                                  | Responsibility                                                   |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Create | `stages/storyboard-builder.ts`                        | Stage 4: scripts → scene breakdowns + visual direction           |
| Create | `stages/image-generator.ts`                           | ImageGenerator interface + DalleImageGenerator                   |
| Create | `__tests__/storyboard-builder.test.ts`                | Unit tests for Stage 4                                           |
| Create | `__tests__/image-generator.test.ts`                   | Unit tests for image generator                                   |
| Create | Prisma migration                                      | Add `generateReferenceImages` column                             |
| Modify | `packages/schemas/src/creative-job.ts`                | Add `generateReferenceImages` to brief schema                    |
| Modify | `stages/run-stage.ts`                                 | Wire storyboard stage, add image fields to StageInput            |
| Modify | `creative-job-runner.ts`                              | Pass imageConfig, generateReferenceImages, productImages through |
| Modify | `packages/db/src/stores/prisma-creative-job-store.ts` | Add `generateReferenceImages` to `CreateCreativeJobInput`        |
| Modify | `index.ts`                                            | Export new modules                                               |
| Modify | `apps/api/src/bootstrap/inngest.ts`                   | Read OPENAI_API_KEY, pass imageConfig                            |
| Modify | `apps/api/src/routes/creative-pipeline.ts`            | Pass generateReferenceImages to job creation                     |
| Modify | `.env.example`                                        | Add OPENAI_API_KEY                                               |

---

## 10. Known Limitations

- **DALL-E URLs expire** (~1 hour). If a buyer reviews storyboard output after expiration, images will be broken. Persistent storage is deferred (see Out of Scope) but should be prioritized in a follow-up.
- **Sequential image generation** — images are generated one scene at a time for simplicity. With 4-6 scenes this may take 20-40 seconds. Parallel generation is a future optimization.

---

## 11. Out of Scope

- Image generation for stages other than storyboard
- User-uploaded reference images per scene (uses product images from brief only)
- Image style presets or customization
- Image storage/CDN — DALL-E returns temporary URLs; persistent storage deferred
