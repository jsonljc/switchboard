/**
 * Resolves connection credentials for a cartridge + organization at execution time.
 * Injected into the orchestrator to replace hardcoded `connectionCredentials: {}`.
 */
export interface ConnectionCredentialResolver {
  resolve(
    cartridgeId: string,
    organizationId: string | null,
  ): Promise<Record<string, unknown>>;
}

/**
 * Default no-op resolver that returns empty credentials.
 * Used when no DB-backed resolver is configured (backward compatible).
 */
export class NoOpCredentialResolver implements ConnectionCredentialResolver {
  async resolve(
    _cartridgeId: string,
    _organizationId: string | null,
  ): Promise<Record<string, unknown>> {
    return {};
  }
}
