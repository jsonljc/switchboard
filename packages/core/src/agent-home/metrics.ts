import type { AgentHomeKey } from "./agent-key.js";
import { buildWeekContext } from "./metrics-buckets.js";
import { buildAlexMetricsViewModel } from "./metrics-alex.js";
import { buildRileyMetricsViewModel } from "./metrics-riley.js";
import { buildMiraMetricsViewModel } from "./metrics-mira.js";
import type { MiraCreativeReadModelReader } from "../creative-read-model/types.js";

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
  KpiTile,
  RoiBar,
  RoiBarFull,
  RoiBarDegraded,
} from "./metrics-types.js";

import type { MetricsSignalStore, MetricsViewModel } from "./metrics-types.js";

export interface ProjectMetricsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: MetricsSignalStore;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  miraReader?: MiraCreativeReadModelReader;
}

export async function projectMetrics(input: ProjectMetricsInput): Promise<MetricsViewModel> {
  const week = buildWeekContext(input.now, input.timezone);

  if (input.agentKey === "mira") {
    if (!input.miraReader)
      throw new Error("projectMetrics: miraReader required for agentKey 'mira'");
    const rm = await input.miraReader.read(input.orgId, {
      now: input.now,
      timezone: input.timezone,
    });
    return buildMiraMetricsViewModel({ counts: rm.counts, week });
  }

  const builderInput = {
    orgId: input.orgId,
    week,
    store: input.store,
    targets: input.targets,
  };
  if (input.agentKey === "alex") {
    return buildAlexMetricsViewModel(builderInput);
  }
  return buildRileyMetricsViewModel(builderInput);
}
