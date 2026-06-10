/**
 * The subset of a DeploymentConnection the resolver reads. Kept local so the
 * resolver does not depend on a Prisma row type; the real store returns a
 * superset of these fields (structurally assignable).
 */
interface DeploymentConnectionLike {
  type: string;
  status: string;
  credentials: string;
}

export interface RileyCredentialResolverDeps {
  /** Deployment-scoped credential store (primary source). */
  deploymentConnectionStore: {
    listByDeployment(deploymentId: string): Promise<DeploymentConnectionLike[]>;
  };
  /** Org-level Connection store (pilot fallback). Returns the raw encrypted
   * blob; decryption is the resolver's job so both sources share one shape. */
  connectionStore: {
    findByServiceId(serviceId: string, orgId: string): Promise<{ credentials: string } | null>;
  };
  /** Maps a deployment to its owning organization (for the org fallback). */
  resolveOrgId: (deploymentId: string) => Promise<string | null>;
  /** Decrypts a credentials blob to the Meta token + ad-account pair. */
  decrypt: (blob: string) => { accessToken: string; accountId: string };
}

/** A connection is unusable once its token is dead; never resolve those. */
const isUsableStatus = (status: string | undefined): boolean =>
  status !== "needs_reauth" && status !== "revoked";

/**
 * Resolve Riley's Meta credentials. Primary source: the deployment-scoped
 * DeploymentConnection. Fallback (pilot decision #2, deprecate post-pilot):
 * the org-level Connection(serviceId="meta-ads") so an operator can credential
 * Riley through the existing Settings UI before the OAuth self-serve path is
 * hardened.
 *
 * A needs_reauth/revoked connection is skipped from either source: Riley must
 * never resolve to a dead token, which also stops a dead token from poisoning
 * the weekly fleet audit (D2-3). The org-store fallback applies the same skip
 * inside PrismaConnectionStore.findByServiceId.
 */
export function buildRileyCredentialResolver(deps: RileyCredentialResolverDeps) {
  return async (
    deploymentId: string,
  ): Promise<{ accessToken: string; accountId: string } | null> => {
    const dcs = await deps.deploymentConnectionStore.listByDeployment(deploymentId);
    const dc = dcs.find((c) => c.type === "meta-ads" && isUsableStatus(c.status));
    if (dc) return deps.decrypt(dc.credentials);

    const orgId = await deps.resolveOrgId(deploymentId);
    if (!orgId) return null;
    const orgConn = await deps.connectionStore.findByServiceId("meta-ads", orgId);
    if (!orgConn) return null;
    return deps.decrypt(orgConn.credentials);
    // NOTE(deprecation): remove the org-Connection fallback once Riley migrates
    // to a single canonical credential store post-pilot (audit decision #2).
  };
}
