// ---------------------------------------------------------------------------
// Escalation Ladder — Constraint severity escalation based on duration
// ---------------------------------------------------------------------------
// Determines escalation level based on how many cycles a constraint has
// been the primary constraint and the current score severity.
//
// Levels: INFO (≤1 cycle) → WARN (2 cycles) → ESCALATE (3+ cycles)
//         → CRITICAL (3+ cycles + score < critical threshold)
// ---------------------------------------------------------------------------

import type {
  ConstraintType,
  EscalationLevel,
  EscalationResult,
  AccountLearningProfile,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Critical thresholds per constraint type (matches constraint engine)
// ---------------------------------------------------------------------------

const CRITICAL_THRESHOLDS: Record<ConstraintType, number> = {
  SIGNAL: 30,
  CREATIVE: 25,
  FUNNEL: 25,
  SALES: 25,
  SATURATION: 20,
  OFFER: 25,
  CAPACITY: 20,
};

// ---------------------------------------------------------------------------
// determineEscalationLevel — Main entry point
// ---------------------------------------------------------------------------

export function determineEscalationLevel(
  constraintType: ConstraintType,
  score: number,
  accountProfile?: AccountLearningProfile | null,
): EscalationResult {
  // Count how many consecutive cycles this constraint has been primary
  const cycleCount = getCycleCount(constraintType, accountProfile);
  const criticalThreshold = CRITICAL_THRESHOLDS[constraintType];

  let level: EscalationLevel;
  let reason: string;

  if (cycleCount >= 3 && score < criticalThreshold) {
    level = "CRITICAL";
    reason = `${constraintType} has been primary for ${cycleCount} cycle(s) with score ${score} below critical threshold ${criticalThreshold}`;
  } else if (cycleCount >= 3) {
    level = "ESCALATE";
    reason = `${constraintType} has been primary for ${cycleCount} cycle(s) — requires escalated attention`;
  } else if (cycleCount === 2) {
    level = "WARN";
    reason = `${constraintType} persists as primary for ${cycleCount} consecutive cycle(s)`;
  } else {
    level = "INFO";
    reason = `${constraintType} identified as primary constraint (score: ${score})`;
  }

  return {
    level,
    constraintType,
    cycleCount,
    score,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCycleCount(
  constraintType: ConstraintType,
  profile?: AccountLearningProfile | null,
): number {
  if (!profile) return 1;

  const openEntry = profile.constraintHistory.find(
    (h) => h.constraintType === constraintType && h.endedAt === null,
  );

  return openEntry?.cycleCount ?? 1;
}
