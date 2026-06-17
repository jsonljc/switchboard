/**
 * Org-scoped CTWA campaign-id resolver.
 *
 * The CtwaAdapter (Layer 2, @switchboard/ad-optimizer) cannot touch the DB or
 * construct a MetaAdsClient, so it accepts a `resolveCampaignId(adId, { organizationId })`
 * dependency. This app-layer factory implements that dependency: it looks up the
 * lead org's Meta Ads Connection, decrypts its credentials, builds a MetaAdsClient
 * scoped to that org's ad account, and resolves the ad's parent campaign id via
 * the Graph `/{adId}?fields=campaign_id` edge (MetaAdsClient.getAdCampaignId).
 *
 * The CTWA referral payload from Meta carries only the ad id (`source_id`), not an
 * ad-account id, so org-scoping is keyed on the lead's `organizationId`: each org
 * connects exactly one Meta Ads account, and the canonical lookup matches the
 * dashboard-reports resolver (serviceId "meta-ads", status "connected", accountId
 * sourced from `Connection.externalAccountId`).
 *
 * Every failure path returns `null` so a paid lead is never blocked on attribution:
 * the adapter simply submits without `sourceCampaignId`, and the creative->booking
 * join stays unenriched for that lead rather than dropping it.
 */

/** Minimal MetaAdsClient surface this resolver uses (mock the rest in tests). */
export interface CtwaAdsClientLike {
  getAdCampaignId(adId: string): Promise<string | null>;
}

/** The Connection columns this resolver needs (org-scoped Meta Ads connection). */
export interface CtwaConnectionRow {
  credentials: unknown;
  externalAccountId: string | null;
}

export interface CtwaCampaignResolverDeps {
  /** Returns the org's Meta Ads connection row, or null when the org has none. */
  lookupConnection: (organizationId: string) => Promise<CtwaConnectionRow | null>;
  /** Decrypts the connection's stored credentials blob. */
  decryptCredentials: (credentials: unknown) => Record<string, unknown>;
  /** Constructs an org-scoped ads client from resolved credentials. */
  createAdsClient: (config: { accessToken: string; accountId: string }) => CtwaAdsClientLike;
}

/**
 * Build the `resolveCampaignId` dependency the CtwaAdapter expects. The returned
 * function is org-scoped per call: it resolves the lead org's Meta credentials and
 * asks Meta for the ad's parent campaign id. Returns `null` on any miss (no
 * connection, missing account id / token, or a thrown lookup) — never throws.
 */
export function buildCtwaCampaignResolver(
  deps: CtwaCampaignResolverDeps,
): (adId: string, ctx: { organizationId: string }) => Promise<string | null> {
  return async (adId, ctx) => {
    try {
      const row = await deps.lookupConnection(ctx.organizationId);
      if (!row || !row.externalAccountId || !row.credentials) return null;

      const creds = deps.decryptCredentials(row.credentials);
      const accessToken = creds["accessToken"];
      if (typeof accessToken !== "string" || !accessToken) return null;

      const client = deps.createAdsClient({
        accessToken,
        accountId: row.externalAccountId,
      });
      return await client.getAdCampaignId(adId);
    } catch (err) {
      console.warn(
        `[ctwa-campaign-resolver] failed to resolve campaign for ad=${adId} org=${ctx.organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };
}
