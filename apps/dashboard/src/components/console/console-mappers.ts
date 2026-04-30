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
export function mapEscalationCard(_row: EscalationApiRow, _now: Date): EscalationCard {
  throw new Error("not implemented");
}

export type ApprovalApiRow = {
  id: string;
  summary: string;
  riskContext: string | null;
  riskCategory: string;
  createdAt: string;
};
export function mapApprovalGateCard(_row: ApprovalApiRow, _now: Date): ApprovalGateCard {
  throw new Error("not implemented");
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
