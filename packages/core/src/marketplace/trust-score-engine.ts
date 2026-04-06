import type { AutonomyLevel, PriceTier, TrustScoreRecord } from "@switchboard/schemas";

export interface TrustScoreStore {
  getOrCreate(
    listingId: string,
    taskCategory: string,
    deploymentId?: string,
  ): Promise<TrustScoreRecord>;
  update(
    id: string,
    data: Partial<
      Pick<
        TrustScoreRecord,
        "score" | "totalApprovals" | "totalRejections" | "consecutiveApprovals" | "lastActivityAt"
      >
    >,
  ): Promise<TrustScoreRecord>;
  listByListing(listingId: string): Promise<TrustScoreRecord[]>;
  getAggregateScore(listingId: string): Promise<number>;
  getDeploymentScore?(deploymentId: string): Promise<number>;
}

export interface TrustThresholds {
  approvalPoints: number;
  rejectionPoints: number;
  streakBonusPerStep: number;
  streakBonusCap: number;
  scoreCeiling: number;
  scoreFloor: number;
  supervisedCeiling: number;
  guidedCeiling: number;
  autonomousFloor: number;
  freeCeiling: number;
  basicCeiling: number;
  proCeiling: number;
  eliteFloor: number;
}

export const DEFAULT_TRUST_THRESHOLDS: TrustThresholds = {
  approvalPoints: 3,
  rejectionPoints: 10,
  streakBonusPerStep: 0.5,
  streakBonusCap: 5,
  scoreCeiling: 100,
  scoreFloor: 0,
  supervisedCeiling: 29,
  guidedCeiling: 54,
  autonomousFloor: 55,
  freeCeiling: 29,
  basicCeiling: 54,
  proCeiling: 79,
  eliteFloor: 80,
};

export function scoreToAutonomyLevel(
  score: number,
  thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
): AutonomyLevel {
  if (score >= thresholds.autonomousFloor) return "autonomous";
  if (score > thresholds.supervisedCeiling) return "guided";
  return "supervised";
}

export function scoreToPriceTier(
  score: number,
  thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
): PriceTier {
  if (score >= thresholds.eliteFloor) return "elite";
  if (score > thresholds.basicCeiling) return "pro";
  if (score > thresholds.freeCeiling) return "basic";
  return "free";
}

export class TrustScoreEngine {
  constructor(
    private store: TrustScoreStore,
    private thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS,
  ) {}

  async recordApproval(
    listingId: string,
    taskCategory: string,
    deploymentId?: string,
  ): Promise<TrustScoreRecord> {
    const record = await this.store.getOrCreate(listingId, taskCategory, deploymentId);
    const streak = record.consecutiveApprovals + 1;
    const bonus = Math.min(
      streak * this.thresholds.streakBonusPerStep,
      this.thresholds.streakBonusCap,
    );
    const newScore = Math.min(
      record.score + this.thresholds.approvalPoints + bonus,
      this.thresholds.scoreCeiling,
    );

    return this.store.update(record.id, {
      score: newScore,
      totalApprovals: record.totalApprovals + 1,
      consecutiveApprovals: streak,
      lastActivityAt: new Date(),
    });
  }

  async recordRejection(
    listingId: string,
    taskCategory: string,
    deploymentId?: string,
  ): Promise<TrustScoreRecord> {
    const record = await this.store.getOrCreate(listingId, taskCategory, deploymentId);
    const newScore = Math.max(
      record.score - this.thresholds.rejectionPoints,
      this.thresholds.scoreFloor,
    );

    return this.store.update(record.id, {
      score: newScore,
      totalRejections: record.totalRejections + 1,
      consecutiveApprovals: 0,
      lastActivityAt: new Date(),
    });
  }

  async getAutonomyLevel(listingId: string, taskCategory: string): Promise<AutonomyLevel> {
    const record = await this.store.getOrCreate(listingId, taskCategory);
    return scoreToAutonomyLevel(record.score, this.thresholds);
  }

  async getPriceTier(listingId: string): Promise<PriceTier> {
    const avgScore = await this.store.getAggregateScore(listingId);
    return scoreToPriceTier(avgScore, this.thresholds);
  }

  async getScoreBreakdown(listingId: string): Promise<
    {
      category: string;
      score: number;
      autonomyLevel: AutonomyLevel;
      approvals: number;
      rejections: number;
    }[]
  > {
    const records = await this.store.listByListing(listingId);
    return records.map((r) => ({
      category: r.taskCategory,
      score: r.score,
      autonomyLevel: scoreToAutonomyLevel(r.score, this.thresholds),
      approvals: r.totalApprovals,
      rejections: r.totalRejections,
    }));
  }
}
