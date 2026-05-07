import { formatRelativeAge } from "./relative-age.js";
import type { PipelineViewModel, PipelineTileViewModel, PipelineStage } from "./pipeline-types.js";

export interface AlexPipelineRow {
  id: string;
  name: string | null;
  phone: string | null;
  stage: "active" | "new";
  lastActivityAt: Date;
}

export interface BuildAlexPipelineInput {
  rows: readonly AlexPipelineRow[];
  totalCount: number;
  now: Date;
  timezone: string;
}

const ACTIVITY_HOT_WARM_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

export function buildAlexPipelineViewModel(input: BuildAlexPipelineInput): PipelineViewModel {
  const { rows, totalCount, now, timezone } = input;
  const tiles = rows.map((row) => buildAlexTile(row, now, timezone));
  return {
    agentKey: "alex",
    pipelineKind: "leads",
    countNoun: "people",
    totalCount,
    tiles,
    setupLink: { kind: "agent-setup", agentKey: "alex" },
    freshness: {
      generatedAt: now.toISOString(),
      window: "today",
      dataSource: "live",
    },
  };
}

function buildAlexTile(row: AlexPipelineRow, now: Date, timezone: string): PipelineTileViewModel {
  return {
    id: row.id,
    stage: classifyAlexStage(row, now),
    name: alexTileName(row),
    ctx: alexTileCtx(row, now, timezone),
    link: { kind: "contact", id: row.id },
  };
}

function classifyAlexStage(row: AlexPipelineRow, now: Date): PipelineStage {
  if (row.stage === "active") return "hot";
  // stage === "new"
  const ageMs = now.getTime() - row.lastActivityAt.getTime();
  return ageMs < ACTIVITY_HOT_WARM_THRESHOLD_MS ? "warm" : "new";
}

function alexTileName(row: AlexPipelineRow): string {
  if (row.name && row.name.trim().length > 0) return row.name;
  if (row.phone) {
    const last4 = row.phone.replace(/\D/g, "").slice(-4);
    if (last4.length === 4) return `…${last4}`;
  }
  return "Unnamed lead";
}

function alexTileCtx(row: AlexPipelineRow, now: Date, timezone: string): string {
  const age = formatRelativeAge(row.lastActivityAt, now, timezone);
  return row.stage === "active" ? `In conversation · ${age}` : `New lead · ${age}`;
}
