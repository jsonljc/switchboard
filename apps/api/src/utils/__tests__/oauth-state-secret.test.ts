import { describe, it, expect } from "vitest";
import { resolveOAuthStateSecret } from "../oauth-state-secret.js";

describe("resolveOAuthStateSecret", () => {
  it("prefers SESSION_TOKEN_SECRET over NEXTAUTH_SECRET", () => {
    expect(
      resolveOAuthStateSecret({
        SESSION_TOKEN_SECRET: "session-secret",
        NEXTAUTH_SECRET: "nextauth-secret",
        NODE_ENV: "production",
      }),
    ).toBe("session-secret");
  });

  it("falls back to NEXTAUTH_SECRET when SESSION_TOKEN_SECRET is unset", () => {
    expect(
      resolveOAuthStateSecret({ NEXTAUTH_SECRET: "nextauth-secret", NODE_ENV: "production" }),
    ).toBe("nextauth-secret");
  });

  it("throws in production when neither secret is set (no guessable fallback)", () => {
    expect(() => resolveOAuthStateSecret({ NODE_ENV: "production" })).toThrow(/not configured/i);
  });

  it("treats blank secrets as unset", () => {
    expect(() =>
      resolveOAuthStateSecret({ SESSION_TOKEN_SECRET: "   ", NODE_ENV: "production" }),
    ).toThrow(/not configured/i);
  });

  it("returns a non-empty dev fallback outside production when neither secret is set", () => {
    const secret = resolveOAuthStateSecret({ NODE_ENV: "development" });
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
  });
});
