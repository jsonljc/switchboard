// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { isAgentKey, AGENT_REGISTRY } from "@switchboard/schemas";
import { agentHome } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

export const greetingRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode: allow `x-org-id` header to set the org scope (same pattern as decisionsRoutes)
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get(
    "/agents/:agentKey/greeting",
    {
      schema: {
        description: "Greeting projection for a day-one agent.",
        tags: ["Dashboard"],
        params: {
          type: "object",
          properties: { agentKey: { type: "string" } },
          required: ["agentKey"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { agentKey } = request.params as { agentKey: string };

      // Validate agentKey
      if (!isAgentKey(agentKey)) {
        return reply.code(400).send({ error: `Unknown agent key: ${agentKey}`, statusCode: 400 });
      }

      // Check if agent is day-one
      const entry = AGENT_REGISTRY[agentKey];
      if (entry.launchTier !== "day-one") {
        return reply
          .code(404)
          .send({ error: `Agent ${agentKey} is not available for greeting`, statusCode: 404 });
      }

      // Greeting is only supported for alex and riley
      if (agentKey !== "alex" && agentKey !== "riley") {
        return reply
          .code(400)
          .send({ error: `Greeting not supported for agent: ${agentKey}`, statusCode: 400 });
      }

      // Check store is wired
      if (!app.greetingSignalStore) {
        return reply
          .code(500)
          .send({ error: "Greeting signal store not configured", statusCode: 500 });
      }

      // Project greeting
      const projection = await agentHome.projectGreeting({
        orgId,
        agentKey,
        store: app.greetingSignalStore,
      });

      return reply.code(200).send({ data: projection });
    },
  );
};
