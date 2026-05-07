// Agent Home projection and types
export type { AgentHomeKey } from "./agent-key.js";
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
export {
  projectPipeline,
  PIPELINE_VISIBLE_LIMIT,
  type PipelineSignalStore,
  type ProjectPipelineInput,
  type AlexPipelineRow,
  type RileyPipelineRow,
  type PipelineStage,
  type PipelineTileViewModel,
  type PipelineViewModel,
  type PipelineFreshness,
  type AgentHomeLink,
} from "./pipeline.js";
