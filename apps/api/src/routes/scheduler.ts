import type { FastifyInstance } from "fastify";
import {
  TriggerTypeSchema,
  TriggerActionSchema,
  EventPatternSchema,
  TriggerFiltersSchema,
} from "@switchboard/schemas";
import { z } from "zod";

const CreateTriggerBodySchema = z.object({
  organizationId: z.string(),
  type: TriggerTypeSchema,
  fireAt: z.coerce.date().nullable().optional().default(null),
  cronExpression: z.string().nullable().optional().default(null),
  eventPattern: EventPatternSchema.nullable().optional().default(null),
  action: TriggerActionSchema,
  sourceWorkflowId: z.string().nullable().optional().default(null),
  expiresAt: z.coerce.date().nullable().optional().default(null),
});

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  const scheduler = app.schedulerService;

  if (!scheduler) {
    app.log.warn("SchedulerService not available — scheduler routes disabled");
    return;
  }

  // Create trigger
  app.post("/triggers", async (request, reply) => {
    const parsed = CreateTriggerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid trigger input", details: parsed.error.issues });
    }

    const triggerId = await scheduler.registerTrigger(parsed.data);
    return reply.status(201).send({ triggerId });
  });

  // Cancel trigger
  app.delete<{ Params: { id: string } }>("/triggers/:id", async (request, reply) => {
    try {
      await scheduler.cancelTrigger(request.params.id);
      return reply.status(204).send();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      throw err;
    }
  });

  // List triggers
  app.get("/triggers", async (request, reply) => {
    const filters = TriggerFiltersSchema.parse(request.query);
    const triggers = await scheduler.listPendingTriggers(filters);
    return reply.send({ triggers });
  });
}
