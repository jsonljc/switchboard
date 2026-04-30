import type { FastifyPluginAsync } from "fastify";
import { profileToPosture } from "@switchboard/core";
import type { GovernanceProfileStore } from "@switchboard/core";
import {
  SetGovernanceProfileBodySchema,
  EmergencyHaltBodySchema,
  ResumeBodySchema,
} from "../validation.js";
import { checkReadiness, buildReadinessContext } from "./readiness.js";
import { requireOrganizationScope } from "../utils/require-org.js";
import { resolveOperatorActor } from "./operator-actor.js";

declare module "fastify" {
  interface FastifyInstance {
    governanceProfileStore: GovernanceProfileStore;
  }
}

/** Cartridge that supports campaign search/pause via the governance emergency halt. */
interface EmergencyHaltCapableCartridge {
  searchCampaigns(
    query: string,
  ): Promise<Array<{ id: string; status: string; [key: string]: unknown }>>;
}

function isEmergencyHaltCapable(cartridge: unknown): cartridge is EmergencyHaltCapableCartridge {
  return (
    cartridge != null &&
    typeof (cartridge as EmergencyHaltCapableCartridge).searchCampaigns === "function"
  );
}

export const governanceRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/governance/:orgId/status
  app.get(
    "/:orgId/status",
    {
      schema: {
        description: "Get governance profile and posture for an organization.",
        tags: ["Governance"],
      },
    },
    async (request, reply) => {
      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({
          error: "Forbidden: organization mismatch",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      const store = app.governanceProfileStore;
      const profile = await store.get(orgId);
      const posture = profileToPosture(profile);
      const config = await store.getConfig(orgId);

      // Deployment status and halt info
      let deploymentStatus: string = "unknown";
      let haltedAt: string | null = null;
      let haltReason: string | null = null;

      if (app.prisma) {
        const deployment = await app.prisma.agentDeployment.findFirst({
          where: { organizationId: orgId, skillSlug: "alex" },
          select: { status: true },
        });
        deploymentStatus = deployment?.status ?? "not_found";

        if (deploymentStatus === "paused") {
          const haltEntry = await app.prisma.auditEntry.findFirst({
            where: {
              organizationId: orgId,
              eventType: "agent.emergency-halted",
            },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true, snapshot: true },
          });
          if (haltEntry) {
            haltedAt = haltEntry.timestamp.toISOString();
            const snap = haltEntry.snapshot as Record<string, unknown> | null;
            haltReason = typeof snap?.reason === "string" ? snap.reason : null;
          }
        }
      }

      return reply.code(200).send({
        organizationId: orgId,
        profile,
        posture,
        config,
        deploymentStatus,
        haltedAt,
        haltReason,
      });
    },
  );

  // PUT /api/governance/:orgId/profile
  app.put(
    "/:orgId/profile",
    {
      schema: {
        description: "Set governance profile for an organization.",
        tags: ["Governance"],
      },
    },
    async (request, reply) => {
      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({
          error: "Forbidden: organization mismatch",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      const parsed = SetGovernanceProfileBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }

      const store = app.governanceProfileStore;
      await store.set(orgId, parsed.data.profile);

      const posture = profileToPosture(parsed.data.profile);
      return reply.code(200).send({
        organizationId: orgId,
        profile: parsed.data.profile,
        posture,
      });
    },
  );

  // POST /api/governance/emergency-halt
  app.post(
    "/emergency-halt",
    {
      schema: {
        description: "Emergency halt: lock governance profile and pause all campaigns.",
        tags: ["Governance"],
      },
    },
    async (request, reply) => {
      const parsed = EmergencyHaltBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }
      const body = parsed.data;
      const orgId = body.organizationId ?? request.organizationIdFromAuth ?? null;

      if (!orgId) {
        return reply.code(400).send({
          error: "organizationId is required (provide in body or via API key scoping)",
          statusCode: 400,
        });
      }

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: organization mismatch",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      const store = app.governanceProfileStore;
      await store.set(orgId, "locked");

      // Halt all active deployments via the lifecycle store (writes WorkTrace).
      if (!app.deploymentLifecycleStore) {
        return reply.code(503).send({ error: "Deployment store unavailable", statusCode: 503 });
      }

      const operator = resolveOperatorActor(request);
      const haltResult = await app.deploymentLifecycleStore.haltAll({
        organizationId: orgId,
        operator,
        reason: body.reason ?? null,
      });
      const deploymentsPaused = haltResult.count;

      // Domain-event audit row preserved for the /status reader (see spec §3 / §4.6).
      await app.auditLedger.record({
        eventType: "agent.emergency-halted",
        actorType: "user",
        actorId: operator.id,
        entityType: "organization",
        entityId: orgId,
        riskCategory: "high",
        organizationId: orgId,
        summary: `Emergency halt: locked governance and paused ${deploymentsPaused} deployment(s)`,
        snapshot: {
          reason: body.reason ?? null,
          deploymentsPaused,
          workTraceId: haltResult.workTraceId,
          affectedDeploymentIds: haltResult.affectedDeploymentIds,
        },
      });

      const paused: string[] = [];
      const failures: Array<{ campaignId: string; error: string }> = [];

      try {
        const cartridge = app.storageContext.cartridges.get("digital-ads");
        if (isEmergencyHaltCapable(cartridge)) {
          const campaigns = await cartridge.searchCampaigns("");
          const actorId = request.principalIdFromAuth ?? "system";

          for (const campaign of campaigns) {
            if (campaign.status === "ACTIVE") {
              try {
                const response = await app.platformIngress.submit({
                  intent: "digital-ads.campaign.pause",
                  parameters: { campaignId: campaign.id },
                  actor: { id: actorId, type: "user" as const },
                  organizationId: orgId,
                  targetHint: {
                    deploymentId: "emergency-halt",
                    skillSlug: "digital-ads",
                  },
                  trigger: "api" as const,
                  surface: { surface: "api" },
                });

                if (response.ok && response.result.outcome === "completed") {
                  paused.push(campaign.id);
                }
              } catch (err) {
                failures.push({
                  campaignId: campaign.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }
      } catch {
        // Continue — governance profile is already locked
      }

      return reply.code(200).send({
        governanceProfile: "locked",
        organizationId: orgId,
        deploymentsPaused,
        campaignsPaused: paused,
        failures,
        reason: body.reason ?? null,
      });
    },
  );

  // POST /api/governance/resume
  app.post(
    "/resume",
    {
      schema: {
        description: "Resume after emergency halt: restore governance and reactivate deployment.",
        tags: ["Governance"],
      },
    },
    async (request, reply) => {
      const parsed = ResumeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: parsed.error.issues.map((i) => i.message).join("; "),
          statusCode: 400,
        });
      }
      const orgId = parsed.data.organizationId ?? request.organizationIdFromAuth ?? null;

      if (!orgId) {
        return reply.code(400).send({
          error: "organizationId is required (provide in body or via API key scoping)",
          statusCode: 400,
        });
      }

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({
          error: "Forbidden: organization mismatch",
          hint: "Verify your API key is scoped to the correct organization.",
          statusCode: 403,
        });
      }

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      // Gather readiness context via shared helper
      const ctx = await buildReadinessContext(app.prisma, orgId);

      // Override deployment status to "active" for readiness check (it's paused right now)
      const deploymentForCheck = ctx.deployment ? { ...ctx.deployment, status: "active" } : null;

      const report = checkReadiness({
        ...ctx,
        deployment: deploymentForCheck,
      });

      if (!report.ready) {
        return reply.code(400).send({
          resumed: false,
          readiness: report,
          statusCode: 400,
        });
      }

      // Restore governance to guarded (safe default)
      const store = app.governanceProfileStore;
      await store.set(orgId, "guarded");

      // Reactivate paused deployment(s) for the alex skill via the lifecycle store.
      if (!app.deploymentLifecycleStore) {
        return reply.code(503).send({ error: "Deployment store unavailable", statusCode: 503 });
      }
      const operator = resolveOperatorActor(request);
      const resumeResult = await app.deploymentLifecycleStore.resume({
        organizationId: orgId,
        skillSlug: "alex",
        operator,
      });

      // Domain-event audit row preserved.
      await app.auditLedger.record({
        eventType: "agent.resumed",
        actorType: "user",
        actorId: operator.id,
        entityType: "organization",
        entityId: orgId,
        riskCategory: "medium",
        organizationId: orgId,
        summary: `Agent resumed for organization ${orgId}`,
        snapshot: {
          previousProfile: "locked",
          newProfile: "guarded",
          workTraceId: resumeResult.workTraceId,
          affectedDeploymentIds: resumeResult.affectedDeploymentIds,
        },
      });

      return reply.code(200).send({
        resumed: true,
        profile: "guarded",
      });
    },
  );
};
