// ---------------------------------------------------------------------------
// Bootstrap — bootstrapDigitalAdsCartridge() factory
// ---------------------------------------------------------------------------
// Creates a fully-configured DigitalAdsCartridge with both diagnostic
// providers and write providers, plus interceptors and default policies.
// ---------------------------------------------------------------------------

import { DigitalAdsCartridge } from "./index.js";
import { MetaProvider } from "./providers/meta-provider.js";
import { GoogleProvider } from "./providers/google-provider.js";
import { TikTokProvider } from "./providers/tiktok-provider.js";
import { MockProvider } from "./providers/mock-provider.js";
import {
  createMetaAdsWriteProvider,
} from "./providers/meta-write-provider.js";
import { PostMutationVerifier } from "./interceptors/verification.js";
import type { CartridgeInterceptor } from "@switchboard/cartridge-sdk";
import type { PlatformType } from "../platforms/types.js";
import type { MetricSnapshot } from "../core/types.js";

export interface BootstrapDigitalAdsConfig {
  /** Meta Graph API access token */
  accessToken: string;
  /** Meta ad account ID (e.g. "act_123456789") */
  adAccountId: string;
  /** Throw if credentials are missing (for production) */
  requireCredentials?: boolean;
  /** Use mock providers for all platforms (for testing) */
  useMocks?: boolean;
  /** Mock snapshots for diagnostic providers */
  mockSnapshots?: Partial<Record<PlatformType, Partial<MetricSnapshot>>>;
}

export interface BootstrapDigitalAdsResult {
  cartridge: DigitalAdsCartridge;
  interceptors: CartridgeInterceptor[];
}

/**
 * Create a fully-configured DigitalAdsCartridge.
 *
 * Usage:
 * ```ts
 * const { cartridge, interceptors } = await bootstrapDigitalAdsCartridge({
 *   accessToken: process.env.META_ADS_ACCESS_TOKEN ?? "mock-token",
 *   adAccountId: process.env.META_ADS_ACCOUNT_ID ?? "act_mock",
 * });
 * storage.cartridges.register("digital-ads", new GuardedCartridge(cartridge, interceptors));
 * await seedDefaultStorage(storage, DEFAULT_DIGITAL_ADS_POLICIES);
 * ```
 */
export async function bootstrapDigitalAdsCartridge(
  config: BootstrapDigitalAdsConfig,
): Promise<BootstrapDigitalAdsResult> {
  if (config.requireCredentials) {
    if (!config.accessToken || config.accessToken === "mock-token") {
      throw new Error(
        "Digital Ads cartridge requires a valid META_ADS_ACCESS_TOKEN",
      );
    }
    if (!config.adAccountId || config.adAccountId === "act_mock_dev_only") {
      throw new Error(
        "Digital Ads cartridge requires a valid META_ADS_ACCOUNT_ID",
      );
    }
  }

  const cartridge = new DigitalAdsCartridge();

  // Register diagnostic providers
  if (config.useMocks) {
    const platforms: PlatformType[] = ["meta", "google", "tiktok"];
    for (const platform of platforms) {
      const snapshot = config.mockSnapshots?.[platform];
      cartridge.registerProvider(new MockProvider(platform, snapshot));
    }
  } else {
    cartridge.registerProvider(new MetaProvider());
    cartridge.registerProvider(new GoogleProvider());
    cartridge.registerProvider(new TikTokProvider());
  }

  // Register write provider
  const writeProvider = createMetaAdsWriteProvider({
    accessToken: config.accessToken,
    adAccountId: config.adAccountId,
  });
  cartridge.registerWriteProvider(writeProvider);

  // Initialize with system context
  await cartridge.initialize({
    principalId: "system",
    organizationId: null,
    connectionCredentials: {
      meta: {
        platform: "meta" as const,
        accessToken: config.accessToken,
      },
    },
  });

  // Create interceptors
  const interceptors: CartridgeInterceptor[] = [
    new PostMutationVerifier(writeProvider),
  ];

  return { cartridge, interceptors };
}

// Re-export policies for consumer apps
export { DEFAULT_DIGITAL_ADS_POLICIES } from "./defaults/policies.js";
