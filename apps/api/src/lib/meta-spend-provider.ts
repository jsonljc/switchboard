import type { PrismaClient } from "@switchboard/db";

export interface AdsClientLike {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<Array<{ spend: number }>>;
}

export type AdsClientFactory = (connection: {
  id: string;
  organizationId: string | null;
}) => Promise<AdsClientLike>;

export interface MetaSpendProviderDeps {
  log?: { warn: (...args: unknown[]) => void };
}

export interface MetaSpendRange {
  orgId: string;
  from: Date;
  to: Date;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a spend-cents provider that reads the org's `meta-ads` Connection row,
 * calls getCampaignInsights({ fields: ["spend"] }), sums dollars across rows,
 * and converts to cents. Returns null when:
 * - no `meta-ads` Connection exists for the org
 * - the Connection is not in "connected" status
 * - adsClientFactory is not provided (graceful no-op for test harnesses)
 * - the insights call throws
 *
 * In production this is composed with the connection-based adsClientFactory at
 * apps/api/src/lib/ads-client-factory.ts and decorated onto the Fastify app
 * via apps/api/src/bootstrap/wire-metrics.ts. Test harnesses pass `undefined`
 * to get the graceful null-returning provider.
 */
export function buildMetaSpendProvider(
  prisma: PrismaClient,
  adsClientFactory: AdsClientFactory | undefined,
  deps: MetaSpendProviderDeps = {},
): (range: MetaSpendRange) => Promise<number | null> {
  return async ({ orgId, from, to }) => {
    if (!adsClientFactory) return null;

    const connection = await prisma.connection.findFirst({
      where: { organizationId: orgId, serviceId: "meta-ads", status: "connected" },
      select: { id: true, organizationId: true },
    });
    if (!connection) return null;

    try {
      const client = await adsClientFactory(connection);
      const rows = await client.getCampaignInsights({
        dateRange: { since: fmt(from), until: fmt(to) },
        fields: ["spend"],
      });
      const dollars = rows.reduce((sum, r) => sum + (Number.isFinite(r.spend) ? r.spend : 0), 0);
      return Math.round(dollars * 100);
    } catch (err) {
      deps.log?.warn({ err }, "meta-spend-provider: insights call failed");
      return null;
    }
  };
}
