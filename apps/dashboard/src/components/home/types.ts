import type { AgentKey } from "@switchboard/schemas";

/** One agent in the Team Pulse chip ribbon. `setUp` false ⇒ greyed/coming-soon chip. */
export interface TeamPulseAgent {
  key: AgentKey;
  name: string;
  status: "working" | "idle";
  setUp: boolean;
}

/** Tone of the verdict line: active (work pending), calm (caught up), fallback (no signal). */
export type VerdictShape = "active" | "calm" | "fallback";

/** The one-sentence verdict at the top of Home. `line` is a 3-part span (pre/em/post) or a plain string. */
export interface VerdictModel {
  shape: VerdictShape;
  eyebrow: string;
  salutation: string;
  line: { pre: string; em: string; post: string } | string;
  proof: string;
  /** When set, the `em` accent is colored with `hsl(var(--agent-{accentAgent}))`. Calm/fallback leave this undefined. */
  accentAgent?: AgentKey;
}

/** Raw inputs a verdict composer reads to pick shape + copy. Never rendered directly. */
export interface VerdictSignals {
  decisionCount: number;
  openLeadCount: number;
  oldestWaitMin: number | null;
  workingCount: number;
  setUpCount: number;
  ownerName?: string;
  /** The display name of the top-priority agent (e.g. "Alex"). Used in the active verdict line. */
  topAgentName?: string;
  /** The key of the top-priority agent (e.g. "alex"). Used to pick the identity accent color. */
  topAgentKey?: AgentKey;
  /** When true, core signals are not yet available; composer uses the FALLBACK shape. */
  unavailable?: boolean;
  now?: Date;
}

/** "This week" employee-style note. Optional numeric fields undefined ⇒ skeleton, never fabricated. */
export interface ThisWeekModel {
  authorName: string;
  authorKey: AgentKey;
  bookedConsults?: number;
  newLeads?: number;
  replyTime?: string;
  costPerLead?: string;
  ps?: string;
  reportHref: string;
}

/** One overnight-activity row in the "While you slept" quiet list. */
export interface WhileYouSleptRow {
  agentKey: AgentKey;
  time: string;
  text: string;
}

/** One in-flight task. `chain` is non-null ONLY when backed by a real typed-handoff trace. */
export interface WorkInProgressItem {
  id: string;
  primaryAgent: AgentKey;
  chain: AgentKey[] | null;
  text: string;
}

/** The single quiet permissions line and its link to the adjust surface. */
export interface PermissionsModel {
  summary: string;
  adjustHref: string;
}
