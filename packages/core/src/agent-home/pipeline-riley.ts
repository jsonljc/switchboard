import type { PipelineViewModel, PipelineTileViewModel, PipelineStage } from "./pipeline-types.js";

export interface RileyPipelineRow {
  id: string;
  intent: string;
  humanSummary: string;
  riskLevel: "low" | "medium" | "high";
  dollarsAtRisk: number;
  confidence: number;
  campaignName: string;
  campaignId: string;
  createdAt: Date;
  // Note: approvalRequired is not on this row shape. Auto-class exclusion
  // happens at the SQL filter layer (RecommendationStore.listPendingForAgent
  // uses approvalRequired <> 'auto'). Core has no logic that depends on the
  // value, so it doesn't need to cross the store→core boundary.
}

export interface BuildRileyPipelineInput {
  rows: readonly RileyPipelineRow[];
  totalCount: number;
  now: Date;
}

export const RILEY_HIGH_DOLLAR_THRESHOLD = 500;
export const RILEY_MEDIUM_DOLLAR_THRESHOLD = 100;

const RILEY_ACTION_VERB_BY_INTENT: Record<string, string> = {
  "recommendation.pause_adset": "pause",
  "recommendation.rotate_creative": "rotate creative",
  "recommendation.scale_budget": "scale budget",
};

export function buildRileyPipelineViewModel(input: BuildRileyPipelineInput): PipelineViewModel {
  const { rows, totalCount, now } = input;
  return {
    agentKey: "riley",
    pipelineKind: "ad-sets",
    countNoun: "ad sets",
    totalCount,
    tiles: rows.map(buildRileyTile),
    setupLink: { kind: "agent-setup", agentKey: "riley" },
    freshness: {
      generatedAt: now.toISOString(),
      window: "today",
      dataSource: "live",
    },
  };
}

function buildRileyTile(row: RileyPipelineRow): PipelineTileViewModel {
  return {
    id: row.id,
    stage: classifyRileyStage(row),
    name: row.campaignName,
    ctx: rileyTileCtx(row),
    link: { kind: "ad-set", id: row.campaignId },
  };
}

function classifyRileyStage(row: RileyPipelineRow): PipelineStage {
  if (row.riskLevel === "high") return "hot";
  if (row.riskLevel === "medium") {
    return row.dollarsAtRisk >= RILEY_HIGH_DOLLAR_THRESHOLD ? "hot" : "warm";
  }
  // riskLevel === "low"
  return row.dollarsAtRisk >= RILEY_MEDIUM_DOLLAR_THRESHOLD ? "warm" : "new";
}

function rileyTileCtx(row: RileyPipelineRow): string {
  return `$${formatDollars(row.dollarsAtRisk)} at risk · ${humanizeIntent(row.intent)}`;
}

function formatDollars(dollars: number): string {
  return Math.floor(dollars).toLocaleString("en-US");
}

function humanizeIntent(intent: string): string {
  return (
    RILEY_ACTION_VERB_BY_INTENT[intent] ??
    intent.replace(/^recommendation\./, "").replace(/_/g, " ")
  );
}
