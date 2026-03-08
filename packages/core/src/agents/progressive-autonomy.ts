// ---------------------------------------------------------------------------
// Progressive Autonomy Controller
// ---------------------------------------------------------------------------
// Evaluates an organization's competence track record and recommends
// governance profile transitions. Bridges the CompetenceTracker scoring
// with the governance profile system.
//
// Progression:
//   guarded → observe → autonomous (opt-in)
//
// guarded:  All campaign changes require owner approval via Telegram.
//           Lead response is autonomous (no approval needed).
//
// observe:  Budget adjustments within ±20% are auto-approved.
//           New campaigns still require approval.
//           Owner gets notifications but doesn't need to approve routine changes.
//
// autonomous: Owner opts in to full autonomy.
//             All actions within risk tolerance are auto-executed.
//             Weekly report summarizes what was done.
//             Only high-risk actions (new campaign, >30% budget change) need approval.
// ---------------------------------------------------------------------------

import type { GovernanceProfile } from "@switchboard/schemas";

// ── Configuration ──────────────────────────────────────────────────────────

export interface AutonomyThresholds {
  /** Minimum successful adjustments to move guarded → observe. */
  observeMinSuccesses: number;
  /** Minimum successful adjustments to unlock autonomous option. */
  autonomousMinSuccesses: number;
  /** Minimum competence score to move guarded → observe. */
  observeMinScore: number;
  /** Minimum competence score to unlock autonomous option. */
  autonomousMinScore: number;
  /** Maximum failure rate (failures / total) to be eligible for promotion. */
  maxFailureRate: number;
}

export const DEFAULT_AUTONOMY_THRESHOLDS: AutonomyThresholds = {
  observeMinSuccesses: 10,
  autonomousMinSuccesses: 30,
  observeMinScore: 60,
  autonomousMinScore: 80,
  maxFailureRate: 0.15,
};

// ── Autonomy assessment result ──────────────────────────────────────────────

export interface AutonomyAssessment {
  /** Current governance profile. */
  currentProfile: GovernanceProfile;
  /** Recommended governance profile (may be same as current). */
  recommendedProfile: GovernanceProfile;
  /** Whether the owner can opt-in to autonomous mode. */
  autonomousEligible: boolean;
  /** Human-readable reason for the recommendation. */
  reason: string;
  /** Progress toward next level (0-100). */
  progressPercent: number;
  /** Summary stats used in assessment. */
  stats: {
    totalSuccesses: number;
    totalFailures: number;
    competenceScore: number;
    failureRate: number;
  };
}

// ── Competence snapshot (simplified input from CompetenceTracker) ────────────

export interface CompetenceSnapshot {
  score: number;
  successCount: number;
  failureCount: number;
  rollbackCount: number;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class ProgressiveAutonomyController {
  private thresholds: AutonomyThresholds;

  constructor(thresholds?: Partial<AutonomyThresholds>) {
    this.thresholds = { ...DEFAULT_AUTONOMY_THRESHOLDS, ...thresholds };
  }

  /**
   * Assess whether an organization should be promoted to a higher autonomy level.
   *
   * @param currentProfile - The org's current governance profile
   * @param competence - Aggregated competence stats across relevant action types
   * @param ownerOptedIntoAutonomous - Whether the owner has explicitly opted in
   */
  assess(
    currentProfile: GovernanceProfile,
    competence: CompetenceSnapshot,
    ownerOptedIntoAutonomous = false,
  ): AutonomyAssessment {
    const {
      observeMinSuccesses,
      autonomousMinSuccesses,
      observeMinScore,
      autonomousMinScore,
      maxFailureRate,
    } = this.thresholds;

    const totalActions =
      competence.successCount + competence.failureCount + competence.rollbackCount;
    const failureRate =
      totalActions > 0 ? (competence.failureCount + competence.rollbackCount) / totalActions : 0;

    const stats = {
      totalSuccesses: competence.successCount,
      totalFailures: competence.failureCount + competence.rollbackCount,
      competenceScore: competence.score,
      failureRate: Math.round(failureRate * 100) / 100,
    };

    const tooManyFailures = failureRate > maxFailureRate;

    // ── Locked → always stay locked (manual override required) ────────
    if (currentProfile === "locked") {
      return {
        currentProfile,
        recommendedProfile: "locked",
        autonomousEligible: false,
        reason: "Profile is locked. Manual override required to change.",
        progressPercent: 0,
        stats,
      };
    }

    // ── Strict → promote to guarded when score recovers ──────────────
    if (currentProfile === "strict") {
      if (competence.score >= observeMinScore && !tooManyFailures) {
        return {
          currentProfile,
          recommendedProfile: "guarded",
          autonomousEligible: false,
          reason: `Score recovered to ${competence.score.toFixed(0)}. Ready to move from strict to guarded.`,
          progressPercent: Math.min(100, Math.round((competence.score / observeMinScore) * 100)),
          stats,
        };
      }
      return {
        currentProfile,
        recommendedProfile: "strict",
        autonomousEligible: false,
        reason: `Score ${competence.score.toFixed(0)} below guarded threshold (${observeMinScore}). Staying strict.`,
        progressPercent: Math.min(100, Math.round((competence.score / observeMinScore) * 100)),
        stats,
      };
    }

    // ── Guarded → check for observe promotion ────────────────────────
    if (currentProfile === "guarded") {
      const meetsScore = competence.score >= observeMinScore;
      const meetsSuccesses = competence.successCount >= observeMinSuccesses;

      if (meetsScore && meetsSuccesses && !tooManyFailures) {
        return {
          currentProfile,
          recommendedProfile: "observe",
          autonomousEligible: false,
          reason: `${competence.successCount} successful adjustments with score ${competence.score.toFixed(0)}. Ready for observe mode.`,
          progressPercent: 100,
          stats,
        };
      }

      const scoreProgress = meetsScore ? 50 : Math.round((competence.score / observeMinScore) * 50);
      const successProgress = meetsSuccesses
        ? 50
        : Math.round((competence.successCount / observeMinSuccesses) * 50);

      let reason: string;
      if (tooManyFailures) {
        reason = `Failure rate ${(failureRate * 100).toFixed(0)}% exceeds ${(maxFailureRate * 100).toFixed(0)}% max. Need more consistent results.`;
      } else if (!meetsSuccesses) {
        reason = `${competence.successCount}/${observeMinSuccesses} successful adjustments toward observe mode.`;
      } else {
        reason = `Score ${competence.score.toFixed(0)}/${observeMinScore} toward observe mode.`;
      }

      return {
        currentProfile,
        recommendedProfile: "guarded",
        autonomousEligible: false,
        reason,
        progressPercent: scoreProgress + successProgress,
        stats,
      };
    }

    // ── Observe → check for autonomous eligibility ───────────────────
    if (currentProfile === "observe") {
      const meetsScore = competence.score >= autonomousMinScore;
      const meetsSuccesses = competence.successCount >= autonomousMinSuccesses;
      const eligible = meetsScore && meetsSuccesses && !tooManyFailures;

      // Demotion check: if score dropped significantly, demote back
      if (competence.score < this.thresholds.observeMinScore * 0.7) {
        return {
          currentProfile,
          recommendedProfile: "guarded",
          autonomousEligible: false,
          reason: `Score dropped to ${competence.score.toFixed(0)}. Reverting to guarded mode for safety.`,
          progressPercent: 0,
          stats,
        };
      }

      if (eligible && ownerOptedIntoAutonomous) {
        return {
          currentProfile,
          recommendedProfile: "observe", // autonomous maps to "observe" profile with different behavior
          autonomousEligible: true,
          reason: `Autonomous mode active. ${competence.successCount} successful adjustments, score ${competence.score.toFixed(0)}.`,
          progressPercent: 100,
          stats,
        };
      }

      if (eligible) {
        return {
          currentProfile,
          recommendedProfile: "observe",
          autonomousEligible: true,
          reason: `Autonomous mode available! ${competence.successCount} successful adjustments. Owner can opt-in.`,
          progressPercent: 100,
          stats,
        };
      }

      const scoreProgress = meetsScore
        ? 50
        : Math.round((competence.score / autonomousMinScore) * 50);
      const successProgress = meetsSuccesses
        ? 50
        : Math.round((competence.successCount / autonomousMinSuccesses) * 50);

      return {
        currentProfile,
        recommendedProfile: "observe",
        autonomousEligible: false,
        reason: `${competence.successCount}/${autonomousMinSuccesses} adjustments toward autonomous eligibility.`,
        progressPercent: scoreProgress + successProgress,
        stats,
      };
    }

    // Fallback (should not reach here)
    return {
      currentProfile,
      recommendedProfile: currentProfile,
      autonomousEligible: false,
      reason: "Unknown profile state.",
      progressPercent: 0,
      stats,
    };
  }

  /**
   * Format the assessment as a human-readable message for Telegram.
   */
  formatAssessment(assessment: AutonomyAssessment): string {
    const lines: string[] = [];

    if (assessment.recommendedProfile !== assessment.currentProfile) {
      lines.push(
        `\u{1F4C8} Autonomy upgrade available: ${assessment.currentProfile} \u{2192} ${assessment.recommendedProfile}`,
      );
    } else if (assessment.autonomousEligible) {
      lines.push("\u{1F680} Autonomous mode is now available! Reply /autonomous to enable.");
    }

    lines.push(assessment.reason);
    lines.push(`Progress: ${assessment.progressPercent}%`);

    return lines.join("\n");
  }
}
