# SP4: Storyboard Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the storyboard stub with a real Claude-powered Stage 4 that breaks scripts into scene-by-scene storyboards with visual direction, plus opt-in reference image generation via a pluggable `ImageGenerator` interface (DALL-E 3 first implementation).

**Architecture:** Stage 4 follows the same pattern as stages 1-3: `buildStoryboardPrompt()` + `runStoryboardBuilder()` using the shared `callClaude()` helper. A new `ImageGenerator` interface enables pluggable image providers. The `generateReferenceImages` boolean on the job controls whether image gen runs. `ImageConfig` is threaded through the DI chain from `inngest.ts` → runner → stage.

**Tech Stack:** TypeScript, Zod, Prisma, Anthropic SDK (Claude), OpenAI SDK (DALL-E 3), Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-pcd-sp4-storyboard-builder-design.md`

---

## File Structure

| Action | File                                                                        | Responsibility                                                               |
| ------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Create | `packages/core/src/creative-pipeline/stages/image-generator.ts`             | `ImageGenerator` interface + `DalleImageGenerator` class                     |
| Create | `packages/core/src/creative-pipeline/stages/storyboard-builder.ts`          | Stage 4: `buildStoryboardPrompt()` + `runStoryboardBuilder()`                |
| Create | `packages/core/src/creative-pipeline/__tests__/image-generator.test.ts`     | Unit tests for image generator                                               |
| Create | `packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts`  | Unit tests for storyboard builder                                            |
| Modify | `packages/schemas/src/creative-job.ts`                                      | Add `generateReferenceImages` to `CreativeBriefInput` + `CreativeJobSchema`  |
| Modify | `packages/db/prisma/schema.prisma`                                          | Add `generateReferenceImages` column to `CreativeJob`                        |
| Modify | `packages/db/src/stores/prisma-creative-job-store.ts`                       | Add `generateReferenceImages` to `CreateCreativeJobInput`                    |
| Modify | `packages/core/src/creative-pipeline/stages/run-stage.ts`                   | Wire storyboard stage, add fields to `StageInput`                            |
| Modify | `packages/core/src/creative-pipeline/creative-job-runner.ts`                | Add `ImageConfig` param, thread `imageGenerator` + `generateReferenceImages` |
| Modify | `packages/core/src/creative-pipeline/index.ts`                              | Export new modules                                                           |
| Modify | `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`           | Update storyboard test to use real implementation                            |
| Modify | `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts` | Add `imageConfig` to all calls, test threading                               |
| Modify | `apps/api/src/bootstrap/inngest.ts`                                         | Read `OPENAI_API_KEY`, pass `imageConfig`                                    |
| Modify | `apps/api/src/routes/creative-pipeline.ts`                                  | Pass `generateReferenceImages` to job creation                               |
| Modify | `packages/core/package.json`                                                | Add `openai` dependency                                                      |
| Modify | `.env.example`                                                              | Add `OPENAI_API_KEY`                                                         |

---

### Task 1: Schema & Data Model Changes

**Files:**

- Modify: `packages/schemas/src/creative-job.ts:154-163` (CreativeBriefInput) and `:167-185` (CreativeJobSchema)
- Modify: `packages/db/prisma/schema.prisma:870-895` (CreativeJob model)
- Modify: `packages/db/src/stores/prisma-creative-job-store.ts:5-16` (CreateCreativeJobInput)

- [ ] **Step 1: Add `generateReferenceImages` to `CreativeBriefInput` Zod schema**

In `packages/schemas/src/creative-job.ts`, add after the `references` field (line 160):

```typescript
export const CreativeBriefInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(CreativePlatform).min(1),
  brandVoice: z.string().nullable().optional(),
  productImages: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  pastPerformance: z.record(z.unknown()).nullable().optional(),
  generateReferenceImages: z.boolean().default(false),
});
```

- [ ] **Step 2: Add `generateReferenceImages` to `CreativeJobSchema`**

In the same file, add after `pastPerformance` (line 178):

```typescript
export const CreativeJobSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  productDescription: z.string(),
  targetAudience: z.string(),
  platforms: z.array(z.string()),
  brandVoice: z.string().nullable(),
  productImages: z.array(z.string()),
  references: z.array(z.string()),
  pastPerformance: z.record(z.unknown()).nullable(),
  generateReferenceImages: z.boolean(),
  currentStage: CreativeJobStage,
  stageOutputs: z.record(z.unknown()),
  stoppedAt: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
```

- [ ] **Step 3: Add Prisma column**

In `packages/db/prisma/schema.prisma`, add after `pastPerformance Json?` (line 883):

```prisma
generateReferenceImages  Boolean  @default(false)
```

- [ ] **Step 4: Add to `CreateCreativeJobInput` in the store**

In `packages/db/src/stores/prisma-creative-job-store.ts`, add to the interface (line 15):

```typescript
interface CreateCreativeJobInput {
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  generateReferenceImages: boolean;
}
```

And add it to the `create` method's `data` object (after line 40):

```typescript
generateReferenceImages: input.generateReferenceImages,
```

- [ ] **Step 5: Run Prisma migration**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 db:generate
```

Then create the migration:

```bash
cd /Users/jasonljc/switchboard/packages/db && npx prisma migrate dev --name add_generate_reference_images
```

- [ ] **Step 6: Verify typecheck passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(schemas): add generateReferenceImages to CreativeJob model and schemas"
```

---

### Task 2: ImageGenerator Interface + DALL-E 3 Implementation

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/image-generator.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/image-generator.test.ts`
- Modify: `packages/core/package.json` (add `openai` dependency)

- [ ] **Step 1: Install `openai` package**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core add openai
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/creative-pipeline/__tests__/image-generator.test.ts`:

```typescript
// packages/core/src/creative-pipeline/__tests__/image-generator.test.ts
import { describe, it, expect, vi } from "vitest";
import { DalleImageGenerator } from "../stages/image-generator.js";

const mockGenerate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    images: { generate: mockGenerate },
  })),
}));

describe("DalleImageGenerator", () => {
  it("returns image URL on successful generation", async () => {
    mockGenerate.mockResolvedValue({
      data: [{ url: "https://oaidalleapiprodscus.blob.core.windows.net/image.png" }],
    });

    const generator = new DalleImageGenerator("test-openai-key");
    const url = await generator.generate("A product photo on white background");

    expect(url).toBe("https://oaidalleapiprodscus.blob.core.windows.net/image.png");
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "dall-e-3",
        prompt: "A product photo on white background",
        n: 1,
        size: "1024x1024",
        style: "vivid",
      }),
    );
  });

  it("throws when API returns no image data", async () => {
    mockGenerate.mockResolvedValue({ data: [] });

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow(
      "No image data returned from DALL-E",
    );
  });

  it("throws when API returns no URL", async () => {
    mockGenerate.mockResolvedValue({ data: [{ url: undefined }] });

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow(
      "No image URL returned from DALL-E",
    );
  });

  it("propagates OpenAI SDK errors", async () => {
    mockGenerate.mockRejectedValue(new Error("429 Too Many Requests"));

    const generator = new DalleImageGenerator("test-openai-key");
    await expect(generator.generate("test prompt")).rejects.toThrow("429 Too Many Requests");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/image-generator.test.ts
```

Expected: FAIL — `image-generator.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/creative-pipeline/stages/image-generator.ts`:

```typescript
// packages/core/src/creative-pipeline/stages/image-generator.ts
import OpenAI from "openai";

/**
 * Pluggable interface for image generation.
 * Implementations return a URL to the generated image.
 */
export interface ImageGenerator {
  generate(prompt: string): Promise<string>;
}

/**
 * DALL-E 3 implementation of ImageGenerator.
 * Generates 1024x1024 images in "vivid" style using the OpenAI SDK.
 */
export class DalleImageGenerator implements ImageGenerator {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(prompt: string): Promise<string> {
    const response = await this.client.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      style: "vivid",
    });

    const imageData = response.data[0];
    if (!imageData) {
      throw new Error("No image data returned from DALL-E");
    }

    if (!imageData.url) {
      throw new Error("No image URL returned from DALL-E");
    }

    return imageData.url;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/image-generator.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/image-generator.ts packages/core/src/creative-pipeline/__tests__/image-generator.test.ts packages/core/package.json && git commit -m "feat: add ImageGenerator interface and DalleImageGenerator implementation"
```

---

### Task 3: Storyboard Builder Stage

**Files:**

- Create: `packages/core/src/creative-pipeline/stages/storyboard-builder.ts`
- Create: `packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts`:

```typescript
// packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runStoryboardBuilder, buildStoryboardPrompt } from "../stages/storyboard-builder.js";
import type { ScriptWriterOutput, StoryboardOutput } from "@switchboard/schemas";
import type { ImageGenerator } from "../stages/image-generator.js";

vi.mock("../stages/call-claude.js", () => ({
  callClaude: vi.fn(),
}));

const mockScripts: ScriptWriterOutput = {
  scripts: [
    {
      hookRef: "0",
      fullScript: "Hook text. Problem text. Solution text. Proof text. CTA text.",
      timing: [
        { section: "hook", startSec: 0, endSec: 3, content: "Stop scrolling!" },
        { section: "problem", startSec: 3, endSec: 8, content: "You waste hours scheduling." },
        { section: "solution", startSec: 8, endSec: 18, content: "Our AI handles it all." },
        { section: "proof", startSec: 18, endSec: 25, content: "10k businesses trust us." },
        { section: "cta", startSec: 25, endSec: 30, content: "Try free for 14 days." },
      ],
      format: "feed_video",
      platform: "meta",
      productionNotes: "Use bright colors",
    },
  ],
};

const mockStoryboardOutput: StoryboardOutput = {
  storyboards: [
    {
      scriptRef: "0",
      scenes: [
        {
          sceneNumber: 1,
          description: "Close-up of frustrated business owner",
          visualDirection: "Tight face shot, warm lighting, shallow DOF",
          duration: 3,
          textOverlay: "Sound familiar?",
          referenceImageUrl: null,
        },
        {
          sceneNumber: 2,
          description: "Screen showing the AI scheduling interface",
          visualDirection: "Over-the-shoulder shot, cool blue tones, screen recording",
          duration: 5,
          textOverlay: null,
          referenceImageUrl: null,
        },
        {
          sceneNumber: 3,
          description: "Happy business owner checking phone",
          visualDirection: "Medium shot, natural lighting, candid feel",
          duration: 7,
          textOverlay: "10k+ businesses",
          referenceImageUrl: null,
        },
        {
          sceneNumber: 4,
          description: "Logo and CTA card",
          visualDirection: "Clean white background, brand colors, centered text",
          duration: 5,
          textOverlay: "Try free for 14 days",
          referenceImageUrl: null,
        },
      ],
    },
  ],
};

describe("buildStoryboardPrompt", () => {
  it("includes product description and scripts in user message", () => {
    const { systemPrompt, userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
    );

    expect(systemPrompt).toContain("storyboard");
    expect(systemPrompt).toContain("scene");
    expect(systemPrompt).toContain("visualDirection");
    expect(userMessage).toContain("AI scheduling tool");
    expect(userMessage).toContain("Stop scrolling!");
    expect(userMessage).toContain("hook");
  });

  it("includes product images when provided", () => {
    const { userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
        productImages: ["https://example.com/product1.jpg", "https://example.com/product2.jpg"],
      },
      mockScripts,
    );

    expect(userMessage).toContain("https://example.com/product1.jpg");
    expect(userMessage).toContain("https://example.com/product2.jpg");
  });

  it("omits product images section when none provided", () => {
    const { userMessage } = buildStoryboardPrompt(
      {
        productDescription: "AI tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
    );

    expect(userMessage).not.toContain("Product Images");
  });
});

describe("runStoryboardBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Claude and returns storyboard output without images", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
    );

    expect(result.storyboards).toHaveLength(1);
    expect(result.storyboards[0]?.scenes).toHaveLength(4);
    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBeNull();
    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        schema: expect.anything(),
        maxTokens: 8192,
      }),
    );
  });

  it("generates images per scene when imageGenerator is provided", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const mockImageGenerator: ImageGenerator = {
      generate: vi
        .fn()
        .mockResolvedValueOnce("https://dalle.example.com/scene1.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene2.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene3.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene4.png"),
    };

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      mockImageGenerator,
    );

    expect(mockImageGenerator.generate).toHaveBeenCalledTimes(4);
    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene1.png",
    );
    expect(result.storyboards[0]?.scenes[3]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene4.png",
    );
  });

  it("sets referenceImageUrl to null when image gen fails for a scene", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const mockImageGenerator: ImageGenerator = {
      generate: vi
        .fn()
        .mockResolvedValueOnce("https://dalle.example.com/scene1.png")
        .mockRejectedValueOnce(new Error("429 Too Many Requests"))
        .mockResolvedValueOnce("https://dalle.example.com/scene3.png")
        .mockResolvedValueOnce("https://dalle.example.com/scene4.png"),
    };

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      mockImageGenerator,
    );

    expect(result.storyboards[0]?.scenes[0]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene1.png",
    );
    // Scene 2 failed — URL should be null, not throw
    expect(result.storyboards[0]?.scenes[1]?.referenceImageUrl).toBeNull();
    expect(result.storyboards[0]?.scenes[2]?.referenceImageUrl).toBe(
      "https://dalle.example.com/scene3.png",
    );
  });

  it("does not call image generator when none provided", async () => {
    const { callClaude } = await import("../stages/call-claude.js");
    const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;
    mockCallClaude.mockResolvedValue(mockStoryboardOutput);

    const result = await runStoryboardBuilder(
      {
        productDescription: "AI scheduling tool",
        targetAudience: "SMBs",
        platforms: ["meta"],
      },
      mockScripts,
      "test-api-key",
      // no imageGenerator
    );

    // All scenes should have null referenceImageUrl
    for (const scene of result.storyboards[0]?.scenes ?? []) {
      expect(scene.referenceImageUrl).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/storyboard-builder.test.ts
```

Expected: FAIL — `storyboard-builder.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/creative-pipeline/stages/storyboard-builder.ts`:

```typescript
// packages/core/src/creative-pipeline/stages/storyboard-builder.ts
import { callClaude } from "./call-claude.js";
import { StoryboardOutput } from "@switchboard/schemas";
import type { ScriptWriterOutput } from "@switchboard/schemas";
import type { ImageGenerator } from "./image-generator.js";

interface StoryboardBrief {
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  productImages?: string[];
}

export function buildStoryboardPrompt(
  brief: StoryboardBrief,
  scriptsOutput: ScriptWriterOutput,
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `You are an expert creative director who transforms ad scripts into detailed scene-by-scene storyboards with precise visual direction.

Your job is to break each script into 4-6 scenes, mapping to the script's timing structure. Each scene gets detailed visual direction that a production team can execute.

## Scene Mapping

Map script sections to scenes:
- **Hook** section → Scene 1 (the scroll-stopper)
- **Problem** section → Scene 2 (visualize the pain)
- **Solution** section → Scenes 3-4 (show the product in action)
- **Proof** section → Scene 4-5 (social proof, results)
- **CTA** section → Final scene (clear call to action)

Combine or split sections as needed to hit 4-6 scenes per script.

## Visual Direction

For each scene, specify:
- **Camera angle:** wide, medium, close-up, over-the-shoulder, POV, etc.
- **Lighting:** natural, studio, warm, cool, dramatic, etc.
- **Mood:** energetic, calm, urgent, aspirational, etc.
- **Composition:** rule of thirds, centered, leading lines, etc.
- **Talent direction:** facial expression, action, positioning

## Output Format

Return a JSON object with exactly this structure:

{
  "storyboards": [
    {
      "scriptRef": "0",
      "scenes": [
        {
          "sceneNumber": 1,
          "description": "What happens in this scene",
          "visualDirection": "Camera: close-up. Lighting: warm overhead. Mood: frustrated. Composition: centered face, blurred background. Talent: furrowed brow, looking at phone.",
          "duration": 3,
          "textOverlay": "Text shown on screen, or null if none",
          "referenceImageUrl": null
        }
      ]
    }
  ]
}

Guidelines:
- Create one storyboard per script
- 4-6 scenes per storyboard
- Scene durations should roughly match the script timing sections
- Total scene durations should sum to the script's total duration
- textOverlay is null when no text appears on screen
- referenceImageUrl is always null (images are generated separately)
- Be specific and actionable in visual direction — avoid vague terms
- Respond ONLY with the JSON object`;

  const scriptDetails = scriptsOutput.scripts
    .map((script, idx) => {
      const timingDetails = script.timing
        .map((t) => `  - ${t.section} (${t.startSec}s-${t.endSec}s): ${t.content}`)
        .join("\n");

      return `**Script ${idx} (${script.format}, ${script.platform}):**
Hook: "${script.timing.find((t) => t.section === "hook")?.content ?? ""}"
Full timing:
${timingDetails}
Production notes: ${script.productionNotes}`;
    })
    .join("\n\n");

  let userMessage = `Create storyboards for these scripts:

**Product:** ${brief.productDescription}
**Audience:** ${brief.targetAudience}
**Platforms:** ${brief.platforms.join(", ")}

${scriptDetails}`;

  if (brief.productImages && brief.productImages.length > 0) {
    userMessage += `\n\n**Product Images (incorporate into visual direction):**\n${brief.productImages.map((url) => `- ${url}`).join("\n")}`;
  }

  return { systemPrompt, userMessage };
}

export async function runStoryboardBuilder(
  brief: StoryboardBrief,
  scriptsOutput: ScriptWriterOutput,
  apiKey: string,
  imageGenerator?: ImageGenerator,
): Promise<StoryboardOutput> {
  const { systemPrompt, userMessage } = buildStoryboardPrompt(brief, scriptsOutput);

  const output = await callClaude({
    apiKey,
    systemPrompt,
    userMessage,
    schema: StoryboardOutput,
    maxTokens: 8192,
  });

  // If no image generator, return Claude output as-is (all referenceImageUrl are null)
  if (!imageGenerator) {
    return output;
  }

  // Generate reference images for each scene
  for (const storyboard of output.storyboards) {
    for (const scene of storyboard.scenes) {
      try {
        const imagePrompt = `Ad scene reference image: ${scene.description}. Visual style: ${scene.visualDirection}. Product: ${brief.productDescription}. Platform: ${brief.platforms.join(", ")}.`;
        scene.referenceImageUrl = await imageGenerator.generate(imagePrompt);
      } catch (err) {
        console.warn(
          `Image generation failed for scene ${scene.sceneNumber}: ${err instanceof Error ? err.message : String(err)}`,
        );
        scene.referenceImageUrl = null;
      }
    }
  }

  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/storyboard-builder.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/storyboard-builder.ts packages/core/src/creative-pipeline/__tests__/storyboard-builder.test.ts && git commit -m "feat: add storyboard builder stage with optional image generation"
```

---

### Task 4: Wire Storyboard Stage into run-stage.ts

**Files:**

- Modify: `packages/core/src/creative-pipeline/stages/run-stage.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`

- [ ] **Step 1: Update `StageInput` interface and wire storyboard case**

In `packages/core/src/creative-pipeline/stages/run-stage.ts`:

1. Add imports at top:

```typescript
import { runStoryboardBuilder } from "./storyboard-builder.js";
import type { ImageGenerator } from "./image-generator.js";
```

2. Update `StageInput` interface to add `productImages` to brief and top-level fields:

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
}
```

3. Replace the storyboard stub (lines 89-106) with:

```typescript
    case "storyboard": {
      const rawScripts = input.previousOutputs["scripts"];
      if (!rawScripts) throw new Error("storyboard stage requires scripts output");
      const scripts = ScriptWriterOutput.parse(rawScripts);
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

- [ ] **Step 2: Update run-stage tests**

In `packages/core/src/creative-pipeline/__tests__/run-stage.test.ts`:

Add `ScriptWriterOutput` to the import (line 4):

```typescript
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
} from "@switchboard/schemas";
```

Add a mock scripts output after `mockHooksOutput`:

```typescript
const mockScriptsOutput: ScriptWriterOutput = {
  scripts: [
    {
      hookRef: "0",
      fullScript: "Script text",
      timing: [
        { section: "hook", startSec: 0, endSec: 3, content: "Stop scrolling" },
        { section: "problem", startSec: 3, endSec: 8, content: "Problem" },
        { section: "solution", startSec: 8, endSec: 18, content: "Solution" },
        { section: "proof", startSec: 18, endSec: 25, content: "Proof" },
        { section: "cta", startSec: 25, endSec: 30, content: "CTA" },
      ],
      format: "feed_video",
      platform: "meta",
      productionNotes: "Notes",
    },
  ],
};
```

Replace the placeholder storyboard test (line 98-101) with:

```typescript
it("runs storyboard stage via Claude with scripts output", async () => {
  const { callClaude } = await import("../stages/call-claude.js");
  (callClaude as ReturnType<typeof vi.fn>).mockResolvedValue({
    storyboards: [
      {
        scriptRef: "0",
        scenes: [
          {
            sceneNumber: 1,
            description: "Scene 1",
            visualDirection: "Close-up",
            duration: 3,
            textOverlay: null,
            referenceImageUrl: null,
          },
        ],
      },
    ],
  });

  const result = await runStage("storyboard", {
    ...baseInput,
    previousOutputs: { scripts: mockScriptsOutput },
  });

  expect(result).toHaveProperty("storyboards");
});

it("throws if storyboard stage missing scripts output", async () => {
  await expect(runStage("storyboard", baseInput)).rejects.toThrow("requires scripts output");
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/run-stage.test.ts
```

Expected: All tests PASS. The storyboard test now uses real implementation (with mocked callClaude).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/stages/run-stage.ts packages/core/src/creative-pipeline/__tests__/run-stage.test.ts && git commit -m "feat: wire storyboard builder into run-stage dispatcher"
```

---

### Task 5: Thread ImageConfig Through DI Chain

**Files:**

- Modify: `packages/core/src/creative-pipeline/creative-job-runner.ts`
- Modify: `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`

- [ ] **Step 1: Update creative-job-runner.ts**

Add import for `ImageGenerator` and `DalleImageGenerator` at top:

```typescript
import { DalleImageGenerator } from "./stages/image-generator.js";
import type { ImageGenerator } from "./stages/image-generator.js";
```

Add `ImageConfig` interface after `LLMConfig`:

```typescript
interface ImageConfig {
  openaiApiKey?: string;
}
```

Update `executeCreativePipeline` signature to accept `imageConfig`:

```typescript
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
): Promise<void> {
```

Inside the function, after loading the job, create the image generator conditionally:

```typescript
// Create image generator if configured and job requests it
let imageGenerator: ImageGenerator | undefined;
if (imageConfig?.openaiApiKey && job.generateReferenceImages) {
  imageGenerator = new DalleImageGenerator(imageConfig.openaiApiKey);
}
```

Update the `runStage` call inside the loop to pass new fields. Replace the existing call (lines 59-71):

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
  }),
);
```

Update `createCreativeJobRunner` to accept and pass `imageConfig`:

```typescript
export function createCreativeJobRunner(
  jobStore: JobStore,
  llmConfig: LLMConfig,
  imageConfig?: ImageConfig,
) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/job.submitted" }],
    },
    async ({ event, step }: { event: { data: JobEventData }; step: StepTools }) => {
      await executeCreativePipeline(event.data, step, jobStore, llmConfig, imageConfig);
    },
  );
}
```

- [ ] **Step 2: Update creative-job-runner tests**

In `packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts`:

Add a mock for `image-generator.js` after the existing `run-stage.js` mock (to avoid instantiating a real OpenAI client in tests):

```typescript
vi.mock("../stages/image-generator.js", () => ({
  DalleImageGenerator: vi.fn(() => ({
    generate: vi.fn().mockResolvedValue("https://dalle.example.com/mock.png"),
  })),
}));
```

Add `generateReferenceImages` to `mockJob`:

```typescript
const mockJob = {
  id: "job_1",
  taskId: "task_1",
  organizationId: "org_1",
  deploymentId: "dep_1",
  productDescription: "AI scheduling tool",
  targetAudience: "Small business owners",
  platforms: ["meta"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  generateReferenceImages: false,
  currentStage: "trends",
  stageOutputs: {},
  stoppedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

Update all existing `executeCreativePipeline` calls — the 5th arg is optional so existing calls still work. But add a new test for imageConfig threading:

```typescript
it("passes imageConfig through when job has generateReferenceImages", async () => {
  const jobWithImages = { ...mockJob, generateReferenceImages: true };
  jobStore.findById.mockResolvedValue(jobWithImages);

  const { runStage } = await import("../stages/run-stage.js");
  const mockRunStage = runStage as ReturnType<typeof vi.fn>;

  await executeCreativePipeline(jobData, step as never, jobStore as never, llmConfig, {
    openaiApiKey: "test-openai-key",
  });

  // Verify that runStage was called with generateReferenceImages and imageGenerator
  const storyboardCall = mockRunStage.mock.calls.find(
    (call: unknown[]) => call[0] === "storyboard",
  );
  expect(storyboardCall).toBeDefined();
  expect(storyboardCall?.[1]).toMatchObject({
    generateReferenceImages: true,
    imageGenerator: expect.objectContaining({ generate: expect.any(Function) }),
  });
});

it("does not create imageGenerator when openaiApiKey not set", async () => {
  const jobWithImages = { ...mockJob, generateReferenceImages: true };
  jobStore.findById.mockResolvedValue(jobWithImages);

  const { runStage } = await import("../stages/run-stage.js");
  const mockRunStage = runStage as ReturnType<typeof vi.fn>;

  await executeCreativePipeline(
    jobData,
    step as never,
    jobStore as never,
    llmConfig,
    // no openaiApiKey
  );

  const storyboardCall = mockRunStage.mock.calls.find(
    (call: unknown[]) => call[0] === "storyboard",
  );
  expect(storyboardCall?.[1]?.imageGenerator).toBeUndefined();
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/__tests__/creative-job-runner.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/creative-pipeline/creative-job-runner.ts packages/core/src/creative-pipeline/__tests__/creative-job-runner.test.ts && git commit -m "feat: thread ImageConfig through creative pipeline DI chain"
```

---

### Task 6: API, Store, and Inngest Wiring

**Files:**

- Modify: `apps/api/src/routes/creative-pipeline.ts:52-63`
- Modify: `apps/api/src/bootstrap/inngest.ts`
- Modify: `packages/core/src/creative-pipeline/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update API route to pass `generateReferenceImages`**

In `apps/api/src/routes/creative-pipeline.ts`, update the `jobStore.create()` call (line 52-63) to include the new field:

```typescript
const job = await jobStore.create({
  taskId: task.id,
  organizationId: orgId,
  deploymentId,
  productDescription: brief.productDescription,
  targetAudience: brief.targetAudience,
  platforms: brief.platforms,
  brandVoice: brief.brandVoice ?? null,
  productImages: brief.productImages,
  references: brief.references,
  pastPerformance: brief.pastPerformance ?? null,
  generateReferenceImages: brief.generateReferenceImages ?? false,
});
```

- [ ] **Step 2: Update inngest.ts to read OPENAI_API_KEY and pass imageConfig**

Replace `apps/api/src/bootstrap/inngest.ts`:

```typescript
// apps/api/src/bootstrap/inngest.ts
import type { FastifyInstance } from "fastify";
import inngestFastify from "inngest/fastify";
import { PrismaCreativeJobStore } from "@switchboard/db";
import { inngestClient, createCreativeJobRunner } from "@switchboard/core/creative-pipeline";

export async function registerInngest(app: FastifyInstance): Promise<void> {
  if (!app.prisma) {
    app.log.warn("Inngest: skipping registration — no database connection");
    return;
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    app.log.warn(
      "Inngest: ANTHROPIC_API_KEY not set — creative pipeline stages will fail at runtime",
    );
  }

  const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";
  if (!openaiApiKey) {
    app.log.warn("Inngest: OPENAI_API_KEY not set — storyboard image generation will be skipped");
  }

  const jobStore = new PrismaCreativeJobStore(app.prisma);

  await app.register(inngestFastify, {
    client: inngestClient,
    functions: [
      createCreativeJobRunner(jobStore, { apiKey }, openaiApiKey ? { openaiApiKey } : undefined),
    ],
  });

  app.log.info("Inngest serve handler registered at /api/inngest");
}
```

- [ ] **Step 3: Update index.ts exports**

In `packages/core/src/creative-pipeline/index.ts`, add:

```typescript
export { runStoryboardBuilder, buildStoryboardPrompt } from "./stages/storyboard-builder.js";
export { DalleImageGenerator } from "./stages/image-generator.js";
export type { ImageGenerator } from "./stages/image-generator.js";
```

- [ ] **Step 4: Add OPENAI_API_KEY to .env.example**

In `.env.example`, add after `ANTHROPIC_API_KEY=` (line 53):

```
# OpenAI — reference image generation for storyboard stage (optional)
OPENAI_API_KEY=
```

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

- [ ] **Step 6: Run all creative pipeline tests**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/creative-pipeline/
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/creative-pipeline.ts apps/api/src/bootstrap/inngest.ts packages/core/src/creative-pipeline/index.ts .env.example && git commit -m "feat: wire storyboard image generation through API and Inngest"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck
```

Expected: No errors.

- [ ] **Step 3: Run lint**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 lint
```

Expected: No errors.
