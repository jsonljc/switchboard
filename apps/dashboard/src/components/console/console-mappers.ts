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
  RichText,
} from "./console-data";
import { consoleFixture } from "./console-data";

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

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
  revenue: { amount: number; currency: string; deltaPctVsAvg: number | null };
  replyTime: { medianSeconds: number; previousSeconds: number | null; sampleSize: number } | null;
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
        value: formatCurrency(input.revenue.amount, input.revenue.currency),
        delta:
          input.revenue.deltaPctVsAvg === null
            ? ["—"]
            : [
                input.revenue.deltaPctVsAvg >= 0 ? "+" : "",
                { bold: `${Math.round(input.revenue.deltaPctVsAvg * 100)}%` },
                " vs avg",
              ],
        tone:
          input.revenue.deltaPctVsAvg === null
            ? "neutral"
            : input.revenue.deltaPctVsAvg >= 0
              ? "good"
              : "coral",
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
        value: input.replyTime === null ? "—" : formatDuration(input.replyTime.medianSeconds),
        delta:
          input.replyTime === null
            ? ["pending"]
            : input.replyTime.previousSeconds === null
              ? ["new today"]
              : input.replyTime.medianSeconds <= input.replyTime.previousSeconds
                ? ["↓ from ", { bold: formatDuration(input.replyTime.previousSeconds) }]
                : ["↑ from ", { bold: formatDuration(input.replyTime.previousSeconds) }],
        tone:
          input.replyTime === null
            ? "neutral"
            : input.replyTime.previousSeconds !== null &&
                input.replyTime.medianSeconds <= input.replyTime.previousSeconds
              ? "good"
              : "neutral",
        placeholder: input.replyTime === null,
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
  stageProgress?: {
    stageIndex: number;
    stageTotal: number;
    stageLabel: string;
    closesAt: string | null;
  };
};
export function mapApprovalGateCard(row: ApprovalApiRow, now: Date): ApprovalGateCard {
  const sp = row.stageProgress;
  return {
    kind: "approval_gate",
    id: row.id,
    agent: "mira",
    jobName: row.summary,
    timer: {
      stageLabel: sp?.stageLabel ?? row.riskContext?.trim() ?? "Approval needed",
      ageDisplay: formatAge(row.createdAt, now),
    },
    stageProgress: sp ? `Stage ${sp.stageIndex + 1} of ${sp.stageTotal}` : "—",
    stageDetail: row.riskContext?.trim() ?? sp?.stageLabel ?? "",
    countdown: sp?.closesAt ? formatCountdown(sp.closesAt, now) : "—",
    primary: { label: "Review →" },
    stop: { label: "Stop campaign" },
  };
}

function formatCountdown(closesAt: string, now: Date): string {
  const ms = new Date(closesAt).getTime() - now.getTime();
  if (ms <= 0) return "expired";
  const totalMin = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours === 0) return `${min}m left`;
  if (hours <= 24) return `${hours}h ${min}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
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

export type AgentsInput = {
  modules: ModuleEnablementMap;
  alex: { repliedToday: number; qualifiedToday: number; bookedToday: number } | null;
  nova: { draftsPending: number } | null;
  mira: { inFlight: number; winningHook: string | null } | null;
  todaySpend: { amount: number; currency: string } | null;
};

export function mapAgents(input: AgentsInput): AgentStripEntry[] {
  const activeKey: AgentKey = input.modules.nova ? "nova" : input.modules.alex ? "alex" : "mira";
  return (
    [
      { key: "alex", name: "Alex", href: "/conversations", label: "view conversations →" },
      { key: "nova", name: "Nova", href: "/modules/ad-optimizer", label: "view ad actions →" },
      { key: "mira", name: "Mira", href: "/modules/creative", label: "view creative →" },
    ] as const
  ).map((a) => {
    const enabled = input.modules[a.key];
    let primaryStat = "—";
    let subStat: RichText = ["—"];
    if (a.key === "alex" && enabled && input.alex) {
      primaryStat = `${input.alex.repliedToday} replied`;
      subStat = [
        `${input.alex.qualifiedToday} qualified · `,
        { bold: `${input.alex.bookedToday} booked` },
      ];
    } else if (a.key === "nova" && enabled && input.nova) {
      // Reads today.spend (not a duplicate field on agentsToday.nova) — by design.
      primaryStat = input.todaySpend
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: input.todaySpend.currency,
            maximumFractionDigits: 0,
          }).format(input.todaySpend.amount)
        : "—";
      subStat = [`${input.nova.draftsPending} drafts pending`];
    } else if (a.key === "mira" && enabled && input.mira) {
      primaryStat = `${input.mira.inFlight} in flight`;
      subStat = input.mira.winningHook
        ? [{ bold: input.mira.winningHook }, " hook winning"]
        : ["—"];
    } else if (!enabled) {
      primaryStat = "Hire " + a.name;
      subStat = ["module disabled"];
    } else {
      primaryStat = "pending option C2";
    }
    return {
      key: a.key,
      name: a.name,
      primaryStat,
      subStat,
      viewLink: enabled ? { label: a.label, href: a.href } : { label: "", href: a.href },
      active: a.key === activeKey && enabled,
    };
  });
}

// ── Activity ──────────────────────────────────────────────────────────────
export type AuditEntry = {
  id: string;
  action: string; // existing — comes from `entry.type` on the API side, kept for compatibility
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
  /** NEW: structured agent attribution from the API (option C1). */
  agent: AgentKey | null;
};

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

export function mapActivity(entries: AuditEntry[]): { moreToday: number; rows: ActivityRow[] } {
  const now = new Date();
  const todayEntries = entries.filter((e) => isToday(e.createdAt, now));
  const displayed = entries.slice(0, 9);
  const moreToday = Math.max(0, todayEntries.length - displayed.length);
  const rows: ActivityRow[] = displayed.map((e) => ({
    id: e.id,
    time: formatHHMM(e.createdAt),
    // Read the structured field. Fallback to "system" preserves the option-B render shape for null agents.
    agent: e.agent ?? "system",
    message: [e.action.replace(/^[^.]+\./, "").replace(/[._]/g, " ")],
  }));
  return { moreToday, rows };
}

// ── Top-level composer ────────────────────────────────────────────────────
export type MapConsoleInput = {
  orgName: string;
  now: Date;
  dispatch: "live" | "halted";
  leadsToday: number;
  leadsYesterday: number;
  bookingsToday: Array<{ startsAt: string; contactName: string }>;
  revenue: { amount: number; currency: string; deltaPctVsAvg: number | null };
  replyTime: { medianSeconds: number; previousSeconds: number | null; sampleSize: number } | null;
  escalations: EscalationApiRow[];
  approvals: ApprovalApiRow[];
  modules: ModuleEnablementMap;
  auditEntries: AuditEntry[];
  alex: { repliedToday: number; qualifiedToday: number; bookedToday: number } | null;
  nova: { draftsPending: number } | null;
  mira: { inFlight: number; winningHook: string | null } | null;
  todaySpend: { amount: number; currency: string } | null;
};
export function mapConsoleData(input: MapConsoleInput): ConsoleData {
  const queue = mapQueue(input.escalations, input.approvals, input.now);
  return {
    opStrip: mapOpStrip(input.orgName, input.now, input.dispatch),
    numbers: mapNumbersStrip({
      leadsToday: input.leadsToday,
      leadsYesterday: input.leadsYesterday,
      bookingsToday: input.bookingsToday,
      revenue: input.revenue,
      replyTime: input.replyTime,
    }),
    queueLabel: { count: `${queue.length} pending` },
    queue,
    agents: mapAgents({
      modules: input.modules,
      alex: input.alex,
      nova: input.nova,
      mira: input.mira,
      todaySpend: input.todaySpend,
    }),
    novaPanel: consoleFixture.novaPanel, // option C replaces this with real ad-set aggregation
    activity: mapActivity(input.auditEntries),
  };
}

// Re-export AgentKey so consumers can import from one place
export type { AgentKey };
