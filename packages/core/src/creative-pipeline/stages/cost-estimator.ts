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

export interface StoryboardForEstimate {
  storyboards: Array<{
    scenes: Array<{
      duration: number;
    }>;
  }>;
}

export interface TierEstimate {
  cost: number;
  description: string;
}

export interface CostEstimates {
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
