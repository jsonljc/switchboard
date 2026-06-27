/**
 * EV-14 / CHAN-7 — session-token org binding.
 *
 * A session JWT carries a SIGNED `organizationId` claim. Cross-tenant safety
 * means: a token issued for org A validates to org A (never org B), and the org
 * claim is integrity-protected — you cannot take org A's token, rewrite the org
 * claim to org B, and have it validate. The existing session-token.test.ts pins
 * issue/validate/expiry/wrong-secret; this adds the org-isolation lane. TEST-ONLY.
 */
import { describe, it, expect } from "vitest";
import { issueSessionToken, validateSessionToken } from "../auth/session-token.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long-for-hs256";
const ORG_A = "org_A";
const ORG_B = "org_B";

async function tokenFor(organizationId: string, principalId: string): Promise<string> {
  return issueSessionToken({
    sessionId: `sess-${organizationId}`,
    organizationId,
    principalId,
    roleId: "ad-operator",
    secret: SECRET,
    expiresInMs: 30 * 60 * 1000,
  });
}

describe("CHAN-7 session-token org binding", () => {
  it("each org's token validates to its OWN org, never the other", async () => {
    const tokenA = await tokenFor(ORG_A, "principal_A");
    const tokenB = await tokenFor(ORG_B, "principal_B");
    expect(tokenA).not.toBe(tokenB);

    const claimsA = await validateSessionToken(tokenA, SECRET);
    const claimsB = await validateSessionToken(tokenB, SECRET);

    expect(claimsA.organizationId).toBe(ORG_A);
    expect(claimsA.organizationId).not.toBe(ORG_B);
    expect(claimsB.organizationId).toBe(ORG_B);
    expect(claimsB.organizationId).not.toBe(ORG_A);
  });

  it("a token's org claim cannot be rebound to another org (tamper breaks the signature)", async () => {
    const tokenA = await tokenFor(ORG_A, "principal_A");
    const [header, payloadB64, signature] = tokenA.split(".");

    // Rewrite organizationId A -> B in the payload, keep the original signature.
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8"));
    expect(payload.organizationId).toBe(ORG_A);
    payload.organizationId = ORG_B;
    const forgedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const forgedToken = `${header}.${forgedPayload}.${signature}`;

    // The HS256 signature no longer matches the mutated payload -> rejected.
    await expect(validateSessionToken(forgedToken, SECRET)).rejects.toThrow();
  });

  it("an org-A token cannot be reissued for org B without the signing secret", async () => {
    // Forging an org-B token requires the secret; signing with a different secret
    // and validating under the real secret must fail.
    const forgedWithWrongSecret = await issueSessionToken({
      sessionId: "sess-forged",
      organizationId: ORG_B,
      principalId: "attacker",
      roleId: "ad-operator",
      secret: "attacker-secret-that-is-also-32-bytes-plus",
      expiresInMs: 30 * 60 * 1000,
    });
    await expect(validateSessionToken(forgedWithWrongSecret, SECRET)).rejects.toThrow();
  });
});
