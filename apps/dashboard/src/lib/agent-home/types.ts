// apps/dashboard/src/lib/agent-home/types.ts
import type { AgentKey } from "@switchboard/schemas";

// ─── Shared ───────────────────────────────────────────────────
// Trailing windows, not calendar. "week" = trailing 7d ending now.
// "month" = trailing 30d. UI copy may say "This Week" — that's a
// label decision, not a windowing decision.
export type AgentWindow = "today" | "week" | "month";

export type DataSource = "fixture" | "live";

export interface DataFreshness {
  generatedAt: string; // ISO
  window: AgentWindow;
  dataSource: DataSource;
  isPartial?: boolean;
  unavailableSources?: readonly string[]; // optional sources that failed
}

export type ProseSegment = { kind: "text"; text: string } | { kind: "accent"; text: string };

export interface MetricComparator {
  window: AgentWindow;
  value: number;
}

// Backend identifies the object; frontend resolves the route.
// Pipeline tiles render disabled when the target route doesn't yet exist.
export type AgentHomeLink =
  | { kind: "contact"; id: string }
  | { kind: "ad-set"; id: string }
  | { kind: "creative-job"; id: string }
  | { kind: "agent-setup"; agentKey: AgentKey }
  | { kind: "all-wins"; agentKey: AgentKey };

// Stable async-shape contract for every block hook.
// PR-S1 fixture form returns immediate data; live PRs swap internals only.
export interface AgentBlockQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

// Wire-shape wrapper used by all four endpoints.
export interface AgentBlockResponse<T> {
  data: T;
}

// ─── B1 Greeting ──────────────────────────────────────────────
export type GreetingVariant = "named-lead" | "quiet" | "busy";

export interface GreetingViewModel {
  variant: GreetingVariant;
  segments: readonly ProseSegment[];
  signal: {
    inboxCount: number;
    oldestOpenItemAgeHours: number | null;
    hoursSinceLastOperatorAction: number | null;
  };
  freshness: DataFreshness;
}

// ─── B3 Recent Wins ───────────────────────────────────────────
// Source priority for v1: terminal PendingActionRecord (resolved/dismissed/confirmed).
// Bookings + ConversionRecord are optional `DepResult` sources — same shape,
// `source` field discriminates.
export type WinSource = "recommendation" | "booking" | "conversion";

export interface WinViewModel {
  id: string;
  agentKey: AgentKey; // future cross-agent inbox without contract churn
  source: WinSource;
  occurredAt: string; // ISO
  timeFolio: string; // pre-rendered: "11:42 AM" / "Yesterday · 6:14 PM"
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null; // ISO if available
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

// ─── B4 This Week ─────────────────────────────────────────────
// Per-agent hero is different. Discriminated union, not a polymorphic struct.
// `revenue-attributed` exists in the union but is not the default for either
// agent in Slice B (no per-agent attribution wiring on LifecycleRevenueEvent yet).
export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | { kind: "revenue-attributed"; value: number; currency: string; comparator: MetricComparator };

export interface SparkPoint {
  label: string; // "Mon" / "last week" — pre-rendered
  value: number;
  isProjection?: boolean;
}

// Stat cells are uniform across agents (3 columns), but the backend chooses
// what each cell means per-agent.
export interface StatCell {
  label: string;
  display: string;
  rawValue: number | null;
  unit: "count" | "percent" | "currency";
  unavailable?: boolean;
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
}

// ─── B5 Pipeline ──────────────────────────────────────────────
// Pipeline is fundamentally different per agent, so the tile shape is shared
// but the *meaning* of `stage` and the source of `name`/`ctx` is per-agent.
export type PipelineStage = "hot" | "warm" | "new";

export interface PipelineTileViewModel {
  id: string; // contactId / pendingActionRecordId / creativeJobId
  stage: PipelineStage;
  name: string;
  ctx: string;
  link: AgentHomeLink; // typed link, frontend resolves to href
}

export interface PipelineViewModel {
  agentKey: AgentKey;
  pipelineKind: "leads" | "ad-sets" | "creatives";
  totalCount: number;
  countNoun: "people" | "ad sets" | "creatives";
  tiles: readonly PipelineTileViewModel[];
  setupLink: AgentHomeLink; // always { kind: "agent-setup", agentKey }
  freshness: DataFreshness;
}
