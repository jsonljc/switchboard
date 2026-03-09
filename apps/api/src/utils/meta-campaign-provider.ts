import type { PrismaClient } from "@switchboard/db";
import { PrismaConnectionStore } from "@switchboard/db";
import { createMetaAdsWriteProvider, type MetaAdsWriteProvider } from "@switchboard/digital-ads";

export interface OrgScopedMetaAdsContext {
  provider: MetaAdsWriteProvider;
  adAccountId: string;
}

export async function getOrgScopedMetaAdsContext(
  prisma: PrismaClient | null,
  organizationId: string | undefined,
): Promise<OrgScopedMetaAdsContext> {
  if (!prisma) {
    throw new Error("Database unavailable");
  }
  if (!organizationId) {
    throw new Error("Organization-scoped authentication is required");
  }

  const connectionStore = new PrismaConnectionStore(prisma);
  const connection = await connectionStore.getByService("meta-ads", organizationId);
  if (!connection) {
    throw new Error("Meta Ads connection not found for organization");
  }

  const accessToken = connection.credentials["accessToken"];
  const adAccountId = connection.credentials["adAccountId"];
  if (typeof accessToken !== "string" || typeof adAccountId !== "string") {
    throw new Error("Meta Ads connection is missing accessToken or adAccountId");
  }

  return {
    provider: createMetaAdsWriteProvider({ accessToken, adAccountId }),
    adAccountId,
  };
}

export async function getOrgScopedMetaCampaignProvider(
  prisma: PrismaClient | null,
  organizationId: string | undefined,
): Promise<MetaAdsWriteProvider> {
  const context = await getOrgScopedMetaAdsContext(prisma, organizationId);
  return context.provider;
}
