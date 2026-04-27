import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { encryptCredentials, decryptCredentials } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";
import { buildManagedWebhookPath } from "../lib/managed-webhook-path.js";
import { fetchWabaIdFromToken, registerWebhookOverride } from "../lib/whatsapp-meta.js";
import { probeWhatsAppHealth } from "../lib/whatsapp-health-probe.js";
import { resolveProvisionStatus, type StepResult } from "../lib/resolve-provision-status.js";

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
        create: {
          id: orgId,
          name: "",
          runtimeType: "http",
          runtimeConfig: {},
          governanceProfile: "guarded",
          onboardingComplete: false,
          managedChannels: [],
          provisioningStatus: "pending",
        },
        update: {},
      });

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
        try {
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

            // ── Beta compatibility bridge ──
            const alexListing = await tx.agentListing.upsert({
              where: { slug: "alex-conversion" },
              create: {
                slug: "alex-conversion",
                name: "Alex",
                description: "AI-powered lead conversion agent",
                type: "ai-agent",
                status: "active",
                trustScore: 0,
                autonomyLevel: "supervised",
                priceTier: "free",
                metadata: {},
              },
              update: {},
            });

            const deployment = await tx.agentDeployment.upsert({
              where: {
                organizationId_listingId: {
                  organizationId: orgId,
                  listingId: alexListing.id,
                },
              },
              update: {},
              create: {
                organizationId: orgId,
                listingId: alexListing.id,
                status: "active",
                skillSlug: "alex",
              },
            });

            const tokenHash = createHash("sha256").update(connection.id).digest("hex");

            await tx.deploymentConnection.upsert({
              where: {
                deploymentId_type_slot: {
                  deploymentId: deployment.id,
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
                deploymentId: deployment.id,
                type: ch.channel,
                slot: "default",
                credentials: encrypted,
                tokenHash,
              },
            });

            return { connection, managedChannel };
          });

          // ── Task 6: per-step StepResult tracking, resolved at the end ──
          // Each provision step collapses into a StepResult; resolveProvisionStatus
          // applies the precedence (config_error > pending_chat_register >
          // health_check_failed > pending_meta_register > active).
          let metaConfig: StepResult = { kind: "ok", reason: null };
          let chatConfig: StepResult = { kind: "ok", reason: null };
          let metaRegister: StepResult = { kind: "ok", reason: null };
          let healthProbe: StepResult = { kind: "ok", reason: null };
          let chatNotify: StepResult = { kind: "ok", reason: null };
          let webhookRegistered = false;
          let lastHealthCheckIso: string | null = null;

          // Lifted so the health probe block can reuse decrypted credentials.
          let customerToken: string | undefined;
          let customerPhoneNumberId: string | undefined;

          // Chat config check applies to every channel (notify is channel-agnostic).
          const chatUrl = process.env.CHAT_PUBLIC_URL ?? process.env.SWITCHBOARD_CHAT_URL;
          const internalSecret = process.env.INTERNAL_API_SECRET;
          if (!chatUrl || !internalSecret) {
            const missing: string[] = [];
            if (!chatUrl) missing.push("CHAT_PUBLIC_URL");
            if (!internalSecret) missing.push("INTERNAL_API_SECRET");
            chatConfig = {
              kind: "fail",
              reason: `config_error_chat: missing ${missing.join(" / ")}`,
            };
          }

          // ── Meta webhook auto-registration (best-effort, WhatsApp only) ──
          if (ch.channel === "whatsapp") {
            const appToken = process.env.WHATSAPP_GRAPH_TOKEN;
            const verifyToken = process.env.WHATSAPP_APP_SECRET;

            if (!appToken || !verifyToken) {
              const missing: string[] = [];
              if (!appToken) missing.push("WHATSAPP_GRAPH_TOKEN");
              if (!verifyToken) missing.push("WHATSAPP_APP_SECRET");
              metaConfig = {
                kind: "fail",
                reason: `config_error_meta: missing ${missing.join(" / ")}`,
              };
            }

            // Always attempt to decrypt so the health probe can run even if
            // meta env is missing (probe only needs customer token).
            try {
              const decrypted = decryptCredentials(encrypted) as {
                token?: unknown;
                phoneNumberId?: unknown;
              };
              if (typeof decrypted.token === "string" && decrypted.token.length > 0) {
                customerToken = decrypted.token;
              }
              if (
                typeof decrypted.phoneNumberId === "string" &&
                decrypted.phoneNumberId.length > 0
              ) {
                customerPhoneNumberId = decrypted.phoneNumberId;
              }
            } catch (decryptErr) {
              metaConfig = {
                kind: "fail",
                reason: `Failed to decrypt customer credentials: ${
                  decryptErr instanceof Error ? decryptErr.message : "unknown error"
                }`,
              };
            }

            // Run Meta registration only when we have meta env, chat url (for
            // building the webhook URL), and a customer token.
            if (metaConfig.kind === "ok" && appToken && verifyToken) {
              if (!chatUrl) {
                // chatConfig already failed above; skip meta call (no URL to register).
                metaRegister = {
                  kind: "fail",
                  reason: "Meta registration skipped: chat config missing webhook base URL",
                };
              } else if (!customerToken) {
                metaRegister = {
                  kind: "fail",
                  reason: "Meta registration skipped: customer credentials missing 'token' field",
                };
              } else {
                const wabaResult = await fetchWabaIdFromToken({
                  apiVersion,
                  appToken,
                  userToken: customerToken,
                });
                if (!wabaResult.ok) {
                  metaRegister = {
                    kind: "fail",
                    reason: `Meta WABA lookup (/debug_token) failed: ${wabaResult.reason}`,
                  };
                } else {
                  const reg = await registerWebhookOverride({
                    apiVersion,
                    userToken: customerToken,
                    wabaId: wabaResult.wabaId,
                    webhookUrl: `${chatUrl}${result.managedChannel.webhookPath}`,
                    verifyToken,
                  });
                  if (reg.ok) {
                    metaRegister = { kind: "ok", reason: null };
                    webhookRegistered = true;
                  } else {
                    metaRegister = {
                      kind: "fail",
                      reason: `Meta /subscribed_apps failed: ${reg.reason}`,
                    };
                  }
                }
              }
            } else if (metaConfig.kind === "fail") {
              // Meta env missing — register can't run. Mark failed; resolver
              // will pick config_error (precedes pending_meta_register).
              metaRegister = {
                kind: "fail",
                reason: "Meta registration skipped: meta config missing",
              };
            }

            // ── Synchronous WhatsApp health probe (best-effort) ──
            if (customerToken && customerPhoneNumberId) {
              const probe = await probeWhatsAppHealth({
                apiVersion,
                userToken: customerToken,
                phoneNumberId: customerPhoneNumberId,
              });
              if (probe.ok) {
                lastHealthCheckIso = probe.checkedAt.toISOString();
                await app.prisma.connection.update({
                  where: { id: result.connection.id },
                  data: { lastHealthCheck: probe.checkedAt },
                });
                await app.prisma.managedChannel.update({
                  where: { id: result.managedChannel.id },
                  data: { lastHealthCheck: probe.checkedAt },
                });
              } else {
                healthProbe = {
                  kind: "fail",
                  reason: `Health probe failed: ${probe.reason}`,
                };
              }
            }
          }

          // ── Provision-notify (outside transaction, hardened with one retry) ──
          if (chatConfig.kind === "ok" && chatUrl && internalSecret) {
            let notifyAttempt = 0;
            let notifyOk = false;
            let lastNotifyError: string | null = null;
            while (notifyAttempt < 2 && !notifyOk) {
              if (notifyAttempt > 0) {
                await new Promise((r) => setTimeout(r, 200));
              }
              notifyAttempt++;
              try {
                const notifyRes = await fetch(`${chatUrl}/internal/provision-notify`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${internalSecret}`,
                  },
                  body: JSON.stringify({ managedChannelId: result.managedChannel.id }),
                });
                if (notifyRes.ok) {
                  notifyOk = true;
                } else {
                  lastNotifyError = `Provision-notify HTTP ${notifyRes.status}`;
                }
              } catch (notifyErr) {
                lastNotifyError = notifyErr instanceof Error ? notifyErr.message : "fetch error";
              }
            }
            if (!notifyOk) {
              chatNotify = {
                kind: "fail",
                reason: `Provision-notify failed after retry: ${lastNotifyError}`,
              };
            }
          }

          const resolved = resolveProvisionStatus({
            metaConfig,
            chatConfig,
            metaRegister,
            healthProbe,
            chatNotify,
            channel: ch.channel as "whatsapp" | "telegram" | "slack",
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
          results.push({
            id: null,
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
