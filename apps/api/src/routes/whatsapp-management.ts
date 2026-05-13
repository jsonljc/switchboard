import type { FastifyPluginAsync } from "fastify";
import { decryptCredentials } from "@switchboard/db";

interface ManagementOptions {
  /** Test seam for Graph API fetch. Defaults to global fetch. */
  graphApiFetch?: typeof fetch;
}

interface WhatsAppCredentials {
  primaryPhoneNumberId?: string;
  [key: string]: unknown;
}

type ReadinessStatus = "ready" | "needs_attention";

interface ReadinessReason {
  step: string;
  message: string;
}

type QualityBadge = "good" | "warning" | "bad" | "unknown";

interface PhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  codeVerificationStatus: string;
  qualityRating: string;
  qualityBadge: QualityBadge;
  messagingLimit: string;
  isPrimaryForSwitchboard: boolean;
}

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  hasBody: boolean;
  hasButtons: boolean;
  components: unknown[];
}

interface WabaAccount {
  id: string;
  name: string;
  timezone_id: string;
  message_template_namespace: string;
  account_review_status?: string;
}

/** Maps Graph API quality_rating to UI badge */
function qualityBadge(rating: string): QualityBadge {
  switch (rating) {
    case "GREEN":
      return "good";
    case "YELLOW":
      return "warning";
    case "RED":
      return "bad";
    default:
      return "unknown";
  }
}

/** Returns true if phone number status indicates usable connection */
function isUsablePhoneNumberStatus(status: string): boolean {
  return status === "CONNECTED";
}

/** Classifies Graph API errors into typed error codes */
function classifyGraphError(
  res: Response,
  body: { error?: { code?: number; message?: string } },
): string {
  const errorCode = body.error?.code;

  // Token invalid (code 190 or 401 status)
  if (errorCode === 190 || res.status === 401) {
    return "WHATSAPP_TOKEN_INVALID";
  }

  // Permission denied (code 200/10 or 403 status)
  if (errorCode === 200 || errorCode === 10 || res.status === 403) {
    return "WHATSAPP_GRAPH_PERMISSION_DENIED";
  }

  // Rate limited (429 status or codes 4/80007)
  if (res.status === 429 || errorCode === 4 || errorCode === 80007) {
    return "WHATSAPP_RATE_LIMITED";
  }

  // Default upstream error
  return "WHATSAPP_UPSTREAM_ERROR";
}

/** Fetches from Graph API with timeout and error handling */
async function graphGet(
  path: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetchImpl(path, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const body = (await res.json()) as { error?: { code?: number; message?: string } };

    if (!res.ok) {
      return {
        ok: false,
        code: classifyGraphError(res, body),
        message: body.error?.message ?? `HTTP ${res.status}`,
      };
    }

    return { ok: true, data: body };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "WHATSAPP_UPSTREAM_ERROR", message: "Request timeout" };
    }
    return {
      ok: false,
      code: "WHATSAPP_UPSTREAM_ERROR",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export const whatsappManagementRoutes: FastifyPluginAsync<ManagementOptions> = async (
  app,
  opts,
) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;
  const metaSystemUserToken = process.env.META_SYSTEM_USER_TOKEN ?? "";
  const apiVersion = "v21.0";
  const graphBase = `https://graph.facebook.com/${apiVersion}`;

  app.get("/account", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    // Step 1: Look up WhatsApp Connection
    const connection = await app.prisma!.connection.findFirst({
      where: {
        organizationId,
        serviceId: "whatsapp",
      },
    });

    if (!connection) {
      return reply.code(404).send({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "No WhatsApp connection found for this organization",
      });
    }

    // Step 2: Check externalAccountId (wabaId)
    const wabaId = connection.externalAccountId;
    if (!wabaId) {
      return reply.code(409).send({
        error: "WHATSAPP_CONNECTION_INCOMPLETE",
        message: "WhatsApp connection is missing WABA ID",
      });
    }

    // Step 3: Decrypt credentials and check primaryPhoneNumberId
    let primaryPhoneNumberId: string | null = null;
    try {
      // Try to parse as JSON first (for tests), then decrypt (for production)
      let creds: WhatsAppCredentials;
      const credString =
        typeof connection.credentials === "string"
          ? connection.credentials
          : JSON.stringify(connection.credentials);
      try {
        creds = JSON.parse(credString) as WhatsAppCredentials;
      } catch {
        creds = decryptCredentials(credString) as WhatsAppCredentials;
      }
      primaryPhoneNumberId = creds.primaryPhoneNumberId ?? null;
    } catch {
      // If both fail, treat as missing primaryPhoneNumberId
      primaryPhoneNumberId = null;
    }

    if (!primaryPhoneNumberId) {
      return reply.code(409).send({
        error: "WHATSAPP_CONNECTION_INCOMPLETE",
        message: "WhatsApp connection is missing primary phone number ID",
      });
    }

    const reasons: ReadinessReason[] = [];

    // Step 4: Fetch WABA info from Graph API
    const wabaPath = `${graphBase}/${wabaId}?fields=id,name,timezone_id,message_template_namespace,account_review_status`;
    const wabaResult = await graphGet(wabaPath, metaSystemUserToken, fetchImpl);

    if (!wabaResult.ok) {
      return reply.code(200).send({
        readiness: "needs_attention" as ReadinessStatus,
        reasons: [
          {
            step: "waba_access",
            message: "Cannot access WABA information from Meta",
          },
        ],
        connection: {
          id: connection.id,
          wabaId,
          primaryPhoneNumberId,
        },
      });
    }

    const wabaAccount = wabaResult.data as WabaAccount;

    // Step 5: Fetch phone numbers from Graph API
    const phonePath = `${graphBase}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier`;
    const phoneResult = await graphGet(phonePath, metaSystemUserToken, fetchImpl);

    if (!phoneResult.ok) {
      return reply.code(200).send({
        readiness: "needs_attention" as ReadinessStatus,
        reasons: [
          {
            step: "phone_numbers_access",
            message: "Cannot read phone numbers from Meta",
          },
        ],
        connection: {
          id: connection.id,
          wabaId,
          primaryPhoneNumberId,
        },
        account: {
          id: wabaAccount.id,
          name: wabaAccount.name,
          timezone: wabaAccount.timezone_id,
          namespace: wabaAccount.message_template_namespace,
          reviewStatus: wabaAccount.account_review_status ?? "UNKNOWN",
        },
      });
    }

    const phoneData = phoneResult.data as { data?: unknown[] };
    const phoneNumbers = phoneData.data ?? [];

    // Step 6: Check WABA review status
    const reviewStatus = wabaAccount.account_review_status ?? "UNKNOWN";
    if (reviewStatus !== "APPROVED") {
      reasons.push({
        step: "waba_review",
        message: `WABA review status is ${reviewStatus}, not APPROVED`,
      });
    }

    // Step 7: Check if primary phone exists in Graph response
    const primaryPhone = phoneNumbers.find((p: any) => p.id === primaryPhoneNumberId);
    if (!primaryPhone) {
      reasons.push({
        step: "primary_phone_missing",
        message: "Primary phone number not found in WABA phone numbers",
      });
    } else {
      // Step 8: Check primary phone status
      const phoneStatus = (primaryPhone as any).code_verification_status;
      if (!isUsablePhoneNumberStatus(phoneStatus)) {
        reasons.push({
          step: "primary_phone_status",
          message: `Primary phone number status is ${phoneStatus}, not CONNECTED`,
        });
      }

      // Step 9: Check primary phone quality
      const quality = (primaryPhone as any).quality_rating;
      if (quality === "RED") {
        reasons.push({
          step: "primary_phone_quality",
          message: "Phone number quality is low (RED rating)",
        });
      }
    }

    // Step 10: Determine readiness
    const readiness: ReadinessStatus = reasons.length === 0 ? "ready" : "needs_attention";

    return reply.code(200).send({
      readiness,
      reasons,
      connection: {
        id: connection.id,
        wabaId,
        primaryPhoneNumberId,
      },
      account: {
        id: wabaAccount.id,
        name: wabaAccount.name,
        timezone: wabaAccount.timezone_id,
        namespace: wabaAccount.message_template_namespace,
        reviewStatus,
      },
    });
  });

  app.get("/phone-numbers", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const connection = await app.prisma!.connection.findFirst({
      where: {
        organizationId,
        serviceId: "whatsapp",
      },
    });

    if (!connection || !connection.externalAccountId) {
      return reply.code(404).send({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "No WhatsApp connection found",
      });
    }

    const wabaId = connection.externalAccountId;
    let primaryPhoneNumberId: string | null = null;
    try {
      // Try to parse as JSON first (for tests), then decrypt (for production)
      let creds: WhatsAppCredentials;
      const credString =
        typeof connection.credentials === "string"
          ? connection.credentials
          : JSON.stringify(connection.credentials);
      try {
        creds = JSON.parse(credString) as WhatsAppCredentials;
      } catch {
        creds = decryptCredentials(credString) as WhatsAppCredentials;
      }
      primaryPhoneNumberId = creds.primaryPhoneNumberId ?? null;
    } catch {
      // Continue without primary phone number
    }

    const phonePath = `${graphBase}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier`;
    const phoneResult = await graphGet(phonePath, metaSystemUserToken, fetchImpl);

    if (!phoneResult.ok) {
      return reply.code(502).send({
        error: phoneResult.code,
        message: phoneResult.message,
      });
    }

    const phoneData = phoneResult.data as { data?: any[] };
    const phoneNumbers: PhoneNumber[] = (phoneData.data ?? []).map((p: any) => ({
      id: p.id,
      displayPhoneNumber: p.display_phone_number ?? "",
      verifiedName: p.verified_name ?? "",
      codeVerificationStatus: p.code_verification_status ?? "UNKNOWN",
      qualityRating: p.quality_rating ?? "UNKNOWN",
      qualityBadge: qualityBadge(p.quality_rating ?? ""),
      messagingLimit: p.messaging_limit_tier ?? "UNKNOWN",
      isPrimaryForSwitchboard: p.id === primaryPhoneNumberId,
    }));

    return reply.code(200).send({ phoneNumbers });
  });

  app.get("/templates", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const connection = await app.prisma!.connection.findFirst({
      where: {
        organizationId,
        serviceId: "whatsapp",
      },
    });

    if (!connection || !connection.externalAccountId) {
      return reply.code(404).send({
        error: "WHATSAPP_NOT_CONNECTED",
        message: "No WhatsApp connection found",
      });
    }

    const wabaId = connection.externalAccountId;
    const templatePath = `${graphBase}/${wabaId}/message_templates?fields=id,name,language,status,category,components`;
    const templateResult = await graphGet(templatePath, metaSystemUserToken, fetchImpl);

    if (!templateResult.ok) {
      return reply.code(502).send({
        error: templateResult.code,
        message: templateResult.message,
      });
    }

    const templateData = templateResult.data as { data?: any[] };
    const templates: Template[] = (templateData.data ?? []).map((t: any) => {
      const components = Array.isArray(t.components) ? t.components : [];
      const hasBody = components.some((c: any) => c.type === "BODY");
      const hasButtons = components.some((c: any) => c.type === "BUTTONS");

      return {
        id: t.id,
        name: t.name ?? "",
        language: t.language ?? "",
        status: t.status ?? "UNKNOWN",
        category: t.category ?? "",
        hasBody,
        hasButtons,
        components: t.components ?? [],
      };
    });

    return reply.code(200).send({ templates });
  });
};
