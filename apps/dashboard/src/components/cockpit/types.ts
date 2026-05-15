export type CockpitStatus =
  | "IDLE"
  | "WORKING"
  | "TALKING"
  | "WAITING"
  | "WATCHING"
  | "REVIEWING"
  | "HALTED";

export interface MissionViewModel {
  subtitle: string;
  title: string;
  rows: Array<[string, string] | [string, string, "ok" | "warn" | "off"]>;
}

export type AlexApprovalKind =
  | "pricing"
  | "refund"
  | "qualification"
  | "regulatory"
  | "safety-gate"
  | "escalation";

export type RileyApprovalKind =
  | "pause"
  | "scale"
  | "refresh_creative"
  | "restructure"
  | "shift_budget_to_source"
  | "switch_optimization_event"
  | "harden_capi_attribution"
  | "hold"
  | "add_creative"
  | "review_budget"
  | "signal_health_group";

export type ApprovalUrgency = "immediate" | "this_week" | "next_cycle";

interface ApprovalViewBase {
  id: string;
  urgency: ApprovalUrgency;
  askedAt: string;
  title: string;
  body?: string;
  quote?: string;
  quoteFrom?: string;
  risk?: string;
  presentation: { primaryLabel: string; dismissLabel: string };
  primary: string;
  secondary: string;
  tertiaryLabel?: string;
  acceptToast?: string;
  declineToast?: string;
}

export type AlexApprovalView = ApprovalViewBase & {
  kind: AlexApprovalKind;
  primaryAction:
    | { kind: "respond"; bindingHash: string; verdict: "accept" | "deny" }
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> };
};

export type RileyApprovalView = ApprovalViewBase & {
  kind: RileyApprovalKind;
  campaign:
    | { kind: "campaign"; name: string; id: string }
    | { kind: "account"; pixelId: string; breaches: number };
  confidence: number;
  learningPhaseImpact: "no impact" | "will reset learning";
  reversible: boolean;
  primaryAction:
    | { kind: "internal"; intent: string; parameters: Record<string, unknown> }
    | { kind: "external"; url: string; service: "meta" | "google" };
};

export type ApprovalView = AlexApprovalView | RileyApprovalView;

export interface ThreadMessage {
  from: string;
  text: string;
}

export type ActivityKind =
  | "booked"
  | "qualified"
  | "replied"
  | "sent"
  | "started"
  | "connected"
  | "waiting"
  | "escalated"
  | "passed"
  | "watching"
  | "reviewing"
  | "paused"
  | "scaled"
  | "rotated"
  | "shifted"
  | "restructured"
  | "alert";

export interface ActivityRow {
  time: string;
  kind: ActivityKind;
  head: string;
  body?: string;
  who?: string;
  preview?: ThreadMessage[];
  replyable?: boolean;
  tag?: string;
}

// ─── A.3 KPI Strip + ROI Bar ──────────────────────────────────

export interface KpiTile {
  label: string;
  value: number | string;
  unit?: string;
  trend?: string;
  unavailable?: boolean;
  hint?: string;
}

export interface RoiBarFull {
  label: string;
  leftMeta: string;
  rightMeta: { value: string; suffix: string };
  fillPct: number;
  breakEvenPct: number;
  breakEvenLabel: string;
  scaleLeft: string;
  scaleRight: string;
  comparator: { value: string; target: string; onTarget: boolean };
}

export interface RoiBarDegraded {
  degraded: true;
  degradedHint: string;
  label?: string;
  comparator: { value: string; target: string; onTarget?: false };
}

export type RoiBar = RoiBarFull | RoiBarDegraded;

export interface CockpitKpiData {
  range: string;
  tiles?: KpiTile[];
  roi?: RoiBar;
  // legacy flat shape (Alex-side adapter)
  booked?: number | null;
  bookedDelta?: string | null;
  leads?: number | null;
  leadsDelta?: string | null;
  qualifiedPct?: number | null;
  qualifiedDelta?: string | null;
  spend?: number | null;
  avgValue?: number | null;
  target?: number | null;
}
