import { randomUUID } from "node:crypto";
import type {
  CompetenceRecord,
  CompetenceAdjustment,
  CompetenceThresholds,
  CompetenceEvent,
} from "@switchboard/schemas";
import type { CompetenceStore } from "../storage/interfaces.js";
import type { AuditLedger } from "../audit/ledger.js";

export const DEFAULT_COMPETENCE_THRESHOLDS: CompetenceThresholds = {
  promotionScore: 80,
  promotionMinSuccesses: 10,
  demotionScore: 40,
  successPoints: 3,
  failurePoints: 10,
  rollbackPoints: 15,
  streakBonusPerStep: 0.5,
  streakBonusCap: 5,
  decayPointsPerDay: 2,
  scoreCeiling: 100,
  scoreFloor: 0,
};

export class CompetenceTracker {
  private store: CompetenceStore;
  private ledger: AuditLedger | null;

  constructor(store: CompetenceStore, ledger?: AuditLedger) {
    this.store = store;
    this.ledger = ledger ?? null;
  }

  async recordSuccess(principalId: string, actionType: string): Promise<void> {
    const thresholds = await this.getThresholds(actionType);
    const record = await this.getOrCreateRecord(principalId, actionType);
    const previousScore = record.score;

    record.successCount += 1;
    record.consecutiveSuccesses += 1;
    const streakBonus = Math.min(
      record.consecutiveSuccesses * thresholds.streakBonusPerStep,
      thresholds.streakBonusCap,
    );
    record.score = Math.min(
      record.score + thresholds.successPoints + streakBonus,
      thresholds.scoreCeiling,
    );
    record.lastActivityAt = new Date();
    record.lastDecayAppliedAt = new Date();
    record.updatedAt = new Date();

    // Check promotion
    if (
      previousScore < thresholds.promotionScore &&
      record.score >= thresholds.promotionScore &&
      record.successCount >= thresholds.promotionMinSuccesses
    ) {
      const event: CompetenceEvent = {
        type: "promoted",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: `Reached promotion threshold (score=${record.score.toFixed(1)}, successes=${record.successCount})`,
      };
      record.history.push(event);
      await this.audit("competence.promoted", principalId, actionType, record);
    } else {
      const event: CompetenceEvent = {
        type: "score_updated",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: `Success recorded (streak=${record.consecutiveSuccesses})`,
      };
      record.history.push(event);
    }

    await this.store.saveRecord(record);
  }

  async recordFailure(principalId: string, actionType: string): Promise<void> {
    const thresholds = await this.getThresholds(actionType);
    const record = await this.getOrCreateRecord(principalId, actionType);
    const previousScore = record.score;

    record.failureCount += 1;
    record.consecutiveSuccesses = 0;
    record.score = Math.max(
      record.score - thresholds.failurePoints,
      thresholds.scoreFloor,
    );
    record.lastActivityAt = new Date();
    record.lastDecayAppliedAt = new Date();
    record.updatedAt = new Date();

    // Check demotion
    if (
      previousScore >= thresholds.demotionScore &&
      record.score < thresholds.demotionScore
    ) {
      const event: CompetenceEvent = {
        type: "demoted",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: `Dropped below demotion threshold (score=${record.score.toFixed(1)})`,
      };
      record.history.push(event);
      await this.audit("competence.demoted", principalId, actionType, record);
    } else {
      const event: CompetenceEvent = {
        type: "score_updated",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: "Failure recorded",
      };
      record.history.push(event);
    }

    await this.store.saveRecord(record);
  }

  async recordRollback(principalId: string, actionType: string): Promise<void> {
    const thresholds = await this.getThresholds(actionType);
    const record = await this.getOrCreateRecord(principalId, actionType);
    const previousScore = record.score;

    record.rollbackCount += 1;
    record.consecutiveSuccesses = 0;
    record.score = Math.max(
      record.score - thresholds.rollbackPoints,
      thresholds.scoreFloor,
    );
    record.lastActivityAt = new Date();
    record.lastDecayAppliedAt = new Date();
    record.updatedAt = new Date();

    // Check demotion
    if (
      previousScore >= thresholds.demotionScore &&
      record.score < thresholds.demotionScore
    ) {
      const event: CompetenceEvent = {
        type: "demoted",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: `Dropped below demotion threshold after rollback (score=${record.score.toFixed(1)})`,
      };
      record.history.push(event);
      await this.audit("competence.demoted", principalId, actionType, record);
    } else {
      const event: CompetenceEvent = {
        type: "score_updated",
        timestamp: new Date(),
        previousScore,
        newScore: record.score,
        reason: "Rollback recorded",
      };
      record.history.push(event);
    }

    await this.store.saveRecord(record);
  }

  async getAdjustment(
    principalId: string,
    actionType: string,
    now?: Date,
  ): Promise<CompetenceAdjustment | null> {
    const record = await this.store.getRecord(principalId, actionType);
    if (!record) return null;

    const thresholds = await this.getThresholds(actionType);
    const decayed = this.applyDecay(record, thresholds, now ?? new Date());

    const shouldTrust =
      decayed.score >= thresholds.promotionScore &&
      decayed.successCount >= thresholds.promotionMinSuccesses;

    const shouldEscalate = decayed.score < thresholds.demotionScore;

    return {
      principalId,
      actionType,
      score: decayed.score,
      shouldTrust,
      shouldEscalate,
      record: decayed,
    };
  }

  private applyDecay(
    record: CompetenceRecord,
    thresholds: CompetenceThresholds,
    now: Date,
  ): CompetenceRecord {
    const msSinceDecay = now.getTime() - record.lastDecayAppliedAt.getTime();
    const daysSinceDecay = Math.floor(msSinceDecay / (1000 * 60 * 60 * 24));

    if (daysSinceDecay <= 0) return record;

    const decayAmount = daysSinceDecay * thresholds.decayPointsPerDay;
    const newScore = Math.max(record.score - decayAmount, thresholds.scoreFloor);

    return {
      ...record,
      score: newScore,
      history: [...record.history],
    };
  }

  private async getThresholds(actionType: string): Promise<CompetenceThresholds> {
    // Try specific policy match first
    const specific = await this.store.getPolicy(actionType);
    if (specific) return specific.thresholds;

    // Try default policy
    const defaultPolicy = await this.store.getDefaultPolicy();
    if (defaultPolicy) return defaultPolicy.thresholds;

    return DEFAULT_COMPETENCE_THRESHOLDS;
  }

  private async getOrCreateRecord(
    principalId: string,
    actionType: string,
  ): Promise<CompetenceRecord> {
    const existing = await this.store.getRecord(principalId, actionType);
    if (existing) return existing;

    const now = new Date();
    return {
      id: randomUUID(),
      principalId,
      actionType,
      successCount: 0,
      failureCount: 0,
      rollbackCount: 0,
      consecutiveSuccesses: 0,
      score: 0,
      lastActivityAt: now,
      lastDecayAppliedAt: now,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  private async audit(
    eventType: "competence.promoted" | "competence.demoted" | "competence.updated",
    principalId: string,
    actionType: string,
    record: CompetenceRecord,
  ): Promise<void> {
    if (!this.ledger) return;

    await this.ledger.record({
      eventType,
      actorType: "system",
      actorId: "competence-tracker",
      entityType: "competence",
      entityId: record.id,
      riskCategory: "low",
      summary: `Competence ${eventType.split(".")[1]} for ${principalId} on ${actionType} (score=${record.score.toFixed(1)})`,
      snapshot: {
        principalId,
        actionType,
        score: record.score,
        successCount: record.successCount,
        failureCount: record.failureCount,
        rollbackCount: record.rollbackCount,
        consecutiveSuccesses: record.consecutiveSuccesses,
      },
    });
  }
}
