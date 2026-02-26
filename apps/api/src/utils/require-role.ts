import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrincipalRole } from "@switchboard/schemas";

/**
 * Role-based access guard for admin routes.
 * Looks up the principal from the identity store and checks if they
 * have any of the required roles. Returns true if allowed (or auth is
 * disabled). Sends 403 and returns false if role is missing.
 */
export async function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  ...roles: PrincipalRole[]
): Promise<boolean> {
  const principalId = request.principalIdFromAuth;

  // Auth disabled (dev mode) — allow all
  if (!principalId) return true;

  const identityStore = request.server.storageContext.identity;
  const principal = await identityStore.getPrincipal(principalId);

  if (!principal) {
    reply.code(403).send({ error: "Forbidden: principal not found" });
    return false;
  }

  const hasRole = principal.roles.some((r) => roles.includes(r));
  if (!hasRole) {
    reply.code(403).send({
      error: `Forbidden: requires one of [${roles.join(", ")}]`,
    });
    return false;
  }

  return true;
}
