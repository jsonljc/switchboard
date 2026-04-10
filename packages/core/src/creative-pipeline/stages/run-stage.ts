// packages/core/src/creative-pipeline/stages/run-stage.ts
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
  StoryboardOutput,
  VideoProducerOutput,
} from "@switchboard/schemas";
import { runTrendAnalyzer } from "./trend-analyzer.js";
import { runHookGenerator } from "./hook-generator.js";
import { runScriptWriter } from "./script-writer.js";

export interface StageInput {
  jobId: string;
  brief: {
    productDescription: string;
    targetAudience: string;
    platforms: string[];
    brandVoice?: string | null;
  };
  previousOutputs: Record<string, unknown>;
  apiKey: string;
}

type StageOutput =
  | TrendAnalysisOutput
  | HookGeneratorOutput
  | ScriptWriterOutput
  | StoryboardOutput
  | VideoProducerOutput;

const STAGE_ORDER = ["trends", "hooks", "scripts", "storyboard", "production"] as const;
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
        },
        input.apiKey,
      );

    case "hooks": {
      const trendsOutput = input.previousOutputs["trends"] as TrendAnalysisOutput;
      if (!trendsOutput) throw new Error("hooks stage requires trends output");
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
      const trends = input.previousOutputs["trends"] as TrendAnalysisOutput;
      const hooks = input.previousOutputs["hooks"] as HookGeneratorOutput;
      if (!trends || !hooks) throw new Error("scripts stage requires trends and hooks output");
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

    case "storyboard":
      return {
        storyboards: [
          {
            scriptRef: "0",
            scenes: [
              {
                sceneNumber: 1,
                description: "[placeholder] Scene description — SP4",
                visualDirection: "placeholder",
                duration: 3,
                textOverlay: null,
                referenceImageUrl: null,
              },
            ],
          },
        ],
      };

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
