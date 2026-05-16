import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@switchboard/db";
import { buildMetaSpendProvider } from "../lib/meta-spend-provider.js";
import { buildAdsClientFactory } from "../lib/ads-client-factory.js";

interface WireMetricsProviderOptions {
  decryptCredentials?: (encrypted: unknown) => Record<string, unknown>;
}

/**
 * Composes buildAdsClientFactory + buildMetaSpendProvider and decorates the
 * Fastify instance with `metaSpendProvider`. Called from app.ts inside
 * buildServer(); extracted into its own module so the wiring logic is
 * unit-testable without booting the full server.
 */
export function wireMetricsProvider(
  app: FastifyInstance,
  prisma: PrismaClient,
  options: WireMetricsProviderOptions = {},
): void {
  const adsClientFactory = buildAdsClientFactory(prisma, {
    ...(options.decryptCredentials ? { decryptCredentials: options.decryptCredentials } : {}),
  });
  app.decorate(
    "metaSpendProvider",
    buildMetaSpendProvider(prisma, adsClientFactory, { log: app.log }),
  );
}
