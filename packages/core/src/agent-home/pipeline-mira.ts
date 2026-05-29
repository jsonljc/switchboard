import type { PipelineViewModel, PipelineTileViewModel, PipelineStage } from "./pipeline-types.js";
import type { MiraCreativeStatus } from "../creative-read-model/types.js";
import { formatRelativeAge } from "./relative-age.js";

export interface MiraPipelineRow {
  id: string;
  title: string;
  status: MiraCreativeStatus;
  createdAt: Date;
}

export interface BuildMiraPipelineInput {
  rows: readonly MiraPipelineRow[];
  totalCount: number;
  now: Date;
}

export function buildMiraPipelineViewModel(input: BuildMiraPipelineInput): PipelineViewModel {
  const { rows, totalCount, now } = input;
  return {
    agentKey: "mira",
    pipelineKind: "creatives",
    countNoun: "creatives",
    totalCount,
    tiles: rows.map((r) => buildTile(r, now)),
    setupLink: { kind: "agent-setup", agentKey: "mira" },
    freshness: { generatedAt: now.toISOString(), window: "today", dataSource: "live" },
  };
}

function buildTile(row: MiraPipelineRow, now: Date): PipelineTileViewModel {
  return {
    id: row.id,
    stage: classifyStage(row.status),
    name: row.title,
    ctx: tileCtx(row, now),
    link: { kind: "creative-job", id: row.id },
  };
}

function classifyStage(status: MiraCreativeStatus): PipelineStage {
  if (status === "awaiting_review") return "hot";
  if (status === "draft_ready") return "warm";
  // Terminal/edge states (in_progress / stopped / failed / shipped) all map to
  // "new" — the lowest visual priority — so they don't draw hot/warm attention.
  // tileCtx() differentiates their display copy (e.g. "Drafting", "Stopped",
  // "Needs attention") even though the pipeline stage column shows "new".
  return "new";
}

function tileCtx(row: MiraPipelineRow, now: Date): string {
  // Use UTC as the timezone for pipeline tile relative-age labels (M1 pilot scale).
  const age = formatRelativeAge(row.createdAt, now, "UTC");
  switch (row.status) {
    case "awaiting_review":
      return `Ready for review · ${age}`;
    case "draft_ready":
      return `Draft completed · ${age}`;
    case "in_progress":
      return `Drafting · ${age}`;
    case "stopped":
      return `Stopped · ${age}`;
    case "failed":
      return `Needs attention · ${age}`;
    case "shipped":
      return `Draft completed · ${age}`;
  }
}
