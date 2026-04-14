// packages/core/src/ad-optimizer/facebook-oauth.ts

export const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
export const OAUTH_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
export const SCOPES = "ads_read,ads_management,business_management";
export const REFRESH_THRESHOLD_DAYS = 7;

export interface FacebookOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
}

export interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
  status: number;
}

/**
 * Build the Facebook OAuth authorization URL.
 */
export function buildAuthorizationUrl(config: FacebookOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    response_type: "code",
    state,
  });
  return `${OAUTH_DIALOG}?${params.toString()}`;
}

/**
 * Exchange an authorization code for a short-lived access token.
 */
export async function exchangeCodeForToken(
  config: FacebookOAuthConfig,
  code: string,
): Promise<TokenResult> {
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const url = `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`;
  const response = await fetch(url);
  const data = await handleResponse(response);
  return {
    accessToken: data.access_token as string,
    expiresIn: data.expires_in as number,
  };
}

/**
 * Exchange a short-lived token for a long-lived (60-day) token.
 */
export async function exchangeForLongLivedToken(
  config: FacebookOAuthConfig,
  shortLivedToken: string,
): Promise<TokenResult> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const url = `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`;
  const response = await fetch(url);
  const data = await handleResponse(response);
  return {
    accessToken: data.access_token as string,
    expiresIn: data.expires_in as number,
  };
}

/**
 * List ad accounts accessible with the given access token.
 */
export async function listAdAccounts(accessToken: string): Promise<AdAccount[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "account_id,name,currency,account_status",
  });
  const url = `${GRAPH_API_BASE}/me/adaccounts?${params.toString()}`;
  const response = await fetch(url);
  const data = await handleResponse(response);
  const accounts = data.data as Array<Record<string, unknown>>;
  return accounts.map((raw) => ({
    accountId: raw.account_id as string,
    name: raw.name as string,
    currency: raw.currency as string,
    status: raw.account_status as number,
  }));
}

/**
 * Refresh the token if it expires within REFRESH_THRESHOLD_DAYS.
 * Returns null if the token is not near expiry.
 */
export async function refreshTokenIfNeeded(
  config: FacebookOAuthConfig,
  currentToken: string,
  expiresAt: Date,
): Promise<TokenResult | null> {
  const msUntilExpiry = expiresAt.getTime() - Date.now();
  const daysUntilExpiry = msUntilExpiry / (24 * 60 * 60 * 1000);

  if (daysUntilExpiry > REFRESH_THRESHOLD_DAYS) {
    return null;
  }

  return exchangeForLongLivedToken(config, currentToken);
}

async function handleResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    let message = "Unknown error";
    try {
      const errorBody = (await response.json()) as { error?: { message?: string } };
      if (errorBody.error?.message) {
        message = errorBody.error.message;
      }
    } catch {
      // JSON parsing failed, use default message
    }
    throw new Error(`Facebook OAuth error (${response.status}): ${message}`);
  }
  return (await response.json()) as Record<string, unknown>;
}
