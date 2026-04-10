// packages/core/src/creative-pipeline/stages/run-stage.ts
import { TrendAnalysisOutput, HookGeneratorOutput, ScriptWriterOutput } from "@switchboard/schemas";
import type { StoryboardOutput, VideoProducerOutput } from "@switchboard/schemas";
import { runTrendAnalyzer } from "./trend-analyzer.js";
import { runHookGenerator } from "./hook-generator.js";
import { runScriptWriter } from "./script-writer.js";
import { runStoryboardBuilder } from "./storyboard-builder.js";
import type { ImageGenerator } from "./image-generator.js";

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

type StageOutput =
  | TrendAnalysisOutput
  | HookGeneratorOutput
  | ScriptWriterOutput
  | StoryboardOutput
  | VideoProducerOutput;

export const STAGE_ORDER = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export function getNextStage(current: StageName): StageName | "complete" {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return "complete";
  return STAGE_ORDER[idx + 1] as StageName;
}

/**
 * Dispatch a pipeline stage by name.
 * Stages 1-3 use Claude. Stages 4-5 remain as no-op stubs (SP4-SP5).
 */
export async function runStage(stage: string, input: StageInput): Promise<StageOutput> {
  switch (stage) {
    case "trends":
      return runTrendAnalyzer(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
          references: input.brief.references,
        },
        input.apiKey,
      );

    case "hooks": {
      const rawTrends = input.previousOutputs["trends"];
      if (!rawTrends) throw new Error("hooks stage requires trends output");
      const trendsOutput = TrendAnalysisOutput.parse(rawTrends);
      return runHookGenerator(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
        },
        trendsOutput,
        input.apiKey,
      );
    }

    case "scripts": {
      const rawTrends = input.previousOutputs["trends"];
      const rawHooks = input.previousOutputs["hooks"];
      if (!rawTrends || !rawHooks)
        throw new Error("scripts stage requires trends and hooks output");
      const trends = TrendAnalysisOutput.parse(rawTrends);
      const hooks = HookGeneratorOutput.parse(rawHooks);
      return runScriptWriter(
        {
          productDescription: input.brief.productDescription,
          targetAudience: input.brief.targetAudience,
          platforms: input.brief.platforms,
          brandVoice: input.brief.brandVoice ?? null,
        },
        trends,
        hooks,
        input.apiKey,
      );
    }

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

    case "production":
      return {
        videos: [
          {
            storyboardRef: "0",
            videoUrl: "https://placeholder.example.com/video.mp4",
            thumbnailUrl: "https://placeholder.example.com/thumb.jpg",
            format: "9:16",
            duration: 30,
            platform: "meta",
          },
        ],
        staticFallbacks: [],
      };

    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}
