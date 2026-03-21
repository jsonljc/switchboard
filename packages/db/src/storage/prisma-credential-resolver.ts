import type { PrismaConnectionStore } from "./prisma-connection-store.js";

/**
 * Interface matching @switchboard/core's ConnectionCredentialResolver.
 * Defined locally to avoid circular dependency between packages/db and packages/core.
 */
interface ConnectionCredentialResolver {
  resolve(cartridgeId: string, organizationId: string | null): Promise<Record<string, unknown>>;
}

/**
 * Maps cartridge IDs to their associated services and platform keys.
 * Each cartridge may need credentials from multiple services (e.g. digital-ads
 * needs meta, google, and tiktok credentials keyed by platform).
 *
 * Cartridges without a mapping (e.g. "crm") use boot-time credentials.
 */
const CARTRIDGE_TO_SERVICES: Record<string, Array<{ serviceId: string; platformKey: string }>> = {
  "digital-ads": [
    { serviceId: "meta-ads", platformKey: "meta" },
    { serviceId: "google-ads", platformKey: "google" },
    { serviceId: "tiktok-ads", platformKey: "tiktok" },
  ],
  payments: [{ serviceId: "stripe", platformKey: "stripe" }],
};

/**
 * Resolves connection credentials from the DB at execution time.
 *
 * Resolution strategy:
 * 1. Map cartridgeId → service mappings (skip if no mapping)
 * 2. For each service, try org-scoped: getByService(serviceId, organizationId)
 * 3. Fall back to explicitly global: getByService(serviceId, null) — only connections
 *    with organizationId = null are treated as global, preventing cross-org leakage.
 * 4. Return platform-keyed map: { meta: { ...creds }, google: { ...creds } }
 * 5. Return {} if no services found: cartridge uses boot-time credentials
 */
export class PrismaCredentialResolver implements ConnectionCredentialResolver {
  constructor(private connectionStore: PrismaConnectionStore) {}

  async resolve(
    cartridgeId: string,
    organizationId: string | null,
  ): Promise<Record<string, unknown>> {
    const services = CARTRIDGE_TO_SERVICES[cartridgeId];
    if (!services || services.length === 0) {
      return {};
    }

    const result: Record<string, unknown> = {};

    for (const { serviceId, platformKey } of services) {
      try {
        let connection = null;

        // Try org-scoped first
        if (organizationId) {
          connection = await this.connectionStore.getByService(serviceId, organizationId);
        }

        // Fall back to explicitly global (organizationId = null) — NOT unscoped
        if (!connection) {
          connection = await this.connectionStore.getByServiceGlobal(serviceId);
        }

        if (connection) {
          result[platformKey] = connection.credentials;
        }
      } catch (err) {
        // Credential decryption may fail if encryption key is missing.
        // Skip this service — cartridge will use boot-time creds for this platform.
        console.warn(
          `[credential-resolver] failed to resolve ${serviceId} for org=${organizationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }
}
