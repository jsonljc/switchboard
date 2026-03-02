import type { PrismaClient } from "@switchboard/db";
import { createLogger } from "../logger.js";
import type { Logger } from "../logger.js";

export interface TokenRefreshJobConfig {
  prisma: PrismaClient;
  intervalMs?: number;
  refreshBeforeExpiryMs?: number;
  logger?: Logger;
}

/**
 * Background job that periodically checks for OAuth2 connections
 * with tokens expiring soon and attempts to refresh them.
 *
 * Follows the same pattern as approval-expiry.ts:
 * - setInterval with in-flight tracking
 * - Returns a cleanup function
 */
export function startTokenRefreshJob(config: TokenRefreshJobConfig): () => void {
  const {
    prisma,
    intervalMs = 30 * 60_000, // 30 minutes
    refreshBeforeExpiryMs = 60 * 60_000, // 1 hour before expiry
    logger = createLogger("token-refresh-job"),
  } = config;

  let stopped = false;
  let inFlightPromise: Promise<void> | null = null;

  const scan = async () => {
    if (stopped) return;
    try {
      // Find OAuth2 connections that are nearing expiry
      const connections = await prisma.connection.findMany({
        where: {
          authType: "oauth2",
          status: { not: "disconnected" },
        },
      });

      for (const conn of connections) {
        if (stopped) break;

        // Parse credentials to check token expiry
        let creds: Record<string, unknown>;
        try {
          const { decryptCredentials } = await import("@switchboard/db");
          creds = typeof conn.credentials === "string"
            ? decryptCredentials(conn.credentials)
            : conn.credentials as Record<string, unknown>;
        } catch {
          // Can't decrypt — skip
          continue;
        }

        const tokenExpiresAt = creds.tokenExpiresAt as string | undefined;
        const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : null;

        // Skip if no expiry info or token is not nearing expiry
        if (!expiresAt) continue;
        const timeUntilExpiry = expiresAt.getTime() - Date.now();
        if (timeUntilExpiry > refreshBeforeExpiryMs) continue;

        logger.info(
          { connectionId: conn.id, serviceId: conn.serviceId, expiresAt: expiresAt.toISOString() },
          "Token nearing expiry, attempting refresh",
        );

        try {
          const { refreshMetaOAuthToken } = await import("@switchboard/db");
          const connectionRecord = {
            id: conn.id,
            serviceId: conn.serviceId,
            serviceName: conn.serviceName,
            organizationId: conn.organizationId,
            authType: conn.authType,
            credentials: creds as Record<string, unknown>,
            scopes: conn.scopes,
            refreshStrategy: conn.refreshStrategy,
            status: conn.status,
            lastHealthCheck: conn.lastHealthCheck,
            createdAt: conn.createdAt,
            updatedAt: conn.updatedAt,
          } as Parameters<typeof refreshMetaOAuthToken>[0];

          const result = await refreshMetaOAuthToken(connectionRecord, prisma);

          if (result.success) {
            logger.info(
              { connectionId: conn.id, expiresAt: result.expiresAt?.toISOString() },
              "Token refreshed successfully",
            );
          } else {
            logger.warn(
              { connectionId: conn.id, error: result.error },
              "Token refresh failed, marking as expired",
            );
            await prisma.connection.update({
              where: { id: conn.id },
              data: { status: "token_expired" },
            });
          }
        } catch (err) {
          logger.error(
            { connectionId: conn.id, err },
            "Unexpected error during token refresh",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Error scanning connections for token refresh");
    }
  };

  const timer = setInterval(() => {
    inFlightPromise = scan();
  }, intervalMs);

  // Run initial scan
  inFlightPromise = scan();

  return () => {
    stopped = true;
    clearInterval(timer);
    if (inFlightPromise) {
      inFlightPromise.catch(() => {});
    }
  };
}
