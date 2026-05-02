import type {
  ActivityRow,
  AgentKey,
  AgentStripEntry,
  ApprovalGateCard,
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

// ── Agents ────────────────────────────────────────────────────────────────
export type ModuleEnablementMap = {
  alex: boolean;
  nova: boolean;
  mira: boolean;
};
export function mapAgents(modules: ModuleEnablementMap): AgentStripEntry[] {
  const activeKey: AgentKey = modules.nova ? "nova" : modules.alex ? "alex" : "mira";
  return (
    [
      { key: "alex", name: "Alex", href: "/conversations", label: "view conversations →" },
      { key: "nova", name: "Nova", href: "/modules/ad-optimizer", label: "view ad actions →" },
      { key: "mira", name: "Mira", href: "/modules/creative", label: "view creative →" },
    ] as const
  ).map((a) => ({
    key: a.key,
    name: a.name,
    primaryStat: "pending option C",
    subStat: ["—"],
    viewLink: { label: a.label, href: a.href },
    active: a.key === activeKey,
  }));
}

// ── Activity ──────────────────────────────────────────────────────────────
export type AuditEntry = {
  id: string;
  action: string;
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};
function agentForAction(action: string, actorId: string | null): AgentKey {
  const key = (actorId ?? action).toLowerCase();
  if (key.includes("alex")) return "alex";
  if (key.includes("nova")) return "nova";
  if (key.includes("mira")) return "mira";
  return "system";
}

function formatHHMM(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isToday(createdAt: string, now: Date): boolean {
  const d = new Date(createdAt);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function mapActivity(entries: AuditEntry[]): {
  moreToday: number;
  rows: ActivityRow[];
} {
  const now = new Date();
  const todayEntries = entries.filter((e) => isToday(e.createdAt, now));
  const displayed = entries.slice(0, 9);
  const moreToday = Math.max(0, todayEntries.length - displayed.length);
  const rows: ActivityRow[] = displayed.map((e) => ({
    id: e.id,
    time: formatHHMM(e.createdAt),
    agent: agentForAction(e.action, e.actorId),
    message: [e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")],
  }));
  return { moreToday, rows };
}

// Re-export AgentKey so consumers can import from one place
export type { AgentKey };
