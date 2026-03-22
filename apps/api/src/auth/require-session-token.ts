import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionTokenClaims } from "./session-token.js";
import { validateSessionToken } from "./session-token.js";

const claimsSym = Symbol("sessionTokenClaims");

type RequestWithSessionClaims = FastifyRequest & {
  [claimsSym]?: SessionTokenClaims;
};

export async function requireSessionToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "Missing Authorization: Bearer session token" });
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const secret = process.env["SESSION_TOKEN_SECRET"];
  if (!secret) {
    await reply.code(503).send({ error: "Session token validation not configured" });
    return;
  }
  try {
    const claims = await validateSessionToken(token, secret);
    (request as RequestWithSessionClaims)[claimsSym] = claims;
  } catch {
    await reply.code(401).send({ error: "Invalid or expired session token" });
  }
}

export function getSessionTokenClaims(request: FastifyRequest): SessionTokenClaims {
  const c = (request as RequestWithSessionClaims)[claimsSym];
  if (!c) {
    throw new Error("getSessionTokenClaims called without requireSessionToken preHandler");
  }
  return c;
}
