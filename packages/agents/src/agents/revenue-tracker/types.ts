// ---------------------------------------------------------------------------
// Revenue Tracker — Dependency types (injected at construction time)
// ---------------------------------------------------------------------------

export interface PipelineStatus {
  stages: unknown[];
  totalValue: number;
}

export interface AttributionData {
  leads: number;
  bookings: number;
  revenue: number;
  roas: number;
}

export interface AdSnapshot {
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Dependencies injected into the Revenue Tracker handler.
 * The app layer wires these from cartridge implementations.
 */
export interface RevenueTrackerDeps {
  getPipelineStatus?: () => Promise<PipelineStatus>;
  getAttribution?: (params: { campaignId: string }) => Promise<AttributionData | null>;
  fetchAdSnapshot?: (params: { platform: string; entityId: string }) => Promise<AdSnapshot>;
}
