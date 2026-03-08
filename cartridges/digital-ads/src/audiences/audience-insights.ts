// ---------------------------------------------------------------------------
// Audience Insights — Reach estimation, overlap detection
// ---------------------------------------------------------------------------

import type { AudienceInsights } from "./types.js";

export class AudienceInsightsChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async getInsights(audienceId: string): Promise<AudienceInsights> {
    const url =
      `${this.baseUrl}/${audienceId}?fields=id,approximate_count` +
      `&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audience insights for ${audienceId}`);
    }
    const data = (await response.json()) as Record<string, unknown>;

    return {
      audienceId,
      approximateCount: Number(data.approximate_count ?? 0),
      deliveryEstimate: null,
    };
  }

  async getReachEstimate(
    adAccountId: string,
    targetingSpec: Record<string, unknown>,
  ): Promise<{ dailyReach: { lower: number; upper: number } }> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const url =
      `${this.baseUrl}/${accountId}/delivery_estimate?` +
      `targeting_spec=${encodeURIComponent(JSON.stringify(targetingSpec))}` +
      `&optimization_goal=REACH` +
      `&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch delivery estimate");
    }
    const data = (await response.json()) as Record<string, unknown>;
    const estimates = (data.data as unknown[]) ?? [];
    const estimate = estimates[0] as Record<string, unknown> | undefined;
    const curve = estimate?.daily_outcomes_curve as Array<Record<string, unknown>> | undefined;

    return {
      dailyReach: {
        lower: Number(curve?.[0]?.reach ?? 0),
        upper: Number(curve?.[1]?.reach ?? 0),
      },
    };
  }
}
