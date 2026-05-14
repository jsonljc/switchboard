import type { FastifyPluginAsync } from "fastify";
import { WhatsAppSendTestRequestSchema, type WhatsAppSendTestRequest } from "@switchboard/schemas";
import { fetchWhatsAppTemplates } from "./whatsapp-management.js";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

interface GraphErrorBody {
  error?: {
    code?: number | string;
    message?: string;
    type?: string;
    error_subcode?: number;
  };
}

// Mirrors graphGet's return shape — NO `retryable` field. Callers infer retryable from code.
export type GraphPostResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; httpStatus: number };

// `url` is a full URL — matches graphGet's convention. Caller composes ${graphBase}/${phoneNumberId}/messages.
export async function graphPost(
  url: string,
  body: unknown,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GraphPostResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      code: "WHATSAPP_NETWORK_ERROR",
      message: err instanceof Error ? err.message : "network error",
      httpStatus: 502,
    };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  if (res.ok) return { ok: true, data: parsed };

  const errBody = parsed as GraphErrorBody;
  const code = Number(errBody.error?.code ?? 0);
  const subcode = Number(errBody.error?.error_subcode ?? 0);
  const message = errBody.error?.message ?? "Graph API error";

  if (code === 190) return { ok: false, code: "WHATSAPP_TOKEN_INVALID", message, httpStatus: 502 };
  if (code === 200 || code === 10 || res.status === 403)
    return { ok: false, code: "WHATSAPP_GRAPH_PERMISSION_DENIED", message, httpStatus: 403 };
  if (res.status === 429 || code === 4 || subcode === 80007)
    return { ok: false, code: "WHATSAPP_RATE_LIMITED", message, httpStatus: 429 };
  if (code === 132000 || code === 132001)
    return { ok: false, code: "WHATSAPP_TEMPLATE_NOT_FOUND", message, httpStatus: 400 };
  return { ok: false, code: "WHATSAPP_UPSTREAM_ERROR", message, httpStatus: 502 };
}

// Boundary helper — derive the user-facing retryable flag for the JSON error envelope.
// Intentionally LOCAL to whatsapp-send-test.ts for now. whatsapp-management.ts:398 has its
// own narrower inline check (`code === "WHATSAPP_RATE_LIMITED"`). Unifying both into a
// shared util is a separate follow-up; do not move this helper unless you also update
// whatsapp-management.ts' inline check and add a regression test for /templates' retryable flag.
export function isRetryable(code: string): boolean {
  return (
    code === "WHATSAPP_RATE_LIMITED" ||
    code === "WHATSAPP_UPSTREAM_ERROR" ||
    code === "WHATSAPP_NETWORK_ERROR" ||
    code === "WHATSAPP_NO_MESSAGE_ID"
  );
}

export interface SendTestOptions {
  graphApiFetch?: typeof fetch;
}

export const whatsappSendTestRoutes: FastifyPluginAsync<SendTestOptions> = async (app, opts) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;

  app.post("/send-test", async (request, reply) => {
    const orgId = (request as unknown as { organizationIdFromAuth: string }).organizationIdFromAuth;
    const sentBy = (request as unknown as { userEmail?: string }).userEmail ?? "system";

    const parsed = WhatsAppSendTestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "WHATSAPP_BAD_REQUEST",
          message: parsed.error.issues.map((i) => i.message).join("; "),
          retryable: false,
        },
      });
    }
    const body: WhatsAppSendTestRequest = parsed.data;

    const channel = await app.prisma!.managedChannel.findFirst({
      where: { organizationId: orgId, channel: "whatsapp" },
    });
    if (!channel) {
      return reply.code(404).send({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "WhatsApp channel is not connected",
          retryable: false,
        },
      });
    }

    const allowed = Array.isArray(channel.testRecipients)
      ? (channel.testRecipients as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (!allowed.includes(body.toNumber)) {
      return reply.code(403).send({
        error: {
          code: "WHATSAPP_RECIPIENT_NOT_ALLOWLISTED",
          message: "toNumber must be on this channel's testRecipients allowlist",
          retryable: false,
        },
      });
    }

    const conn = await app.prisma!.connection.findFirst({
      where: { id: channel.connectionId, organizationId: orgId },
    });
    const wabaId = conn?.externalAccountId ?? null;
    if (!wabaId) {
      return reply.code(500).send({
        error: {
          code: "WHATSAPP_WABA_MISSING",
          message: "Connection has no externalAccountId (WABA)",
          retryable: false,
        },
      });
    }
    const token = process.env.META_SYSTEM_USER_TOKEN ?? "";
    if (!token) {
      return reply.code(500).send({
        error: {
          code: "WHATSAPP_TOKEN_MISSING",
          message: "META_SYSTEM_USER_TOKEN is not configured on the server",
          retryable: false,
        },
      });
    }

    const tplResult = await fetchWhatsAppTemplates({ wabaId, token, fetchImpl });
    if (!tplResult.ok) {
      return reply.code(tplResult.httpStatus).send({
        error: {
          code: tplResult.code,
          message: tplResult.message,
          retryable: isRetryable(tplResult.code),
        },
      });
    }
    const tpl = tplResult.templates.find(
      (t) => t.name === body.templateName && t.language === body.languageCode,
    );
    if (!tpl || tpl.status.toUpperCase() !== "APPROVED") {
      return reply.code(400).send({
        error: {
          code: "WHATSAPP_TEMPLATE_NOT_APPROVED",
          message: "Only APPROVED templates can be used for send-test",
          retryable: false,
        },
      });
    }

    const graphBody = {
      messaging_product: "whatsapp",
      to: body.toNumber.replace(/^\+/, ""),
      type: "template",
      template: { name: body.templateName, language: { code: body.languageCode } },
    };
    const result = await graphPost(
      `${GRAPH_BASE}/${body.phoneNumberId}/messages`,
      graphBody,
      token,
      fetchImpl,
    );
    if (!result.ok) {
      return reply.code(result.httpStatus).send({
        error: { code: result.code, message: result.message, retryable: isRetryable(result.code) },
      });
    }
    const data = result.data as { messages?: Array<{ id?: string }> };
    const messageId = data.messages?.[0]?.id;
    if (!messageId) {
      return reply.code(502).send({
        error: {
          code: "WHATSAPP_NO_MESSAGE_ID",
          message: "Graph accepted the message but did not return an ID",
          retryable: true,
        },
      });
    }

    const sentAt = new Date();
    await app.prisma!.whatsAppTestSend.create({
      data: {
        organizationId: orgId,
        managedChannelId: channel.id,
        messageId,
        phoneNumberId: body.phoneNumberId,
        templateName: body.templateName,
        languageCode: body.languageCode,
        toNumber: body.toNumber,
        sentBy,
        sentAt,
        apiStatus: "sent",
      },
    });
    return reply.code(200).send({ messageId, status: "sent", sentAt: sentAt.toISOString() });
  });

  app.get("/test-sends", async (_req, reply) =>
    reply
      .code(501)
      .send({ error: { code: "NOT_IMPLEMENTED", message: "filled next task", retryable: false } }),
  );
};
