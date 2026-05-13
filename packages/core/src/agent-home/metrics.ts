import type { AgentHomeKey } from "./agent-key.js";
import { buildWeekContext } from "./metrics-buckets.js";
import { buildAlexMetricsViewModel } from "./metrics-alex.js";
import { buildRileyMetricsViewModel } from "./metrics-riley.js";

// Re-export all types so barrel and test files continue working
export type {
  ProseSegment,
  MetricComparator,
  HeroMetric,
  SparkPoint,
  StatCell,
  DataFreshness,
  MetricsViewModel,
  MetricsSignalStore,
  PerAgentBuilderInput,
} from "./metrics-types.js";

import type { MetricsSignalStore, MetricsViewModel } from "./metrics-types.js";

export interface ProjectMetricsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: MetricsSignalStore;
}

export async function projectMetrics(input: ProjectMetricsInput): Promise<MetricsViewModel> {
  const week = buildWeekContext(input.now, input.timezone);
  if (input.agentKey === "alex") {
    return buildAlexMetricsViewModel({ orgId: input.orgId, week, store: input.store });
  }
  return buildRileyMetricsViewModel({ orgId: input.orgId, week, store: input.store });
}
