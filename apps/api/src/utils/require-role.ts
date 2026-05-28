import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrincipalRole } from "@switchboard/schemas";

/**
 * Role-based access guard for admin routes.
 * Looks up the principal from the identity store and checks if they have any of
 * the required roles. Returns true when auth is disabled (dev mode). Fails closed
 * with 403 when auth is enabled but no principal is bound, or when the principal
 * lacks the required role.
 */
export async function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  ...roles: PrincipalRole[]
): Promise<boolean> {
  // Dev mode — auth middleware registered no keys. Allow all, matching assertOrgAccess.
  if (request.server.authDisabled === true) return true;

  const principalId = request.principalIdFromAuth;

  // Auth is enabled but the request carries no principal binding (e.g. an
  // org-scoped static API key with an empty principal part: "key:org::"). Fail
  // closed — the absence of a principal must never be treated as a role grant.
  if (!principalId) {
    reply.code(403).send({
      error: "Forbidden: authenticated request has no principal binding",
      statusCode: 403,
    });
    return false;
  }

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
