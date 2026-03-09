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
import { createMetaAdsWriteProvider } from "./providers/meta-write-provider.js";
import { PostMutationVerifier } from "./interceptors/verification.js";
import { MetaGraphClient } from "../platforms/meta/graph-client.js";
import type { CartridgeInterceptor } from "@switchboard/cartridge-sdk";
import type { PlatformType, PlatformClient, PlatformCredentials } from "../platforms/types.js";
import type { MetricSnapshot } from "../core/types.js";
import type { EntityLevel } from "../core/types.js";
import type { PlatformHealth } from "./types.js";
import type { AdPlatformProvider } from "./providers/provider.js";
import type { SnapshotCacheStore } from "../platforms/cache/types.js";
import { CachedPlatformClient } from "../platforms/cache/cached-client.js";

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
  /** Optional cache store for snapshot caching */
  cacheStore?: SnapshotCacheStore;
}

export interface BootstrapDigitalAdsResult {
  cartridge: DigitalAdsCartridge;
  interceptors: CartridgeInterceptor[];
}

/**
 * Wraps a provider so that createClient() and connect() return CachedPlatformClient instances.
 */
class CachingProviderWrapper implements AdPlatformProvider {
  constructor(
    private inner: AdPlatformProvider,
    private cacheStore: SnapshotCacheStore,
  ) {}

  get platform(): PlatformType {
    return this.inner.platform;
  }

  async connect(
    credentials: PlatformCredentials,
    entityId: string,
  ): Promise<{
    client: PlatformClient;
    accountName: string;
    entityLevels: EntityLevel[];
  }> {
    const result = await this.inner.connect(credentials, entityId);
    return {
      ...result,
      client: new CachedPlatformClient(result.client, this.cacheStore),
    };
  }

  checkHealth(credentials: PlatformCredentials, entityId: string): Promise<PlatformHealth> {
    return this.inner.checkHealth(credentials, entityId);
  }

  createClient(credentials: PlatformCredentials): PlatformClient {
    return new CachedPlatformClient(this.inner.createClient(credentials), this.cacheStore);
  }
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
      throw new Error("Digital Ads cartridge requires a valid META_ADS_ACCESS_TOKEN");
    }
    if (!config.adAccountId || config.adAccountId === "act_mock_dev_only") {
      throw new Error("Digital Ads cartridge requires a valid META_ADS_ACCOUNT_ID");
    }
  }

  const cartridge = new DigitalAdsCartridge();

  // Create shared MetaGraphClient so both read and write providers share
  // the same circuit breaker and rate limiter
  const graphClient = new MetaGraphClient({
    accessToken: config.accessToken,
    apiVersion: "v22.0",
  });

  const wrapProvider = (provider: AdPlatformProvider): AdPlatformProvider =>
    config.cacheStore ? new CachingProviderWrapper(provider, config.cacheStore) : provider;

  // Register diagnostic providers
  if (config.useMocks) {
    const platforms: PlatformType[] = ["meta", "google", "tiktok"];
    for (const platform of platforms) {
      const snapshot = config.mockSnapshots?.[platform];
      cartridge.registerProvider(wrapProvider(new MockProvider(platform, snapshot)));
    }
  } else {
    cartridge.registerProvider(wrapProvider(new MetaProvider({ graphClient })));
    cartridge.registerProvider(wrapProvider(new GoogleProvider()));
    cartridge.registerProvider(wrapProvider(new TikTokProvider()));
  }

  // Register write provider (shares the same graphClient)
  const writeProvider = createMetaAdsWriteProvider({
    accessToken: config.accessToken,
    adAccountId: config.adAccountId,
    graphClient,
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
  const interceptors: CartridgeInterceptor[] = [new PostMutationVerifier(writeProvider)];

  return { cartridge, interceptors };
}

// Re-export policies for consumer apps
export { DEFAULT_DIGITAL_ADS_POLICIES } from "./defaults/policies.js";
