// apps/dashboard/src/lib/agent-home/types.ts
import type { AgentKey } from "@switchboard/schemas";

export type AgentWindow = "today" | "week" | "month";

export type DataSource = "fixture" | "live";

export interface DataFreshness {
  generatedAt: string;
  window: AgentWindow;
  dataSource: DataSource;
  isPartial?: boolean;
  unavailableSources?: readonly string[];
}

export type ProseSegment = { kind: "text"; text: string } | { kind: "accent"; text: string };

export interface MetricComparator {
  window: AgentWindow;
  value: number;
}

export type AgentHomeLink =
  | { kind: "contact"; id: string }
  | { kind: "ad-set"; id: string }
  | { kind: "creative-job"; id: string }
  | { kind: "agent-setup"; agentKey: AgentKey }
  | { kind: "all-wins"; agentKey: AgentKey };

export interface AgentBlockQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

export interface AgentBlockResponse<T> {
  data: T;
}

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

export type WinSource = "recommendation" | "booking" | "conversion";

export interface WinViewModel {
  id: string;
  agentKey: AgentKey;
  source: WinSource;
  occurredAt: string;
  timeFolio: string;
  proseSegments: readonly ProseSegment[];
  undo: {
    available: boolean;
    until: string | null;
    unavailableReason?: "expired" | "not-reversible" | "missing-permission";
  };
}

export interface WinsViewModel {
  wins: readonly WinViewModel[];
  hasMore: boolean;
  freshness: DataFreshness;
}

export type HeroMetric =
  | { kind: "tours-booked"; value: number; comparator: MetricComparator }
  | { kind: "ad-leads"; value: number; comparator: MetricComparator }
  | { kind: "creatives-shipped"; value: number; comparator: MetricComparator }
  | { kind: "revenue-attributed"; value: number; currency: string; comparator: MetricComparator };

export interface SparkPoint {
  label: string;
  value: number;
  isProjection?: boolean;
}

export interface StatCell {
  label: string;
  display: string;
  rawValue: number;
  unit: "count" | "percent" | "currency";
}

export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
}

export type PipelineStage = "hot" | "warm" | "new";

export interface PipelineTileViewModel {
  id: string;
  stage: PipelineStage;
  name: string;
  ctx: string;
  link: AgentHomeLink;
}

export interface PipelineViewModel {
  agentKey: AgentKey;
  pipelineKind: "leads" | "ad-sets" | "creatives";
  totalCount: number;
  countNoun: "people" | "ad sets" | "creatives";
  tiles: readonly PipelineTileViewModel[];
  setupLink: AgentHomeLink;
  freshness: DataFreshness;
}
