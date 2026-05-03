"use client";

import type { QueueCard } from "../console-data";
import { EscalationCardView } from "./escalation-card";
import { RecommendationCardView } from "./recommendation-card";
import { ApprovalGateCardView } from "./approval-gate-card";

export { EscalationCardView } from "./escalation-card";
export { RecommendationCardView } from "./recommendation-card";
export { ApprovalGateCardView } from "./approval-gate-card";
export { RichTextSpan, capitalize } from "./rich-text";

interface QueueCardViewProps {
  card: QueueCard;
  resolving: boolean;
  onResolve: () => void;
}

export function QueueCardView({ card, resolving, onResolve }: QueueCardViewProps) {
  switch (card.kind) {
    case "escalation":
      return <EscalationCardView card={card} resolving={resolving} onResolve={onResolve} />;
    case "recommendation":
      return <RecommendationCardView card={card} resolving={resolving} onResolve={onResolve} />;
    case "approval_gate":
      return <ApprovalGateCardView card={card} resolving={resolving} onResolve={onResolve} />;
  }
}
