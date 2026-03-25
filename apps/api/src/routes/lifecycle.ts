// ---------------------------------------------------------------------------
// Lifecycle Routes — contact, opportunity, revenue, pipeline, and owner tasks
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import {
  OpportunityStageSchema,
  TaskStatusSchema,
  RevenueTypeSchema,
  RecordedBySchema,
} from "@switchboard/schemas";
import { createEventEnvelope } from "@switchboard/agents";
import type { RoutedEventEnvelope } from "@switchboard/agents";
import { z } from "zod";

const CreateContactBodySchema = z.object({
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  firstTouchChannel: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  attribution: z.record(z.unknown()).nullable().optional(),
  roles: z.array(z.string()).optional(),
});

const CreateOpportunityBodySchema = z.object({
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  estimatedValue: z.number().nullable().optional(),
  assignedAgent: z.string().nullable().optional(),
});

const AdvanceStageBodySchema = z.object({
  toStage: OpportunityStageSchema,
  advancedBy: z.string().min(1),
});

const RecordRevenueBodySchema = z.object({
  contactId: z.string().min(1),
  opportunityId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().optional(),
  type: RevenueTypeSchema,
  status: z.enum(["pending", "confirmed", "refunded", "failed"]).optional(),
  recordedBy: RecordedBySchema,
  externalReference: z.string().nullable().optional(),
  verified: z.boolean().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

const UpdateTaskStatusBodySchema = z.object({
  status: TaskStatusSchema,
});

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  const deps = app.lifecycleDeps;
  if (!deps) {
    app.log.warn("[lifecycle-routes] Lifecycle deps not available — skipping lifecycle routes");
    return;
  }

  const { lifecycleService, fallbackHandler: _fallbackHandler, ownerTaskStore } = deps;

  // POST /contacts — create a contact
  app.post("/contacts", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = CreateContactBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const contact = await lifecycleService.createContact({
      organizationId: orgId,
      ...parsed.data,
    });

    return reply.status(201).send(contact);
  });

  // GET /contacts/:id — get contact with opportunities
  app.get<{ Params: { id: string } }>("/contacts/:id", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const detail = await lifecycleService.getContactWithOpportunities(orgId, request.params.id);
    if (!detail) {
      return reply.status(404).send({ error: "Contact not found" });
    }

    return reply.send(detail);
  });

  // POST /opportunities — create an opportunity
  app.post("/opportunities", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = CreateOpportunityBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    const opportunity = await lifecycleService.createOpportunity({
      organizationId: orgId,
      ...parsed.data,
    });

    return reply.status(201).send(opportunity);
  });

  // POST /opportunities/:id/advance — advance opportunity stage
  app.post<{ Params: { id: string } }>("/opportunities/:id/advance", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = AdvanceStageBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    try {
      const result = await lifecycleService.advanceOpportunityStage(
        orgId,
        request.params.id,
        parsed.data.toStage,
        parsed.data.advancedBy,
      );

      // Wrap advancementData into a RoutedEventEnvelope
      const envelope = createEventEnvelope({
        organizationId: orgId,
        eventType: "opportunity.stage_advanced",
        source: { type: "system", id: "lifecycle-api" },
        payload: result.advancementData,
      });

      // Dispatch to EventLoop for agent processing
      const agentSystem = app.agentSystem;
      if (agentSystem?.eventLoop) {
        await agentSystem.eventLoop.process(envelope, { organizationId: orgId });
      }

      return reply.send({ opportunity: result.opportunity, event: envelope });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  });

  // POST /revenue — record a revenue event
  app.post("/revenue", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = RecordRevenueBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    try {
      const result = await lifecycleService.recordRevenue({
        organizationId: orgId,
        ...parsed.data,
      });

      // Wrap revenueData into a "revenue.recorded" event
      const revenueEnvelope = createEventEnvelope({
        organizationId: orgId,
        eventType: "revenue.recorded",
        source: { type: "system", id: "lifecycle-api" },
        payload: result.revenueData,
      });

      const events: RoutedEventEnvelope[] = [revenueEnvelope];

      // If stage was auto-advanced (showed → won), also emit an opportunity.stage_advanced event
      if (result.stageAdvancement) {
        const stageEnvelope = createEventEnvelope({
          organizationId: orgId,
          eventType: "opportunity.stage_advanced",
          source: { type: "system", id: "lifecycle-api" },
          payload: result.stageAdvancement.advancementData,
          causationId: revenueEnvelope.eventId,
          correlationId: revenueEnvelope.correlationId,
        });
        events.push(stageEnvelope);
      }

      // Dispatch all events to EventLoop for agent processing
      const agentSystem = app.agentSystem;
      if (agentSystem?.eventLoop) {
        for (const evt of events) {
          await agentSystem.eventLoop.process(evt, { organizationId: orgId });
        }
      }

      return reply.status(201).send({
        revenueEvent: result.revenueEvent,
        events,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  });

  // GET /pipeline — get pipeline snapshot
  app.get("/pipeline", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const snapshot = await lifecycleService.getPipeline(orgId);
    return reply.send(snapshot);
  });

  // GET /tasks — get pending owner tasks
  app.get("/tasks", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const tasks = await ownerTaskStore.findPending(orgId);
    return reply.send({ tasks });
  });

  // POST /tasks/:id/status — update task status
  app.post<{ Params: { id: string } }>("/tasks/:id/status", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.status(401).send({ error: "Organization context required" });
    }

    const parsed = UpdateTaskStatusBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.issues });
    }

    try {
      const completedAt = parsed.data.status === "completed" ? new Date() : undefined;
      const task = await ownerTaskStore.updateStatus(
        orgId,
        request.params.id,
        parsed.data.status,
        completedAt,
      );
      return reply.send(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found") || message.includes("Record to update not found")) {
        return reply.status(404).send({ error: "Task not found" });
      }
      return reply.status(400).send({ error: message });
    }
  });
}
