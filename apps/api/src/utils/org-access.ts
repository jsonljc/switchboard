import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Checks that the authenticated request's organization matches the resource's organization.
 * Returns true if access is allowed, false if denied (sends a response).
 *
 * Three-state model:
 *   - app.authDisabled === true (dev mode: no API_KEYS configured): allow all (returns true).
 *   - auth-enabled, request.organizationIdFromAuth === undefined: deny with 403
 *     ("Authenticated request has no organization binding"). This is the closed-fail state
 *     for unscoped static API keys; never allow.
 *   - auth-enabled, organizationIdFromAuth !== resourceOrgId: deny with 403 (org mismatch).
 *
 * If the resource has no org binding (resourceOrgId nullish), allow (global resource).
 */
export function assertOrgAccess(
  request: FastifyRequest,
  resourceOrgId: string | null | undefined,
  reply: FastifyReply,
): boolean {
  // Dev mode — auth middleware did not register any keys. Allow all.
  if (request.server.authDisabled === true) return true;

  const authOrgId = request.organizationIdFromAuth;

  // Auth is enabled but the request has no org binding (e.g. unscoped static API key).
  // Fail closed — never treat this as "dev mode".
  if (!authOrgId) {
    reply.code(403).send({
      error: "Forbidden: authenticated request has no organization binding",
      hint: "Configure API_KEY_METADATA to scope this API key to an organization.",
      statusCode: 403,
    });
    return false;
  }

  // Resource has no org binding — allow (global resource).
  if (!resourceOrgId) return true;

  // Org mismatch
  if (authOrgId !== resourceOrgId) {
    reply.code(403).send({
      error: "Forbidden: organization mismatch",
      hint: "Verify your API key is scoped to the correct organization.",
      statusCode: 403,
    });
    return false;
  }

  return true;
}

/**
 * Resolves the organization for a mutation route, enforcing the auth-trust-binding rules:
 *
 *   - In dev mode (app.authDisabled === true), `bodyOrgId` is acceptable (used in tests
 *     and local development).
 *   - In auth-enabled mode, only `request.organizationIdFromAuth` is trusted. If `bodyOrgId`
 *     is provided and differs from auth, returns a 400 (mismatch). If auth has no org binding,
 *     returns a 403 ("no organization binding").
 *
 * Returns the resolved organizationId on success, or null after sending a response.
 */
export function resolveOrganizationForMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  bodyOrgId: string | null | undefined,
): string | null {
  // Dev mode — accept body orgId or auth orgId.
  if (request.server.authDisabled === true) {
    const orgId = request.organizationIdFromAuth ?? bodyOrgId ?? null;
    if (!orgId) {
      reply.code(400).send({
        error: "organizationId is required",
        statusCode: 400,
      });
      return null;
    }
    return orgId;
  }

  const authOrgId = request.organizationIdFromAuth;
  if (!authOrgId) {
    reply.code(403).send({
      error: "Forbidden: authenticated request has no organization binding",
      hint: "Configure API_KEY_METADATA to scope this API key to an organization.",
      statusCode: 403,
    });
    return null;
  }

  if (bodyOrgId && bodyOrgId !== authOrgId) {
    reply.code(400).send({
      error: "organizationId in body does not match authenticated context",
      hint: "Omit organizationId from the request body, or send the value bound to your API key.",
      statusCode: 400,
    });
    return null;
  }

  return authOrgId;
}
