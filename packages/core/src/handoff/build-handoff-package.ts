import { createId } from "@paralleldrive/cuid2";
import type { Handoff } from "./types.js";

/**
 * Build a Handoff for compliance-driven escalation.
 *
 * Shared between DeterministicSafetyGateHook (1b-1) and ClaimClassifierHook (1b-2)
 * so both governance gates emit identically shaped handoff rows. The 4h SLA
 * deadline and stub lead/qualification snapshots match the 1b-1 contract that
 * downstream tooling (handoff queue, SLA monitor) already consumes.
 */
export function buildHandoffPackage(
  sessionId: string,
  orgId: string,
  turnCount: number,
  clock: () => Date,
): Handoff {
  return {
    id: createId(),
    sessionId,
    organizationId: orgId,
    reason: "compliance_concern",
    status: "pending",
    leadSnapshot: { channel: "skill" },
    qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
    conversationSummary: {
      turnCount,
      keyTopics: [],
      objectionHistory: [],
      sentiment: "neutral",
    },
    slaDeadlineAt: new Date(clock().getTime() + 4 * 60 * 60 * 1000),
    createdAt: clock(),
  };
}
