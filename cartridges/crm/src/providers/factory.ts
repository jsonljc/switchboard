import type { CrmProvider } from "./crm-provider.js";
import { InMemoryCrmProvider } from "./mock.js";

export interface CrmProviderOptions {
  prisma?: unknown;
  organizationId?: string;
  /** HubSpot private app access token */
  hubspotAccessToken?: string;
  /** HubSpot pipeline ID (optional) */
  hubspotPipelineId?: string;
}

export function createCrmProvider(options?: CrmProviderOptions): CrmProvider {
  // When a HubSpot access token is available, use the HubSpot provider.
  if (options?.hubspotAccessToken) {
    const token = options.hubspotAccessToken;
    // HubSpot private app tokens start with "pat-" and are 40+ chars
    const isReal =
      (token.startsWith("pat-") || token.startsWith("CL")) && token.length >= 20;

    if (isReal) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { HubSpotCrmProvider } = require("./hubspot.js");
        return new HubSpotCrmProvider({
          accessToken: token,
          pipelineId: options.hubspotPipelineId,
        });
      } catch {
        // Fall through to other providers
      }
    }
  }

  // When a Prisma client is available, use the database-backed provider.
  if (options?.prisma) {
    // Dynamic import to avoid circular dependency at module load time.
    // The PrismaCrmProvider is in @switchboard/db.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaCrmProvider } = require("@switchboard/db");
      return new PrismaCrmProvider(options.prisma, options.organizationId);
    } catch {
      // Fall through to in-memory if db package not available
    }
  }
  return new InMemoryCrmProvider();
}
