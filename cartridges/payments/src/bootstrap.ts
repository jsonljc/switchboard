import { PaymentsCartridge } from "./index.js";

export interface BootstrapPaymentsConfig {
  secretKey: string;
  /** When true, throws if secretKey is missing. */
  requireCredentials?: boolean;
}

export interface BootstrapPaymentsResult {
  cartridge: PaymentsCartridge;
}

/**
 * Create and initialize the payments cartridge.
 *
 * Returns the raw cartridge. The caller is responsible for wrapping in
 * GuardedCartridge, registering in storage, and seeding policies — this
 * keeps payments decoupled from @switchboard/core.
 */
export async function bootstrapPaymentsCartridge(
  config: BootstrapPaymentsConfig,
): Promise<BootstrapPaymentsResult> {
  if (config.requireCredentials && !config.secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is required in production. " +
      "Set this environment variable or set NODE_ENV to something other than 'production'.",
    );
  }

  const cartridge = new PaymentsCartridge();
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      secretKey: config.secretKey,
    },
  });

  return { cartridge };
}
