// ---------------------------------------------------------------------------
// Action Engine — Constraint-to-action mapping and intervention generation
// ---------------------------------------------------------------------------
// Given a primary constraint, deterministically selects the appropriate
// action type, estimates impact, and generates intervention proposals.
// ---------------------------------------------------------------------------

import type {
  ConstraintType,
  RevGrowthActionType,
  ImpactTier,
  Constraint,
  Intervention,
  ActionArtifact,
} from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";

// ---------------------------------------------------------------------------
// Constraint → Action mapping (deterministic lookup)
// ---------------------------------------------------------------------------

interface ActionMapping {
  actionType: RevGrowthActionType;
  defaultPriority: number;
  measurementWindowDays: number;
  briefTemplate: string;
}

const CONSTRAINT_ACTION_MAP: Record<ConstraintType, ActionMapping> = {
  SIGNAL: {
    actionType: "FIX_TRACKING",
    defaultPriority: 1,
    measurementWindowDays: 7,
    briefTemplate:
      "Fix tracking infrastructure: ensure pixel is active, CAPI is configured, and event match quality exceeds 6/10.",
  },
  CREATIVE: {
    actionType: "REFRESH_CREATIVE",
    defaultPriority: 2,
    measurementWindowDays: 14,
    briefTemplate:
      "Refresh creative portfolio: add new concepts, retire fatigued assets, and improve diversity score.",
  },
  FUNNEL: {
    actionType: "OPTIMIZE_FUNNEL",
    defaultPriority: 3,
    measurementWindowDays: 14,
    briefTemplate:
      "Optimize the leakiest funnel stage: reduce drop-off rate at the identified bottleneck.",
  },
  SALES: {
    actionType: "IMPROVE_SALES_PROCESS",
    defaultPriority: 4,
    measurementWindowDays: 21,
    briefTemplate:
      "Improve sales process: accelerate follow-up velocity, increase CRM match rate, and boost stage conversion rates.",
  },
  SATURATION: {
    actionType: "EXPAND_AUDIENCE",
    defaultPriority: 5,
    measurementWindowDays: 21,
    briefTemplate:
      "Expand audience reach: the account is approaching spend saturation. Explore new audiences, platforms, or geographic expansion.",
  },
  OFFER: {
    actionType: "REVISE_OFFER",
    defaultPriority: 6,
    measurementWindowDays: 14,
    briefTemplate:
      "Revise the offer: conversion rates suggest the value proposition needs strengthening. Test new landing pages, pricing, or promotions.",
  },
  CAPACITY: {
    actionType: "SCALE_CAPACITY",
    defaultPriority: 7,
    measurementWindowDays: 30,
    briefTemplate:
      "Scale operational capacity: demand is outpacing fulfillment. Expand staffing, inventory, or service capacity.",
  },
};

// ---------------------------------------------------------------------------
// Impact estimation
// ---------------------------------------------------------------------------

export function estimateImpact(constraint: Constraint): ImpactTier {
  // Critical scores with high confidence = high impact potential
  if (constraint.score < 25 && constraint.confidence === "HIGH") return "HIGH";
  if (constraint.score < 40) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// generateIntervention — Create an intervention proposal from a constraint
// ---------------------------------------------------------------------------

export function generateIntervention(constraint: Constraint, cycleId: string): Intervention {
  const mapping = CONSTRAINT_ACTION_MAP[constraint.type];
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const artifact: ActionArtifact = {
    type: "brief",
    title: `${mapping.actionType} Brief`,
    content: buildBriefContent(constraint, mapping),
    generatedAt: now,
  };

  return {
    id,
    cycleId,
    constraintType: constraint.type,
    actionType: mapping.actionType,
    status: "PROPOSED",
    priority: mapping.defaultPriority,
    estimatedImpact: estimateImpact(constraint),
    reasoning: constraint.reason,
    artifacts: [artifact],
    outcomeStatus: "PENDING",
    measurementWindowDays: mapping.measurementWindowDays,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// generateInterventionWithLLM — Enhanced version with LLM artifact generation
// ---------------------------------------------------------------------------

export async function generateInterventionWithLLM(
  constraint: Constraint,
  cycleId: string,
  llmClient: LLMClient,
): Promise<Intervention> {
  const mapping = CONSTRAINT_ACTION_MAP[constraint.type];
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Generate a more detailed brief via LLM
  let briefContent: string;
  try {
    briefContent = await llmClient.complete([
      {
        role: "system",
        content:
          "You are a revenue growth advisor. Generate a concise action brief (3-5 bullet points) for the given constraint. Be specific and actionable.",
      },
      {
        role: "user",
        content: `Constraint: ${constraint.type} (score: ${constraint.score}/100)\nReason: ${constraint.reason}\nIssues: ${constraint.scorerOutput.issues.map((i) => i.message).join("; ")}\n\nGenerate an action brief for: ${mapping.briefTemplate}`,
      },
    ]);
  } catch {
    // Fall back to template if LLM fails
    briefContent = buildBriefContent(constraint, mapping);
  }

  const artifact: ActionArtifact = {
    type: "brief",
    title: `${mapping.actionType} Brief`,
    content: briefContent,
    generatedAt: now,
  };

  return {
    id,
    cycleId,
    constraintType: constraint.type,
    actionType: mapping.actionType,
    status: "PROPOSED",
    priority: mapping.defaultPriority,
    estimatedImpact: estimateImpact(constraint),
    reasoning: constraint.reason,
    artifacts: [artifact],
    outcomeStatus: "PENDING",
    measurementWindowDays: mapping.measurementWindowDays,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// lookupActionType — Simple constraint → action type lookup
// ---------------------------------------------------------------------------

export function lookupActionType(constraintType: ConstraintType): RevGrowthActionType {
  return CONSTRAINT_ACTION_MAP[constraintType].actionType;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBriefContent(constraint: Constraint, mapping: ActionMapping): string {
  const lines: string[] = [
    `## ${mapping.actionType} Action Brief`,
    "",
    `**Constraint:** ${constraint.type} (score: ${constraint.score}/100, confidence: ${constraint.confidence})`,
    "",
    `**Summary:** ${mapping.briefTemplate}`,
    "",
    "**Key Issues:**",
  ];

  for (const issue of constraint.scorerOutput.issues) {
    const severity =
      issue.severity === "critical" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
    lines.push(`- ${severity} ${issue.message}`);
  }

  lines.push("");
  lines.push(`**Measurement Window:** ${mapping.measurementWindowDays} days`);
  lines.push(`**Estimated Impact:** ${estimateImpact(constraint)}`);

  return lines.join("\n");
}
