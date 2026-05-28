// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  projectPipeline,
  type PipelineSignalStore,
  type AlexPipelineRow,
  type RileyPipelineRow,
} from "@switchboard/core";
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

const RileyTargetEntitiesSchema = z.object({
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
});

export const pipelineRoute: FastifyPluginAsync = async (app) => {
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

  app.get("/agents/:agentId/pipeline", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });

    const { agentId } = params.data;
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    // Per-agent precondition checks: Alex doesn't need recommendationStore,
    // Riley doesn't need contactStore, Mira needs prisma for the read-model reader.
    const agentKey = agentId as "alex" | "riley" | "mira";
    if (agentKey === "alex" && !app.contactStore) {
      return reply.code(503).send({ error: "Contact store unavailable" });
    }
    if (agentKey === "riley" && !app.recommendationStore) {
      return reply.code(503).send({ error: "Recommendations store unavailable" });
    }
    const prisma = app.prisma;
    if (agentKey === "mira" && !prisma) {
      return reply.code(503).send({ error: "Database unavailable" });
    }

    const timezone = await getOrgTimezone(app.prisma, orgId);
    const log = app.log;
    const miraReader = prisma ? new PrismaMiraCreativeReadModelReader(prisma) : undefined;

    const store: PipelineSignalStore = {
      async listAlexPipeline({ orgId: o, activitySince, limit }) {
        const cs = app.contactStore!;
        const result = await cs.listForPipeline({ orgId: o, activitySince, limit });
        const rows: AlexPipelineRow[] = result.rows.flatMap((c) => {
          if (c.stage !== "active" && c.stage !== "new") return [];
          return [
            {
              id: c.id,
              name: c.name ?? null,
              phone: c.phone ?? null,
              stage: c.stage as "active" | "new",
              lastActivityAt: c.lastActivityAt,
            },
          ];
        });
        return { rows, totalCount: result.totalCount };
      },
      async listRileyPipeline({ orgId: o, limit }) {
        const rs = app.recommendationStore!;
        const result = await rs.listPendingForAgent({
          orgId: o,
          agentKey: "riley",
          surface: "queue",
          limit,
        });
        const rows: RileyPipelineRow[] = result.rows.flatMap((r) => {
          const parsed = RileyTargetEntitiesSchema.safeParse(r.targetEntities);
          if (!parsed.success) {
            log.warn(
              {
                pendingActionRecordId: r.id,
                orgId: o,
                validationIssue: parsed.error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; "),
              },
              "pipeline-riley: dropped row with malformed targetEntities",
            );
            return [];
          }
          if (r.riskLevel !== "low" && r.riskLevel !== "medium" && r.riskLevel !== "high") {
            log.warn(
              {
                pendingActionRecordId: r.id,
                orgId: o,
                validationIssue: `riskLevel: unexpected value '${r.riskLevel}'`,
              },
              "pipeline-riley: dropped row with unknown riskLevel",
            );
            return [];
          }
          return [
            {
              id: r.id,
              intent: r.intent,
              riskLevel: r.riskLevel,
              dollarsAtRisk: r.dollarsAtRisk,
              campaignName: parsed.data.campaignName,
              campaignId: parsed.data.campaignId,
              createdAt: r.createdAt,
            },
          ];
        });
        return { rows, totalCount: result.totalCount };
      },
      async listMiraPipeline({ orgId: o, limit }) {
        // Unreachable: the `agentKey === "mira" && !prisma` guard above 503s
        // before we ever dispatch to Mira without a reader.
        if (!miraReader) throw new Error("listMiraPipeline: prisma unavailable");
        const rm = await miraReader.read(o, { now: new Date(), timezone, visibleLimit: limit });
        return {
          rows: rm.jobs.map((j) => ({
            id: j.id,
            title: j.title,
            status: j.status,
            createdAt: new Date(j.createdAt),
          })),
          // All creative jobs in the fetched window (cockpit summary count,
          // NOT reporting-grade — see PR1 counts honesty note).
          totalCount: rm.counts.total,
        };
      },
    };

    try {
      const vm = await projectPipeline({
        orgId,
        agentKey,
        now: new Date(),
        timezone,
        store,
      });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err, requestId: request.id }, "pipeline projection failed");
      return reply.code(500).send({ error: "Pipeline projection failed", requestId: request.id });
    }
  });
};
