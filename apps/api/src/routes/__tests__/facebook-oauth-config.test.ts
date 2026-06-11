import { describe, it, expect } from "vitest";
import { resolveMetaOAuthConfig } from "../facebook-oauth.js";

describe("resolveMetaOAuthConfig", () => {
  it("prefers the canonical META_* vars over the deprecated FACEBOOK_* aliases", () => {
    // D10-4: the OAuth route and the token-refresh cron must read the same credential prefix.
    // The cron reads META_* (bootstrap/inngest.ts), so META_* is canonical here too.
    const config = resolveMetaOAuthConfig({
      META_APP_ID: "meta_app",
      META_APP_SECRET: "meta_secret",
      META_OAUTH_REDIRECT_URI: "https://example.com/meta/callback",
      FACEBOOK_APP_ID: "fb_app",
      FACEBOOK_APP_SECRET: "fb_secret",
      FACEBOOK_REDIRECT_URI: "https://example.com/fb/callback",
    });
    expect(config).toEqual({
      appId: "meta_app",
      appSecret: "meta_secret",
      redirectUri: "https://example.com/meta/callback",
    });
  });

  it("falls back to the FACEBOOK_* aliases when META_* are unset (back-compat)", () => {
    const config = resolveMetaOAuthConfig({
      FACEBOOK_APP_ID: "fb_app",
      FACEBOOK_APP_SECRET: "fb_secret",
      FACEBOOK_REDIRECT_URI: "https://example.com/fb/callback",
    });
    expect(config).toEqual({
      appId: "fb_app",
      appSecret: "fb_secret",
      redirectUri: "https://example.com/fb/callback",
    });
  });

  it("throws when a required credential is missing under both prefixes", () => {
    expect(() => resolveMetaOAuthConfig({ META_APP_ID: "only_id" })).toThrow(
      /Missing Meta OAuth config/,
    );
  });
});
