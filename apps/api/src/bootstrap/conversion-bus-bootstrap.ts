// ---------------------------------------------------------------------------
// ConversionBus Bootstrap — wires CRM → ad platform feedback loop
// ---------------------------------------------------------------------------

import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@switchboard/db";
import type { ConversionBus } from "@switchboard/core";
import type { MetaAdsWriteProvider } from "@switchboard/digital-ads";

export interface ConversionBusBootstrapOptions {
  conversionBus: ConversionBus;
  adsWriteProvider: MetaAdsWriteProvider | null;
  prismaClient: PrismaClient | null;
  logger: FastifyBaseLogger;
}

export async function wireConversionBus(options: ConversionBusBootstrapOptions): Promise<void> {
  const { conversionBus, adsWriteProvider, prismaClient, logger } = options;

  if (!adsWriteProvider || !prismaClient) {
    return;
  }

  const { CAPIDispatcher, OutcomeTracker, TikTokDispatcher, GoogleOfflineDispatcher } =
    await import("@switchboard/digital-ads");
  const { PrismaCrmProvider } = await import("@switchboard/db");

  const dispatcher = new CAPIDispatcher({
    adsProvider: adsWriteProvider,
    crmProvider: new PrismaCrmProvider(prismaClient),
    pixelId: process.env["META_PIXEL_ID"] ?? "",
  });
  dispatcher.register(conversionBus);

  const outcomeTracker = new OutcomeTracker();
  outcomeTracker.register(conversionBus);

  const registeredDispatchers = ["CAPIDispatcher", "OutcomeTracker"];

  // TikTok Events API dispatcher (gated by TIKTOK_PIXEL_ID)
  const tiktokPixelId = process.env["TIKTOK_PIXEL_ID"];
  if (tiktokPixelId) {
    const tiktokDispatcher = new TikTokDispatcher({
      sendEvent: async (_pixelId, _event) => ({ success: true }), // stub — real TikTok API client to come
      crmProvider: new PrismaCrmProvider(prismaClient),
      pixelId: tiktokPixelId,
    });
    tiktokDispatcher.register(conversionBus);
    registeredDispatchers.push("TikTokDispatcher");
  }

  // Google Offline Conversions dispatcher (gated by GOOGLE_CONVERSION_ACTION_ID)
  const googleConversionActionId = process.env["GOOGLE_CONVERSION_ACTION_ID"];
  if (googleConversionActionId) {
    const googleDispatcher = new GoogleOfflineDispatcher({
      uploadConversion: async (_conversion) => ({ success: true }), // stub — real Google Ads client to come
      crmProvider: new PrismaCrmProvider(prismaClient),
      conversionActionId: googleConversionActionId,
    });
    googleDispatcher.register(conversionBus);
    registeredDispatchers.push("GoogleOfflineDispatcher");
  }

  logger.info(`ConversionBus wired: ${registeredDispatchers.join(" + ")} registered`);
}
