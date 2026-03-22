import { describe, it, expect } from "vitest";
import { issueSessionToken, validateSessionToken } from "../auth/session-token.js";

const TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long-for-hs256";

describe("Session Tokens", () => {
  describe("issueSessionToken", () => {
    it("issues a JWT with session claims", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });
  });

  describe("validateSessionToken", () => {
    it("validates a token and returns claims", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      const claims = await validateSessionToken(token, TEST_SECRET);
      expect(claims.sessionId).toBe("sess-1");
      expect(claims.organizationId).toBe("org-1");
      expect(claims.principalId).toBe("principal-1");
      expect(claims.roleId).toBe("ad-operator");
    });

    it("rejects an expired token", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: -1000,
      });

      await expect(validateSessionToken(token, TEST_SECRET)).rejects.toThrow();
    });

    it("rejects a token signed with wrong secret", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      await expect(
        validateSessionToken(token, "wrong-secret-that-is-also-32-bytes-plus"),
      ).rejects.toThrow();
    });
  });
});
