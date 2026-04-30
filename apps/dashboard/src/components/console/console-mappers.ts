import type {
  ActivityRow,
  AgentKey,
  AgentStripEntry,
  ApprovalGateCard,
  ConsoleData,
  EscalationCard,
  NumbersStrip,
  OpStrip,
  QueueCard,
} from "./console-data";

// ── Op strip ──────────────────────────────────────────────────────────────
export function mapOpStrip(orgName: string, now: Date, dispatch: "live" | "halted"): OpStrip {
  const day = now.toLocaleDateString("en-US", { weekday: "short" });
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return { orgName, now: `${day} ${time}`, dispatch };
}

// ── Numbers strip ─────────────────────────────────────────────────────────
export type NumbersInput = {
  leadsToday: number;
  leadsYesterday: number;
  bookingsToday: Array<{ startsAt: string; contactName: string }>;
};
export function mapNumbersStrip(input: NumbersInput): NumbersStrip {
  const leadsDelta = input.leadsToday - input.leadsYesterday;
  const leadsTone: "good" | "coral" = leadsDelta >= 0 ? "good" : "coral";
  const leadsArrow = leadsDelta >= 0 ? "↑" : "↓";
  const leadsAbs = Math.abs(leadsDelta);

  const appts = input.bookingsToday.length;
  const next = input.bookingsToday[0];
  const nextTime = next
    ? new Date(next.startsAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      })
    : null;

  return {
    cells: [
      {
        label: "Revenue today",
        value: "—",
        delta: ["pending option C"],
        tone: "neutral",
        placeholder: true,
      },
      {
        label: "Leads today",
        value: String(input.leadsToday),
        delta: [`${leadsArrow} `, { bold: String(leadsAbs) }, " vs yesterday"],
        tone: leadsTone,
      },
      {
        label: "Appointments",
        value: String(appts),
        delta: next
          ? ["next: ", { bold: nextTime ?? "" }, ` · ${next.contactName}`]
          : ["none scheduled"],
        tone: "neutral",
      },
      {
        label: "Spend today",
        value: "—",
        delta: ["pending option C"],
        tone: "neutral",
        placeholder: true,
      },
      {
        label: "Reply time",
        value: "—",
        delta: ["pending option C"],
        tone: "neutral",
        placeholder: true,
      },
    ],
  };
}

// ── Queue ─────────────────────────────────────────────────────────────────
export type EscalationApiRow = {
  id: string;
  leadSnapshot?: { name?: string; channel?: string } | null;
  reason?: string | null;
  conversationSummary?: string | null;
  createdAt: string;
};
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

export function mapEscalationCard(row: EscalationApiRow, now: Date): EscalationCard {
  const contactName = row.leadSnapshot?.name?.trim() || "Unknown";
  const channel = row.leadSnapshot?.channel?.trim() || "—";
  const reasonText = row.reason?.trim() || row.conversationSummary?.trim() || "";
  return {
    kind: "escalation",
    id: row.id,
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
  createdAt: string;
};
export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
  return {
    kind: "approval_gate",
    id: row.id,
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
  _escalations: EscalationApiRow[],
  _approvals: ApprovalApiRow[],
  _now: Date,
): QueueCard[] {
  throw new Error("not implemented");
}

// ── Agents ────────────────────────────────────────────────────────────────
export type ModuleEnablementMap = {
  alex: boolean;
  nova: boolean;
  mira: boolean;
};
export function mapAgents(_modules: ModuleEnablementMap): AgentStripEntry[] {
  throw new Error("not implemented");
}

// ── Activity ──────────────────────────────────────────────────────────────
export type AuditEntry = {
  id: string;
  action: string;
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};
export function mapActivity(_entries: AuditEntry[]): { moreToday: number; rows: ActivityRow[] } {
  throw new Error("not implemented");
}

// ── Top-level composer ────────────────────────────────────────────────────
export type MapConsoleInput = {
  orgName: string;
  now: Date;
  dispatch: "live" | "halted";
  leadsToday: number;
  leadsYesterday: number;
  bookingsToday: Array<{ startsAt: string; contactName: string }>;
  escalations: EscalationApiRow[];
  approvals: ApprovalApiRow[];
  modules: ModuleEnablementMap;
  auditEntries: AuditEntry[];
};
export function mapConsoleData(_input: MapConsoleInput): ConsoleData {
  throw new Error("not implemented");
}

// Re-export AgentKey so consumers can import from one place
export type { AgentKey };
