import type { Recommendation } from "../../recommendations/types.js";
import type { Decision, DecisionPresentation } from "../types.js";
import { scoreRecommendation } from "../urgency.js";

const FALLBACK_PRESENTATION: DecisionPresentation = {
  primaryLabel: "Approve",
  secondaryLabel: "Edit",
  dismissLabel: "Dismiss",
  dataLines: [],
};

export function adaptRecommendation(row: Recommendation): Decision {
  return {
    id: `approval:${row.id}`,
    kind: "approval",
    orgId: row.orgId,
    agentKey: row.agentKey,
    humanSummary: row.humanSummary,
    presentation: extractPresentation(row.parameters),
    urgencyScore: scoreRecommendation(row),
    createdAt: row.createdAt,
    threadHref: deriveThreadHref(row),
    sourceRef: { kind: "approval", sourceId: row.id },
    meta: {
      contactName: extractContactName(row.targetEntities),
      riskLevel: row.riskLevel,
      undoableUntil: row.undoableUntil ?? undefined,
    },
  };
}

function extractPresentation(parameters: Record<string, unknown>): DecisionPresentation {
  const meta = parameters?.["__recommendation"] as
    | { presentation?: DecisionPresentation }
    | undefined;
  return meta?.presentation ?? FALLBACK_PRESENTATION;
}

function extractContactName(targetEntities: Record<string, unknown> | null): string | undefined {
  if (!targetEntities) return undefined;
  const name = targetEntities["contactName"];
  return typeof name === "string" ? name : undefined;
}

function deriveThreadHref(row: Recommendation): string | null {
  if (!row.targetEntities) return null;
  const contactId = row.targetEntities["contactId"];
  return typeof contactId === "string" ? `/contacts/${contactId}/conversations` : null;
}
