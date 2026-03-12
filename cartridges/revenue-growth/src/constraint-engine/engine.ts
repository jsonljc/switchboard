// ---------------------------------------------------------------------------
// Constraint Engine — Priority-ordered constraint identification
// ---------------------------------------------------------------------------
// Evaluates scorer outputs against priority-ordered rules to identify the
// single primary constraint limiting revenue growth.
//
// Priority order: SIGNAL > CREATIVE > FUNNEL > SALES > SATURATION
//
// A constraint is "binding" when its scorer output falls below a threshold.
// The engine selects the highest-priority binding constraint as primary
// and records all others as secondary.
// ---------------------------------------------------------------------------

import type {
  ScorerOutput,
  Constraint,
  ConstraintType,
  AccountLearningProfile,
  EscalationResult,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Configuration — scorer name → constraint type mapping with thresholds
// ---------------------------------------------------------------------------

interface ConstraintRule {
  constraintType: ConstraintType;
  scorerName: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Score below this value means the constraint is binding */
  bindingThreshold: number;
  /** Score below this value is critical */
  criticalThreshold: number;
}

const CONSTRAINT_RULES: ConstraintRule[] = [
  {
    constraintType: "SIGNAL",
    scorerName: "signal-health",
    priority: 1,
    bindingThreshold: 60,
    criticalThreshold: 30,
  },
  {
    constraintType: "CREATIVE",
    scorerName: "creative-depth",
    priority: 2,
    bindingThreshold: 50,
    criticalThreshold: 25,
  },
  {
    constraintType: "FUNNEL",
    scorerName: "funnel-leakage",
    priority: 3,
    bindingThreshold: 50,
    criticalThreshold: 25,
  },
  {
    constraintType: "SALES",
    scorerName: "sales-process",
    priority: 4,
    bindingThreshold: 50,
    criticalThreshold: 25,
  },
  {
    constraintType: "SATURATION",
    scorerName: "headroom",
    priority: 5,
    bindingThreshold: 40,
    criticalThreshold: 20,
  },
];

// ---------------------------------------------------------------------------
// ScorerContext — Optional context for calibration-aware scoring
// ---------------------------------------------------------------------------

export interface ScorerContext {
  accountProfile?: AccountLearningProfile;
  escalation?: EscalationResult;
}

// ---------------------------------------------------------------------------
// identifyConstraints — Main engine entry point
// ---------------------------------------------------------------------------

export interface ConstraintResult {
  primary: Constraint | null;
  secondary: Constraint[];
  constraintTransition: boolean;
}

export function identifyConstraints(
  scorerOutputs: ScorerOutput[],
  previousPrimaryConstraintType: ConstraintType | null,
  scorerContext?: ScorerContext,
): ConstraintResult {
  // Build a lookup of scorer outputs by name
  const scorerMap = new Map<string, ScorerOutput>();
  for (const output of scorerOutputs) {
    scorerMap.set(output.scorerName, output);
  }

  // Evaluate each rule against available scorer outputs
  const bindingConstraints: Constraint[] = [];

  for (const rule of CONSTRAINT_RULES) {
    const scorerOutput = scorerMap.get(rule.scorerName);
    if (!scorerOutput) continue;

    // Calibration-aware threshold adjustment for SALES constraint
    let effectiveThreshold = rule.bindingThreshold;
    if (scorerContext?.accountProfile && rule.constraintType === "SALES") {
      const calibration = scorerContext.accountProfile.calibration[rule.constraintType];
      if (calibration && calibration.totalCount >= 3 && calibration.successRate > 0.7) {
        // High success rate → widen the binding threshold to catch issues earlier
        effectiveThreshold = Math.min(rule.bindingThreshold + 10, 80);
      }
    }

    if (scorerOutput.score < effectiveThreshold) {
      const isCritical = scorerOutput.score < rule.criticalThreshold;
      const reason = buildReason(rule, scorerOutput, isCritical);

      bindingConstraints.push({
        type: rule.constraintType,
        score: scorerOutput.score,
        confidence: scorerOutput.confidence,
        isPrimary: false, // will be set below
        scorerOutput,
        reason,
      });
    }
  }

  // Sort by priority (already sorted by rule order, but enforce)
  bindingConstraints.sort((a, b) => {
    const priorityA = CONSTRAINT_RULES.find((r) => r.constraintType === a.type)?.priority ?? 99;
    const priorityB = CONSTRAINT_RULES.find((r) => r.constraintType === b.type)?.priority ?? 99;
    return priorityA - priorityB;
  });

  // Select primary constraint (highest priority binding constraint)
  let primary: Constraint | null = null;
  const secondary: Constraint[] = [];

  if (bindingConstraints.length > 0) {
    primary = { ...bindingConstraints[0]!, isPrimary: true };
    for (let i = 1; i < bindingConstraints.length; i++) {
      secondary.push(bindingConstraints[i]!);
    }
  }

  // Detect constraint transition
  const constraintTransition =
    previousPrimaryConstraintType !== null &&
    primary !== null &&
    primary.type !== previousPrimaryConstraintType;

  return { primary, secondary, constraintTransition };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReason(rule: ConstraintRule, output: ScorerOutput, isCritical: boolean): string {
  const criticalIssues = output.issues.filter((i) => i.severity === "critical");
  const topIssue = criticalIssues[0] ?? output.issues[0];

  const severity = isCritical ? "Critical" : "Binding";
  const base = `${severity} constraint: ${rule.constraintType} (score ${output.score}/${rule.bindingThreshold})`;

  if (topIssue) {
    return `${base}. ${topIssue.message}`;
  }

  return base;
}
