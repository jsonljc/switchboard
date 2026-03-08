// ---------------------------------------------------------------------------
// Review Checker — Ad review status & policy violation checker
// ---------------------------------------------------------------------------

import type { AdReviewStatus } from "./types.js";

export class ReviewChecker {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async checkReviewStatus(adAccountId: string): Promise<AdReviewStatus[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    const filtering = JSON.stringify([
      {
        field: "effective_status",
        operator: "IN",
        value: ["DISAPPROVED", "WITH_ISSUES"],
      },
    ]);

    const url =
      `${this.baseUrl}/${accountId}/ads` +
      `?filtering=${encodeURIComponent(filtering)}` +
      `&fields=id,name,effective_status,review_feedback,ad_review_feedback` +
      `&access_token=${this.accessToken}`;

    const data = await this.fetchJson(url);
    const ads = (data.data ?? []) as Record<string, unknown>[];

    return ads.map((ad) => {
      const reviewFeedback = (ad.review_feedback ?? ad.ad_review_feedback ?? []) as Array<
        Record<string, unknown>
      >;
      const feedback = reviewFeedback.map((f) => ({
        type: String(f.type ?? ""),
        body: String(f.body ?? ""),
      }));

      const policyViolations = feedback
        .filter((f) => f.type === "POLICY_VIOLATION" || f.type === "policy_violation")
        .map((f) => f.body);

      return {
        adId: String(ad.id),
        adName: String(ad.name ?? ""),
        effectiveStatus: String(ad.effective_status ?? ""),
        reviewFeedback: feedback,
        policyViolations,
      };
    });
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
