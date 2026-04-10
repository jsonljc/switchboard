// packages/core/src/creative-pipeline/stages/run-stage.ts
import {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
  StoryboardOutput,
} from "@switchboard/schemas";
import type { VideoProducerOutput } from "@switchboard/schemas";
import { runTrendAnalyzer } from "./trend-analyzer.js";
import { runHookGenerator } from "./hook-generator.js";
import { runScriptWriter } from "./script-writer.js";
import { runStoryboardBuilder } from "./storyboard-builder.js";
import { runVideoProducer, createPromptOptimizer } from "./video-producer.js";
import type { VideoProducerDeps } from "./video-producer.js";
import { KlingClient } from "./kling-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { WhisperClient } from "./whisper-client.js";
import { VideoAssembler } from "./video-assembler.js";
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
  productionTier?: string;
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
 * Stages 1-4 use Claude. Stage 5 remains as a no-op stub (SP5).
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

    case "production": {
      const rawStoryboard = input.previousOutputs["storyboard"];
      const rawScripts = input.previousOutputs["scripts"];
      if (!rawStoryboard || !rawScripts) {
        throw new Error("production stage requires storyboard and scripts output");
      }
      const storyboard = StoryboardOutput.parse(rawStoryboard);
      const scripts = ScriptWriterOutput.parse(rawScripts);
      const tier = (input.productionTier ?? "basic") as "basic" | "pro";

      const klingClient = new KlingClient({ apiKey: process.env.KLING_API_KEY ?? "" });
      const deps: VideoProducerDeps = {
        klingClient,
        optimizePrompt: createPromptOptimizer(input.apiKey),
      };

      if (tier === "pro") {
        deps.elevenLabsClient = new ElevenLabsClient({
          apiKey: process.env.ELEVENLABS_API_KEY ?? "",
        });
        deps.whisperClient = new WhisperClient({
          apiKey: input.apiKey,
        });
        deps.videoAssembler = new VideoAssembler();
      }

      return runVideoProducer(
        {
          storyboard,
          scripts,
          tier,
          platforms: input.brief.platforms,
          productDescription: input.brief.productDescription,
        },
        deps,
      );
    }

    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}
