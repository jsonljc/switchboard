import type { CartridgeInterceptor } from "@switchboard/cartridge-sdk";
import { AdsSpendCartridge } from "./index.js";
import { PostMutationVerifier } from "./interceptors/verification.js";

export interface BootstrapAdsSpendConfig {
  accessToken: string;
  adAccountId: string;
  /** When true, throws if accessToken or adAccountId are missing. */
  requireCredentials?: boolean;
}

export interface BootstrapAdsSpendResult {
  cartridge: AdsSpendCartridge;
  interceptors: CartridgeInterceptor[];
}

/**
 * Create and initialize the ads-spend cartridge with its interceptors.
 *
 * Returns the raw cartridge and interceptor list. The caller is responsible
 * for wrapping in GuardedCartridge, registering in storage, and seeding
 * policies — this keeps ads-spend decoupled from @switchboard/core.
 */
export async function bootstrapAdsSpendCartridge(
  config: BootstrapAdsSpendConfig,
): Promise<BootstrapAdsSpendResult> {
  if (config.requireCredentials && (!config.accessToken || !config.adAccountId)) {
    throw new Error(
      "META_ADS_ACCESS_TOKEN and META_ADS_ACCOUNT_ID are required in production. " +
      "Set these environment variables or set NODE_ENV to something other than 'production'.",
    );
  }

  const cartridge = new AdsSpendCartridge();
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      accessToken: config.accessToken,
      adAccountId: config.adAccountId,
    },
  });

  const verifier = new PostMutationVerifier(() => cartridge.getProvider());

  return { cartridge, interceptors: [verifier] };
}
