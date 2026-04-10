// packages/core/src/creative-pipeline/stages/run-stage.ts
import type {
  TrendAnalysisOutput,
  HookGeneratorOutput,
  ScriptWriterOutput,
  StoryboardOutput,
  VideoProducerOutput,
} from "@switchboard/schemas";

export interface StageInput {
  jobId: string;
  brief: {
    productDescription: string;
    targetAudience: string;
    platforms: string[];
  };
  previousOutputs: Record<string, unknown>;
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
 * Dispatch a pipeline stage by name. SP2: all stages return placeholder output.
 * SP3+ will replace each case with real Claude/API calls.
 */
export async function runStage(stage: string, _input: StageInput): Promise<StageOutput> {
  switch (stage) {
    case "trends":
      return {
        angles: [
          {
            theme: "[placeholder] Trend theme",
            motivator: "placeholder",
            platformFit: "meta",
            rationale: "SP2 no-op — real analysis in SP3",
          },
        ],
        audienceInsights: {
          awarenessLevel: "problem_aware" as const,
          topDrivers: ["placeholder"],
          objections: ["placeholder"],
        },
        trendSignals: [{ platform: "meta", trend: "placeholder", relevance: "SP2 no-op" }],
      };

    case "hooks":
      return {
        hooks: [
          {
            angleRef: "0",
            text: "[placeholder] Hook text",
            type: "pattern_interrupt" as const,
            platformScore: 0,
            rationale: "SP2 no-op — real generation in SP3",
          },
        ],
        topCombos: [{ angleRef: "0", hookRef: "0", score: 0 }],
      };

    case "scripts":
      return {
        scripts: [
          {
            hookRef: "0",
            fullScript: "[placeholder] Full script content",
            timing: [{ section: "hook", startSec: 0, endSec: 3, content: "placeholder" }],
            format: "feed_video",
            platform: "meta",
            productionNotes: "SP2 no-op — real script writing in SP3",
          },
        ],
      };

    case "storyboard":
      return {
        storyboards: [
          {
            scriptRef: "0",
            scenes: [
              {
                sceneNumber: 1,
                description: "[placeholder] Scene description",
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
