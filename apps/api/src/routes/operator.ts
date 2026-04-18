import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { OperatorChannelSchema } from "@switchboard/schemas";
import type { OperatorChannel, OperatorRequest, OperatorCommand } from "@switchboard/schemas";
import { z } from "zod";
import type { OperatorDeps } from "../bootstrap/operator-deps.js";

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

/**
 * Dispatch a command via the router, format the result, and persist final status.
 * Wraps dispatch in try/catch so a thrown error sets the command to "failed".
 */
async function dispatchAndFinalize(
  deps: OperatorDeps,
  command: OperatorCommand,
  channel: OperatorChannel,
): Promise<{ status: "completed" | "failed"; message: string; workflowIds: string[] }> {
  try {
    const routerResult = await deps.router.dispatch({
      ...command,
      entities: command.entities.map((e) => ({ type: e.type, value: e.id ?? "" })),
    });

    const status = routerResult.success ? "completed" : "failed";
    const completedAt = new Date();
    const workflowIds = routerResult.workflowIds;

    let resultData: Record<string, unknown> = {};
    if (routerResult.success && routerResult.resultSummary) {
      try {
        resultData = JSON.parse(routerResult.resultSummary) as Record<string, unknown>;
      } catch {
        resultData = { summary: routerResult.resultSummary };
      }
    }

    const message = routerResult.success
      ? deps.formatter.formatSuccess(command.intent, resultData, channel)
      : deps.formatter.formatError(routerResult.error ?? "Unknown error", channel);

    await deps.commandStore.updateCommandStatus(command.id, status, {
      resultSummary: message,
      completedAt,
      workflowIds,
    });

    return { status, message, workflowIds };
  } catch (err) {
    const completedAt = new Date();
    const errorMessage = err instanceof Error ? err.message : "Unexpected dispatch error";
    const message = deps.formatter.formatError(errorMessage, channel);

    await deps.commandStore.updateCommandStatus(command.id, "failed", {
      resultSummary: message,
      completedAt,
    });

    return { status: "failed", message, workflowIds: [] };
  }
}

export async function operatorRoutes(app: FastifyInstance): Promise<void> {
  const deps = (app as unknown as Record<string, unknown>).operatorDeps as OperatorDeps | null;

  if (!deps) {
    app.log.warn("Operator deps not available — operator routes disabled");
    return;
  }

  // Submit a command
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
        guardrailResult: {
          ...guardrailResult,
          riskLevel: "low" as const,
          requiresPreview: false,
          ambiguityFlags: [],
        },
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
            command.entities.map((e) => ({ type: e.type, value: e.id ?? "" })),
            channel,
          ),
          guardrailResult,
        });
      }

      // 7. Execute immediately
      command.status = "executing";
      await deps.commandStore.saveCommand(command);

      const result = await dispatchAndFinalize(deps, command, channel);

      return reply.send({
        commandId: command.id,
        status: result.status,
        message: result.message,
        workflowIds: result.workflowIds,
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

  // Confirm a parsed command
  app.post("/command/:id/confirm", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const { id } = request.params as { id: string };
    const command = await deps.commandStore.getCommandById(id);
    if (!command) {
      return reply.status(404).send({ error: "Command not found" });
    }
    if (command.organizationId !== orgId) {
      return reply.status(403).send({ error: "Command belongs to a different organization" });
    }
    if (command.status !== "parsed") {
      return reply.status(409).send({ error: "Command must be in parsed status to confirm" });
    }

    // Mark as executing
    await deps.commandStore.updateCommandStatus(id, "executing");

    // Resolve channel from the original request
    const opRequest = await deps.commandStore.getRequestById(command.requestId);
    const channel: OperatorChannel = opRequest?.channel ?? "dashboard";

    const result = await dispatchAndFinalize(deps, command, channel);

    return reply.send({
      commandId: id,
      status: result.status,
      message: result.message,
      workflowIds: result.workflowIds,
    });
  });

  // Cancel a parsed command
  app.post("/command/:id/cancel", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const { id } = request.params as { id: string };
    const command = await deps.commandStore.getCommandById(id);
    if (!command) {
      return reply.status(404).send({ error: "Command not found" });
    }
    if (command.organizationId !== orgId) {
      return reply.status(403).send({ error: "Command belongs to a different organization" });
    }
    if (command.status !== "parsed") {
      return reply.status(409).send({ error: "Command must be in parsed status to cancel" });
    }

    await deps.commandStore.updateCommandStatus(id, "rejected", {
      resultSummary: "Cancelled by operator",
      completedAt: new Date(),
    });

    return reply.send({
      commandId: id,
      status: "rejected",
      message: "Command cancelled.",
    });
  });
}
