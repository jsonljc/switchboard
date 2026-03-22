import * as jose from "jose";

export interface SessionTokenClaims {
  sessionId: string;
  organizationId: string;
  principalId: string;
  roleId: string;
}

/**
 * Issue a session-scoped JWT.
 * This is a SEPARATE auth path from the existing API key / NextAuth flow.
 * Session tokens are short-lived and scoped to a single session.
 */
export async function issueSessionToken(input: {
  sessionId: string;
  organizationId: string;
  principalId: string;
  roleId: string;
  secret: string;
  expiresInMs: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(input.secret);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(input.expiresInMs / 1000);

  return new jose.SignJWT({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    roleId: input.roleId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setSubject(input.principalId)
    .setIssuer("switchboard:session")
    .sign(secret);
}

/**
 * Validate a session-scoped JWT and return its claims.
 */
export async function validateSessionToken(
  token: string,
  secret: string,
): Promise<SessionTokenClaims> {
  const secretKey = new TextEncoder().encode(secret);

  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: "switchboard:session",
  });

  return {
    sessionId: payload["sessionId"] as string,
    organizationId: payload["organizationId"] as string,
    principalId: payload["principalId"] as string,
    roleId: payload["roleId"] as string,
  };
}
