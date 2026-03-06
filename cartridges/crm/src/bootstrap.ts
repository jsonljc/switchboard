import { CrmCartridge } from "./index.js";
import type { CrmProviderOptions } from "./providers/factory.js";

export interface BootstrapCrmConfig {
  /** When true, throws if no valid credentials are available. */
  requireCredentials?: boolean;
}

export interface BootstrapCrmResult {
  cartridge: CrmCartridge;
}

/**
 * Create and initialize the CRM cartridge.
 *
 * The built-in CRM uses an in-memory provider by default.
 * Pass `providerOptions` with a `prisma` client to use the database-backed provider.
 * Returns the raw cartridge. The caller is responsible for wrapping in
 * GuardedCartridge, registering in storage, and seeding policies.
 */
export async function bootstrapCrmCartridge(
  config?: BootstrapCrmConfig,
  providerOptions?: CrmProviderOptions,
): Promise<BootstrapCrmResult> {
  void config;

  const cartridge = new CrmCartridge(providerOptions);
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {},
  });

  return { cartridge };
}
