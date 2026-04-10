// packages/schemas/src/creative-job.ts
import { z } from "zod";

// ── Enums ──

export const CreativeJobStage = z.enum([
  "trends",
  "hooks",
  "scripts",
  "storyboard",
  "production",
  "complete",
]);
export type CreativeJobStage = z.infer<typeof CreativeJobStage>;

export const CreativePlatform = z.enum(["meta", "youtube", "tiktok"]);
export type CreativePlatform = z.infer<typeof CreativePlatform>;

export const AwarenessLevel = z.enum([
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
]);
export type AwarenessLevel = z.infer<typeof AwarenessLevel>;

export const HookType = z.enum(["pattern_interrupt", "question", "bold_statement"]);
export type HookType = z.infer<typeof HookType>;

// ── Stage Outputs ──

export const TrendAnalysisOutput = z.object({
  angles: z.array(
    z.object({
      theme: z.string(),
      motivator: z.string(),
      platformFit: z.string(),
      rationale: z.string(),
    }),
  ),
  audienceInsights: z.object({
    awarenessLevel: AwarenessLevel,
    topDrivers: z.array(z.string()),
    objections: z.array(z.string()),
  }),
  trendSignals: z.array(
    z.object({
      platform: z.string(),
      trend: z.string(),
      relevance: z.string(),
    }),
  ),
});
export type TrendAnalysisOutput = z.infer<typeof TrendAnalysisOutput>;

export const HookGeneratorOutput = z.object({
  hooks: z.array(
    z.object({
      angleRef: z.string(),
      text: z.string(),
      type: HookType,
      platformScore: z.number(),
      rationale: z.string(),
    }),
  ),
  topCombos: z.array(
    z.object({
      angleRef: z.string(),
      hookRef: z.string(),
      score: z.number(),
    }),
  ),
});
export type HookGeneratorOutput = z.infer<typeof HookGeneratorOutput>;

export const AdFormat = z.enum(["feed_video", "stories", "skippable", "shorts"]);
export type AdFormat = z.infer<typeof AdFormat>;

export const ScriptSection = z.enum(["hook", "problem", "solution", "proof", "cta"]);
export type ScriptSection = z.infer<typeof ScriptSection>;

export const ScriptWriterOutput = z.object({
  scripts: z.array(
    z.object({
      hookRef: z.string(),
      fullScript: z.string(),
      timing: z.array(
        z.object({
          section: ScriptSection,
          startSec: z.number(),
          endSec: z.number(),
          content: z.string(),
        }),
      ),
      format: AdFormat,
      platform: z.string(),
      productionNotes: z.string(),
    }),
  ),
});
export type ScriptWriterOutput = z.infer<typeof ScriptWriterOutput>;

export const StoryboardOutput = z.object({
  storyboards: z.array(
    z.object({
      scriptRef: z.string(),
      scenes: z.array(
        z.object({
          sceneNumber: z.number(),
          description: z.string(),
          visualDirection: z.string(),
          duration: z.number(),
          textOverlay: z.string().nullable(),
          referenceImageUrl: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutput>;

export const VideoProducerOutput = z.object({
  videos: z.array(
    z.object({
      storyboardRef: z.string(),
      videoUrl: z.string(),
      thumbnailUrl: z.string(),
      format: z.string(),
      duration: z.number(),
      platform: z.string(),
    }),
  ),
  staticFallbacks: z.array(
    z.object({
      imageUrl: z.string(),
      platform: z.string(),
    }),
  ),
});
export type VideoProducerOutput = z.infer<typeof VideoProducerOutput>;

export const StageOutputs = z.object({
  trends: TrendAnalysisOutput.optional(),
  hooks: HookGeneratorOutput.optional(),
  scripts: ScriptWriterOutput.optional(),
  storyboard: StoryboardOutput.optional(),
  production: VideoProducerOutput.optional(),
});
export type StageOutputs = z.infer<typeof StageOutputs>;

// ── Creative Brief (input) ──

export const CreativeBriefInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(CreativePlatform).min(1),
  brandVoice: z.string().nullable().optional(),
  productImages: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  pastPerformance: z.record(z.unknown()).nullable().optional(),
});
export type CreativeBriefInput = z.infer<typeof CreativeBriefInput>;

// ── Creative Job (full record) ──

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
  currentStage: CreativeJobStage,
  stageOutputs: z.record(z.unknown()),
  stoppedAt: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CreativeJob = z.infer<typeof CreativeJobSchema>;
