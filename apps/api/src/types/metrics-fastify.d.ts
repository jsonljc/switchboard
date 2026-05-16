export {};

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Meta Ads spend provider — feeds /alex and /riley KPI spend tiles.
     * Wired in apps/api/src/app.ts via apps/api/src/bootstrap/wire-metrics.ts,
     * which composes buildMetaSpendProvider + the connection-based
     * adsClientFactory. Returns null when no connected `meta-ads` Connection
     * exists, when the insights call throws, or when the AdsClientFactory
     * rejects.
     */
    metaSpendProvider?: (range: { orgId: string; from: Date; to: Date }) => Promise<number | null>;
  }
}
