/**
 * View-model types for the Console surface.
 *
 * The Console renders pre-formatted strings — currency, age ("4 min ago"),
 * unicode sparklines, etc. The mapping from raw backend data to these
 * view-model shapes lives in `use-console-data.ts`. The view stays dumb.
 *
 * When wiring lands, only `use-console-data.ts` changes; the markup and
 * these types stay stable.
 */

export type AgentKey = "alex" | "nova" | "mira" | "system";

/** Inline text with optional <b> spans, used in queue + activity rows. */
export type RichSegment = string | { bold: string } | { coral: string };
export type RichText = RichSegment[];

export type OpStrip = {
  orgName: string;
  /** Pre-formatted display, e.g. "Thu 10:42 AM". */
  now: string;
  dispatch: "live" | "halted";
};

/**
 * Five-cell at-a-glance strip between the operating strip and queue.
 * Per 2026 SMB-dashboard research: 3-5 KPIs, owners scan in F-pattern,
 * each cell shows a value + a delta/context line.
 */
export type NumbersCell = {
  /** Mono uppercase label, e.g. "REVENUE TODAY". */
  label: string;
  /** Headline value, large General Sans, e.g. "$1,240". */
  value: string;
  /** Sub-line: delta or context. */
  delta: RichText;
  /** Optional tonal cue for the delta line. */
  tone?: "good" | "coral" | "neutral";
  /** When true, render value as muted "—" placeholder; data not yet wired. */
  placeholder?: boolean;
};

export type NumbersStrip = {
  cells: NumbersCell[];
};

export type EscalationCard = {
  kind: "escalation";
  id: string;
  /** Backend escalation id, used by `<EscalationSlideOver>` to drive useEscalationReply. */
  escalationId: string;
  agent: AgentKey;
  contactName: string;
  channel: string;
  /** "Urgent · 4 min ago" — pre-formatted. */
  timer: { label: string; ageDisplay: string };
  issue: RichText;
  primary: { label: string };
  secondary: { label: string };
  selfHandle: { label: string };
};

export type RecommendationCard = {
  kind: "recommendation";
  id: string;
  agent: AgentKey;
  action: string;
  /** Pre-formatted: "Immediate", "conf 0.87". */
  timer: { label: string; confidence: string };
  /** Mono data lines under the action. */
  dataLines: RichText[];
  primary: { label: string };
  secondary: { label: string };
  dismiss: { label: string };
};

export type ApprovalGateCard = {
  kind: "approval_gate";
  id: string;
  /** Backend approval id, used by `<ApprovalSlideOver>` to drive useApprovalAction. */
  approvalId: string;
  /** Binding hash from the source approval — required by the API to approve/reject. */
  bindingHash: string;
  agent: AgentKey;
  jobName: string;
  /** "Hooks ready · 2h ago". */
  timer: { stageLabel: string; ageDisplay: string };
  /** "Stage 2 of 5". */
  stageProgress: string;
  stageDetail: string;
  /** "gate closes in 21h". */
  countdown: string;
  primary: { label: string };
  stop: { label: string };
};

export type QueueCard = EscalationCard | RecommendationCard | ApprovalGateCard;

export type AgentStripEntry = {
  key: AgentKey;
  name: string;
  primaryStat: string;
  subStat: RichText;
  pendingDot?: boolean;
  viewLink: { label: string; href: string };
  active?: boolean;
};

export type AdSetRow = {
  id: string;
  name: string;
  spend: string;
  ctr: string;
  spark: string;
  sparkDirection: "up" | "down" | "flat";
  recommended: string;
  status: string;
  pausePending?: boolean;
};

export type NovaPanel = {
  /** "Nova · Ad actions" — title comes from agent label. */
  spendDisplay: string;
  draftsPending: number;
  rows: AdSetRow[];
  /** Pinned cross-link to a queue card. */
  draftNote?: {
    adSetName: string;
    queueAnchor: string;
    actionLabel: string;
  };
  confidenceDisplay: string;
  setsTracked: number;
  fullViewHref: string;
};

export type ActivityRow = {
  id: string;
  /** Pre-formatted "10:42". */
  time: string;
  agent: AgentKey;
  message: RichText;
  cta?: { label: string; href: string };
};

export type ConsoleData = {
  opStrip: OpStrip;
  numbers: NumbersStrip;
  queueLabel: { count: string };
  queue: QueueCard[];
  agents: AgentStripEntry[];
  novaPanel: NovaPanel;
  activity: { moreToday: number; rows: ActivityRow[] };
};

// ---------------------------------------------------------------------------
// Fixture — moves to a real mapper inside use-console-data.ts when wiring
// lands. Until then this is the single source of demo data.
// ---------------------------------------------------------------------------

export const consoleFixture: ConsoleData = {
  opStrip: {
    orgName: "Aurora Dental",
    now: "Thu 10:42 AM",
    dispatch: "live",
  },
  numbers: {
    cells: [
      {
        label: "Revenue today",
        value: "$1,240",
        delta: [{ bold: "+18%" }, " vs avg"],
        tone: "good",
      },
      {
        label: "Leads today",
        value: "7",
        delta: ["↑ ", { bold: "2" }, " vs yesterday"],
        tone: "good",
      },
      {
        label: "Appointments",
        value: "3",
        delta: ["next: ", { bold: "11:00" }, " · Sarah"],
        tone: "neutral",
      },
      {
        label: "Spend today",
        value: "$842",
        delta: [{ bold: "24%" }, " of cap"],
        tone: "neutral",
      },
      {
        label: "Reply time",
        value: "12s",
        delta: ["↓ from ", { bold: "18s" }, " yest."],
        tone: "good",
      },
    ],
  },
  queueLabel: { count: "3 pending" },
  queue: [
    {
      kind: "escalation",
      id: "esc-sarah",
      escalationId: "esc-sarah",
      agent: "alex",
      contactName: "Sarah",
      channel: "WhatsApp",
      timer: { label: "Urgent", ageDisplay: "4 min ago" },
      issue: [
        "Asking about a ",
        { bold: "15% discount" },
        ". Outside your stated policy. Alex is paused and waiting for your call before replying.",
      ],
      primary: { label: "Send discount 10%" },
      secondary: { label: "Hold the line" },
      selfHandle: { label: "I'll handle this" },
    },
    {
      kind: "recommendation",
      id: "queue-pause-pending",
      agent: "nova",
      action: "Pause Ad Set B — Dental Whitening",
      timer: { label: "Immediate", confidence: "0.87" },
      dataLines: [
        [{ bold: "$180" }, " spent · 0.4% CTR vs 2.1% avg · 0 leads this week"],
        ["7-day trend ▼ 38% · saturation index ", { bold: "0.91" }],
        ["Pausing saves ", { bold: "~$340" }, " before the next review window"],
      ],
      primary: { label: "Approve pause" },
      secondary: { label: "Edit" },
      dismiss: { label: "Dismiss" },
    },
    {
      kind: "approval_gate",
      id: "gate-campaign-01",
      approvalId: "gate-campaign-01",
      bindingHash: "fixture-binding-hash",
      agent: "mira",
      jobName: "Campaign 01 — Dental UGC Series",
      timer: { stageLabel: "Hooks ready", ageDisplay: "2h ago" },
      stageProgress: "Stage 2 of 5",
      stageDetail: "3 hook variants ready for review",
      countdown: "gate closes in 21h",
      primary: { label: "Review hooks →" },
      stop: { label: "Stop campaign" },
    },
  ],
  agents: [
    {
      key: "alex",
      name: "Alex",
      primaryStat: "14 replied today",
      subStat: ["12s · 4 qualified · 2 booked"],
      viewLink: { label: "view conversations →", href: "/conversations" },
    },
    {
      key: "nova",
      name: "Nova",
      primaryStat: "$842 spent today",
      subStat: ["2 drafts · 1 pending"],
      pendingDot: true,
      active: true,
      viewLink: { label: "view ad actions →", href: "/modules/ad-optimizer" },
    },
    {
      key: "mira",
      name: "Mira",
      primaryStat: "3 in flight",
      subStat: ["Hook 2 winning"],
      viewLink: { label: "view creative →", href: "/modules/creative" },
    },
  ],
  novaPanel: {
    spendDisplay: "$842",
    draftsPending: 2,
    rows: [
      {
        id: "as-cleaning-retarget",
        name: "Cleaning · retarget · 30d",
        spend: "$596",
        ctr: "2.4%",
        spark: "▃▄▅▄▆▇▆",
        sparkDirection: "up",
        recommended: "Hold",
        status: "Active",
      },
      {
        id: "as-whitening-b",
        name: "Whitening · Ad Set B",
        spend: "$180",
        ctr: "0.4%",
        spark: "▆▅▄▃▃▂▁",
        sparkDirection: "down",
        recommended: "Pause",
        status: "Pause pending",
        pausePending: true,
      },
      {
        id: "as-implants-lal",
        name: "Implants · lookalike 1%",
        spend: "$42",
        ctr: "3.1%",
        spark: "▂▃▃▄▅▅▆",
        sparkDirection: "up",
        recommended: "Scale +20%",
        status: "Active",
      },
      {
        id: "as-whitening-cdmx",
        name: "Whitening · CTWA · CDMX",
        spend: "$24",
        ctr: "2.8%",
        spark: "▄▄▅▄▅▄▅",
        sparkDirection: "flat",
        recommended: "Hold",
        status: "Active",
      },
      {
        id: "as-cleaning-prospecting",
        name: "Cleaning · prospecting",
        spend: "$0",
        ctr: "—",
        spark: "▁▁▁▁▁▁▁",
        sparkDirection: "flat",
        recommended: "Resume",
        status: "Paused",
      },
    ],
    draftNote: {
      adSetName: "Whitening · Ad Set B",
      queueAnchor: "#queue-pause-pending",
      actionLabel: "Drafting pause",
    },
    confidenceDisplay: "0.87",
    setsTracked: 4,
    fullViewHref: "/modules/ad-optimizer",
  },
  activity: {
    moreToday: 18,
    rows: [
      {
        id: "ev-1",
        time: "10:42",
        agent: "nova",
        message: ["Draft pause created — ", { bold: "Ad Set B" }],
        cta: { label: "Approve", href: "#queue-pause-pending" },
      },
      {
        id: "ev-2",
        time: "10:38",
        agent: "alex",
        message: ["Lead booked — ", { bold: "Sarah" }, " · consultation"],
      },
      {
        id: "ev-3",
        time: "10:31",
        agent: "mira",
        message: ["Hooks ready — ", { bold: "Campaign 01" }],
        cta: { label: "Review", href: "#" },
      },
      {
        id: "ev-4",
        time: "10:14",
        agent: "nova",
        message: ["Budget pacing normal across all sets"],
      },
      {
        id: "ev-5",
        time: "09:55",
        agent: "alex",
        message: ["3 new leads replied · WhatsApp"],
      },
      {
        id: "ev-6",
        time: "09:40",
        agent: "mira",
        message: ["Brief received — Dental UGC Series"],
      },
      {
        id: "ev-7",
        time: "09:22",
        agent: "nova",
        message: ["Hourly scan — 12 sets normal · 1 flagged"],
      },
      {
        id: "ev-8",
        time: "09:08",
        agent: "alex",
        message: ["First reply to ", { bold: "Marisol G." }, " in 11s"],
      },
      {
        id: "ev-9",
        time: "08:51",
        agent: "mira",
        message: ["Trend scan complete — 3 hooks generated"],
      },
    ],
  },
};
