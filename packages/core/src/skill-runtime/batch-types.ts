import type { GovernanceTier } from "./governance.js";

// ── Context Contract ──

export interface BatchContextRequirement {
  key: string;
  source: "ads" | "crm" | "deployment" | "benchmark";
  freshnessSeconds?: number;
  scope?: string;
}

export interface BatchContextContract {
  required: BatchContextRequirement[];
}

// ── Batch Execution Config ──

export interface BatchExecutionConfig {
  deploymentId: string;
  orgId: string;
  trigger: string;
  scheduleName?: string;
}

// ── Batch Skill Result ──

export interface BatchRecommendation {
  type: string;
  action: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface BatchProposedWrite {
  tool: string;
  operation: string;
  params: unknown;
  governanceTier: GovernanceTier;
}

export interface BatchSkillResult {
  recommendations: BatchRecommendation[];
  proposedWrites: BatchProposedWrite[];
  summary: string;
  nextRunHint?: string;
}

// ── Batch Parameter Builder ──

export interface BatchSkillStores {
  adsClient: {
    getCampaignInsights(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAccountSummary(): Promise<unknown>;
  };
  crmDataProvider: {
    getFunnelData(campaignIds: string[]): Promise<unknown>;
    getBenchmarks(accountId: string): Promise<unknown>;
  };
  deploymentStore: {
    findById(deploymentId: string): Promise<unknown>;
  };
}

export type BatchParameterBuilder = (
  config: BatchExecutionConfig,
  stores: BatchSkillStores,
  contract: BatchContextContract,
) => Promise<Record<string, unknown>>;

// ── Validation ──

export function validateBatchSkillResult(result: unknown): asserts result is BatchSkillResult {
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.recommendations)) {
    throw new Error("BatchSkillResult missing recommendations array");
  }
  if (!Array.isArray(r.proposedWrites)) {
    throw new Error("BatchSkillResult missing proposedWrites array");
  }
  if (typeof r.summary !== "string" || r.summary.length === 0) {
    throw new Error("BatchSkillResult missing summary string");
  }
}
