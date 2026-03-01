import type { FunnelSchema, VerticalBenchmarks, VerticalType } from "../core/types.js";
import type { PlatformClient, PlatformCredentials, PlatformType } from "./types.js";
import { MetaApiClient } from "./meta/client.js";
import { GoogleAdsClient } from "./google/client.js";
import { TikTokAdsClient } from "./tiktok/client.js";

// Meta funnels
import { commerceFunnel as metaCommerceFunnel } from "./meta/funnels/commerce.js";
import {
  leadgenFunnel as metaLeadgenFunnel,
  createLeadgenFunnel as createMetaLeadgenFunnel,
} from "./meta/funnels/leadgen.js";
import { brandFunnel as metaBrandFunnel } from "./meta/funnels/brand.js";

// Google funnels
import { commerceFunnel as googleCommerceFunnel } from "./google/funnels/commerce.js";
import { leadgenFunnel as googleLeadgenFunnel } from "./google/funnels/leadgen.js";
import { brandFunnel as googleBrandFunnel } from "./google/funnels/brand.js";

// TikTok funnels
import { commerceFunnel as tiktokCommerceFunnel } from "./tiktok/funnels/commerce.js";
import { leadgenFunnel as tiktokLeadgenFunnel } from "./tiktok/funnels/leadgen.js";
import { brandFunnel as tiktokBrandFunnel } from "./tiktok/funnels/brand.js";

// Benchmarks (platform-agnostic defaults)
import { commerceBenchmarks } from "../verticals/commerce/benchmarks.js";
import {
  leadgenBenchmarks,
  createLeadgenBenchmarks,
} from "../verticals/leadgen/benchmarks.js";
import { brandBenchmarks } from "../verticals/brand/benchmarks.js";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createPlatformClient(
  credentials: PlatformCredentials
): PlatformClient {
  switch (credentials.platform) {
    case "meta":
      return new MetaApiClient({ accessToken: credentials.accessToken });
    case "google":
      return new GoogleAdsClient({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken,
        developerToken: credentials.developerToken,
        loginCustomerId: credentials.loginCustomerId,
      });
    case "tiktok":
      return new TikTokAdsClient({
        accessToken: credentials.accessToken,
        appId: credentials.appId,
      });
  }
}

// ---------------------------------------------------------------------------
// Funnel resolution
// ---------------------------------------------------------------------------

export interface ResolveFunnelOptions {
  /** For Meta leadgen: custom qualified lead action type */
  qualifiedLeadActionType?: string;
}

export function resolveFunnel(
  platform: PlatformType,
  vertical: VerticalType,
  options?: ResolveFunnelOptions
): FunnelSchema {
  if (vertical === "commerce") {
    switch (platform) {
      case "meta":
        return metaCommerceFunnel;
      case "google":
        return googleCommerceFunnel;
      case "tiktok":
        return tiktokCommerceFunnel;
    }
  }

  if (vertical === "leadgen") {
    switch (platform) {
      case "meta":
        return options?.qualifiedLeadActionType
          ? createMetaLeadgenFunnel(options.qualifiedLeadActionType)
          : metaLeadgenFunnel;
      case "google":
        return googleLeadgenFunnel;
      case "tiktok":
        return tiktokLeadgenFunnel;
    }
  }

  if (vertical === "brand") {
    switch (platform) {
      case "meta":
        return metaBrandFunnel;
      case "google":
        return googleBrandFunnel;
      case "tiktok":
        return tiktokBrandFunnel;
    }
  }

  throw new Error(
    `No funnel schema for platform "${platform}" + vertical "${vertical}"`
  );
}

// ---------------------------------------------------------------------------
// Benchmark resolution
// ---------------------------------------------------------------------------

export function resolveBenchmarks(
  _platform: PlatformType,
  vertical: VerticalType,
  options?: ResolveFunnelOptions
): VerticalBenchmarks {
  switch (vertical) {
    case "commerce":
      return commerceBenchmarks;
    case "leadgen":
      return options?.qualifiedLeadActionType
        ? createLeadgenBenchmarks(options.qualifiedLeadActionType)
        : leadgenBenchmarks;
    case "brand":
      return brandBenchmarks;
    default:
      throw new Error(`No benchmarks for vertical "${vertical}"`);
  }
}
