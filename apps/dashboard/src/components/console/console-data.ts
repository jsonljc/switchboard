/**
 * View-model types for the Console surface.
 *
 * The Console renders pre-formatted strings — currency, age ("4 min ago"),
 * unicode sparklines, etc. Each zone owns its own data hook and mapping;
 * there is no whole-page composer. These types describe the per-card and
 * per-zone shapes the view components consume.
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
