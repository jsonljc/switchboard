// Agent Home projection and types
export type { AgentHomeKey } from "./agent-key.js";
export {
  computeVariant,
  buildSegments,
  projectGreeting,
  InMemoryGreetingSignalStore,
  type GreetingVariant,
  type GreetingSignal,
  type TopItemMeta,
  type GreetingProjection,
  type GreetingSignalStore,
  type ProjectGreetingInput,
  type GreetingAgentConfig,
} from "./greeting.js";
export {
  projectWins,
  type WinSource,
  type WinStatus,
  type WinTerminalRecord,
  type WinsSignalStore,
  type WinViewModel,
  type WinsViewModel,
  type WinsAgentConfig,
  type ProseSegment,
  type DataFreshness,
  type ProjectWinsInput,
} from "./wins.js";
export { computeWindowStart, type WinTimeWindow } from "./window.js";
export { formatTimeFolio } from "./time-folio.js";
export { formatRelativeAge } from "./relative-age.js";
export { buildMiraPipelineViewModel, type BuildMiraPipelineInput } from "./pipeline-mira.js";
export {
  projectPipeline,
  PIPELINE_VISIBLE_LIMIT,
  type PipelineSignalStore,
  type ProjectPipelineInput,
  type AlexPipelineRow,
  type RileyPipelineRow,
  type MiraPipelineRow,
  type PipelineStage,
  type PipelineTileViewModel,
  type PipelineViewModel,
  type PipelineFreshness,
  type AgentHomeLink,
} from "./pipeline.js";
export {
  projectBookingWins,
  type BookingWinSignalRow,
  type BookingWinViewModel,
  type BookingWinsViewModel,
} from "./booking-wins.js";

// Metrics (PR-S5)
export { projectMetrics, type ProjectMetricsInput } from "./metrics.js";
export { buildMiraMetricsViewModel, type BuildMiraMetricsInput } from "./metrics-mira.js";
export type {
  MetricsSignalStore,
  MetricsViewModel,
  HeroMetric,
  MetricComparator,
  SparkPoint,
  StatCell,
} from "./metrics-types.js";
export { buildWeekContext, type WeekContext } from "./metrics-buckets.js";
export { getAgentTargets, type AgentTargets } from "./targets.js";
export type { ActivityPreviewReader, ThreadMessageRecord } from "./activity-preview-reader.js";
export { extractContactRef } from "./contact-snapshot-extractors.js";
export type { ContactRef } from "./contact-snapshot-extractors.js";
export { translateAuditToCockpitActivity } from "./cockpit-activity-translator.js";
export type {
  AuditEntryForTranslator,
  TranslateAuditToCockpitActivityArgs,
} from "./cockpit-activity-translator.js";
