import type { CrmProvider } from "./crm-provider.js";
import { InMemoryCrmProvider } from "./mock.js";

export interface CrmProviderOptions {
  prisma?: unknown;
  organizationId?: string;
}

export function createCrmProvider(options?: CrmProviderOptions): CrmProvider {
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
