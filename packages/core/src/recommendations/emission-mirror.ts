import { randomUUID } from "node:crypto";
import type { WorkTrace } from "../platform/work-trace.js";
import { WORK_TRACE_HASH_VERSION_LATEST } from "../platform/work-trace-hash.js";
import type { PersistRecommendationInput, Recommendation } from "./types.js";

/**
 * Mirror that performs the dual-write of a Recommendation row + a WorkTrace
 * row inside a single atomic unit. Layer-3 (core) does not know what kind of
 * unit (Prisma transaction, in-memory, etc.); the mirror implementation owns
 * that.
 *
 * When provided to emitRecommendation, this replaces the per-store insert path
 * with the mirror's recordEmission. When absent, emitRecommendation falls back
 * to the legacy single-store insert path.
 */
export interface RecommendationEmissionMirror {
  recordEmission(args: {
    recommendationInsert: PersistRecommendationInput;
    workTrace: WorkTrace;
  }): Promise<{ row: Recommendation; idempotent: boolean }>;
}

const RISK_LEVEL_TO_SCORE: Record<"low" | "medium" | "high", number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
};

export interface BuildRileyEmissionWorkTraceArgs {
  insert: PersistRecommendationInput;
  now: Date;
  cronId: string;
}

/**
 * Build the WorkTrace shape that mirrors a Riley recommendation emission.
 *
 * Field mapping (verbatim from Wave B slicing spec §Slice B-Wave-1):
 *   - mode: "pipeline" — ad-optimizer is a pipeline by architectural category
 *   - trigger: "schedule" — Riley emissions are cron-scheduled
 *   - outcome: "pending_approval" for queue surface, "completed" for shadow_action
 *   - governanceOutcome: "require_approval" for queue, "execute" for shadow_action
 *   - ingressPath: "agent_recommendation_emission"
 *   - hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST (v2; ingressPath is in v2 hash input)
 *   - actor: service / ad-optimizer
 *   - durationMs: 0 (no execution; emit is the terminal event)
 *   - idempotencyKey: shared with the Recommendation insert
 *   - completedAt = governanceCompletedAt = requestedAt = now
 */
export function buildRileyEmissionWorkTrace(args: BuildRileyEmissionWorkTraceArgs): WorkTrace {
  const { insert, now, cronId } = args;
  const nowIso = now.toISOString();
  const isQueue = insert.surface === "queue";
  return {
    workUnitId: randomUUID(),
    traceId: randomUUID(),
    intent: insert.intent,
    mode: "pipeline",
    organizationId: insert.orgId,
    actor: { type: "service", id: "ad-optimizer" },
    trigger: "schedule",
    idempotencyKey: insert.idempotencyKey,
    parameters: {
      cronId,
      action: insert.action,
      humanSummary: insert.humanSummary,
      confidence: insert.confidence,
      dollarsAtRisk: insert.dollarsAtRisk,
      sourceWorkflow: insert.sourceWorkflow ?? null,
      targetEntities: insert.targetEntities ?? null,
    },
    governanceOutcome: isQueue ? "require_approval" : "execute",
    riskScore: RISK_LEVEL_TO_SCORE[insert.riskLevel],
    matchedPolicies: [],
    outcome: isQueue ? "pending_approval" : "completed",
    durationMs: 0,
    requestedAt: nowIso,
    governanceCompletedAt: nowIso,
    completedAt: nowIso,
    ingressPath: "agent_recommendation_emission",
    hashInputVersion: WORK_TRACE_HASH_VERSION_LATEST,
  };
}
