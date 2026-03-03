import type { PrismaConnectionStore } from "./prisma-connection-store.js";

/**
 * Interface matching @switchboard/core's ConnectionCredentialResolver.
 * Defined locally to avoid circular dependency between packages/db and packages/core.
 */
interface ConnectionCredentialResolver {
  resolve(cartridgeId: string, organizationId: string | null): Promise<Record<string, unknown>>;
}

/**
 * Maps cartridge IDs to the service IDs used in the Connection table.
 * Cartridges without a mapping (e.g. "crm") use boot-time credentials.
 */
const CARTRIDGE_TO_SERVICE: Record<string, string> = {
  "digital-ads": "meta-ads",
  payments: "stripe",
  "quant-trading": "broker-api",
};

/**
 * Resolves connection credentials from the DB at execution time.
 *
 * Resolution strategy:
 * 1. Map cartridgeId → serviceId (skip if no mapping)
 * 2. Try org-scoped: getByService(serviceId, organizationId)
 * 3. Fall back to global: getByService(serviceId)
 * 4. Fall back to {}: cartridge uses boot-time credentials
 */
export class PrismaCredentialResolver implements ConnectionCredentialResolver {
  constructor(private connectionStore: PrismaConnectionStore) {}

  async resolve(
    cartridgeId: string,
    organizationId: string | null,
  ): Promise<Record<string, unknown>> {
    const serviceId = CARTRIDGE_TO_SERVICE[cartridgeId];
    if (!serviceId) {
      return {};
    }

    try {
      // Try org-scoped first
      if (organizationId) {
        const orgConnection = await this.connectionStore.getByService(serviceId, organizationId);
        if (orgConnection) {
          return orgConnection.credentials;
        }
      }

      // Fall back to global (no org filter)
      const globalConnection = await this.connectionStore.getByService(serviceId);
      if (globalConnection) {
        return globalConnection.credentials;
      }
    } catch {
      // Credential decryption may fail if encryption key is missing.
      // Fall through to empty credentials — cartridge will use boot-time creds.
    }

    return {};
  }
}
