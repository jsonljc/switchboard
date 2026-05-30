// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import {
  WhatsAppCreateTemplateRequestSchema,
  type WhatsAppCreateTemplateRequest,
} from "@switchboard/schemas";
import { graphPost, isRetryable } from "./whatsapp-send-test.js";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface TemplateCreateOptions {
  graphApiFetch?: typeof fetch;
}

interface GraphComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT";
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
}

/** Translate the validated request into Meta's `components[]` payload. */
function toComponents(req: WhatsAppCreateTemplateRequest): GraphComponent[] {
  const components: GraphComponent[] = [];
  if (req.header) {
    components.push({ type: "HEADER", format: "TEXT", text: req.header.text });
  }
  const body: GraphComponent = { type: "BODY", text: req.body.text };
  if (req.body.examples && req.body.examples.length > 0) {
    body.example = { body_text: [req.body.examples] };
  }
  components.push(body);
  if (req.footer) {
    components.push({ type: "FOOTER", text: req.footer.text });
  }
  if (req.buttons && req.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: req.buttons.map((b) => {
        if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
        if (b.type === "PHONE_NUMBER")
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }
  return components;
}

export const whatsappTemplateCreateRoutes: FastifyPluginAsync<TemplateCreateOptions> = async (
  app,
  opts,
) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;

  app.post("/templates", async (request, reply) => {
    const orgId = (request as unknown as { organizationIdFromAuth?: string })
      .organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
      });
    }

    const parsed = WhatsAppCreateTemplateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "WHATSAPP_BAD_REQUEST",
          message: parsed.error.issues.map((i) => i.message).join("; "),
          retryable: false,
        },
      });
    }
    const body = parsed.data;

    const conn = await app.prisma!.connection.findFirst({
      where: { organizationId: orgId, serviceId: "whatsapp" },
    });
    if (!conn) {
      return reply.code(404).send({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "No WhatsApp connection found",
          retryable: false,
        },
      });
    }
    const wabaId = conn.externalAccountId;
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
          message: "META_SYSTEM_USER_TOKEN is not configured",
          retryable: false,
        },
      });
    }

    const graphBody = {
      name: body.name,
      language: body.language,
      category: body.category,
      components: toComponents(body),
    };
    const result = await graphPost(
      `${GRAPH_BASE}/${wabaId}/message_templates`,
      graphBody,
      token,
      fetchImpl,
    );
    if (!result.ok) {
      return reply.code(result.httpStatus).send({
        error: { code: result.code, message: result.message, retryable: isRetryable(result.code) },
      });
    }
    const data = result.data as { id?: string; status?: string; category?: string };
    return reply.code(200).send({
      id: data.id ?? null,
      status: data.status ?? "PENDING",
      category: data.category ?? body.category,
    });
  });
};
