import type { MetaAdsConfig, MetaAdsProvider } from "./meta-ads.js";
import { MockMetaAdsProvider } from "./meta-ads.js";
import { RealMetaAdsProvider } from "./real-meta-ads.js";

export function createMetaAdsProvider(config: MetaAdsConfig): MetaAdsProvider {
  // Real Meta access tokens are long (100+ chars, typically start with "EAA").
  // Short tokens, empty tokens, or known test values use the mock provider.
  const token = config.accessToken;
  if (!token || token.length < 20 || token === "mock-token") {
    return new MockMetaAdsProvider(config);
  }
  return new RealMetaAdsProvider(config);
}
