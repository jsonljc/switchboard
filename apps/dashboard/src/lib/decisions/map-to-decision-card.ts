import type { Decision, DecisionKind } from "./types";

export interface DecisionCardProps {
  folio: { kindLabel: string; rightFolio: string };
  serifSentence: string;
  primaryLabel: string;
  secondaryLabel: string;
  dismissLabel: string;
  threadHref: string | null;
  source: { kind: DecisionKind; sourceId: string };
}

export function mapToDecisionCard(decision: Decision, index: number): DecisionCardProps {
  return {
    folio: {
      kindLabel: `${kindToFolioLabel(decision.kind)} ${index + 1}`,
      rightFolio: composeRightFolio(decision),
    },
    serifSentence: decision.humanSummary,
    primaryLabel: decision.presentation.primaryLabel,
    secondaryLabel: decision.presentation.secondaryLabel,
    dismissLabel: decision.presentation.dismissLabel,
    threadHref: decision.threadHref,
    source: decision.sourceRef,
  };
}

function kindToFolioLabel(kind: DecisionKind): string {
  switch (kind) {
    case "approval":
      return "DECISION";
    case "handoff":
      return "HANDOFF";
  }
}

function composeRightFolio(d: Decision): string {
  const name = d.meta.contactName?.toUpperCase() ?? "—";
  if (d.kind === "handoff" && d.meta.slaDeadlineAt) {
    return `${name} · DUE ${formatRelative(new Date(d.meta.slaDeadlineAt))}`;
  }
  return `${name} — ${formatRelative(new Date(d.createdAt))} AGO`;
}

function formatRelative(target: Date): string {
  const diffMs = Math.abs(target.getTime() - Date.now());
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `${Math.round(diffMs / 60_000)}M`;
  if (hours < 24) return `${Math.round(hours)}H`;
  return `${Math.round(hours / 24)}D`;
}
