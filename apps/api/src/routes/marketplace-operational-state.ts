// @route-class: control-plane
// ---------------------------------------------------------------------------
// Operational-state confirmations (Riley v3 slice 4b; spec 2.1 net-new
// paragraph + 7.4; substrate shipped in 4a, #895).
//
// Org-scoped settings writes following the business-facts conventions
// (marketplace.ts): org from request.organizationIdFromAuth, deployment :id
// anchors org ownership with 404 on mismatch (no existence leak), Zod
// safeParse -> 400, stores constructed inline. NOT PlatformIngress: a
// confirmation is a settings write, not a revenue action.
//
// POST is append-only by contract: every save calls recordConfirmation
// (INSERT-only; the store deliberately ships no update API). Re-sending the
// same state IS the freshness re-anchor ("everything still accurate").
// confirmedAt is this route's clock at handling time (the operator action
// moment); the client never supplies it. confirmedBy is the authenticated
// principal when auth carries one; nothing invents an identity.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { OperationalStateSchema } from "@switchboard/schemas";
import { PrismaDeploymentStore, PrismaOperationalStateStore } from "@switchboard/db";

export const marketplaceOperationalStateRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/deployments/:id/operational-state",
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
      }

      const { id } = request.params;
      const deploymentStore = new PrismaDeploymentStore(app.prisma);
      const deployment = await deploymentStore.findById(id);
      if (!deployment || deployment.organizationId !== orgId) {
        return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
      }

      const store = new PrismaOperationalStateStore(app.prisma);
      // getLatest degrades malformed rows to null (honest absence); the UI
      // renders null as "never confirmed", never a fabricated default.
      const confirmation = await store.getLatest(orgId);
      return reply.send({ confirmation });
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/deployments/:id/operational-state",
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(401).send({ error: "Authentication required", statusCode: 401 });
      }

      const { id } = request.params;
      const deploymentStore = new PrismaDeploymentStore(app.prisma);
      const deployment = await deploymentStore.findById(id);
      if (!deployment || deployment.organizationId !== orgId) {
        return reply.code(404).send({ error: "Deployment not found", statusCode: 404 });
      }

      const parsed = OperationalStateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid operational state",
          issues: parsed.error.issues,
          statusCode: 400,
        });
      }

      const store = new PrismaOperationalStateStore(app.prisma);
      const principalId = request.principalIdFromAuth;
      const confirmation = await store.recordConfirmation(orgId, parsed.data, {
        confirmedAt: new Date(),
        ...(principalId ? { confirmedBy: principalId } : {}),
      });
      return reply.code(201).send({ confirmation });
    },
  );
};
