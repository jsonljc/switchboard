// @route-class: read-only
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

type ReadinessStatus = "ready" | "needs_attention" | "incomplete" | "not_connected";

type QualityBadge = "good" | "warning" | "bad" | "unknown";

interface PhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  qualityBadge: QualityBadge;
  messagingLimitTier: string | null;
  status: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
  isOfficialBusinessAccount: boolean | null;
  isPrimaryForSwitchboard: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  hasBody: boolean;
  hasButtons: boolean;
  rejectedReason: string | null;
}

interface WabaAccount {
  id: string;
  name: string;
  currency: string;
  timezone_id: string;
  message_template_namespace: string;
  account_review_status?: string;
}

/**
 * A `phone_numbers` entry as returned by the WhatsApp Graph API. All fields are
 * optional because Graph omits absent fields; consumers must null-coalesce.
 */
interface GraphPhoneNumber {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
  status?: string;
  platform_type?: string;
  code_verification_status?: string;
  is_official_business_account?: boolean;
}

/** Envelope wrapping the `phone_numbers` edge list from the Graph API. */
interface GraphPhoneNumbersResponse {
  data?: GraphPhoneNumber[];
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

/** Classifies Graph API errors into typed error codes + appropriate HTTP status */
function classifyGraphError(
  res: Response,
  body: { error?: { code?: number; message?: string } },
): { code: string; httpStatus: number } {
  const errorCode = body.error?.code;

  // Token invalid (code 190 or 401 status)
  if (errorCode === 190 || res.status === 401) {
    return { code: "WHATSAPP_TOKEN_INVALID", httpStatus: 502 };
  }

  // Permission denied (code 200/10 or 403 status)
  if (errorCode === 200 || errorCode === 10 || res.status === 403) {
    return { code: "WHATSAPP_GRAPH_PERMISSION_DENIED", httpStatus: 403 };
  }

  // Rate limited (429 status or codes 4/80007)
  if (res.status === 429 || errorCode === 4 || errorCode === 80007) {
    return { code: "WHATSAPP_RATE_LIMITED", httpStatus: 429 };
  }

  // Default upstream error
  return { code: "WHATSAPP_UPSTREAM_ERROR", httpStatus: 502 };
}

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const graphBase = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Fetches from Graph API with timeout and error handling */
async function graphGet(
  path: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true; data: unknown } | { ok: false; code: string; message: string; httpStatus: number }
> {
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
      const classified = classifyGraphError(res, body);
      return {
        ok: false,
        code: classified.code,
        httpStatus: classified.httpStatus,
        message: body.error?.message ?? `HTTP ${res.status}`,
      };
    }

    return { ok: true, data: body };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        code: "WHATSAPP_UPSTREAM_ERROR",
        httpStatus: 502,
        message: "Request timeout",
      };
    }
    return {
      ok: false,
      code: "WHATSAPP_UPSTREAM_ERROR",
      httpStatus: 502,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Fetches approved/pending/rejected message templates for a WABA from the Graph API.
 * Shared between the `/templates` route and the send-test flow so the URL + mapping
 * stay in lockstep.
 */
export async function fetchWhatsAppTemplates(args: {
  wabaId: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { ok: true; templates: WhatsAppTemplate[] }
  | { ok: false; code: string; message: string; httpStatus: number }
> {
  const { wabaId, token, fetchImpl } = args;
  const templatePath = `${graphBase}/${wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100`;
  const templateResult = await graphGet(templatePath, token, fetchImpl);

  if (!templateResult.ok) {
    return {
      ok: false,
      code: templateResult.code,
      message: templateResult.message,
      httpStatus: templateResult.httpStatus,
    };
  }

  const templateData = templateResult.data as { data?: any[] };
  const templates: WhatsAppTemplate[] = (templateData.data ?? []).map((t: any) => {
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
      rejectedReason: (t.rejected_reason as string) ?? null,
    };
  });

  return { ok: true, templates };
}

export const whatsappManagementRoutes: FastifyPluginAsync<ManagementOptions> = async (
  app,
  opts,
) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;
  const metaSystemUserToken = process.env.META_SYSTEM_USER_TOKEN ?? "";

  app.get("/account", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
      });
    }

    // Step 1: Look up WhatsApp Connection + ManagedChannel (allowlist) in parallel
    const [connection, channel] = await Promise.all([
      app.prisma!.connection.findFirst({
        where: {
          organizationId,
          serviceId: "whatsapp",
        },
      }),
      app.prisma!.managedChannel.findFirst({
        where: { organizationId, channel: "whatsapp" },
      }),
    ]);

    const testRecipients: string[] = Array.isArray(
      (channel as { testRecipients?: unknown } | null)?.testRecipients,
    )
      ? ((channel as { testRecipients: unknown[] }).testRecipients.filter(
          (x): x is string => typeof x === "string",
        ) as string[])
      : [];

    if (!connection) {
      return reply.code(200).send({
        connection: {
          status: "not_connected" as const,
          externalAccountId: null,
          primaryPhoneNumberId: null,
          connectedAt: null,
          testRecipients,
        },
        account: {
          id: null,
          name: null,
          currency: null,
          timezoneId: null,
          reviewStatus: null,
          templateNamespace: null,
        },
        readiness: {
          status: "not_connected" as ReadinessStatus,
          reasons: ["No WhatsApp connection found for this organization"],
        },
      });
    }

    // Step 2: Check externalAccountId (wabaId)
    const wabaId = connection.externalAccountId;

    // Step 3: Decrypt credentials and check primaryPhoneNumberId
    let primaryPhoneNumberId: string | null = null;
    try {
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
      primaryPhoneNumberId = null;
    }

    const connectedAt =
      (connection as Record<string, unknown>).connectedAt != null
        ? String((connection as Record<string, unknown>).connectedAt)
        : null;

    if (!wabaId || !primaryPhoneNumberId) {
      return reply.code(200).send({
        connection: {
          status: "incomplete" as const,
          externalAccountId: wabaId ?? null,
          primaryPhoneNumberId,
          connectedAt,
          testRecipients,
        },
        account: {
          id: null,
          name: null,
          currency: null,
          timezoneId: null,
          reviewStatus: null,
          templateNamespace: null,
        },
        readiness: {
          status: "incomplete" as ReadinessStatus,
          reasons: [
            ...(!wabaId ? ["WhatsApp connection is missing WABA ID"] : []),
            ...(!primaryPhoneNumberId
              ? ["WhatsApp connection is missing primary phone number ID"]
              : []),
          ],
        },
      });
    }

    const reasons: string[] = [];

    // Step 4: Fetch WABA info from Graph API
    const wabaPath = `${graphBase}/${wabaId}?fields=id,name,currency,timezone_id,message_template_namespace,account_review_status`;
    const wabaResult = await graphGet(wabaPath, metaSystemUserToken, fetchImpl);

    if (!wabaResult.ok) {
      return reply.code(200).send({
        connection: {
          status: "needs_attention" as const,
          externalAccountId: wabaId,
          primaryPhoneNumberId,
          connectedAt,
          testRecipients,
        },
        account: {
          id: null,
          name: null,
          currency: null,
          timezoneId: null,
          reviewStatus: null,
          templateNamespace: null,
        },
        readiness: {
          status: "needs_attention" as ReadinessStatus,
          reasons: ["Cannot access WABA information from Meta"],
        },
      });
    }

    const wabaAccount = wabaResult.data as WabaAccount;

    // Step 5: Fetch phone numbers from Graph API (lightweight query for readiness only)
    const phonePath = `${graphBase}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,messaging_limit_tier`;
    const phoneResult = await graphGet(phonePath, metaSystemUserToken, fetchImpl);

    let phoneNumbers: GraphPhoneNumber[] = [];
    if (!phoneResult.ok) {
      // I4: accumulate reason but don't short-circuit — step 6 only needs WABA data
      reasons.push("Cannot read phone numbers from Meta");
    } else {
      const phoneData = phoneResult.data as GraphPhoneNumbersResponse;
      phoneNumbers = phoneData.data ?? [];
    }

    // Step 6: Check WABA review status (runs even if step 5 failed)
    const reviewStatus = wabaAccount.account_review_status ?? "UNKNOWN";
    if (reviewStatus !== "APPROVED") {
      reasons.push(`WABA review status is ${reviewStatus}, not APPROVED`);
    }

    // Step 7: Check if primary phone exists in Graph response (skip if step 5 failed)
    if (phoneNumbers.length > 0 || phoneResult.ok) {
      const primaryPhone = phoneNumbers.find((p) => p.id === primaryPhoneNumberId);
      if (!primaryPhone) {
        reasons.push("Primary phone number not found in WABA phone numbers");
      } else {
        // Step 8: Check primary phone status — C2: check `status` not `code_verification_status`
        const phoneStatus = primaryPhone.status;
        if (!isUsablePhoneNumberStatus(phoneStatus ?? "")) {
          reasons.push(`Primary phone number status is ${phoneStatus ?? "UNKNOWN"}, not CONNECTED`);
        }

        // Step 9: Check primary phone quality
        const quality = primaryPhone.quality_rating;
        if (quality === "RED") {
          reasons.push("Phone number quality is low (RED rating)");
        }
      }
    }

    // Step 10: Determine readiness
    const readinessStatus: ReadinessStatus = reasons.length === 0 ? "ready" : "needs_attention";

    return reply.code(200).send({
      connection: {
        status: "connected" as const,
        externalAccountId: wabaId,
        primaryPhoneNumberId,
        connectedAt,
        testRecipients,
      },
      account: {
        id: wabaAccount.id ?? null,
        name: wabaAccount.name ?? null,
        currency: wabaAccount.currency ?? null,
        timezoneId: wabaAccount.timezone_id ?? null,
        reviewStatus,
        templateNamespace: wabaAccount.message_template_namespace ?? null,
      },
      readiness: {
        status: readinessStatus,
        reasons,
      },
    });
  });

  app.get("/phone-numbers", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
      });
    }

    const connection = await app.prisma!.connection.findFirst({
      where: {
        organizationId,
        serviceId: "whatsapp",
      },
    });

    if (!connection || !connection.externalAccountId) {
      return reply.code(404).send({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "No WhatsApp connection found",
          retryable: false,
        },
      });
    }

    const wabaId = connection.externalAccountId;
    let primaryPhoneNumberId: string | null = null;
    try {
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

    const phonePath = `${graphBase}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status,is_official_business_account,status,messaging_limit_tier`;
    const phoneResult = await graphGet(phonePath, metaSystemUserToken, fetchImpl);

    if (!phoneResult.ok) {
      return reply.code(phoneResult.httpStatus).send({
        error: {
          code: phoneResult.code,
          message: phoneResult.message,
          retryable: phoneResult.code === "WHATSAPP_RATE_LIMITED",
        },
      });
    }

    const phoneData = phoneResult.data as GraphPhoneNumbersResponse;
    const phoneNumbers: PhoneNumber[] = (phoneData.data ?? []).map((p) => ({
      id: p.id ?? "",
      displayPhoneNumber: p.display_phone_number ?? null,
      verifiedName: p.verified_name ?? null,
      qualityRating: p.quality_rating ?? null,
      qualityBadge: qualityBadge(p.quality_rating ?? ""),
      messagingLimitTier: p.messaging_limit_tier ?? null,
      status: p.status ?? null,
      platformType: p.platform_type ?? null,
      codeVerificationStatus: p.code_verification_status ?? null,
      isOfficialBusinessAccount: p.is_official_business_account ?? null,
      isPrimaryForSwitchboard: p.id === primaryPhoneNumberId,
    }));

    return reply.code(200).send({ phoneNumbers });
  });

  app.get("/templates", async (request, reply) => {
    const organizationId = request.organizationIdFromAuth;
    if (!organizationId) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
      });
    }

    const connection = await app.prisma!.connection.findFirst({
      where: {
        organizationId,
        serviceId: "whatsapp",
      },
    });

    if (!connection || !connection.externalAccountId) {
      return reply.code(404).send({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "No WhatsApp connection found",
          retryable: false,
        },
      });
    }

    const wabaId = connection.externalAccountId;
    const templateResult = await fetchWhatsAppTemplates({
      wabaId,
      token: metaSystemUserToken,
      fetchImpl,
    });

    if (!templateResult.ok) {
      return reply.code(templateResult.httpStatus).send({
        error: {
          code: templateResult.code,
          message: templateResult.message,
          retryable: templateResult.code === "WHATSAPP_RATE_LIMITED",
        },
      });
    }

    return reply.code(200).send({ templates: templateResult.templates });
  });
};
