import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  projectPipeline,
  type PipelineSignalStore,
  type AlexPipelineRow,
  type RileyPipelineRow,
} from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

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
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    // Per-agent precondition checks: Alex doesn't need recommendationStore,
    // Riley doesn't need contactStore.
    const agentKey = agentId as "alex" | "riley";
    if (agentKey === "alex" && !app.contactStore) {
      return reply.code(503).send({ error: "Contact store unavailable" });
    }
    if (agentKey === "riley" && !app.recommendationStore) {
      return reply.code(503).send({ error: "Recommendations store unavailable" });
    }

    const timezone = "Asia/Singapore";
    const log = app.log;

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
