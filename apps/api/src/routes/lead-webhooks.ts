import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateToken, hashToken, tokenPrefix } from "../services/lead-webhook/token.js";
import { requireOrganizationScope } from "../utils/require-org.js";

const VALID_SOURCES = ["tally", "typeform", "webflow", "google-forms", "generic"] as const;

const CreateBody = z.object({
  label: z.string().min(1).max(120),
  sourceType: z.enum(VALID_SOURCES),
  greetingTemplateName: z.string().min(1).max(120).optional(),
});

function publicBaseUrl(request: { protocol: string; host: string }): string {
  return process.env["PUBLIC_API_BASE_URL"] ?? `${request.protocol}://${request.host}`;
}

interface WebhookRow {
  id: string;
  organizationId: string;
  label: string;
  tokenPrefix: string;
  sourceType: string;
  greetingTemplateName: string;
  status: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

function publicView(row: WebhookRow) {
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.tokenPrefix,
    sourceType: row.sourceType,
    greetingTemplateName: row.greetingTemplateName,
    status: row.status,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export const leadWebhooksRoutes: FastifyPluginAsync = async (app) => {
  app.post("/lead-webhooks", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", details: parsed.error.format() });
    }

    const token = generateToken();
    const created = (await app.leadWebhookStore.create({
      organizationId: orgId,
      label: parsed.data.label,
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefix(token),
      sourceType: parsed.data.sourceType,
      greetingTemplateName: parsed.data.greetingTemplateName,
    } as never)) as unknown as WebhookRow;

    return reply.code(201).send({
      ...publicView(created),
      token, // returned ONCE
      url: `${publicBaseUrl(request)}/api/leads/inbound/${token}`,
    });
  });

  app.get("/lead-webhooks", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    const list = (await app.leadWebhookStore.listByOrg(orgId)) as unknown as WebhookRow[];
    return reply.send({ webhooks: list.map(publicView) });
  });

  app.post<{ Params: { id: string } }>("/lead-webhooks/:id/revoke", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    // Defensive: confirm the row belongs to this org before revoking
    const list = (await app.leadWebhookStore.listByOrg(orgId)) as unknown as WebhookRow[];
    const owned = list.some((w) => w.id === request.params.id);
    if (!owned) return reply.code(404).send({ error: "not_found" });
    await app.leadWebhookStore.revoke(request.params.id);
    return reply.send({ ok: true });
  });
};
