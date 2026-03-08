// ---------------------------------------------------------------------------
// Policy Scanner — Checks for policy violations, disapproved ads, and limits
// ---------------------------------------------------------------------------

import type { PolicyScanResult } from "./types.js";

export class PolicyScanner {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  /**
   * Scan an ad account for policy violations, disapproved ads, and approaching spend limits.
   */
  async scan(adAccountId: string): Promise<PolicyScanResult> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const scannedAt = new Date().toISOString();

    const disapprovedAds: PolicyScanResult["disapprovedAds"] = [];
    const policyWarnings: PolicyScanResult["policyWarnings"] = [];
    const issues: string[] = [];

    // 1. Check for disapproved ads
    try {
      const adsUrl =
        `${this.baseUrl}/${accountId}/ads?` +
        `fields=id,name,effective_status,ad_review_feedback` +
        `&filtering=[{"field":"effective_status","operator":"IN","value":["DISAPPROVED","WITH_ISSUES"]}]` +
        `&limit=100` +
        `&access_token=${this.accessToken}`;

      const adsData = await this.fetchJson(adsUrl);
      const ads = (adsData.data ?? []) as Array<Record<string, unknown>>;

      for (const ad of ads) {
        const feedback = ad.ad_review_feedback as Record<string, unknown> | undefined;
        const globalReasons = (feedback?.global ?? {}) as Record<string, string>;
        const reasons = Object.values(globalReasons);
        disapprovedAds.push({
          adId: String(ad.id),
          adName: String(ad.name ?? ""),
          reason: reasons.length > 0 ? reasons.join("; ") : "Unknown policy violation",
        });
      }

      if (disapprovedAds.length > 0) {
        issues.push(`${disapprovedAds.length} ad(s) have been disapproved or flagged.`);
      }
    } catch {
      issues.push("Failed to check for disapproved ads.");
    }

    // 2. Check account-level spend limits
    let spendLimitApproaching = false;
    try {
      const accountUrl =
        `${this.baseUrl}/${accountId}?` +
        `fields=spend_cap,amount_spent` +
        `&access_token=${this.accessToken}`;

      const accountData = await this.fetchJson(accountUrl);
      const spendCap = Number(accountData.spend_cap ?? 0);
      const amountSpent = Number(accountData.amount_spent ?? 0);

      if (spendCap > 0) {
        const spendRatio = amountSpent / spendCap;
        if (spendRatio >= 0.9) {
          spendLimitApproaching = true;
          const remaining = (spendCap - amountSpent) / 100; // cents to dollars
          issues.push(
            `Account spend limit is ${(spendRatio * 100).toFixed(1)}% utilized. ` +
              `Only $${remaining.toFixed(2)} remaining.`,
          );
          policyWarnings.push({
            entityType: "account",
            entityId: accountId,
            warning: `Spend limit approaching: ${(spendRatio * 100).toFixed(1)}% used.`,
          });
        }
      }
    } catch {
      issues.push("Failed to check account spend limits.");
    }

    // 3. Check for campaigns with policy warnings
    try {
      const campaignsUrl =
        `${this.baseUrl}/${accountId}/campaigns?` +
        `fields=id,name,issues_info` +
        `&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]` +
        `&limit=100` +
        `&access_token=${this.accessToken}`;

      const campaignsData = await this.fetchJson(campaignsUrl);
      const campaigns = (campaignsData.data ?? []) as Array<Record<string, unknown>>;

      for (const campaign of campaigns) {
        const issuesInfo = (campaign.issues_info ?? []) as Array<Record<string, unknown>>;
        for (const issue of issuesInfo) {
          policyWarnings.push({
            entityType: "campaign",
            entityId: String(campaign.id),
            warning: String(issue.error_summary ?? issue.level ?? "Policy issue detected"),
          });
        }
      }

      if (policyWarnings.length > disapprovedAds.length) {
        issues.push(`${policyWarnings.length} policy warning(s) detected across campaigns.`);
      }
    } catch {
      issues.push("Failed to check campaign policy warnings.");
    }

    const overallHealthy =
      disapprovedAds.length === 0 && !spendLimitApproaching && issues.length === 0;

    return {
      adAccountId: accountId,
      scannedAt,
      disapprovedAds,
      policyWarnings,
      spendLimitApproaching,
      overallHealthy,
      issues,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
