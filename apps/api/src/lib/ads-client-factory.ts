import type { PrismaClient } from "@switchboard/db";
import { decryptCredentials as defaultDecryptCredentials } from "@switchboard/db";
import { MetaAdsClient } from "@switchboard/ad-optimizer";
import type { AdsClientFactory } from "./meta-spend-provider.js";

interface BuildAdsClientFactoryDeps {
  decryptCredentials?: (encrypted: unknown) => Record<string, unknown>;
}

/**
 * Returns an AdsClientFactory that looks up a Connection by (id, organizationId),
 * decrypts its credentials, and constructs a MetaAdsClient bound to that org.
 * The seam mirrors the deployment-credentials pattern at
 * apps/api/src/bootstrap/inngest.ts:201-205 — same decrypt helper, same
 * MetaAdsClient constructor — but keyed on Connection.id (not deploymentId)
 * because MetaSpendProvider queries connections directly.
 *
 * Cross-org defense: the Prisma WHERE filter requires BOTH id AND
 * organizationId to match, so even if the caller passes a forged or misrouted
 * connection ref the lookup returns null instead of hydrating credentials from
 * a different org.
 */
export function buildAdsClientFactory(
  prisma: PrismaClient,
  deps: BuildAdsClientFactoryDeps = {},
): AdsClientFactory {
  // Adapt the canonical `decryptCredentials(string)` to the `(unknown) => …`
  // shape this factory uses internally. The Prisma `credentials` column is
  // typed as `JsonValue` but always stores the base64 string produced by
  // `encryptCredentials`, so we forward it as-is.
  const decrypt =
    deps.decryptCredentials ??
    ((encrypted: unknown) => defaultDecryptCredentials(encrypted as string));
  return async (connection) => {
    const row = await prisma.connection.findFirst({
      where: {
        id: connection.id,
        organizationId: connection.organizationId,
      },
      select: { credentials: true },
    });
    if (!row) {
      throw new Error(
        `Connection not found for org: id=${connection.id} organizationId=${connection.organizationId}`,
      );
    }
    const creds = decrypt(row.credentials);
    const accessToken = creds["accessToken"];
    const accountId = creds["accountId"];
    if (typeof accessToken !== "string" || typeof accountId !== "string") {
      throw new Error(
        `Connection ${connection.id} credentials missing accessToken/accountId after decrypt`,
      );
    }
    return new MetaAdsClient({ accessToken, accountId });
  };
}
