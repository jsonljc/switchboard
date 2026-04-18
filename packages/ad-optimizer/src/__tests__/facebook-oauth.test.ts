// packages/core/src/ad-optimizer/__tests__/facebook-oauth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  refreshTokenIfNeeded,
  GRAPH_API_BASE,
  OAUTH_DIALOG,
  SCOPES,
} from "../facebook-oauth.js";
import type { FacebookOAuthConfig } from "../facebook-oauth.js";

describe("facebook-oauth", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const config: FacebookOAuthConfig = {
    appId: "test-app-id",
    appSecret: "test-app-secret",
    redirectUri: "https://example.com/callback",
  };

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildAuthorizationUrl", () => {
    it("builds correct URL with scopes and state", () => {
      const url = buildAuthorizationUrl(config, "random-state-123");
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe(OAUTH_DIALOG);
      expect(parsed.searchParams.get("client_id")).toBe("test-app-id");
      expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
      expect(parsed.searchParams.get("scope")).toBe(SCOPES);
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("state")).toBe("random-state-123");
    });
  });

  describe("exchangeCodeForToken", () => {
    it("exchanges code and returns accessToken + expiresIn", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "short-lived-token-abc",
            expires_in: 3600,
          }),
      });

      const result = await exchangeCodeForToken(config, "auth-code-xyz");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain(`${GRAPH_API_BASE}/oauth/access_token`);
      expect(callUrl).toContain("client_id=test-app-id");
      expect(callUrl).toContain("client_secret=test-app-secret");
      expect(callUrl).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcallback");
      expect(callUrl).toContain("code=auth-code-xyz");

      expect(result).toEqual({
        accessToken: "short-lived-token-abc",
        expiresIn: 3600,
      });
    });

    it("throws on failed exchange", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { message: "Invalid verification code" },
          }),
      });

      await expect(exchangeCodeForToken(config, "bad-code")).rejects.toThrow(
        "Facebook OAuth error (401): Invalid verification code",
      );
    });
  });

  describe("exchangeForLongLivedToken", () => {
    it("exchanges short-lived token for 60-day token", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "long-lived-token-xyz",
            expires_in: 5184000,
          }),
      });

      const result = await exchangeForLongLivedToken(config, "short-lived-token-abc");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("grant_type=fb_exchange_token");
      expect(callUrl).toContain("client_id=test-app-id");
      expect(callUrl).toContain("client_secret=test-app-secret");
      expect(callUrl).toContain("fb_exchange_token=short-lived-token-abc");

      expect(result).toEqual({
        accessToken: "long-lived-token-xyz",
        expiresIn: 5184000,
      });
    });
  });

  describe("listAdAccounts", () => {
    it("returns mapped AdAccount array", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                account_id: "123456",
                name: "My Business Account",
                currency: "USD",
                account_status: 1,
              },
              {
                account_id: "789012",
                name: "EU Account",
                currency: "EUR",
                account_status: 2,
              },
            ],
          }),
      });

      const result = await listAdAccounts("valid-access-token");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain(`${GRAPH_API_BASE}/me/adaccounts`);
      expect(callUrl).toContain("access_token=valid-access-token");
      expect(callUrl).toContain("fields=account_id%2Cname%2Ccurrency%2Caccount_status");

      expect(result).toEqual([
        { accountId: "123456", name: "My Business Account", currency: "USD", status: 1 },
        { accountId: "789012", name: "EU Account", currency: "EUR", status: 2 },
      ]);
    });
  });

  describe("refreshTokenIfNeeded", () => {
    it("returns null when not near expiry (>7 days)", async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days from now

      const result = await refreshTokenIfNeeded(config, "current-token", futureDate);

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refreshes when within 7 days and returns new token", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "refreshed-token",
            expires_in: 5184000,
          }),
      });

      const nearExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now

      const result = await refreshTokenIfNeeded(config, "expiring-token", nearExpiry);

      expect(result).toEqual({
        accessToken: "refreshed-token",
        expiresIn: 5184000,
      });

      const callUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(callUrl).toContain("fb_exchange_token=expiring-token");
    });

    it("throws when refresh fails (token revoked)", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: { message: "Token has been revoked" },
          }),
      });

      const nearExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now

      await expect(refreshTokenIfNeeded(config, "revoked-token", nearExpiry)).rejects.toThrow(
        "Facebook OAuth error (400): Token has been revoked",
      );
    });
  });
});
