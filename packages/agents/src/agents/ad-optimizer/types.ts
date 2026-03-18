// ---------------------------------------------------------------------------
// Ad Optimizer Agent — dependency types
// ---------------------------------------------------------------------------

export interface FunnelDiagnosis {
  bottleneck: string;
  findings: unknown[];
  roas: number;
}

export interface CampaignSnapshot {
  spend: number;
  revenue: number;
  conversions: number;
}

export interface StructureAnalysis {
  findings: unknown[];
}

export interface AdOptimizerDeps {
  diagnoseFunnel?: (params: {
    platform: string;
    entityId: string;
    vertical: string;
  }) => Promise<FunnelDiagnosis>;

  fetchSnapshot?: (params: { platform: string; entityId: string }) => Promise<CampaignSnapshot>;

  analyzeStructure?: (params: { platform: string; entityId: string }) => Promise<StructureAnalysis>;
}
