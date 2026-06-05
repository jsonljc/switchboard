// packages/core/src/creative-pipeline/stages/cost-estimator.ts

/**
 * Approximate cost per Kling API call (5s clip).
 * Kling charges per generation, ~$0.35 per 5s clip (standard mode).
 * EXPORTED (slice-3 spec 3.3b): the provider router's ranking costs and the
 * production budget accumulator must agree with the governance estimate, so
 * these constants are the single source.
 */
export const KLING_COST_PER_5S = 0.35;
export const KLING_COST_PER_10S = 0.7;
/**
 * Approximate HeyGen cost per avatar clip (slice-3 spec 3.5): order $1/clip
 * at current API credit pricing for short-form avatar video. The router's
 * ranking table aligns to this constant (parity-tested).
 */
export const HEYGEN_COST_PER_CLIP = 1.0;
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

// ── UGC estimate (slice-3 spec 3.3b) ──

export interface UgcSpecForEstimate {
  renderTargets: { durationSec: number };
  providersAllowed: string[];
}

/**
 * Per-provider per-clip rate. Kling's boundary matches its adapter's
 * mapDuration (video-provider.ts): <=7s specs RENDER as 5s clips, so they
 * must be BILLED as 5s clips, or the governance estimate over-states 2x for
 * the 5-7s range scripting's midpoint durations commonly produce.
 */
function providerClipRate(provider: string, durationSec: number): number {
  if (provider === "heygen") return HEYGEN_COST_PER_CLIP;
  return durationSec > 7 ? KLING_COST_PER_10S : KLING_COST_PER_5S;
}

/**
 * UGC render cost: one clip per spec, billed at the MAX rate across the
 * spec's allowed providers (slice-3 spec 3.5: conservative parking; an
 * avatar-capable spec MAY render on heygen, so governance parks on the
 * dearest allowed rate and the operator never under-approves). This is the
 * governance spend signal for the approve-INTO-production continue and the
 * estimate readback; UGC is untiered.
 */
export function estimateUgcCost(specs: UgcSpecForEstimate[]): TierEstimate {
  if (specs.length === 0) {
    return { cost: 0, description: "No clips to produce" };
  }
  const cost = specs.reduce((sum, spec) => {
    const rates = spec.providersAllowed.map((p) =>
      providerClipRate(p, spec.renderTargets.durationSec),
    );
    return sum + (rates.length > 0 ? Math.max(...rates) : KLING_COST_PER_5S);
  }, 0);
  const providers = [...new Set(specs.flatMap((s) => s.providersAllowed))].sort().join(", ");
  return {
    cost: Math.round(cost * 100) / 100,
    description: `${specs.length} UGC clips via ${providers}`,
  };
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
