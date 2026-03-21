import type { FastifyPluginAsync } from "fastify";
import { StrategistAgent, ProfileResolver, buildMinimalProfile } from "@switchboard/core";
import type { AgentContext } from "@switchboard/core";
import { PrismaAdsOperatorConfigStore } from "@switchboard/db";
import { createLogger } from "../logger.js";

const logger = createLogger("org-handoff");

/**
 * Organization handoff route — triggers post-onboarding welcome and strategist analysis.
 */
export const orgHandoffRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/organizations/:orgId/handoff
  // Triggers post-onboarding handoff: welcome message + strategist analysis
  app.post(
    "/:orgId/handoff",
    {
      schema: {
        description: "Trigger post-onboarding handoff — welcome message and campaign analysis.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      // 1. Load AdsOperatorConfig for this org
      const configStore = new PrismaAdsOperatorConfigStore(app.prisma);
      const opConfig = await configStore.getByOrg(orgId);
      if (!opConfig) {
        return reply.code(400).send({
          error: "No operator config found. Complete the setup wizard first.",
          statusCode: 400,
        });
      }

      // 2. Resolve profile for StrategistAgent context
      let profile = app.resolvedProfile ?? undefined;
      if (!profile && app.prisma) {
        try {
          const orgConfig = await app.prisma.organizationConfig.findUnique({
            where: { id: orgId },
            select: { name: true, skinId: true },
          });
          if (orgConfig?.name) {
            const minimalProfile = buildMinimalProfile({
              orgId,
              businessName: orgConfig.name,
              skinId: orgConfig.skinId ?? "generic",
              timezone: opConfig.schedule.timezone,
            });
            const resolver = new ProfileResolver();
            profile = resolver.resolve(minimalProfile);
          }
        } catch {
          logger.warn(
            { orgId },
            "Could not load org config for profile — strategist may skip plan",
          );
        }
      }

      // 3. Build AgentContext and fire-and-forget strategist tick
      const ctx: AgentContext = {
        config: opConfig,
        orchestrator: app.orchestrator as AgentContext["orchestrator"],
        storage: app.storageContext,
        notifier: app.agentNotifier ?? {
          sendProactive: async (_chatId: string, _channelType: string, _message: string) => {},
        },
        profile,
        skin: app.resolvedSkin ?? undefined,
      };

      const strategist = new StrategistAgent();
      void strategist
        .tick(ctx)
        .catch((err) => logger.error({ err, orgId }, "Handoff strategist tick failed"));

      logger.info({ orgId }, "Post-onboarding handoff triggered — strategist tick started");

      return reply.code(200).send({
        triggered: true,
        message:
          "Campaign analysis started. Your operator will send you a plan on Telegram shortly.",
      });
    },
  );
};
