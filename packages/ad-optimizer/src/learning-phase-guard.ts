// packages/core/src/ad-optimizer/learning-phase-guard.ts
import type {
  LearningPhaseStatusSchema as LearningPhaseStatus,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  CampaignLearningInput,
  AdSetLearningInput,
} from "@switchboard/schemas";

// Re-export for backward compatibility
export type { CampaignLearningInput };

// ── Constants ──

const LEARNING_DAYS = 7;
const LEARNING_EVENTS_REQUIRED = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Input / Output Types ──

export interface PerformanceMetrics {
  cpa: number;
  roas: number;
}

export interface PerformanceTargets {
  targetCPA: number;
  targetROAS: number;
}

// ── Guard ──

export class LearningPhaseGuard {
  /**
   * Determine whether a campaign is in learning phase.
   *
   * inLearning is true if EITHER:
   *   - The API explicitly signals learning (input.learningPhase === true), OR
   *   - lastModifiedDays < LEARNING_DAYS AND optimizationEvents < LEARNING_EVENTS_REQUIRED
   */
  check(campaignId: string, input: CampaignLearningInput): LearningPhaseStatus {
    const { learningPhase, lastModifiedDays, optimizationEvents } = input;

    const dataSignalsLearning =
      lastModifiedDays < LEARNING_DAYS && optimizationEvents < LEARNING_EVENTS_REQUIRED;

    const inLearning = learningPhase || dataSignalsLearning;

    const state: LearningPhaseStatus["state"] = inLearning ? "learning" : "success";

    return {
      adSetId: campaignId,
      adSetName: campaignId,
      campaignId,
      state,
      metricsSnapshot: null,
      postExitSnapshot: null,
      exitStability: state === "success" ? "pending" : null,
    };
  }

  /**
   * Gate a recommendation based on learning phase status.
   *
   * If not in learning, the recommendation is passed through unchanged.
   * If in learning, the recommendation is converted to a WatchOutput.
   */
  gate(
    recommendation: RecommendationOutput,
    status: LearningPhaseStatus,
  ): RecommendationOutput | WatchOutput {
    if (status.state !== "learning") {
      return recommendation;
    }

    const checkBackDate =
      new Date(Date.now() + LEARNING_DAYS * MS_PER_DAY).toISOString().split("T")[0] ?? "";

    const message =
      `Campaign is in learning. ` +
      `${recommendation.action} recommendation held until learning completes.`;

    const watch: WatchOutput = {
      type: "watch",
      campaignId: recommendation.campaignId,
      campaignName: recommendation.campaignName,
      pattern: "in_learning_phase",
      message,
      checkBackDate,
    };

    return watch;
  }

  /**
   * Returns true when actual CPA is at or below target AND actual ROAS is at or above target.
   */
  isPerformingWell(metrics: PerformanceMetrics, targets: PerformanceTargets): boolean {
    return metrics.cpa <= targets.targetCPA && metrics.roas >= targets.targetROAS;
  }
}

// ── V2: Ad-set-level 3-state machine ──

export interface LearningLimitedDiagnosis {
  cause: "audience_too_narrow" | "underfunded" | "cost_constrained";
  recommendation: "expand_targeting" | "consolidate" | "review_budget";
}

const DESTRUCTIVE_ACTIONS = new Set(["pause", "restructure"]);

const STATE_MAP: Record<AdSetLearningInput["learningStageStatus"], LearningPhaseStatus["state"]> = {
  LEARNING: "learning",
  FAIL: "learning_limited",
  SUCCESS: "success",
  UNKNOWN: "unknown",
};

export class LearningPhaseGuardV2 {
  /**
   * Map API learning stage to a 3-state machine (learning, learning_limited, success, unknown).
   * Snapshots metrics for learning and learning_limited states.
   * Sets exitStability to "pending" for success state.
   */
  classifyState(input: AdSetLearningInput): LearningPhaseStatus {
    const state = STATE_MAP[input.learningStageStatus] ?? "unknown";

    const snapshotStates = new Set<string>(["learning", "learning_limited"]);
    const metricsSnapshot = snapshotStates.has(state)
      ? {
          cpa: input.cpa,
          roas: input.roas,
          ctr: input.ctr,
          spend: input.spend,
          conversions: input.conversions,
        }
      : null;

    const exitStability = state === "success" ? "pending" : null;

    return {
      adSetId: input.adSetId,
      adSetName: input.adSetName,
      campaignId: input.campaignId,
      state,
      metricsSnapshot,
      postExitSnapshot: null,
      exitStability,
    };
  }

  /** Returns true for actions that would reset learning phase. */
  isDestructiveAction(action: string): boolean {
    return DESTRUCTIVE_ACTIONS.has(action);
  }

  /**
   * Gate recommendations based on learning phase status.
   *
   * Only gates destructive actions during "learning" state.
   * Learning Limited, Success, and Unknown states pass through.
   */
  gate(
    recommendation: RecommendationOutput,
    status: LearningPhaseStatus,
  ): RecommendationOutput | WatchOutput {
    if (status.state !== "learning" || !this.isDestructiveAction(recommendation.action)) {
      return recommendation;
    }

    const checkBackDate = new Date(Date.now() + 3 * MS_PER_DAY).toISOString().split("T")[0] ?? "";

    const message =
      `Ad set "${status.adSetName}" is in learning. ` +
      `${recommendation.action} recommendation held until learning completes.`;

    return {
      type: "watch",
      campaignId: recommendation.campaignId,
      campaignName: recommendation.campaignName,
      pattern: "in_learning_phase",
      message,
      checkBackDate,
    };
  }

  /** Diagnose why an ad set is in learning_limited state. */
  diagnoseLearningLimited(
    _status: LearningPhaseStatus,
    input: AdSetLearningInput,
  ): LearningLimitedDiagnosis {
    if (input.frequency > 3.0) {
      return { cause: "audience_too_narrow", recommendation: "expand_targeting" };
    }
    if (input.spend < 100) {
      return { cause: "underfunded", recommendation: "consolidate" };
    }
    return { cause: "cost_constrained", recommendation: "review_budget" };
  }
}
