import type { FastifyPluginAsync } from "fastify";

export const auditMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook("onResponse", async (request, _reply) => {
    // In production, would log request/response to audit ledger
    // for routes that modify state
    const auditableRoutes = ["/api/actions", "/api/approvals", "/api/policies", "/api/identity"];
    const isAuditable = auditableRoutes.some((r) => request.url.startsWith(r));

    if (isAuditable && ["POST", "PUT", "DELETE"].includes(request.method)) {
      // Would record audit entry here
    }
  });
};
