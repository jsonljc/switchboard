// ---------------------------------------------------------------------------
// Audience Management Types
// ---------------------------------------------------------------------------

export type CustomAudienceSource = "website" | "customer_list" | "engagement" | "app" | "offline";

export type CustomAudienceSubtype = "CUSTOM" | "LOOKALIKE" | "WEBSITE" | "ENGAGEMENT" | "APP";

export interface CreateCustomAudienceParams {
  adAccountId: string;
  name: string;
  description?: string;
  source: CustomAudienceSource;
  rule?: Record<string, unknown>;
  customerFileSource?: string;
  retentionDays?: number;
}

export interface CreateLookalikeParams {
  adAccountId: string;
  name: string;
  sourceAudienceId: string;
  targetCountries: string[];
  ratio: number; // 0.01-0.20 (1%-20%)
  description?: string;
}

export interface CustomAudienceInfo {
  id: string;
  name: string;
  description: string | null;
  subtype: string;
  approximateCount: number | null;
  deliveryStatus: string | null;
  retentionDays: number | null;
  createdAt: string | null;
}

export interface AudienceInsights {
  audienceId: string;
  approximateCount: number;
  deliveryEstimate: {
    dailyReach: { lower: number; upper: number } | null;
  } | null;
}

export interface DeleteAudienceResult {
  success: boolean;
  audienceId: string;
}
