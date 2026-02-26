import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Checks that the authenticated request's organization matches the resource's organization.
 * Returns true if access is allowed, false if denied (sends 403 response).
 * No-op (returns true) when auth is disabled (dev mode: organizationIdFromAuth is undefined).
 */
export function assertOrgAccess(
  request: FastifyRequest,
  resourceOrgId: string | null | undefined,
  reply: FastifyReply,
): boolean {
  const authOrgId = request.organizationIdFromAuth;

  // No auth configured (dev mode) — allow all
  if (!authOrgId) return true;

  // Resource has no org binding — allow (global resource)
  if (!resourceOrgId) return true;

  // Org mismatch
  if (authOrgId !== resourceOrgId) {
    reply.code(403).send({ error: "Forbidden: organization mismatch" });
    return false;
  }

  return true;
}
