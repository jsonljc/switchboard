import type { AgentHomeKey } from "./agent-key.js";
import { buildAlexPipelineViewModel, type AlexPipelineRow } from "./pipeline-alex.js";
import { buildRileyPipelineViewModel, type RileyPipelineRow } from "./pipeline-riley.js";
import { buildMiraPipelineViewModel, type MiraPipelineRow } from "./pipeline-mira.js";
import type { PipelineViewModel } from "./pipeline-types.js";

export const PIPELINE_VISIBLE_LIMIT = 5;
const ALEX_ACTIVITY_WINDOW_DAYS = 7;

export interface PipelineSignalStore {
  listAlexPipeline(input: {
    orgId: string;
    activitySince: Date;
    limit: number;
  }): Promise<{ rows: AlexPipelineRow[]; totalCount: number }>;

  listRileyPipeline(input: {
    orgId: string;
    limit: number;
  }): Promise<{ rows: RileyPipelineRow[]; totalCount: number }>;

  listMiraPipeline(input: {
    orgId: string;
    limit: number;
  }): Promise<{ rows: MiraPipelineRow[]; totalCount: number }>;
}

export interface ProjectPipelineInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: PipelineSignalStore;
}

export async function projectPipeline(input: ProjectPipelineInput): Promise<PipelineViewModel> {
  const { orgId, agentKey, now, timezone, store } = input;

  if (agentKey === "alex") {
    const activitySince = new Date(now.getTime() - ALEX_ACTIVITY_WINDOW_DAYS * 86_400_000);
    const { rows, totalCount } = await store.listAlexPipeline({
      orgId,
      activitySince,
      limit: PIPELINE_VISIBLE_LIMIT,
    });
    return buildAlexPipelineViewModel({ rows, totalCount, now, timezone });
  }

  if (agentKey === "mira") {
    const { rows, totalCount } = await store.listMiraPipeline({
      orgId,
      limit: PIPELINE_VISIBLE_LIMIT,
    });
    return buildMiraPipelineViewModel({ rows, totalCount, now });
  }

  // agentKey === "riley"
  const { rows, totalCount } = await store.listRileyPipeline({
    orgId,
    limit: PIPELINE_VISIBLE_LIMIT,
  });
  return buildRileyPipelineViewModel({ rows, totalCount, now });
}

export type { AlexPipelineRow } from "./pipeline-alex.js";
export type { RileyPipelineRow } from "./pipeline-riley.js";
export type { MiraPipelineRow } from "./pipeline-mira.js";
export type {
  PipelineStage,
  PipelineTileViewModel,
  PipelineViewModel,
  PipelineFreshness,
  AgentHomeLink,
} from "./pipeline-types.js";
