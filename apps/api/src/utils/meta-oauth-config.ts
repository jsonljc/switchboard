import type { FacebookOAuthConfig } from "@switchboard/ad-optimizer";

/**
 * Resolve the Meta OAuth app credentials from the environment, shared by the OAuth connect routes
 * and the token-refresh cron so both halves read the same credential prefix (D10-4).
 *
 * Resolves the credential as a GROUP per prefix, never field-by-field, so we cannot pair an app id
 * from one prefix with a secret from the other (potentially a different Meta app). META_* is
 * canonical (the prefix the refresh cron has always read); FACEBOOK_* is a deprecated full-set
 * alias accepted for one release so existing deployments keep working.
 */
export function resolveMetaOAuthConfig(
  env: Record<string, string | undefined>,
): FacebookOAuthConfig {
  const meta = {
    appId: env["META_APP_ID"],
    appSecret: env["META_APP_SECRET"],
    redirectUri: env["META_OAUTH_REDIRECT_URI"],
  };
  const facebook = {
    appId: env["FACEBOOK_APP_ID"],
    appSecret: env["FACEBOOK_APP_SECRET"],
    redirectUri: env["FACEBOOK_REDIRECT_URI"],
  };
  const config = meta.appId && meta.appSecret && meta.redirectUri ? meta : facebook;

  if (!config.appId || !config.appSecret || !config.redirectUri) {
    throw new Error(
      "Missing Meta OAuth config. Set META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI.",
    );
  }

  return { appId: config.appId, appSecret: config.appSecret, redirectUri: config.redirectUri };
}
