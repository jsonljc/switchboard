import type { FastifyPluginAsync } from "fastify";

export const smbRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/smb/:orgId/activity-log — query SMB activity log
  app.get("/:orgId/activity-log", {
    schema: {
      description: "Query SMB activity log for an organization.",
      tags: ["SMB"],
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    // Verify this is an SMB org
    const tier = await app.tierStore.getTier(orgId);
    if (tier !== "smb") {
      return reply.code(400).send({
        error: "Activity log is only available for SMB organizations. Use the audit API for enterprise orgs.",
        statusCode: 400,
      });
    }

    const query = request.query as {
      actorId?: string;
      actionType?: string;
      result?: string;
      after?: string;
      before?: string;
      limit?: string;
      offset?: string;
    };

    const entries = await app.smbActivityLog.query({
      organizationId: orgId,
      actorId: query.actorId,
      actionType: query.actionType,
      result: query.result as any,
      after: query.after ? new Date(query.after) : undefined,
      before: query.before ? new Date(query.before) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return reply.code(200).send({ entries });
  });

  // GET /api/smb/:orgId/tier — get org tier + config
  app.get("/:orgId/tier", {
    schema: {
      description: "Get organization tier and SMB configuration.",
      tags: ["SMB"],
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const tier = await app.tierStore.getTier(orgId);
    const smbConfig = tier === "smb" ? await app.tierStore.getSmbConfig(orgId) : null;

    return reply.code(200).send({ tier, smbConfig });
  });

  // PUT /api/smb/:orgId/tier — update SMB config
  app.put("/:orgId/tier", {
    schema: {
      description: "Update SMB organization configuration.",
      tags: ["SMB"],
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const tier = await app.tierStore.getTier(orgId);
    if (tier !== "smb") {
      return reply.code(400).send({
        error: "Can only update SMB config for SMB-tier organizations",
        statusCode: 400,
      });
    }

    const body = request.body as {
      governanceProfile?: string;
      allowedActionTypes?: string[];
      blockedActionTypes?: string[];
      perActionSpendLimit?: number | null;
      dailySpendLimit?: number | null;
      ownerId?: string;
    };

    const existing = await app.tierStore.getSmbConfig(orgId);
    if (!existing && !body.ownerId) {
      return reply.code(400).send({
        error: "ownerId is required when creating initial SMB config",
        statusCode: 400,
      });
    }

    const config = {
      tier: "smb" as const,
      governanceProfile: (body.governanceProfile ?? existing?.governanceProfile ?? "guarded") as any,
      allowedActionTypes: body.allowedActionTypes ?? existing?.allowedActionTypes,
      blockedActionTypes: body.blockedActionTypes ?? existing?.blockedActionTypes,
      perActionSpendLimit: body.perActionSpendLimit !== undefined ? body.perActionSpendLimit : (existing?.perActionSpendLimit ?? null),
      dailySpendLimit: body.dailySpendLimit !== undefined ? body.dailySpendLimit : (existing?.dailySpendLimit ?? null),
      ownerId: body.ownerId ?? existing?.ownerId ?? "",
    };

    await app.tierStore.setSmbConfig(orgId, config);

    return reply.code(200).send({ config });
  });

  // POST /api/smb/:orgId/upgrade — upgrade SMB → enterprise
  app.post("/:orgId/upgrade", {
    schema: {
      description: "Upgrade an SMB organization to enterprise tier.",
      tags: ["SMB"],
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const tier = await app.tierStore.getTier(orgId);
    if (tier === "enterprise") {
      return reply.code(400).send({
        error: "Organization is already on enterprise tier",
        statusCode: 400,
      });
    }

    await app.tierStore.upgradeTier(orgId, "enterprise");

    return reply.code(200).send({
      tier: "enterprise",
      message: "Organization upgraded to enterprise tier. Configure identity specs and policies to use the full governance pipeline.",
    });
  });
};
