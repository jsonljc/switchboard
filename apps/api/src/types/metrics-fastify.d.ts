export {};

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Optional Meta Ads spend provider. When wired, the metrics route uses it to
     * fetch org spend for the week window. When absent or undefined, spendCents is
     * always null (graceful no-op per A.3 slice brief).
     *
     * TODO(A.3-follow-up): wire buildMetaSpendProvider(prisma, adsClientFactory)
     * in the bootstrap layer once credential decryption plumbing is verified.
     */
    metaSpendProvider?: (range: { orgId: string; from: Date; to: Date }) => Promise<number | null>;
  }
}
