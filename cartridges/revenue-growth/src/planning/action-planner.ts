// ---------------------------------------------------------------------------
// Action Planner — Context-aware intervention planning
// ---------------------------------------------------------------------------
// Given a constraint, escalation level, and optional account profile,
// produces a fully-formed Intervention with calibration-adjusted impact
// estimates and LLM-enhanced briefs when available.
// ---------------------------------------------------------------------------

import type {
  Constraint,
  Intervention,
  ActionArtifact,
  EscalationResult,
  AccountLearningProfile,
} from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";
import { generateIntervention, generateInterventionWithLLM } from "../action-engine/engine.js";

// ---------------------------------------------------------------------------
// Planner context
// ---------------------------------------------------------------------------

export interface PlannerContext {
  accountProfile?: AccountLearningProfile | null;
  escalation: EscalationResult;
  llmClient?: LLMClient | null;
}

// ---------------------------------------------------------------------------
// ActionPlanner — Main planner class
// ---------------------------------------------------------------------------

export class ActionPlanner {
  /**
   * Plan an intervention based on constraint, escalation, and context.
   * Uses LLM for rich briefs when available, with template fallback.
   * ESCALATE/CRITICAL levels get multi-artifact plans.
   */
  async planIntervention(
    constraint: Constraint,
    cycleId: string,
    context: PlannerContext,
  ): Promise<Intervention> {
    // Generate base intervention (with or without LLM)
    let intervention: Intervention;
    if (context.llmClient) {
      intervention = await generateInterventionWithLLM(constraint, cycleId, context.llmClient);
    } else {
      intervention = generateIntervention(constraint, cycleId);
    }

    // Adjust impact estimate based on calibration data
    intervention = this.applyCalibration(intervention, context.accountProfile);

    // ESCALATE/CRITICAL levels get additional artifacts
    if (context.escalation.level === "ESCALATE" || context.escalation.level === "CRITICAL") {
      intervention = await this.addEscalationArtifacts(intervention, context);
    }

    return intervention;
  }

  /**
   * Adjust impact estimate using historical calibration data.
   */
  private applyCalibration(
    intervention: Intervention,
    profile?: AccountLearningProfile | null,
  ): Intervention {
    if (!profile) return intervention;

    const calibration = profile.calibration[intervention.constraintType];
    if (!calibration || calibration.totalCount < 3) return intervention;

    // If historical success rate is low, downgrade impact estimate
    if (calibration.successRate < 0.3 && intervention.estimatedImpact === "HIGH") {
      return { ...intervention, estimatedImpact: "MEDIUM" };
    }

    // If historical success rate is high, upgrade impact estimate
    if (calibration.successRate > 0.7 && intervention.estimatedImpact === "LOW") {
      return { ...intervention, estimatedImpact: "MEDIUM" };
    }

    return intervention;
  }

  /**
   * Add checklist and escalation report artifacts for ESCALATE/CRITICAL levels.
   */
  private async addEscalationArtifacts(
    intervention: Intervention,
    context: PlannerContext,
  ): Promise<Intervention> {
    const now = new Date().toISOString();
    const additionalArtifacts: ActionArtifact[] = [];
    const { escalation } = context;

    // Checklist artifact
    const checklistContent = buildEscalationChecklist(escalation, intervention);
    additionalArtifacts.push({
      type: "checklist",
      title: `${escalation.level} Escalation Checklist`,
      content: checklistContent,
      generatedAt: now,
    });

    // For CRITICAL, add a report artifact
    if (escalation.level === "CRITICAL") {
      const reportContent = buildCriticalReport(escalation, intervention, context.accountProfile);
      additionalArtifacts.push({
        type: "report",
        title: "Critical Constraint Report",
        content: reportContent,
        generatedAt: now,
      });
    }

    return {
      ...intervention,
      artifacts: [...intervention.artifacts, ...additionalArtifacts],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEscalationChecklist(
  escalation: EscalationResult,
  intervention: Intervention,
): string {
  const lines = [
    `## ${escalation.level} Escalation Checklist`,
    "",
    `**Constraint:** ${escalation.constraintType} (score: ${escalation.score}, ${escalation.cycleCount} cycle(s))`,
    "",
    "### Required Actions:",
    `- [ ] Review ${intervention.actionType} intervention brief`,
    `- [ ] Verify data sources are accurate`,
    `- [ ] Assign owner for intervention execution`,
  ];

  if (escalation.level === "CRITICAL") {
    lines.push(
      "- [ ] Schedule emergency review meeting",
      "- [ ] Notify account stakeholders",
      "- [ ] Set up daily monitoring",
    );
  }

  lines.push(
    "",
    `**Impact Estimate:** ${intervention.estimatedImpact}`,
    `**Measurement Window:** ${intervention.measurementWindowDays ?? "N/A"} days`,
  );

  return lines.join("\n");
}

function buildCriticalReport(
  escalation: EscalationResult,
  intervention: Intervention,
  profile?: AccountLearningProfile | null,
): string {
  const lines = [
    "## Critical Constraint Report",
    "",
    `**Constraint Type:** ${escalation.constraintType}`,
    `**Current Score:** ${escalation.score}`,
    `**Consecutive Cycles:** ${escalation.cycleCount}`,
    `**Escalation Reason:** ${escalation.reason}`,
    "",
    "### History",
  ];

  if (profile) {
    const calibration = profile.calibration[intervention.constraintType];
    if (calibration) {
      lines.push(
        `- Historical success rate: ${(calibration.successRate * 100).toFixed(0)}%`,
        `- Average improvement: ${calibration.avgImprovement.toFixed(1)} points`,
        `- Total interventions: ${calibration.totalCount}`,
      );
    } else {
      lines.push("- No historical calibration data available");
    }
  } else {
    lines.push("- No account profile available");
  }

  lines.push(
    "",
    "### Recommendation",
    `This constraint has persisted for ${escalation.cycleCount} cycles with a score of ${escalation.score}. Immediate action is required.`,
  );

  return lines.join("\n");
}
