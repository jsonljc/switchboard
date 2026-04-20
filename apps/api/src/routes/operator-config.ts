// ---------------------------------------------------------------------------
// Operator Config routes — CRUD for AdsOperatorConfig
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";

// TODO: These imports reference modules that don't exist yet.
// Stubbed to allow typecheck to pass. Re-enable when the feature is built.
// import { AdsOperatorConfigSchema } from "@switchboard/schemas";
// import type { AdsOperatorConfig } from "@switchboard/schemas";
// import { PrismaAdsOperatorConfigStore } from "@switchboard/db";
// import { ProgressiveAutonomyController, automationLevelToProfile } from "@switchboard/core";
// import type { CompetenceSnapshot } from "@switchboard/core";

type AdsOperatorConfig = {
  id: string;
  organizationId: string;
  principalId: string;
  automationLevel: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};
const AdsOperatorConfigSchema = {
  omit: () => ({
    safeParse: (_v: unknown) => ({
      success: false as const,
      error: { flatten: () => ({ fieldErrors: {} }) },
    }),
  }),
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PrismaAdsOperatorConfigStore = class {
  constructor(_p: unknown) {}
  create(_d: unknown): Promise<unknown> {
    return Promise.resolve(null);
  }
  getByOrg(_id: string): Promise<AdsOperatorConfig | null> {
    return Promise.resolve(null);
  }
  update(_id: string, _d: unknown): Promise<unknown> {
    return Promise.resolve(null);
  }
}; // eslint-disable-line @typescript-eslint/no-explicit-any
const ProgressiveAutonomyController = class {
  assess(_p: unknown, _s: unknown): unknown {
    return {};
  }
};
const automationLevelToProfile = (_level: string): unknown => ({});
type CompetenceSnapshot = {
  score: number;
  successCount: number;
  failureCount: number;
  rollbackCount: number;
};

export const operatorConfigRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/operator-config — create config
  app.post(
    "/",
    {
      schema: {
        description: "Create an AdsOperatorConfig for an organization.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const body = request.body as {
        organizationId: string;
        adAccountIds: string[];
        platforms: string[];
        automationLevel: string;
        targets: Record<string, unknown>;
        schedule: Record<string, unknown>;
        notificationChannel: Record<string, unknown>;
        principalId?: string;
        active?: boolean;
      };

      if (!body.organizationId) {
        return reply.code(400).send({ error: "organizationId is required", statusCode: 400 });
      }

      if (
        request.organizationIdFromAuth &&
        body.organizationId !== request.organizationIdFromAuth
      ) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const principalId = body.principalId ?? request.principalIdFromAuth ?? "system";

      // Validate the config shape via Zod (minus auto-generated fields)
      const parseResult = AdsOperatorConfigSchema.omit({
        id: true,
        createdAt: true,
        updatedAt: true,
      }).safeParse({
        ...body,
        principalId,
        active: body.active ?? true,
      });

      if (!parseResult.success) {
        return reply.code(400).send({
          error: "Invalid operator config",
          details: parseResult.error.flatten().fieldErrors,
          statusCode: 400,
        });
      }

      const store = new PrismaAdsOperatorConfigStore(app.prisma);
      const config = await store.create(parseResult.data);

      return reply.code(201).send({ config });
    },
  );

  // GET /api/operator-config/:orgId — get config for org
  app.get(
    "/:orgId",
    {
      schema: {
        description: "Get AdsOperatorConfig for an organization.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId } = request.params as { orgId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const store = new PrismaAdsOperatorConfigStore(app.prisma);
      const config = await store.getByOrg(orgId);

      if (!config) {
        return reply.code(404).send({ error: "Operator config not found", statusCode: 404 });
      }

      return reply.code(200).send({ config });
    },
  );

  // PUT /api/operator-config/:orgId — update config
  app.put(
    "/:orgId",
    {
      schema: {
        description: "Update AdsOperatorConfig for an organization.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId } = request.params as { orgId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const store = new PrismaAdsOperatorConfigStore(app.prisma);
      const existing = await store.getByOrg(orgId);

      if (!existing) {
        return reply.code(404).send({ error: "Operator config not found", statusCode: 404 });
      }

      const updates = request.body as Partial<
        Omit<AdsOperatorConfig, "id" | "organizationId" | "principalId" | "createdAt" | "updatedAt">
      >;

      const config = await store.update(existing.id, updates);
      return reply.code(200).send({ config });
    },
  );

  // GET /api/operator-config/:orgId/autonomy — autonomy assessment
  app.get(
    "/:orgId/autonomy",
    {
      schema: {
        description: "Get autonomy assessment for an organization's operator config.",
        tags: ["Agents"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId } = request.params as { orgId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const store = new PrismaAdsOperatorConfigStore(app.prisma);
      const opConfig = await store.getByOrg(orgId);

      if (!opConfig) {
        return reply.code(404).send({ error: "Operator config not found", statusCode: 404 });
      }

      // Aggregate competence records for this principal
      const records = await app.storageContext.competence.listRecords(opConfig.principalId);

      const snapshot: CompetenceSnapshot = {
        score: 0,
        successCount: 0,
        failureCount: 0,
        rollbackCount: 0,
      };

      for (const r of records) {
        snapshot.successCount += r.successCount;
        snapshot.failureCount += r.failureCount;
        snapshot.rollbackCount += r.rollbackCount;
        snapshot.score += r.score;
      }

      if (records.length > 0) {
        snapshot.score = snapshot.score / records.length;
      }

      const controller = new ProgressiveAutonomyController();
      const currentProfile = automationLevelToProfile(opConfig.automationLevel);
      const assessment = controller.assess(currentProfile, snapshot);

      return reply.code(200).send({ assessment });
    },
  );
};
