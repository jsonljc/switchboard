import type { FastifyPluginAsync } from "fastify";
import { PlaybookSchema } from "@switchboard/schemas";

const SIMULATION_SYSTEM_PROMPT =
  "SIMULATION MODE: You are in simulation mode. No actions are real. " +
  "Always communicate that outcomes are simulated. Never say a booking is confirmed, " +
  "an email was sent, or any action was completed. Instead say what WOULD happen " +
  "if this were a real conversation.";

const simulateRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/simulate", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized", statusCode: 401 });

    if (!app.simulationExecutor || !app.simulationSkill) {
      return reply.code(503).send({
        error: "Simulation unavailable — skill executor not configured",
        statusCode: 503,
      });
    }

    const body = request.body as { playbook?: unknown; userMessage?: unknown };

    if (!body.userMessage || typeof body.userMessage !== "string") {
      return reply
        .code(400)
        .send({ error: "userMessage is required and must be a string", statusCode: 400 });
    }

    const playbookParse = PlaybookSchema.safeParse(body.playbook);
    if (!playbookParse.success) {
      return reply.code(400).send({
        error: "Invalid playbook",
        issues: playbookParse.error.issues,
        statusCode: 400,
      });
    }

    try {
      const result = await app.simulationExecutor.execute({
        skill: app.simulationSkill,
        parameters: {
          playbook: playbookParse.data,
          simulationPrompt: SIMULATION_SYSTEM_PROMPT,
        },
        messages: [{ role: "user", content: body.userMessage }],
        deploymentId: `sim-${orgId}`,
        orgId,
        trustScore: 0,
        trustLevel: "supervised",
      });

      const toolsAttempted = result.toolCalls.map((tc) => ({
        toolId: tc.toolId,
        operation: tc.operation,
        simulated: tc.result.data?.simulated === true,
        effectCategory:
          typeof tc.result.data?.effect_category === "string"
            ? tc.result.data.effect_category
            : "read",
      }));

      const blockedActions = result.toolCalls
        .filter((tc) => tc.result.data?.simulated === true)
        .map(
          (tc) => `${tc.toolId}.${tc.operation} (${tc.result.data?.effect_category ?? "unknown"})`,
        );

      const annotations = [
        `${result.toolCalls.length} tool call(s)`,
        `${blockedActions.length} blocked by simulation policy`,
        `${result.tokenUsage.input + result.tokenUsage.output} tokens used`,
      ];

      return reply.send({
        alexMessage: result.response,
        annotations,
        toolsAttempted,
        blockedActions,
      });
    } catch (err) {
      app.log.error(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
      return reply.code(500).send({
        error: "Simulation execution failed",
        statusCode: 500,
      });
    }
  });
};

export { simulateRoutes };
