import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { OperatorChannelSchema } from "@switchboard/schemas";
import type { OperatorRequest, OperatorCommand } from "@switchboard/schemas";
import { z } from "zod";

const CommandBodySchema = z.object({
  rawInput: z.string().min(1).max(2000),
  channel: OperatorChannelSchema,
  operatorId: z.string().min(1),
});

const CommandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Max operator commands per org per minute */
const OPERATOR_COMMAND_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
};

export async function operatorRoutes(app: FastifyInstance): Promise<void> {
  const deps = (app as unknown as Record<string, unknown>).operatorDeps as
    | import("../bootstrap/operator-deps.js").OperatorDeps
    | null;

  if (!deps) {
    app.log.warn("Operator deps not available — operator routes disabled");
    return;
  }

  // Submit a command
  // TODO: Add POST /command/:id/confirm and POST /command/:id/cancel endpoints
  // to complete the confirmation flow for write commands (issue #4).
  app.post(
    "/command",
    { config: { rateLimit: OPERATOR_COMMAND_RATE_LIMIT } },
    async (request, reply) => {
      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.status(401).send({ error: "Organization context required" });
      }

      const parsed = CommandBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
      }

      const { rawInput, channel, operatorId } = parsed.data;

      // 1. Save request
      const opRequest: OperatorRequest = {
        id: randomUUID(),
        organizationId: orgId,
        operatorId,
        channel,
        rawInput,
        receivedAt: new Date(),
      };
      await deps.commandStore.saveRequest(opRequest);

      // 2. Interpret (LLM parse)
      const interpretResult = await deps.interpreter.interpret(rawInput, {
        organizationId: orgId,
        channel,
      });

      // 3. Guardrail evaluation
      const guardrailResult = deps.guardrailEvaluator.evaluate(interpretResult);

      // 4. Build command
      const command: OperatorCommand = {
        id: randomUUID(),
        requestId: opRequest.id,
        organizationId: orgId,
        intent: interpretResult.intent,
        entities: interpretResult.entities,
        parameters: interpretResult.parameters,
        parseConfidence: interpretResult.confidence,
        guardrailResult,
        status: "parsed",
        workflowIds: [],
        resultSummary: null,
        createdAt: new Date(),
        completedAt: null,
      };

      // 5. If guardrails block, reject
      if (!guardrailResult.canExecute) {
        command.status = "rejected";
        command.completedAt = new Date();
        command.resultSummary = guardrailResult.warnings.join("; ");
        await deps.commandStore.saveCommand(command);
        return reply.send({
          commandId: command.id,
          status: "rejected",
          message: deps.formatter.formatClarificationPrompt(
            guardrailResult.missingEntities.length > 0
              ? guardrailResult.missingEntities
              : ["your request"],
            channel,
          ),
          guardrailResult,
        });
      }

      // 6. If confirmation required, save as parsed and return prompt
      if (guardrailResult.requiresConfirmation) {
        await deps.commandStore.saveCommand(command);
        return reply.send({
          commandId: command.id,
          status: "awaiting_confirmation",
          message: deps.formatter.formatConfirmationPrompt(
            command.intent,
            command.entities,
            channel,
          ),
          guardrailResult,
        });
      }

      // 7. Execute immediately
      command.status = "executing";
      await deps.commandStore.saveCommand(command);

      const routerResult = await deps.router.dispatch(command);

      command.status = routerResult.success ? "completed" : "failed";
      command.completedAt = new Date();
      command.workflowIds = routerResult.workflowIds;

      let resultData: Record<string, unknown> = {};
      if (routerResult.success && routerResult.resultSummary) {
        try {
          resultData = JSON.parse(routerResult.resultSummary) as Record<string, unknown>;
        } catch {
          resultData = { summary: routerResult.resultSummary };
        }
      }

      command.resultSummary = routerResult.success
        ? deps.formatter.formatSuccess(command.intent, resultData, channel)
        : deps.formatter.formatError(routerResult.error ?? "Unknown error", channel);

      await deps.commandStore.updateCommandStatus(command.id, command.status, {
        resultSummary: command.resultSummary,
        completedAt: command.completedAt,
        workflowIds: command.workflowIds,
      });

      return reply.send({
        commandId: command.id,
        status: command.status,
        message: command.resultSummary,
        workflowIds: command.workflowIds,
      });
    },
  );

  // List command history
  app.get("/commands", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const queryParsed = CommandsQuerySchema.safeParse(request.query);
    if (!queryParsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: queryParsed.error.issues });
    }

    const commands = await deps.commandStore.listCommands({
      organizationId: orgId,
      limit: queryParsed.data.limit,
      offset: queryParsed.data.offset,
    });

    return reply.send({ commands });
  });
}
