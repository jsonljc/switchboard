import type { AgentKey, ApprovalGateCard, EscalationCard, QueueCard } from "./console-data";

function formatAge(createdAt: string, now: Date): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// ── Queue ─────────────────────────────────────────────────────────────────
export type EscalationApiRow = {
  id: string;
  leadSnapshot?: { name?: string; channel?: string } | null;
  reason?: string | null;
  conversationSummary?: string | null;
  createdAt: string;
};

export function mapEscalationCard(row: EscalationApiRow, now: Date): EscalationCard {
  const contactName = row.leadSnapshot?.name?.trim() || "Unknown";
  const channel = row.leadSnapshot?.channel?.trim() || "—";
  const reasonText = row.reason?.trim() || row.conversationSummary?.trim() || "";
  return {
    kind: "escalation",
    id: row.id,
    escalationId: row.id,
    agent: "alex",
    contactName,
    channel,
    timer: { label: "Urgent", ageDisplay: formatAge(row.createdAt, now) },
    issue: [reasonText],
    primary: { label: "Reply" },
    secondary: { label: "Hold the line" },
    selfHandle: { label: "I'll handle this" },
  };
}

export type ApprovalApiRow = {
  id: string;
  summary: string;
  riskContext: string | null;
  riskCategory: string;
  bindingHash: string;
  createdAt: string;
};
export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
  return {
    kind: "approval_gate",
    id: row.id,
    approvalId: row.id,
    bindingHash: row.bindingHash,
    agent: "mira",
    jobName: row.summary,
    timer: {
      stageLabel: row.riskContext?.trim() || "Approval needed",
      ageDisplay: formatAge(row.createdAt, now),
    },
    stageProgress: "—",
    stageDetail: row.riskContext?.trim() || "",
    countdown: "—",
    primary: { label: "Review →" },
    stop: { label: "Stop campaign" },
  };
}

export function mapQueue(
  escalations: EscalationApiRow[],
  approvals: ApprovalApiRow[],
  now: Date,
): QueueCard[] {
  const escCards = escalations.map((e) => mapEscalationCard(e, now));
  const gateCards = approvals
    .filter((a) => a.riskCategory === "creative")
    .map((a) => mapApprovalGateCard(a, now));
  // Recommendation cards are not exposed by the backend in option B; option C wires them.
  return [...escCards, ...gateCards];
}

// Re-export AgentKey so consumers can import from one place
export type { AgentKey };
