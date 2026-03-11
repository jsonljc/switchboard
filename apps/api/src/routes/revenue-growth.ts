import type { FastifyPluginAsync } from "fastify";
import { executeGovernedSystemAction } from "../services/system-governed-actions.js";

export const revenueGrowthRoutes: FastifyPluginAsync = async (app) => {
  // POST /:accountId/run — Run a diagnostic cycle (governed)
  app.post(
    "/:accountId/run",
    {
      schema: {
        description: "Run a full diagnostic cycle for an account.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { accountId } = request.params as { accountId: string };

      try {
        const result = await executeGovernedSystemAction({
          orchestrator: app.orchestrator,
          actionType: "revenue-growth.diagnostic.run",
          cartridgeId: "revenue-growth",
          organizationId,
          parameters: { accountId, organizationId },
          message: "Run revenue growth diagnostic",
        });

        if (result.outcome !== "executed") {
          return reply.code(200).send({
            outcome: result.outcome,
            explanation: result.explanation,
            envelopeId: result.envelopeId,
          });
        }

        return reply.code(200).send({
          outcome: "executed",
          data: result.executionResult.data,
          summary: result.executionResult.summary,
          envelopeId: result.envelopeId,
        });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to run diagnostic",
          statusCode: 500,
        });
      }
    },
  );

  // GET /:accountId/latest — Get latest diagnostic results
  app.get(
    "/:accountId/latest",
    {
      schema: {
        description: "Get latest diagnostic cycle results for an account.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { accountId } = request.params as { accountId: string };

      try {
        const result = await cartridge.execute(
          "revenue-growth.diagnostic.latest",
          { accountId },
          { principalId: "system", organizationId: null, connectionCredentials: {} },
        );
        return reply.code(200).send({ data: result.data ?? null, summary: result.summary });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to fetch latest diagnostic",
          statusCode: 500,
        });
      }
    },
  );

  // GET /:accountId/connectors — Check connector health
  app.get(
    "/:accountId/connectors",
    {
      schema: {
        description: "Check connector status for an account.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { accountId } = request.params as { accountId: string };

      try {
        const result = await cartridge.execute(
          "revenue-growth.connectors.status",
          { accountId },
          { principalId: "system", organizationId: null, connectionCredentials: {} },
        );
        return reply.code(200).send({ connectors: result.data ?? [] });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to fetch connector status",
          statusCode: 500,
        });
      }
    },
  );

  // GET /:accountId/interventions — List interventions
  app.get(
    "/:accountId/interventions",
    {
      schema: {
        description: "List interventions for an account.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { accountId } = request.params as { accountId: string };
      const query = request.query as { status?: string; limit?: string };

      try {
        // Use the cartridge's internal store via a diagnostic.latest call
        // to get the latest cycle, then return its interventions
        const result = await cartridge.execute(
          "revenue-growth.diagnostic.latest",
          { accountId },
          { principalId: "system", organizationId: null, connectionCredentials: {} },
        );
        const cycle = result.data as Record<string, unknown> | undefined;
        let interventions = (cycle?.interventions as unknown[]) ?? [];

        if (query.status) {
          interventions = interventions.filter(
            (i) => (i as Record<string, unknown>).status === query.status,
          );
        }
        if (query.limit) {
          interventions = interventions.slice(0, parseInt(query.limit, 10));
        }

        return reply.code(200).send({ interventions });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to list interventions",
          statusCode: 500,
        });
      }
    },
  );

  // POST /interventions/:id/approve — Approve an intervention (governed)
  app.post(
    "/interventions/:id/approve",
    {
      schema: {
        description: "Approve a proposed intervention.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      const organizationId = request.organizationIdFromAuth;
      if (!organizationId) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };

      try {
        const result = await executeGovernedSystemAction({
          orchestrator: app.orchestrator,
          actionType: "revenue-growth.intervention.approve",
          cartridgeId: "revenue-growth",
          organizationId,
          parameters: { interventionId: id },
          message: `Approve intervention ${id}`,
        });

        if (result.outcome !== "executed") {
          return reply.code(200).send({
            outcome: result.outcome,
            explanation: result.explanation,
            envelopeId: result.envelopeId,
          });
        }

        return reply.code(200).send({
          outcome: "executed",
          summary: result.executionResult.summary,
          envelopeId: result.envelopeId,
        });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to approve intervention",
          statusCode: 500,
        });
      }
    },
  );

  // POST /interventions/:id/defer — Defer an intervention
  app.post(
    "/interventions/:id/defer",
    {
      schema: {
        description: "Defer a proposed intervention.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };
      const body = request.body as { reason?: string } | undefined;

      try {
        const result = await cartridge.execute(
          "revenue-growth.intervention.defer",
          { interventionId: id, reason: body?.reason ?? "No reason provided" },
          { principalId: "system", organizationId: null, connectionCredentials: {} },
        );
        return reply.code(200).send({ summary: result.summary });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to defer intervention",
          statusCode: 500,
        });
      }
    },
  );

  // GET /:accountId/digest — Generate weekly digest
  app.get(
    "/:accountId/digest",
    {
      schema: {
        description: "Generate a weekly digest for an account.",
        tags: ["Revenue Growth"],
      },
    },
    async (request, reply) => {
      if (!request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: API key must be scoped to an organization",
          statusCode: 403,
        });
      }

      const cartridge = app.storageContext.cartridges.get("revenue-growth");
      if (!cartridge) {
        return reply
          .code(503)
          .send({ error: "Revenue growth cartridge not available", statusCode: 503 });
      }

      const { accountId } = request.params as { accountId: string };

      try {
        const result = await cartridge.execute(
          "revenue-growth.digest.generate",
          { accountId },
          { principalId: "system", organizationId: null, connectionCredentials: {} },
        );
        return reply.code(200).send({ digest: result.data ?? null, summary: result.summary });
      } catch (err) {
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to generate digest",
          statusCode: 500,
        });
      }
    },
  );
};
