import type { FastifyPluginAsync } from "fastify";
import { profileToPosture } from "@switchboard/core";
import type { GovernanceProfileStore } from "@switchboard/core";
import type { GovernanceProfile } from "@switchboard/schemas";

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
      const { orgId } = request.params as { orgId: string };
      const store = app.governanceProfileStore;
      const profile = await store.get(orgId);
      const posture = profileToPosture(profile);
      const config = await store.getConfig(orgId);

      return reply.code(200).send({
        organizationId: orgId,
        profile,
        posture,
        config,
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
      const { orgId } = request.params as { orgId: string };
      const body = request.body as { profile: GovernanceProfile };

      if (!body.profile) {
        return reply.code(400).send({ error: "profile is required", statusCode: 400 });
      }

      const validProfiles = ["observe", "guarded", "strict", "locked"];
      if (!validProfiles.includes(body.profile)) {
        return reply.code(400).send({
          error: `Invalid profile: ${body.profile}. Must be one of: ${validProfiles.join(", ")}`,
          statusCode: 400,
        });
      }

      const store = app.governanceProfileStore;
      await store.set(orgId, body.profile);

      const posture = profileToPosture(body.profile);
      return reply.code(200).send({
        organizationId: orgId,
        profile: body.profile,
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
      const body = request.body as { organizationId?: string; reason?: string };
      const orgId = body.organizationId ?? request.organizationIdFromAuth ?? null;

      const store = app.governanceProfileStore;
      await store.set(orgId, "locked");

      // Pause active campaigns
      const paused: string[] = [];
      const failures: Array<{ campaignId: string; error: string }> = [];

      try {
        const cartridge = app.storageContext.cartridges.get("digital-ads");
        if (isEmergencyHaltCapable(cartridge)) {
          const campaigns = await cartridge.searchCampaigns("");
          for (const campaign of campaigns) {
            if (campaign.status === "ACTIVE") {
              try {
                const actorId = request.principalIdFromAuth ?? "system";
                const proposeResult = await app.orchestrator.propose({
                  actionType: "digital-ads.campaign.pause",
                  parameters: { campaignId: campaign.id },
                  principalId: actorId,
                  organizationId: orgId,
                  cartridgeId: "digital-ads",
                  message: `Emergency halt: ${body.reason ?? "no reason provided"}`,
                  emergencyOverride: true,
                });

                if (!proposeResult.denied) {
                  await app.orchestrator.executeApproved(proposeResult.envelope.id);
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
        campaignsPaused: paused,
        failures,
        reason: body.reason ?? null,
      });
    },
  );
};
