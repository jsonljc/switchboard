import type { FastifyPluginAsync } from "fastify";
import { PrismaContentStore, PrismaPerformanceStore } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

export const contentRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/content/drafts — list drafts for org + employee
  app.get(
    "/drafts",
    {
      schema: {
        description: "List content drafts, optionally filtered by employee and status.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const query = request.query as {
        employeeId?: string;
        status?: string;
      };

      if (!query.employeeId) {
        return reply
          .code(400)
          .send({ error: "employeeId query parameter is required", statusCode: 400 });
      }

      const store = new PrismaContentStore(app.prisma);
      const drafts = await store.listDrafts(orgId, query.employeeId, query.status);

      return reply.code(200).send({ drafts });
    },
  );

  // GET /api/content/drafts/:id — get a single draft
  app.get(
    "/drafts/:id",
    {
      schema: {
        description: "Get a specific content draft by ID.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const store = new PrismaContentStore(app.prisma);
      const draft = await store.getDraft(id);

      if (!draft || draft.organizationId !== orgId) {
        return reply.code(404).send({ error: "Draft not found", statusCode: 404 });
      }

      return reply.code(200).send({ draft });
    },
  );

  // POST /api/content/drafts/:id/approve — approve a draft
  app.post(
    "/drafts/:id/approve",
    {
      schema: {
        description: "Approve a content draft for publication.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const contentStore = new PrismaContentStore(app.prisma);
      const draft = await contentStore.getDraft(id);

      if (!draft || draft.organizationId !== orgId) {
        return reply.code(404).send({ error: "Draft not found", statusCode: 404 });
      }

      if (draft.status !== "draft" && draft.status !== "revised") {
        return reply
          .code(409)
          .send({ error: `Cannot approve draft in status: ${draft.status}`, statusCode: 409 });
      }

      const updated = await contentStore.updateDraftStatus(id, "approved");

      // Record approval in performance store
      const perfStore = new PrismaPerformanceStore(app.prisma);
      await perfStore.record(orgId, draft.employeeId, {
        contentId: id,
        outcome: "approved",
      });

      return reply.code(200).send({ draft: updated });
    },
  );

  // POST /api/content/drafts/:id/reject — reject a draft with feedback
  app.post(
    "/drafts/:id/reject",
    {
      schema: {
        description: "Reject a content draft with feedback for revision.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const body = request.body as { feedback?: string };

      const contentStore = new PrismaContentStore(app.prisma);
      const draft = await contentStore.getDraft(id);

      if (!draft || draft.organizationId !== orgId) {
        return reply.code(404).send({ error: "Draft not found", statusCode: 404 });
      }

      if (draft.status !== "draft" && draft.status !== "revised") {
        return reply
          .code(409)
          .send({ error: `Cannot reject draft in status: ${draft.status}`, statusCode: 409 });
      }

      const updated = await contentStore.updateDraftStatus(id, "rejected", body.feedback);

      // Record rejection in performance store
      const perfStore = new PrismaPerformanceStore(app.prisma);
      await perfStore.record(orgId, draft.employeeId, {
        contentId: id,
        outcome: "rejected",
        feedback: body.feedback,
      });

      return reply.code(200).send({ draft: updated });
    },
  );

  // GET /api/content/calendar — list calendar entries
  app.get(
    "/calendar",
    {
      schema: {
        description: "List content calendar entries for the organization.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const query = request.query as {
        after?: string;
        before?: string;
      };

      const store = new PrismaContentStore(app.prisma);
      const entries = await store.listCalendar(
        orgId,
        query.after ? new Date(query.after) : undefined,
        query.before ? new Date(query.before) : undefined,
      );

      return reply.code(200).send({ entries });
    },
  );

  // GET /api/content/performance/:employeeId — get performance stats
  app.get(
    "/performance/:employeeId",
    {
      schema: {
        description: "Get content performance stats for an employee.",
        tags: ["Content"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { employeeId } = request.params as { employeeId: string };

      const perfStore = new PrismaPerformanceStore(app.prisma);
      const approvalRate = await perfStore.getApprovalRate(orgId, employeeId);

      return reply.code(200).send({ performance: approvalRate });
    },
  );
};
