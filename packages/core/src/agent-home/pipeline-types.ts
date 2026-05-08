import type { AgentHomeKey } from "./agent-key.js";

export type PipelineStage = "hot" | "warm" | "new";

export type AgentHomeLink =
  | { kind: "contact"; id: string }
  | { kind: "ad-set"; id: string }
  | { kind: "creative-job"; id: string }
  | { kind: "agent-setup"; agentKey: AgentHomeKey | "mira" }
  | { kind: "all-wins"; agentKey: AgentHomeKey | "mira" };

export interface PipelineTileViewModel {
  id: string;
  stage: PipelineStage;
  name: string;
  ctx: string;
  link: AgentHomeLink;
}

export interface PipelineFreshness {
  generatedAt: string;
  window: "today" | "week" | "month";
  dataSource: "live" | "fixture";
  isPartial?: boolean;
  unavailableSources?: readonly string[];
}

export interface PipelineViewModel {
  agentKey: AgentHomeKey;
  pipelineKind: "leads" | "ad-sets" | "creatives";
  countNoun: "people" | "ad sets" | "creatives";
  totalCount: number;
  tiles: readonly PipelineTileViewModel[];
  setupLink: AgentHomeLink;
  freshness: PipelineFreshness;
}
