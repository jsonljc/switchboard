// ---------------------------------------------------------------------------
// Account Learning Profile — Per-account learning state management
// ---------------------------------------------------------------------------
// Manages account-level learning profiles that track creative patterns,
// constraint history durations, and calibration data from past interventions.
// ---------------------------------------------------------------------------

import type {
  AccountLearningProfile,
  CreativeAssetSummary,
  ConstraintType,
  Intervention,
  CreativePattern,
} from "@switchboard/schemas";
import type { AccountProfileStore } from "../stores/interfaces.js";
import { calibrateFromHistory } from "../outcome/calibrator.js";

// ---------------------------------------------------------------------------
// AccountProfileManager — Load, create, and update learning profiles
// ---------------------------------------------------------------------------

export interface AccountProfileDeps {
  accountProfileStore: AccountProfileStore;
}

export class AccountProfileManager {
  /**
   * Load an existing profile or create a default one.
   */
  async getOrCreate(
    accountId: string,
    organizationId: string,
    deps: AccountProfileDeps,
  ): Promise<AccountLearningProfile> {
    const existing = await deps.accountProfileStore.getByAccountId(accountId);
    if (existing) return existing;

    const profile: AccountLearningProfile = {
      accountId,
      organizationId,
      creativePatterns: [],
      constraintHistory: [],
      calibration: {},
      updatedAt: new Date().toISOString(),
    };

    await deps.accountProfileStore.save(profile);
    return profile;
  }

  /**
   * Update creative patterns from creative asset data.
   * Identifies top formats and hooks from the asset summary.
   */
  updateCreativePatterns(
    profile: AccountLearningProfile,
    creativeAssets: CreativeAssetSummary | null,
  ): AccountLearningProfile {
    if (!creativeAssets) return profile;

    const patterns: CreativePattern[] = [];

    // Derive format patterns from asset summary
    const diversityScore = creativeAssets.diversityScore ?? 0;
    const avgScore = creativeAssets.averageScore ?? 0;

    if (creativeAssets.activeAssets > 0) {
      // Top-performer pattern
      if (creativeAssets.topPerformerCount > 0) {
        patterns.push({
          format: "top-performer",
          performanceScore: Math.min(100, avgScore + 20),
          sampleSize: creativeAssets.topPerformerCount,
        });
      }

      // Diversity pattern — tracks how diverse the creative portfolio is
      patterns.push({
        format: "portfolio-diversity",
        performanceScore: diversityScore,
        sampleSize: creativeAssets.activeAssets,
      });

      // Fatigue pattern — tracks creative fatigue
      if (creativeAssets.fatigueRate !== null) {
        const fatigueScore = Math.max(0, 100 - creativeAssets.fatigueRate * 100);
        patterns.push({
          format: "fatigue-resistance",
          performanceScore: fatigueScore,
          sampleSize: creativeAssets.totalAssets,
        });
      }
    }

    return {
      ...profile,
      creativePatterns: patterns,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Track constraint durations — how long each constraint type has been primary.
   */
  updateConstraintHistory(
    profile: AccountLearningProfile,
    currentConstraint: ConstraintType | null,
    previousConstraint: ConstraintType | null,
  ): AccountLearningProfile {
    const now = new Date().toISOString();
    const history = [...profile.constraintHistory];

    // Close the previous constraint entry if the constraint changed
    if (previousConstraint && previousConstraint !== currentConstraint) {
      const openEntry = history.find(
        (h) => h.constraintType === previousConstraint && h.endedAt === null,
      );
      if (openEntry) {
        const idx = history.indexOf(openEntry);
        history[idx] = { ...openEntry, endedAt: now };
      }
    }

    // Open or extend the current constraint entry
    if (currentConstraint) {
      const openEntry = history.find(
        (h) => h.constraintType === currentConstraint && h.endedAt === null,
      );
      if (openEntry) {
        const idx = history.indexOf(openEntry);
        history[idx] = { ...openEntry, cycleCount: openEntry.cycleCount + 1 };
      } else {
        history.push({
          constraintType: currentConstraint,
          startedAt: now,
          endedAt: null,
          cycleCount: 1,
        });
      }
    }

    return {
      ...profile,
      constraintHistory: history,
      updatedAt: now,
    };
  }

  /**
   * Update calibration data from historical interventions.
   * Wraps the existing calibrateFromHistory() function.
   */
  updateCalibration(
    profile: AccountLearningProfile,
    interventions: Intervention[],
  ): AccountLearningProfile {
    const calibrationMap = calibrateFromHistory(interventions);
    const calibration: Record<
      string,
      { successRate: number; avgImprovement: number; totalCount: number }
    > = {};

    for (const [ct, entry] of calibrationMap) {
      calibration[ct] = {
        successRate: entry.successRate,
        avgImprovement: entry.avgImprovement,
        totalCount: entry.totalCount,
      };
    }

    return {
      ...profile,
      calibration,
      updatedAt: new Date().toISOString(),
    };
  }
}
