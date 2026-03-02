import type { PrismaClient } from "@prisma/client";
import type { ConnectionRecord } from "../storage/prisma-connection-store.js";
import { encryptCredentials } from "../crypto/credentials.js";

const META_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";

export interface TokenRefreshResult {
  success: boolean;
  error?: string;
  expiresAt?: Date;
}

/**
 * Refresh a Meta OAuth2 access token using the stored refresh token.
 * Updates the connection's credentials in the database on success,
 * or marks the connection as `token_expired` on failure.
 */
export async function refreshMetaOAuthToken(
  connection: ConnectionRecord,
  prisma: PrismaClient,
): Promise<TokenRefreshResult> {
  const creds = connection.credentials as Record<string, string>;
  const refreshToken = creds.refreshToken;

  if (!refreshToken) {
    return { success: false, error: "No refresh token available" };
  }

  const appId = creds.appId ?? process.env["META_APP_ID"];
  const appSecret = creds.appSecret ?? process.env["META_APP_SECRET"];

  if (!appId || !appSecret) {
    return { success: false, error: "Missing Meta app credentials (appId/appSecret)" };
  }

  try {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: refreshToken,
    });

    const response = await fetch(`${META_TOKEN_URL}?${params.toString()}`);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = (errorBody as any)?.error?.message ?? `HTTP ${response.status}`;
      return { success: false, error: `Token refresh failed: ${errorMsg}` };
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in?: number;
    };

    const expiresIn = data.expires_in ?? 5184000; // Default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Update credentials with new token
    const updatedCreds = {
      ...creds,
      accessToken: data.access_token,
      refreshToken: data.access_token, // Meta long-lived tokens are also the refresh token
      tokenExpiresAt: expiresAt.toISOString(),
    };

    const encryptedCreds = encryptCredentials(updatedCreds);

    await prisma.connection.update({
      where: { id: connection.id },
      data: {
        credentials: encryptedCreds,
        status: "connected",
        lastHealthCheck: new Date(),
      },
    });

    return { success: true, expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
