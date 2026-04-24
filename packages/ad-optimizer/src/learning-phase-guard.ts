// packages/core/src/ad-optimizer/learning-phase-guard.ts
import type {
  LearningPhaseStatusSchema as LearningPhaseStatus,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  CampaignLearningInput,
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

    let estimatedExitDate: Date | null = null;
    if (inLearning) {
      const remainingDays = LEARNING_DAYS - lastModifiedDays;
      estimatedExitDate = new Date(Date.now() + remainingDays * MS_PER_DAY);
    }

    return {
      campaignId,
      inLearning,
      daysSinceChange: lastModifiedDays,
      eventsAccumulated: optimizationEvents,
      eventsRequired: LEARNING_EVENTS_REQUIRED,
      estimatedExitDate,
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
    if (!status.inLearning) {
      return recommendation;
    }

    const { daysSinceChange, eventsAccumulated, eventsRequired, estimatedExitDate } = status;

    const checkBackDate = estimatedExitDate
      ? (estimatedExitDate.toISOString().split("T")[0] ?? "")
      : (new Date().toISOString().split("T")[0] ?? "");

    const message =
      `Campaign is in learning (Day ${daysSinceChange}/${LEARNING_DAYS}, ` +
      `${eventsAccumulated}/${eventsRequired} events). ` +
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
