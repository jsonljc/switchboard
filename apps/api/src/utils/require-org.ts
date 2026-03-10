import type { FastifyReply, FastifyRequest } from "fastify";

export function requireOrganizationScope(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  if (request.organizationIdFromAuth) {
    return request.organizationIdFromAuth;
  }

  reply.code(403).send({
    error: "Forbidden: organization-scoped authentication is required",
    hint: "Use an API key or session bound to a specific organization.",
    statusCode: 403,
  });
  return null;
}
