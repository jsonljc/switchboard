import { MetaAdsClient } from "@switchboard/ad-optimizer";
import { decryptCredentials } from "@switchboard/db";
import type { PrismaClient } from "@switchboard/db";
import type { MetaInsightsProvider, InsightsWindowQuery, WindowMetrics } from "@switchboard/core";

/**
 * Constructs a MetaInsightsProvider for a single org.
 *
 * Resolves the org's Meta-ads deployment connection (accessToken + accountId)
 * from the DB, then adapts MetaAdsClient.getCampaignInsights() into the
 * getWindowMetrics() shape expected by runRileyOutcomeAttribution.
 *
 * Returns a stub provider (all calls → null) when no active Meta-ads
 * connection exists for the org — outcome rows will carry meta_data_missing
 * visibility flags and cockpitRenderable=false, which is the correct fallback.
 */
export function createMetaInsightsProviderForOrg(
  orgId: string,
  prisma: PrismaClient,
): MetaInsightsProvider {
  return {
    async getWindowMetrics(query: InsightsWindowQuery): Promise<WindowMetrics | null> {
      // Re-resolve credentials on every call so Inngest retries and credential
      // rotations never reuse a stale client from a prior invocation.
      const deployment = await prisma.agentDeployment.findFirst({
        where: { organizationId: orgId, status: "active" },
        select: { id: true },
      });
      if (!deployment) return null;

      const connection = await prisma.deploymentConnection.findFirst({
        where: { deploymentId: deployment.id, type: "meta-ads", status: "active" },
        select: { credentials: true },
      });
      if (!connection) return null;

      const creds = decryptCredentials(connection.credentials);
      const accessToken = creds.accessToken as string | undefined;
      const accountId = creds.accountId as string | undefined;
      if (!accessToken || !accountId) return null;

      const client = new MetaAdsClient({ accessToken, accountId });

      const fmt = (d: Date) => d.toISOString().split("T")[0]!;
      const since = fmt(query.startInclusive);
      // Meta's `until` is inclusive; we subtract 1 day from endExclusive
      const untilDate = new Date(query.endExclusive.getTime() - 24 * 60 * 60 * 1000);
      const until = fmt(untilDate);

      const insights = await client.getCampaignInsights({
        dateRange: { since, until },
        fields: [
          "campaign_id",
          "spend",
          "inline_link_click_ctr",
          "impressions",
          "date_start",
          "date_stop",
        ],
        timeIncrement: 1,
      });

      // Slice 4d: org-level spend rides the SAME Graph response (this call
      // already returns every campaign; the sum happens BEFORE the campaign
      // filter). Same dollars-to-cents conversion as the campaign sum. A
      // non-finite sum (Meta spend strings parse with parseFloat; a
      // non-numeric sentinel is NaN, and one NaN row poisons the whole sum)
      // is reported as ABSENCE: the corroboration predicate treats a missing
      // account spend as unjudgeable, never as agreement.
      const accountSpendCents = Math.round(insights.reduce((sum, r) => sum + r.spend, 0) * 100);

      // Filter to the requested campaign
      const rows = insights.filter((i) => i.campaignId === query.campaignId);
      if (rows.length === 0) return null;

      const spendCents = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100);
      const ctr = rows.reduce((sum, r) => sum + r.inlineLinkClickCtr, 0) / rows.length;
      const dailyRowCount = rows.length;

      // spendCents and ctr are the window's REQUIRED primary signals (unlike the
      // OPTIONAL accountSpendCents below, which is merely omitted when non-finite).
      // A non-finite value here — a NaN that survived the client mapper, or a
      // poisoned reduce sum — makes the whole window unjudgeable, so report
      // ABSENCE (null): the same documented fallback as a missing connection,
      // which the orchestrator treats as meta_data_missing / cockpitRenderable=false.
      // A NaN spendCents would instead fabricate a confident, fictional cockpit
      // row downstream (feedback_nan_blind_comparison_gates, #939).
      if (!Number.isFinite(spendCents) || !Number.isFinite(ctr)) return null;

      return {
        spendCents,
        ctr,
        dailyRowCount,
        ...(Number.isFinite(accountSpendCents) ? { accountSpendCents } : {}),
      };
    },
  };
}
