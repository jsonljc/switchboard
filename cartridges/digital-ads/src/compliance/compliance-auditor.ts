// ---------------------------------------------------------------------------
// Compliance Auditor — Composite compliance check
// ---------------------------------------------------------------------------
// Checks ad review status, special ad categories, pixel health, and CAPI
// configuration to produce an overall compliance score.
// ---------------------------------------------------------------------------

import type { ComplianceAuditResult, AdReviewStatus } from "./types.js";
import { ReviewChecker } from "./review-checker.js";

export class ComplianceAuditor {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async audit(adAccountId: string): Promise<ComplianceAuditResult> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    // 1. Check review status
    const reviewChecker = new ReviewChecker(this.baseUrl, this.accessToken);
    let allIssueAds: AdReviewStatus[] = [];
    try {
      allIssueAds = await reviewChecker.checkReviewStatus(adAccountId);
    } catch {
      // Continue audit even if review check fails
    }

    const disapprovedAds = allIssueAds.filter((ad) => ad.effectiveStatus === "DISAPPROVED");
    const adsWithIssues = allIssueAds.filter((ad) => ad.effectiveStatus !== "DISAPPROVED");

    // 2. Check special ad categories on the account
    let specialAdCategories: string[] = [];
    let specialAdCategoriesConfigured = false;
    try {
      const accountUrl =
        `${this.baseUrl}/${accountId}?fields=special_ad_categories` +
        `&access_token=${this.accessToken}`;
      const accountData = await this.fetchJson(accountUrl);
      const categories = accountData.special_ad_categories;
      if (Array.isArray(categories)) {
        specialAdCategories = categories.map(String);
        specialAdCategoriesConfigured = categories.length > 0;
      }
    } catch {
      // Non-blocking
    }

    // 3. Check pixel health
    let pixelHealthy = false;
    try {
      const pixelsUrl =
        `${this.baseUrl}/${accountId}/adspixels?fields=id,is_unavailable,last_fired_time` +
        `&access_token=${this.accessToken}`;
      const pixelsData = await this.fetchJson(pixelsUrl);
      const pixels = (pixelsData.data ?? []) as Record<string, unknown>[];
      pixelHealthy = pixels.some(
        (p) => !p.is_unavailable && p.last_fired_time != null,
      );
    } catch {
      // Non-blocking
    }

    // 4. Check CAPI configuration (via server events on pixel)
    let capiConfigured = false;
    try {
      const pixelsUrl =
        `${this.baseUrl}/${accountId}/adspixels?fields=id` +
        `&access_token=${this.accessToken}`;
      const pixelsData = await this.fetchJson(pixelsUrl);
      const pixels = (pixelsData.data ?? []) as Record<string, unknown>[];
      if (pixels.length > 0) {
        const pixelId = String(pixels[0]!.id);
        const statsUrl =
          `${this.baseUrl}/${pixelId}/stats?aggregation=event` +
          `&access_token=${this.accessToken}`;
        const statsData = await this.fetchJson(statsUrl);
        const stats = (statsData.data ?? []) as Record<string, unknown>[];
        capiConfigured = stats.some(
          (s) => Number(s.count_server ?? 0) > 0,
        );
      }
    } catch {
      // Non-blocking
    }

    // 5. Compute score and recommendations
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (disapprovedAds.length > 0) {
      issues.push(`${disapprovedAds.length} ad(s) disapproved`);
      recommendations.push("Review and fix disapproved ads to restore delivery");
    }
    if (adsWithIssues.length > 0) {
      issues.push(`${adsWithIssues.length} ad(s) with review issues`);
      recommendations.push("Address ad review feedback to prevent future disapprovals");
    }
    if (!pixelHealthy) {
      issues.push("No healthy pixel detected");
      recommendations.push("Install and verify Meta Pixel for conversion tracking");
    }
    if (!capiConfigured) {
      issues.push("Conversions API (CAPI) not configured");
      recommendations.push("Set up server-side event tracking via Conversions API");
    }

    // Score: start at 100, deduct for issues
    let score = 100;
    score -= disapprovedAds.length * 15;
    score -= adsWithIssues.length * 5;
    if (!pixelHealthy) score -= 20;
    if (!capiConfigured) score -= 10;
    score = Math.max(0, Math.min(100, score));

    return {
      accountId,
      auditedAt: new Date().toISOString(),
      disapprovedAds,
      adsWithIssues,
      specialAdCategoriesConfigured,
      specialAdCategories,
      pixelHealthy,
      capiConfigured,
      overallScore: score,
      issues,
      recommendations,
    };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
