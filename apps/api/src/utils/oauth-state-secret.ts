/**
 * Resolve the secret used to HMAC-sign OAuth `state` for the facebook + google-calendar connect
 * flows. Signing AND verifying both happen in the API tier, so the same resolver is used on both
 * sides and they always agree (we deliberately do NOT sign in the dashboard, whose secret env var
 * differs — NEXTAUTH_SECRET vs the API's SESSION_TOKEN_SECRET — which would silently break every
 * connect on a mismatch).
 *
 * `SESSION_TOKEN_SECRET` is canonical; `NEXTAUTH_SECRET` is accepted as a fallback for deployments
 * that only set the shared NextAuth secret. In production a missing secret is a HARD error rather
 * than a guessable constant: an attacker who knew a constant fallback could forge a `state` and bind
 * their own ad account to any deployment (connection-fixation). Outside production we return a fixed
 * dev-only value so local flows work without configuration.
 */
const DEV_FALLBACK_SECRET = "dev-only-oauth-state-secret-not-for-production";

export function resolveOAuthStateSecret(env: Record<string, string | undefined>): string {
  const candidate = env["SESSION_TOKEN_SECRET"]?.trim() || env["NEXTAUTH_SECRET"]?.trim();
  if (candidate) return candidate;

  if (env["NODE_ENV"] === "production") {
    throw new Error(
      "OAuth state secret is not configured. Set SESSION_TOKEN_SECRET (or NEXTAUTH_SECRET) " +
        "so OAuth `state` can be signed and verified.",
    );
  }
  return DEV_FALLBACK_SECRET;
}
