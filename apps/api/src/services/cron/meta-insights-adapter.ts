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
  // Lazy-initialised client: resolved on the first getWindowMetrics call so
  // the credential lookup happens inside the Inngest function body, not at
  // worker-construction time.
  let clientPromise: Promise<MetaAdsClient | null> | null = null;

  async function resolveClient(): Promise<MetaAdsClient | null> {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
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

      return new MetaAdsClient({ accessToken, accountId });
    })();
    return clientPromise;
  }

  return {
    async getWindowMetrics(query: InsightsWindowQuery): Promise<WindowMetrics | null> {
      const client = await resolveClient();
      if (!client) return null;

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
        breakdowns: ["day"],
      });

      // Filter to the requested campaign
      const rows = insights.filter((i) => i.campaignId === query.campaignId);
      if (rows.length === 0) return null;

      const spendCents = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100);
      const ctr =
        rows.length > 0 ? rows.reduce((sum, r) => sum + r.inlineLinkClickCtr, 0) / rows.length : 0;
      const dailyRowCount = rows.length;

      return { spendCents, ctr, dailyRowCount };
    },
  };
}
