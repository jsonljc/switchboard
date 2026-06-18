// @route-class: control-plane
import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import {
  encryptCredentials,
  seedOrgDayOneAgents,
  seedAlexSkillPack,
  provisionOrgAgentDeployments,
} from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";
import { LAZY_ORG_CONFIG_CREATE_DEFAULTS } from "../lib/org-config-defaults.js";
import { buildManagedWebhookPath } from "../lib/managed-webhook-path.js";
import { resolveProvisionStatus, type StepResult } from "../lib/resolve-provision-status.js";
import { provisionWhatsAppSteps } from "../lib/provision-whatsapp-steps.js";
import { ensureAlexListingForOrg } from "../lib/ensure-alex-listing.js";
import { notifyChatProvisionedChannel } from "../lib/notify-chat-provisioned-channel.js";
import { checkV1ChannelLimit } from "../lib/check-v1-channel-limit.js";

const ALLOWED_CONFIG_UPDATE_FIELDS = new Set([
  "name",
  "runtimeType",
  "runtimeConfig",
  "governanceProfile",
  "onboardingComplete",
]);

export interface OrganizationsRoutesOptions {
  /**
   * Meta Graph API version used for WhatsApp webhook auto-registration.
   * Sourced from a single bootstrap config point (see bootstrap/routes.ts) so
   * all Meta calls in this app stay on the same version. No default — the
   * caller MUST plumb this through.
   */
  apiVersion?: string;
}

export const organizationsRoutes: FastifyPluginAsync<OrganizationsRoutesOptions> = async (
  app,
  opts,
) => {
  const apiVersion = opts.apiVersion ?? "v21.0";
  // GET /api/organizations/:orgId/config
  app.get(
    "/:orgId/config",
    {
      schema: {
        description: "Read org config. Auto-creates with defaults if missing (idempotent upsert).",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const config = await app.prisma.organizationConfig.upsert({
        where: { id: orgId },
        // F-02: comped pilot defaults (entitlementOverride) live in one documented,
        // trusted-path-only source. See ../lib/org-config-defaults.ts.
        create: { id: orgId, ...LAZY_ORG_CONFIG_CREATE_DEFAULTS },
        update: {},
      });

      // Decision 10: seed the Alex listing+deployment on first lazy
      // OrganizationConfig access so a brand-new org sees Alex before any
      // channel is provisioned. Idempotent; the provision route also calls
      // this as a safety net for pre-existing orgs.
      await ensureAlexListingForOrg(orgId, app.prisma);

      // Slice A PR 2: seed day-one agent enablement (alex, riley) so the
      // agent home pages have data on first load. Idempotent — re-runs are a
      // no-op via the helper's `update: {}` upsert.
      await seedOrgDayOneAgents(app.prisma, orgId);
      try {
        await seedAlexSkillPack(app.prisma, orgId);
      } catch (err) {
        console.warn(`[organizations] seedAlexSkillPack failed for ${orgId} (continuing):`, err);
      }

      // F3: provision Riley's deployment (day-one) so the cross-agent revenue loop
      // exists for a real org, not just org_dev. Idempotent + atomic. Mira
      // (day-thirty) is provisioned separately via scripts/provision-mira-for-org.ts.
      // Guarded like seedAlexSkillPack: a provisioning hiccup must not fail config
      // load; the orchestrator is idempotent, so the retry is the next config load.
      try {
        await provisionOrgAgentDeployments(app.prisma, orgId, { mira: false });
      } catch (err) {
        console.warn(
          `[organizations] day-one Riley provisioning failed for ${orgId}; ` +
            `will retry on next config load:`,
          err,
        );
      }

      return reply.send({ config });
    },
  );

  // PUT /api/organizations/:orgId/config
  app.put(
    "/:orgId/config",
    {
      schema: {
        description:
          "Update org config. Rejects writes to id, managedChannels, provisioningStatus.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const body = request.body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (ALLOWED_CONFIG_UPDATE_FIELDS.has(key)) {
          data[key] = value;
        }
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({
          error:
            "No valid update fields provided. Allowed: " +
            [...ALLOWED_CONFIG_UPDATE_FIELDS].join(", "),
          statusCode: 400,
        });
      }

      const config = await app.prisma.organizationConfig.update({
        where: { id: orgId },
        data,
      });

      return reply.send({ config });
    },
  );

  // GET /api/organizations/:orgId/channels
  app.get(
    "/:orgId/channels",
    {
      schema: {
        description: "List managed channels for the organization.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const channels = await app.prisma.managedChannel.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
      });

      const formatted = channels.map((ch) => ({
        id: ch.id,
        channel: ch.channel,
        botUsername: ch.botUsername,
        webhookPath: ch.webhookPath,
        webhookRegistered: ch.webhookRegistered,
        status: ch.status,
        statusDetail: ch.statusDetail,
        lastHealthCheck: ch.lastHealthCheck?.toISOString() ?? null,
        createdAt: ch.createdAt.toISOString(),
      }));

      return reply.send({ channels: formatted });
    },
  );

  // POST /api/organizations/:orgId/provision
  app.post(
    "/:orgId/provision",
    {
      schema: {
        description:
          "Provision one or more channels. Creates Connection + ManagedChannel rows. Synchronous — row creation and local validation only; external activation is deferred.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const { channels } = request.body as {
        channels: Array<{
          channel: string;
          botToken?: string;
          webhookSecret?: string;
          signingSecret?: string;
          token?: string;
          phoneNumberId?: string;
          appSecret?: string;
          verifyToken?: string;
        }>;
      };

      if (!Array.isArray(channels) || channels.length === 0) {
        return reply.code(400).send({ error: "channels array is required", statusCode: 400 });
      }

      const results = [];
      for (const ch of channels) {
        // N1: track the created row id outside the try so the catch can persist
        // status:"error" onto a row that was created before a later step threw.
        // Without this, a partial failure leaves the row at its default
        // "provisioning" status with no reason after reload.
        let createdManagedChannelId: string | null = null;
        try {
          // ── Input validation: WhatsApp requires both token + phoneNumberId ──
          // Without this guard, a WhatsApp request with token-only would let
          // metaRegister succeed (it derives WABA from /debug_token, not
          // phoneNumberId) and silently skip the health probe (gated on
          // phoneNumberId being truthy), producing a fake `active` channel
          // whose inbound webhooks could never resolve. Fail fast at the
          // boundary instead.
          if (ch.channel === "whatsapp") {
            const missing: string[] = [];
            if (!ch.token || ch.token.length === 0) missing.push("token");
            if (!ch.phoneNumberId || ch.phoneNumberId.length === 0) missing.push("phoneNumberId");
            if (missing.length > 0) {
              results.push({
                id: null,
                channel: "whatsapp",
                botUsername: null,
                webhookPath: null,
                webhookRegistered: false,
                status: "error",
                statusDetail: `Missing required WhatsApp credentials: ${missing.join(", ")}.`,
                lastHealthCheck: null,
                createdAt: new Date().toISOString(),
              });
              continue;
            }
          }

          // Task 10: v1 channel-limit precheck. See lib/check-v1-channel-limit.ts.
          const limitCheck = await checkV1ChannelLimit({
            prisma: app.prisma,
            organizationId: orgId,
            channel: ch.channel,
            incomingPhoneNumberId: ch.channel === "whatsapp" ? (ch.phoneNumberId ?? null) : null,
          });
          if (limitCheck.kind !== "no_existing") {
            results.push(limitCheck.result);
            continue;
          }

          const encrypted = encryptCredentials({
            botToken: ch.botToken,
            webhookSecret: ch.webhookSecret,
            signingSecret: ch.signingSecret,
            token: ch.token,
            phoneNumberId: ch.phoneNumberId,
            appSecret: ch.appSecret,
            verifyToken: ch.verifyToken,
          });

          const result = await app.prisma.$transaction(async (tx) => {
            const connection = await tx.connection.create({
              data: {
                id: `conn_${crypto.randomUUID().slice(0, 8)}`,
                organizationId: orgId,
                serviceId: ch.channel,
                serviceName: ch.channel,
                authType: "bot_token",
                credentials: encrypted,
                scopes: [],
              },
            });

            const webhookPath = buildManagedWebhookPath(connection.id);

            const managedChannel = await tx.managedChannel.create({
              data: {
                organizationId: orgId,
                channel: ch.channel,
                connectionId: connection.id,
                webhookPath,
                botUsername: null,
              },
            });

            // ── Beta compatibility bridge (safety net for pre-existing orgs) ──
            // The lazy OrganizationConfig upsert seeds this on first config
            // access; this call is the safety net for orgs that provisioned
            // before that path existed. Identical semantics either way.
            const { listingId: _listingId, deploymentId } = await ensureAlexListingForOrg(
              orgId,
              tx,
            );

            const tokenHash = createHash("sha256").update(connection.id).digest("hex");

            await tx.deploymentConnection.upsert({
              where: {
                deploymentId_type_slot: {
                  deploymentId,
                  type: ch.channel,
                  slot: "default",
                },
              },
              update: {
                credentials: encrypted,
                tokenHash,
                status: "active",
              },
              create: {
                deploymentId,
                type: ch.channel,
                slot: "default",
                credentials: encrypted,
                tokenHash,
              },
            });

            return { connection, managedChannel };
          });

          // N1: the row now exists; record its id so the catch can persist a
          // failure status onto it if a later (post-transaction) step throws.
          createdManagedChannelId = result.managedChannel.id;

          // ── Task 6: per-step StepResult tracking, resolved at the end ──
          // Each provision step collapses into a StepResult; resolveProvisionStatus
          // applies the precedence (config_error > pending_chat_register >
          // health_check_failed > pending_meta_register > active).
          let chatConfig: StepResult = { kind: "ok", reason: null };
          let chatNotify: StepResult = { kind: "ok", reason: null };

          // Chat config: helper detects env gaps; we read env here only because
          // the meta /subscribed_apps registration also needs `chatUrl` to build
          // the webhook URL. Final chatConfig/chatNotify state is set by the
          // helper call below.
          const chatUrl = process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL;
          const internalSecret = process.env.INTERNAL_API_SECRET;

          // ── WhatsApp-specific steps: meta registration + health probe ──
          // Extracted to lib/provision-whatsapp-steps.ts (pure move, no behavior
          // change). Non-whatsapp channels skip this block; all StepResults stay
          // at their ok defaults.
          let metaConfig: StepResult = { kind: "ok", reason: null };
          let metaRegister: StepResult = { kind: "ok", reason: null };
          let healthProbe: StepResult = { kind: "ok", reason: null };
          let webhookRegistered = false;
          let lastHealthCheckIso: string | null = null;

          if (ch.channel === "whatsapp") {
            const waSteps = await provisionWhatsAppSteps({
              apiVersion,
              chatUrl,
              encrypted,
              connectionId: result.connection.id,
              managedChannelId: result.managedChannel.id,
              webhookPath: result.managedChannel.webhookPath,
              prisma: app.prisma,
            });
            metaConfig = waSteps.metaConfig;
            metaRegister = waSteps.metaRegister;
            healthProbe = waSteps.healthProbe;
            webhookRegistered = waSteps.webhookRegistered;
            lastHealthCheckIso = waSteps.lastHealthCheckIso;
          }

          // ── Provision-notify (outside transaction, hardened with one retry) ──
          // Shared helper owns both env-gap detection and the retry. We map its
          // result to the existing chatConfig/chatNotify StepResult slots so the
          // resolver behavior is unchanged. The `config_error_chat:` prefix is
          // preserved here so the resolver's "both gaps" path still names both.
          const notifyResult = await notifyChatProvisionedChannel({
            managedChannelId: result.managedChannel.id,
            chatPublicUrl: chatUrl,
            internalApiSecret: internalSecret,
          });
          if (notifyResult.kind === "config_error") {
            chatConfig = {
              kind: "fail",
              reason: `config_error_chat: ${notifyResult.reason}`,
            };
          } else if (notifyResult.kind === "fail") {
            chatNotify = { kind: "fail", reason: notifyResult.reason };
          }

          const resolved = resolveProvisionStatus({
            metaConfig,
            chatConfig,
            metaRegister,
            healthProbe,
            chatNotify,
            channel: ch.channel as "whatsapp" | "telegram" | "slack",
          });

          // N1: persist the resolved status back to the ManagedChannel row so a
          // later GET /channels reflects the real outcome instead of the schema
          // default "provisioning". Previously the status only ever reached the
          // HTTP results[] array below, so any non-active outcome was invisible
          // after reload. lastHealthCheck is already persisted in the probe
          // block above (active path only); here we settle status/detail/
          // webhookRegistered.
          await app.prisma.managedChannel.update({
            where: { id: result.managedChannel.id },
            data: {
              status: resolved.status,
              statusDetail: resolved.statusDetail,
              webhookRegistered,
            },
          });

          results.push({
            id: result.managedChannel.id,
            channel: result.managedChannel.channel,
            botUsername: result.managedChannel.botUsername,
            webhookPath: result.managedChannel.webhookPath,
            webhookRegistered,
            status: resolved.status,
            statusDetail: resolved.statusDetail,
            lastHealthCheck: resolved.status === "active" ? lastHealthCheckIso : null,
            createdAt: result.managedChannel.createdAt.toISOString(),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          // N1: if the row was created before the throw, persist status:"error"
          // + the message onto it so the partial failure is recoverable and not
          // opaque (the operator can see the reason and delete + re-provision).
          // Best-effort: a failure here must not mask the original error.
          if (createdManagedChannelId) {
            try {
              await app.prisma.managedChannel.update({
                where: { id: createdManagedChannelId },
                data: { status: "error", statusDetail: message },
              });
            } catch (persistErr) {
              console.error(
                `[organizations] failed to persist error status for managed channel ` +
                  `${createdManagedChannelId}:`,
                persistErr,
              );
            }
          }
          results.push({
            id: createdManagedChannelId,
            channel: ch.channel,
            botUsername: null,
            webhookPath: null,
            webhookRegistered: false,
            status: "error",
            statusDetail: message,
            lastHealthCheck: null,
            createdAt: new Date().toISOString(),
          });
        }
      }

      return reply.send({ channels: results });
    },
  );

  // DELETE /api/organizations/:orgId/channels/:channelId
  app.delete(
    "/:orgId/channels/:channelId",
    {
      schema: {
        description: "Delete a managed channel (verifies org ownership).",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId, channelId } = request.params as { orgId: string; channelId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const existing = await app.prisma.managedChannel.findUnique({
        where: { id: channelId },
      });

      if (!existing || existing.organizationId !== orgId) {
        return reply.code(404).send({ error: "Channel not found", statusCode: 404 });
      }

      await app.prisma.managedChannel.delete({ where: { id: channelId } });

      return reply.send({ deleted: true });
    },
  );
};
