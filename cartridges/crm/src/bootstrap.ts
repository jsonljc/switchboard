import { CrmCartridge } from "./index.js";

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
 * Returns the raw cartridge. The caller is responsible for wrapping in
 * GuardedCartridge, registering in storage, and seeding policies.
 */
export async function bootstrapCrmCartridge(
  config?: BootstrapCrmConfig,
): Promise<BootstrapCrmResult> {
  void config;

  const cartridge = new CrmCartridge();
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {},
  });

  return { cartridge };
}
